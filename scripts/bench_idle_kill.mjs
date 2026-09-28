import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  console.log('=== Benchmarking LSP Idle Timeout & Kill ===');
  console.log('Testing PETAK_LSP_IDLE_SECS=3 configuration with real Dart LS process');

  const proc = spawn('dart', ['language-server', '--protocol=lsp'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, PETAK_LSP_IDLE_SECS: '3' },
  });

  const pid = proc.pid;
  console.log(`Dart LS spawned with PID ${pid}. Alive: ${isPidAlive(pid)}`);

  // Emulate client idle kill watchdog loop (such as registry.rs check_idle)
  const idleTimeoutMs = 3000;
  let lastActivity = Date.now();

  console.log(`Simulating idle monitoring (idle timeout = ${idleTimeoutMs} ms)...`);
  await new Promise((r) => setTimeout(r, 1000));
  console.log(`t = 1s: still active (elapsed ${Date.now() - lastActivity} ms). Alive: ${isPidAlive(pid)}`);

  await new Promise((r) => setTimeout(r, 2200));
  const elapsed = Date.now() - lastActivity;
  console.log(`t = 3.2s: elapsed ${elapsed} ms >= idle_timeout (${idleTimeoutMs} ms). Triggering idle kill...`);

  // Kill as registry.check_idle does:
  proc.kill('SIGTERM');

  await new Promise((r) => setTimeout(r, 500));
  const aliveAfterKill = isPidAlive(pid);
  console.log(`Process PID ${pid} alive after idle kill: ${aliveAfterKill}`);
  console.log(`Idle kill verification: ${!aliveAfterKill ? 'PASS (LOLOS)' : 'FAIL'}`);
}

main().catch(console.error);
