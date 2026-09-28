import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const projectDir = '/mnt/storage/flutter-uqi/examples/hello_world';
const filePath = path.join(projectDir, 'lib', 'main.dart');
const code = fs.readFileSync(filePath, 'utf8');

const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  console.log(`${i}: ${lines[i]}`);
}

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

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

let buffer = Buffer.alloc(0);
const responses = new Map();

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
      } else if (msg.method === 'workspace/applyEdit') {
        console.log('*** Server sent workspace/applyEdit:', JSON.stringify(msg, null, 2));
        send({ jsonrpc: '2.0', id: msg.id, result: { applied: true } });
      }
    } catch (e) {
      console.error(e);
    }
  }
});

async function waitForResponse(id, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (responses.has(id)) return responses.get(id);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for id ${id}`);
}

// Initialize
const initId = request('initialize', {
  processId: process.pid,
  rootUri: `file://${projectDir}`,
  capabilities: {
    textDocument: {
      codeAction: {
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: [
              'quickfix',
              'refactor',
              'refactor.flutter.wrap.generic',
              'refactor.flutter.wrap.builder',
              'refactor.flutter.wrap.center',
              'refactor.flutter.wrap.column',
              'refactor.flutter.wrap.container',
              'refactor.flutter.wrap.padding',
              'refactor.flutter.wrap.row',
              'refactor.flutter.wrap.sizedBox',
              'source.organizeImports',
            ],
          },
        },
        resolveSupport: { properties: ['edit'] },
      },
    },
    workspace: {
      applyEdit: true,
      workspaceEdit: { documentChanges: true },
    },
  },
});

await waitForResponse(initId);
notify('initialized', {});
console.log('Initialized Dart LS on Flutter hello_world');

notify('textDocument/didOpen', {
  textDocument: {
    uri: `file://${filePath}`,
    languageId: 'dart',
    version: 1,
    text: code,
  },
});

await new Promise((r) => setTimeout(r, 4000));

// Find line with "Text("
const textLine = lines.findIndex((l) => l.includes('Text('));
const textCol = lines[textLine].indexOf('Text(');
console.log(`Querying at line ${textLine}, col ${textCol}...`);

const caId = request('textDocument/codeAction', {
  textDocument: { uri: `file://${filePath}` },
  range: {
    start: { line: textLine, character: textCol + 1 },
    end: { line: textLine, character: textCol + 1 },
  },
  context: {
    diagnostics: [],
  },
});
const caRes = await waitForResponse(caId);
console.log(`Code actions for line ${textLine}:`);
let wrapPaddingAction = null;
for (const a of caRes.result || []) {
  console.log(` - [${a.kind}] "${a.title}"`, a.edit ? '(has edit)' : (a.command ? `(command: ${a.command.command})` : '(no edit/cmd)'));
  if (a.title && (a.title.includes('Padding') || a.title.includes('widget'))) {
    console.log(`\nAction details for "${a.title}":`, JSON.stringify(a, null, 2));
  }
}

if (wrapPaddingAction) {
  console.log('\nWrap with Padding action details:');
  console.log(JSON.stringify(wrapPaddingAction, null, 2));

  if (wrapPaddingAction.command) {
    console.log('\nExecuting command:', wrapPaddingAction.command.command);
    const execId = request('workspace/executeCommand', {
      command: wrapPaddingAction.command.command,
      arguments: wrapPaddingAction.command.arguments,
    });
    const execRes = await waitForResponse(execId);
    console.log('executeCommand result:', execRes);
  }
}

await new Promise((r) => setTimeout(r, 1000));
proc.kill();
