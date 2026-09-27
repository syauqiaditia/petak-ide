#!/usr/bin/env node
// ACP smoke test: try claude-code-acp (npx) and hermes acp handshake.
// Pure Node, no npm deps. Newline-delimited JSON-RPC over stdio.

import { spawn, execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── JSON-RPC helpers (newline-delimited for ACP) ─────────────────
let msgId = 0;
function request(method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id: ++msgId, method, params }) + '\n';
}

// ── RSS measurement ──────────────────────────────────────────────
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

// ── Run one ACP agent ────────────────────────────────────────────
async function testACP({ name, cmd, args, env, timeoutSec = 30 }) {
  const result = {
    name, cmd: `${cmd} ${(args||[]).join(' ')}`,
    handshake: false, sessionId: null,
    agentCapabilities: null, authMethods: null, auth: null,
    peakRSSKB: 0, error: null
  };

  console.log(`\n=== ACP: ${name} ===`);
  console.log(`cmd: ${result.cmd}`);

  return new Promise((resolveP) => {
    let proc;
    try {
      proc = spawn(cmd, args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env }
      });
    } catch (e) {
      result.error = `spawn failed: ${e.message}`;
      console.log(`ERROR: ${result.error}`);
      resolveP(result);
      return;
    }

    let buf = '';
    let done = false;
    let rssInterval = null;
    let timer = null;
    let phase = 'initialize'; // initialize -> session/new -> done

    function finish(reason) {
      if (done) return;
      done = true;
      if (rssInterval) clearInterval(rssInterval);
      if (timer) clearTimeout(timer);
      console.log(`  finish: ${reason}`);
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(() => resolveP(result), 1000);
    }

    rssInterval = setInterval(() => {
      if (proc.pid) {
        const rss = getTreeRSS(proc.pid);
        if (rss > result.peakRSSKB) result.peakRSSKB = rss;
      }
    }, 1000);

    timer = setTimeout(() => {
      result.error = `timeout after ${timeoutSec}s`;
      finish('timeout');
    }, timeoutSec * 1000);

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
      buf = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        console.log(`  recv: ${JSON.stringify(msg).slice(0, 300)}`);

        if (phase === 'initialize' && msg.id && msg.result) {
          // initialize response
          result.handshake = true;
          result.agentCapabilities = msg.result.agentCapabilities || null;
          result.authMethods = msg.result.authMethods || null;
          console.log(`  handshake OK, capabilities: ${JSON.stringify(result.agentCapabilities)?.slice(0, 200)}`);
          console.log(`  authMethods: ${JSON.stringify(result.authMethods)?.slice(0, 200)}`);

          // Send session/new
          phase = 'session/new';
          const cwd = resolve(__dirname, 'fixtures/dart');
          proc.stdin.write(request('session/new', {
            cwd,
            mcpServers: []
          }));
          console.log(`  sent session/new (cwd: ${cwd})`);
        } else if (phase === 'session/new' && msg.id && msg.result) {
          result.sessionId = msg.result.sessionId || msg.result.session_id || null;
          result.auth = result.sessionId ? 'ok (session created)' : 'session created but no sessionId field';
          console.log(`  sessionId: ${result.sessionId}`);
          finish('session created');
        } else if (msg.error) {
          const errMsg = msg.error.message || JSON.stringify(msg.error);
          if (errMsg.includes('auth') || errMsg.includes('login') || errMsg.includes('credential')) {
            result.auth = `needs auth: ${errMsg}`;
            console.log(`  auth required: ${errMsg}`);
          } else {
            result.error = errMsg;
            console.log(`  error: ${errMsg}`);
          }
          if (phase === 'session/new') {
            finish('session/new error');
          }
        }
      }
    });

    // Send initialize
    proc.stdin.write(request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { read: false, write: false }
      },
      clientInfo: { name: 'petak-spike', version: '0.0.1' }
    }));
    console.log(`  sent initialize`);
  });
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const results = [];

  // --- @zed-industries/claude-code-acp via npx ---
  const npxPath = `${process.env.HOME}/.local/bin/npx`;
  // Try the known package names
  for (const pkg of ['@anthropic-ai/claude-code-acp', '@anthropics/claude-code-acp', '@zed-industries/claude-code-acp']) {
    console.log(`\nTrying npx: ${pkg}`);
    try {
      // Check if package exists first (quick)
      const r = await testACP({
        name: `claude-code-acp (${pkg})`,
        cmd: npxPath, args: ['-y', pkg],
        env: {}, timeoutSec: 60
      });
      results.push(r);
      if (r.handshake) break; // found working one
    } catch (e) {
      console.log(`  failed: ${e.message}`);
      results.push({ name: `claude-code-acp (${pkg})`, error: e.message });
    }
  }

  // --- opencode acp ---
  try {
    execSync('which opencode 2>/dev/null', { encoding: 'utf8' });
    const r = await testACP({
      name: 'opencode acp',
      cmd: 'opencode', args: ['acp'],
      env: {}, timeoutSec: 30
    });
    results.push(r);
  } catch {
    console.log('\nopencode: not installed, skipping');
    results.push({ name: 'opencode acp', error: 'not installed', handshake: false });
  }

  // Summary
  console.log('\n\n========== ACP SUMMARY ==========');
  for (const r of results) {
    console.log(`\n${r.name}:`);
    console.log(`  handshake: ${r.handshake || false}`);
    console.log(`  sessionId: ${r.sessionId || 'n/a'}`);
    console.log(`  auth: ${r.auth || 'n/a'}`);
    console.log(`  peak RSS: ${r.peakRSSKB ? (r.peakRSSKB / 1024).toFixed(1) + ' MB' : 'n/a'}`);
    if (r.error) console.log(`  error: ${r.error}`);
  }

  console.log('\n\n========== JSON ==========');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
