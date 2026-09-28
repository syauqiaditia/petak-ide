import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const projectDir = '/tmp/petak_bench_dart_diag';
fs.rmSync(projectDir, { recursive: true, force: true });
fs.mkdirSync(path.join(projectDir, 'lib'), { recursive: true });

fs.writeFileSync(
  path.join(projectDir, 'pubspec.yaml'),
  `name: bench_diag
environment:
  sdk: '>=3.0.0 <4.0.0'
`
);

const filePath = path.join(projectDir, 'lib', 'main.dart');
const fileUri = `file://${filePath}`;
const fileContent = `import 'dart:math';

void main() {
  int x = "broken_type_error";
  print(x);
}
`;
fs.writeFileSync(filePath, fileContent);

async function measureOneRun(runIdx) {
  return new Promise((resolve, reject) => {
    const tSpawn = performance.now();
    const proc = spawn('dart', ['language-server', '--protocol=lsp'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    let msgId = 0;
    function send(obj) {
      const str = JSON.stringify(obj);
      proc.stdin.write(`Content-Length: ${Buffer.byteLength(str)}\r\n\r\n${str}`);
    }

    let buffer = Buffer.alloc(0);
    const responses = new Map();
    let tDidOpen = null;
    let resolved = false;

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
            const tDiag = performance.now();
            const diags = msg.params.diagnostics || [];
            if (!resolved && tDidOpen !== null && diags.length > 0) {
              resolved = true;
              const didOpenToDiag = tDiag - tDidOpen;
              const spawnToDiag = tDiag - tSpawn;
              proc.kill();
              resolve({
                run: runIdx,
                didOpenToDiagMs: didOpenToDiag,
                spawnToDiagMs: spawnToDiag,
                diagCount: diags.length,
                firstError: diags[0].message,
              });
            }
          }
        } catch (e) {
          console.error(e);
        }
      }
    });

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    async function waitForResponse(id, timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (responses.has(id)) return responses.get(id);
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`Timeout waiting for response id ${id}`);
    }

    (async () => {
      const initId = ++msgId;
      send({
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: {
          processId: process.pid,
          rootUri: `file://${projectDir}`,
          capabilities: {
            textDocument: {
              publishDiagnostics: {},
            },
          },
        },
      });

      await waitForResponse(initId);
      send({ jsonrpc: '2.0', method: 'initialized', params: {} });

      tDidOpen = performance.now();
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: fileUri,
            languageId: 'dart',
            version: 1,
            text: fileContent,
          },
        },
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill();
          reject(new Error(`Run ${runIdx} timed out after 10000ms`));
        }
      }, 10000);
    })().catch((err) => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        reject(err);
      }
    });
  });
}

async function main() {
  console.log('=== Benchmarking Dart First Diagnostics (< 3000 ms) ===');
  console.log(`Target project: ${projectDir}`);
  console.log(`Target file: ${filePath}`);
  console.log('');

  const results = [];
  for (let i = 1; i <= 3; i++) {
    const res = await measureOneRun(i);
    console.log(`Run ${res.run}:`);
    console.log(`  didOpen -> publishDiagnostics: ${res.didOpenToDiagMs.toFixed(2)} ms`);
    console.log(`  spawn -> publishDiagnostics:   ${res.spawnToDiagMs.toFixed(2)} ms`);
    console.log(`  diagnostics count:             ${res.diagCount} items`);
    console.log(`  first diagnostic:              "${res.firstError}"`);
    results.push(res);
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('\n--- Summary ---');
  results.forEach((r) => {
    console.log(`Run ${r.run}: ${r.didOpenToDiagMs.toFixed(2)} ms (spawn: ${r.spawnToDiagMs.toFixed(2)} ms)`);
  });

  const avgDidOpen = results.reduce((acc, r) => acc + r.didOpenToDiagMs, 0) / results.length;
  const avgSpawn = results.reduce((acc, r) => acc + r.spawnToDiagMs, 0) / results.length;
  console.log(`\nAverage didOpen -> publishDiagnostics: ${avgDidOpen.toFixed(2)} ms`);
  console.log(`Average spawn -> publishDiagnostics:   ${avgSpawn.toFixed(2)} ms`);
  console.log(`Budget Target: < 3000 ms -> ${avgDidOpen < 3000 ? 'PASS (LOLOS)' : 'FAIL'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
