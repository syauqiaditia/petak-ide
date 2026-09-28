import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const projectDir = '/tmp/petak_bench_dart_completion';
fs.rmSync(projectDir, { recursive: true, force: true });
fs.mkdirSync(path.join(projectDir, 'lib'), { recursive: true });

fs.writeFileSync(
  path.join(projectDir, 'pubspec.yaml'),
  `name: bench_completion
environment:
  sdk: '>=3.0.0 <4.0.0'
`
);

const filePath = path.join(projectDir, 'lib', 'main.dart');
const fileUri = `file://${filePath}`;
const initialCode = `import 'dart:math';

class MySampleWidget {
  void build() {
    // cursor goes here
  }
}
`;
fs.writeFileSync(filePath, initialCode);

function getLineAndChar(text, offset) {
  const lines = text.slice(0, offset).split('\n');
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}

async function main() {
  console.log('=== Benchmarking Dart Completion Latency (< 150 ms) ===');
  console.log(`Target project: ${projectDir}`);

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
        }
      } catch (e) {
        console.error(e);
      }
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

  // 1. Initialize
  const initId = request('initialize', {
    processId: process.pid,
    rootUri: `file://${projectDir}`,
    capabilities: {
      textDocument: {
        completion: {
          completionItem: {
            snippetSupport: true,
          },
        },
      },
    },
  });
  await waitForResponse(initId);
  send({ jsonrpc: '2.0', method: 'initialized', params: {} });

  // 2. Open Document
  send({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri: fileUri,
        languageId: 'dart',
        version: 1,
        text: initialCode,
      },
    },
  });

  // Give server brief moment to analyze initial doc
  await new Promise((r) => setTimeout(r, 600));

  // 3. Measure completion samples
  const prefixes = [
    'pri', 'poi', 'Ma', 'Stri', 'dou',
    'lis', 'Map', 'int', 'bool', 'Set',
    'Futu', 'Stre', 'Ite', 'Run', 'Asse'
  ];

  const latencies = [];
  let docVersion = 1;

  for (let i = 0; i < prefixes.length; i++) {
    const prefix = prefixes[i];
    const insertCode = `import 'dart:math';

class MySampleWidget {
  void build() {
    ${prefix}
  }
}
`;
    docVersion++;
    // Send didChange
    send({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: {
          uri: fileUri,
          version: docVersion,
        },
        contentChanges: [
          {
            text: insertCode,
          },
        ],
      },
    });

    const targetLine = 4;
    const targetChar = 4 + prefix.length;

    const tStart = performance.now();
    const reqId = request('textDocument/completion', {
      textDocument: { uri: fileUri },
      position: { line: targetLine, character: targetChar },
    });

    const resp = await waitForResponse(reqId);
    const latency = performance.now() - tStart;
    const itemCount = resp.result ? (Array.isArray(resp.result) ? resp.result.length : resp.result.items?.length || 0) : 0;

    latencies.push(latency);
    console.log(`Sample ${i + 1} (prefix: "${prefix}"): ${latency.toFixed(2)} ms (${itemCount} items)`);
    await new Promise((r) => setTimeout(r, 50));
  }

  proc.kill();

  latencies.sort((a, b) => a - b);
  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];

  console.log('\n--- Completion Latency Summary (15 samples) ---');
  console.log(`Min: ${min.toFixed(2)} ms`);
  console.log(`Max: ${max.toFixed(2)} ms`);
  console.log(`Avg: ${avg.toFixed(2)} ms`);
  console.log(`p50: ${p50.toFixed(2)} ms`);
  console.log(`p95: ${p95.toFixed(2)} ms`);
  console.log(`Budget Target: < 150 ms -> ${p95 < 150 ? 'PASS (LOLOS)' : 'FAIL'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
