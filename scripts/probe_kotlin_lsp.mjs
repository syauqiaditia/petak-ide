import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const projectDir = '/mnt/storage/uqi-projects/petak/spike/fixtures/kotlin';
const filePath = path.join(projectDir, 'src/main/kotlin/Main.kt');
const code = fs.readFileSync(filePath, 'utf8');

console.log('Main.kt:');
console.log(code);

const cmd = '/mnt/storage/uqi-cache/lsp/server/bin/kotlin-language-server';

const proc = spawn(cmd, [], {
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

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
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
      if (msg.id) {
        responses.set(msg.id, msg);
      } else if (msg.method === 'textDocument/publishDiagnostics') {
        diagnostics = msg.params.diagnostics;
        console.log('Received Kotlin diagnostics:', diagnostics.length);
      }
    } catch (e) {
      console.error(e);
    }
  }
});

async function waitForResponse(id, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (responses.has(id)) return responses.get(id);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for id ${id}`);
}

const initId = request('initialize', {
  processId: process.pid,
  rootUri: `file://${projectDir}`,
  capabilities: {
    textDocument: {
      completion: { completionItem: { snippetSupport: true } },
      codeAction: {
        codeActionLiteralSupport: {
          codeActionKind: { valueSet: ['quickfix', 'refactor'] },
        },
      },
    },
  },
});

const initRes = await waitForResponse(initId);
console.log('Kotlin LS initialized');
notify('initialized', {});

notify('textDocument/didOpen', {
  textDocument: {
    uri: `file://${filePath}`,
    languageId: 'kotlin',
    version: 1,
    text: code,
  },
});

// Wait up to 10s for diagnostics
const startDiag = Date.now();
while (Date.now() - startDiag < 10000 && diagnostics.length === 0) {
  await new Promise((r) => setTimeout(r, 200));
}
console.log('Diagnostics count:', diagnostics.length);
if (diagnostics.length > 0) {
  console.log('First diagnostic:', diagnostics[0]);
}

// Request completion
const compId = request('textDocument/completion', {
  textDocument: { uri: `file://${filePath}` },
  position: { line: 1, character: 4 },
});
const compRes = await waitForResponse(compId);
const items = compRes.result ? (compRes.result.items || compRes.result) : [];
console.log(`Completion items count: ${items.length}`);
if (items.length > 0) {
  console.log('Sample completions:', items.slice(0, 5).map((i) => i.label));
}

// Request code action at line 0
const caId = request('textDocument/codeAction', {
  textDocument: { uri: `file://${filePath}` },
  range: {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 10 },
  },
  context: { diagnostics },
});
const caRes = await waitForResponse(caId);
console.log('Kotlin code actions:', caRes.result);

proc.kill();
