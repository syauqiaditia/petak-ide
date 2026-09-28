import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const tmpDir = '/tmp/petak_test_missing_import';
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });
fs.writeFileSync(
  path.join(tmpDir, 'pubspec.yaml'),
  `name: test_mi
environment:
  sdk: '>=3.0.0 <4.0.0'
`
);

const code = `void main() {
  Random r = Random();
}
`;
const filePath = path.join(tmpDir, 'lib', 'main.dart');
fs.writeFileSync(filePath, code);

const proc = spawn('dart', ['language-server', '--protocol=lsp'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let msgId = 0;
function send(obj) {
  const str = JSON.stringify(obj);
  proc.stdin.write(`Content-Length: ${Buffer.byteLength(str)}\r\n\r\n${str}`);
}

function request(method, params) {
  const id = ++msgId;
  send({ jsonrpc: '2.0', id, method, params });
  return id;
}

let buffer = Buffer.alloc(0);
const responses = new Map();
let diagnostics = [];

proc.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const idx = buffer.indexOf('\r\n\r\n');
    if (idx === -1) break;
    const header = buffer.slice(0, idx).toString();
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;
    const len = parseInt(match[1], 10);
    if (buffer.length < idx + 4 + len) break;
    const bodyStr = buffer.slice(idx + 4, idx + 4 + len).toString();
    buffer = buffer.slice(idx + 4 + len);
    try {
      const msg = JSON.parse(bodyStr);
      if (msg.id) responses.set(msg.id, msg);
      if (msg.method === 'textDocument/publishDiagnostics') {
        diagnostics = msg.params.diagnostics;
      }
    } catch (e) {
      console.error(e);
    }
  }
});

async function waitFor(id) {
  while (!responses.has(id)) await new Promise((r) => setTimeout(r, 50));
  return responses.get(id);
}

await waitFor(
  request('initialize', {
    processId: process.pid,
    rootUri: `file://${tmpDir}`,
    capabilities: {
      textDocument: {
        codeAction: {
          codeActionLiteralSupport: {
            codeActionKind: { valueSet: ['quickfix'] },
          },
        },
      },
    },
  })
);
send({ jsonrpc: '2.0', method: 'initialized', params: {} });
send({
  jsonrpc: '2.0',
  method: 'textDocument/didOpen',
  params: {
    textDocument: {
      uri: `file://${filePath}`,
      languageId: 'dart',
      version: 1,
      text: code,
    },
  },
});

await new Promise((r) => setTimeout(r, 3000));
console.log('Diagnostics:', diagnostics.map((d) => d.message));

const caRes = await waitFor(
  request('textDocument/codeAction', {
    textDocument: { uri: `file://${filePath}` },
    range: {
      start: { line: 1, character: 2 },
      end: { line: 1, character: 8 },
    },
    context: { diagnostics },
  })
);

console.log('Actions for missing import:');
for (const a of caRes.result || []) {
  console.log(` - [${a.kind}] "${a.title}"`, a.edit ? '(has edit)' : '(no edit)');
  if (a.edit) {
    console.log('   Edit:', JSON.stringify(a.edit));
  }
}

proc.kill();
