import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const tmpDir = '/tmp/petak_test_dart_ca';
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });

fs.writeFileSync(
  path.join(tmpDir, 'pubspec.yaml'),
  `name: test_ca
environment:
  sdk: '>=3.0.0 <4.0.0'
dependencies:
  flutter:
    sdk: flutter
`
);

const code = `import 'dart:math';

// Widget definition
abstract class Widget {
  const Widget();
}

class Text extends Widget {
  final String data;
  const Text(this.data);
}

class Padding extends Widget {
  final Widget child;
  const Padding({required this.child});
}

class Center extends Widget {
  final Widget child;
  const Center({required this.child});
}

class Column extends Widget {
  final List<Widget> children;
  const Column({required this.children});
}

Widget build() {
  return Text("Hello");
}
`;

const filePath = path.join(tmpDir, 'lib', 'main.dart');
fs.writeFileSync(filePath, code);

// Spawn dart language-server
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
        console.log('Received diagnostics:', diagnostics.length);
      } else if (msg.method === 'workspace/applyEdit') {
        console.log('Server requested workspace/applyEdit:', JSON.stringify(msg));
        send({ jsonrpc: '2.0', id: msg.id, result: { applied: true } });
      }
    } catch (e) {
      console.error(e);
    }
  }
});

async function waitForResponse(id, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (responses.has(id)) return responses.get(id);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for id ${id}`);
}

// 1. Initialize
const initId = request('initialize', {
  processId: process.pid,
  rootUri: `file://${tmpDir}`,
  capabilities: {
    textDocument: {
      codeAction: {
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: [
              'quickfix',
              'refactor',
              'refactor.flutter.wrap.widget',
              'refactor.flutter.wrap.padding',
              'refactor.flutter.wrap.center',
              'refactor.flutter.wrap.column',
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
console.log('Initialized Dart LS');

// 2. Open file
notify('textDocument/didOpen', {
  textDocument: {
    uri: `file://${filePath}`,
    languageId: 'dart',
    version: 1,
    text: code,
  },
});

// Wait 3s for diagnostics
await new Promise((r) => setTimeout(r, 3000));

// 3. Request code action at line 0 (unused import 'dart:math')
const caId1 = request('textDocument/codeAction', {
  textDocument: { uri: `file://${filePath}` },
  range: {
    start: { line: 0, character: 7 },
    end: { line: 0, character: 18 },
  },
  context: {
    diagnostics: diagnostics.filter((d) => d.range.start.line === 0),
  },
});
const caRes1 = await waitForResponse(caId1);
console.log('Code actions for unused import line 0:');
for (const a of caRes1.result || []) {
  console.log(` - [${a.kind}] "${a.title}"`, a.edit ? '(has edit)' : '(no edit)');
}

// 4. Request code action at Text("Hello") (line 28, character 11)
const lines = code.split('\n');
const textLineIdx = lines.findIndex((l) => l.includes('Text("Hello")'));
console.log(`Text("Hello") is at line ${textLineIdx}`);

const caId2 = request('textDocument/codeAction', {
  textDocument: { uri: `file://${filePath}` },
  range: {
    start: { line: textLineIdx, character: 9 },
    end: { line: textLineIdx, character: 22 },
  },
  context: {
    diagnostics: [],
  },
});
const caRes2 = await waitForResponse(caId2);
console.log(`Code actions for Text("Hello") at line ${textLineIdx}:`);
for (const a of caRes2.result || []) {
  console.log(` - [${a.kind}] "${a.title}"`, a.edit ? '(has edit)' : (a.command ? `(command: ${a.command.command})` : '(no edit/cmd)'));
  if (a.edit) console.log('   Edit:', JSON.stringify(a.edit));
}

proc.kill();
