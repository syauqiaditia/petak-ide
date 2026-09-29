import { Parser, Language, Query } from 'web-tree-sitter';
import { EditorState, ChangeSet, Text } from '@codemirror/state';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const dartFilePath = path.join(os.homedir(), 'petak-bench/Big10k.dart');
const codeText = fs.readFileSync(dartFilePath, 'utf8');

// Initialize web-tree-sitter
await Parser.init({ locateFile: () => 'ui/public/ts/tree-sitter.wasm' });
const dartWasm = fs.readFileSync('ui/public/ts/tree-sitter-dart.wasm');
const language = await Language.load(new Uint8Array(dartWasm));
const scmContent = fs.readFileSync('ui/features/editor/ts/queries/dart.scm', 'utf8');
const query = new Query(language, scmContent);
const parser = new Parser();
parser.setLanguage(language);

// Initialize Dart Language Server
const projectDir = '/tmp/petak_bench_typing_lsp';
fs.rmSync(projectDir, { recursive: true, force: true });
fs.mkdirSync(path.join(projectDir, 'lib'), { recursive: true });
fs.writeFileSync(
  path.join(projectDir, 'pubspec.yaml'),
  `name: bench_typing\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n`
);
const testFile = path.join(projectDir, 'lib', 'Big10k.dart');
fs.writeFileSync(testFile, codeText);

function getDartBin() {
  if (process.env.DART_BIN) return process.env.DART_BIN;
  try {
    const p = execSync('which dart', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    if (p) return p;
  } catch (_) {}
  const candidates = [
    '/Users/uqi/SDK/flutter_3.35.7/bin/dart',
    path.join(os.homedir(), 'SDK/flutter_3.35.7/bin/dart'),
    path.join(os.homedir(), 'flutter/bin/dart'),
    '/mnt/storage/flutter-uqi/bin/dart',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'dart';
}

const dartBin = getDartBin();
const proc = spawn(dartBin, ['language-server', '--protocol=lsp'], {
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
    } catch (_) {}
  }
});

async function waitForResponse(id, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (responses.has(id)) return responses.get(id);
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Timeout waiting for response id ${id}`);
}

const initId = request('initialize', {
  processId: process.pid,
  rootUri: `file://${projectDir}`,
  capabilities: {
    textDocument: {
      synchronization: { didSave: true },
    },
  },
});
await waitForResponse(initId);
send({ jsonrpc: '2.0', method: 'initialized', params: {} });

// didOpen
send({
  jsonrpc: '2.0',
  method: 'textDocument/didOpen',
  params: {
    textDocument: {
      uri: `file://${testFile}`,
      languageId: 'dart',
      version: 1,
      text: codeText,
    },
  },
});

await new Promise((r) => setTimeout(r, 600));

// Setup initial CodeMirror 6 state
let cmDoc = Text.of(codeText.split('\n'));
let tree = parser.parse(codeText);

// Keystroke loop (200 keystrokes at middle of file)
let pos = Math.floor(codeText.length / 2);
let currentText = codeText;
const n = 200;
const keystrokeTimings = [];
let docVersion = 1;
let debounceTimer = null;
let pendingChanges = [];

function offsetToLspPos(text, offset) {
  const sub = text.slice(0, offset);
  const lines = sub.split('\n');
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}

for (let i = 0; i < n; i++) {
  const charToInsert = String.fromCharCode(97 + (i % 26));
  const tStart = performance.now();

  // 1. CodeMirror update
  const changeSpec = { from: pos, to: pos, insert: charToInsert };
  const changeSet = ChangeSet.of(changeSpec, cmDoc.length);
  cmDoc = changeSet.apply(cmDoc);

  // 2. Tree-sitter incremental parse
  const before = currentText.slice(0, pos).split('\n');
  const row = before.length - 1;
  const col = before[row].length;
  tree.edit({
    startIndex: pos,
    oldEndIndex: pos,
    newEndIndex: pos + 1,
    startPosition: { row, column: col },
    oldEndPosition: { row, column: col },
    newEndPosition: { row, column: col + 1 },
  });
  currentText = currentText.slice(0, pos) + charToInsert + currentText.slice(pos);
  tree = parser.parse(currentText, tree);

  // 3. Viewport highlight query (visible ~100 lines)
  query.captures(tree.rootNode, { startIndex: Math.max(0, pos - 1200), endIndex: Math.min(currentText.length, pos + 1200) });

  // 4. LSP Sync logic (debounced 50ms per ui/features/editor/lsp/sync.ts)
  const lspStart = offsetToLspPos(currentText, pos);
  pendingChanges.push({
    range: { start: lspStart, end: lspStart },
    text: charToInsert,
  });

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (pendingChanges.length > 0) {
      docVersion++;
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: `file://${testFile}`, version: docVersion },
          contentChanges: pendingChanges,
        },
      });
      pendingChanges = [];
    }
  }, 50);

  const tEnd = performance.now();
  keystrokeTimings.push(tEnd - tStart);
  pos++;
}

// Wait for any remaining debounce timer to flush
await new Promise((r) => setTimeout(r, 100));
proc.kill();

keystrokeTimings.sort((a, b) => a - b);
const min = keystrokeTimings[0];
const max = keystrokeTimings[keystrokeTimings.length - 1];
const avg = keystrokeTimings.reduce((a, b) => a + b, 0) / keystrokeTimings.length;
const p50 = keystrokeTimings[Math.floor(keystrokeTimings.length * 0.5)];
const p95 = keystrokeTimings[Math.floor(keystrokeTimings.length * 0.95)];

console.log('=== Benchmarking 10k Line Keystroke Latency with LSP (Big10k.dart) ===');
console.log(`Samples: ${n} keystrokes`);
console.log(`Min: ${min.toFixed(2)} ms`);
console.log(`Max: ${max.toFixed(2)} ms`);
console.log(`Avg: ${avg.toFixed(2)} ms`);
console.log(`p50: ${p50.toFixed(2)} ms`);
console.log(`p95: ${p95.toFixed(2)} ms`);
console.log(`Budget Target: <= 17.00 ms (1 frame @ 60Hz) -> ${p95 <= 17.0 ? 'PASS (LOLOS)' : 'FAIL'}`);
