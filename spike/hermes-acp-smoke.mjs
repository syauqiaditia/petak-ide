#!/usr/bin/env node
// Hermes ACP smoke test: try 'hermes acp' handshake via stdio JSON-RPC.
// Runs on the server (not Mac).

import { spawn, execSync } from 'child_process';

let msgId = 0;
function request(method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id: ++msgId, method, params }) + '\n';
}

function getTreeRSS(pid) {
  try {
    let rss = 0;
    const main = execSync(`ps -o rss= -p ${pid} 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (main) rss += parseInt(main, 10);
    try {
      const children = execSync(`pgrep -P ${pid} 2>/dev/null`, { encoding: 'utf8' }).trim();
      for (const cpid of children.split('\n').filter(Boolean)) {
        const crss = execSync(`ps -o rss= -p ${cpid} 2>/dev/null`, { encoding: 'utf8' }).trim();
        if (crss) rss += parseInt(crss, 10);
      }
    } catch {}
    return rss;
  } catch { return 0; }
}

async function main() {
  console.log('=== Hermes ACP test ===');
  
  // Find hermes binary
  let hermesBin;
  try {
    hermesBin = execSync('which hermes 2>/dev/null', { encoding: 'utf8' }).trim();
  } catch {
    console.log('hermes not found in PATH');
    process.exit(1);
  }
  console.log(`hermes: ${hermesBin}`);
  console.log(`version: ${execSync('hermes acp --version 2>&1', { encoding: 'utf8' }).trim()}`);

  const result = {
    name: 'hermes acp', cmd: `${hermesBin} acp`,
    handshake: false, sessionId: null,
    agentCapabilities: null, authMethods: null, auth: null,
    peakRSSKB: 0, error: null
  };

  return new Promise((resolve) => {
    const proc = spawn(hermesBin, ['acp'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let buf = '';
    let done = false;
    let rssInterval = null;
    let timer = null;
    let phase = 'initialize';

    function finish(reason) {
      if (done) return;
      done = true;
      if (rssInterval) clearInterval(rssInterval);
      if (timer) clearTimeout(timer);
      console.log(`  finish: ${reason}`);
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        console.log('\n=== RESULT ===');
        console.log(JSON.stringify(result, null, 2));
        resolve();
      }, 1000);
    }

    proc.stdin.on('error', () => {});

    rssInterval = setInterval(() => {
      if (proc.pid) {
        const rss = getTreeRSS(proc.pid);
        if (rss > result.peakRSSKB) result.peakRSSKB = rss;
      }
    }, 1000);

    timer = setTimeout(() => {
      result.error = 'timeout after 30s';
      finish('timeout');
    }, 30000);

    proc.stderr.on('data', (d) => {
      const lines = d.toString().split('\n').filter(Boolean);
      for (const line of lines.slice(0, 5)) {
        console.log(`  stderr: ${line.slice(0, 200)}`);
      }
    });

    proc.on('error', (e) => {
      result.error = `process error: ${e.message}`;
      finish('process error');
    });
    proc.on('exit', (code) => {
      if (!done) {
        result.error = `process exited early with code ${code}`;
        finish('early exit');
      }
    });

    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        console.log(`  recv: ${JSON.stringify(msg).slice(0, 300)}`);

        if (phase === 'initialize' && msg.id && msg.result) {
          result.handshake = true;
          result.agentCapabilities = msg.result.agentCapabilities || null;
          result.authMethods = msg.result.authMethods || null;
          console.log(`  handshake OK`);

          phase = 'session/new';
          proc.stdin.write(request('session/new', {
            cwd: process.cwd(),
            mcpServers: []
          }));
          console.log(`  sent session/new`);
        } else if (phase === 'session/new' && msg.id && msg.result) {
          result.sessionId = msg.result.sessionId || msg.result.session_id || null;
          result.auth = result.sessionId ? 'ok (session created)' : 'session created but no sessionId field';
          console.log(`  sessionId: ${result.sessionId}`);
          finish('session created');
        } else if (msg.error) {
          result.error = msg.error.message || JSON.stringify(msg.error);
          if (phase === 'session/new') finish('session/new error');
        }
      }
    });

    proc.stdin.write(request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { read: false, write: false } },
      clientInfo: { name: 'petak-spike', version: '0.0.1' }
    }));
    console.log(`  sent initialize`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
