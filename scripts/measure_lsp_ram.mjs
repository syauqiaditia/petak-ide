import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function getRssKb(pid) {
  try {
    const out = execSync(`ps -o rss= -p ${pid}`).toString().trim();
    return parseInt(out, 10);
  } catch (e) {
    return 0;
  }
}

// 1. Measure Dart LS RAM
console.log('--- Measuring Dart Language Server RAM ---');
const dartProc = spawn('dart', ['language-server', '--protocol=lsp'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let dartMsgId = 0;
function dartSend(obj) {
  const str = JSON.stringify(obj);
  dartProc.stdin.write(`Content-Length: ${Buffer.byteLength(str)}\r\n\r\n${str}`);
}

dartSend({
  jsonrpc: '2.0',
  id: ++dartMsgId,
  method: 'initialize',
  params: {
    processId: process.pid,
    rootUri: 'file:///mnt/storage/flutter-uqi/examples/hello_world',
    capabilities: {},
  },
});

await new Promise((r) => setTimeout(r, 4000));
const dartRss = getRssKb(dartProc.pid);
console.log(`Dart LS (PID ${dartProc.pid}) RSS: ${(dartRss / 1024).toFixed(1)} MB (${dartRss} KB)`);
dartProc.kill();

// 2. Measure Kotlin LS RAM
console.log('\n--- Measuring Kotlin Language Server RAM ---');
const kotlinCmd = '/mnt/storage/uqi-cache/lsp/server/bin/kotlin-language-server';
const kotlinProc = spawn(kotlinCmd, [], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

function kotlinSend(obj) {
  const str = JSON.stringify(obj);
  kotlinProc.stdin.write(`Content-Length: ${Buffer.byteLength(str)}\r\n\r\n${str}`);
}

kotlinSend({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    processId: process.pid,
    rootUri: 'file:///mnt/storage/uqi-projects/petak/spike/fixtures/kotlin',
    capabilities: {},
  },
});

await new Promise((r) => setTimeout(r, 6000));
const kotlinRss = getRssKb(kotlinProc.pid);
console.log(`Kotlin LS (PID ${kotlinProc.pid}) RSS: ${(kotlinRss / 1024).toFixed(1)} MB (${kotlinRss} KB)`);
kotlinProc.kill();
