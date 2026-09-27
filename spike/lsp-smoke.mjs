#!/usr/bin/env node
// LSP smoke test: spawn dart/kotlin-lsp/sourcekit-lsp, wait for diagnostics, measure RSS.
// Pure Node, no npm deps. JSON-RPC Content-Length framing over stdio.

import { spawn, execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── JSON-RPC helpers ──────────────────────────────────────────────
let msgId = 0;
function encode(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}
function request(method, params = {}) {
  return encode({ jsonrpc: '2.0', id: ++msgId, method, params });
}
function notification(method, params = {}) {
  return encode({ jsonrpc: '2.0', method, params });
}

// Parse incoming Content-Length framed messages from a buffer
function parseMessages(buf) {
  const msgs = [];
  let rest = buf;
  while (true) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = rest.slice(0, headerEnd).toString();
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1], 10);
    const bodyStart = headerEnd + 4;
    if (rest.length < bodyStart + len) break;
    const body = rest.slice(bodyStart, bodyStart + len).toString();
    try { msgs.push(JSON.parse(body)); } catch {}
    rest = rest.slice(bodyStart + len);
  }
  return { msgs, rest };
}

// ── RSS measurement ──────────────────────────────────────────────
function getTreeRSS(pid) {
  try {
    // Get RSS of main process
    let rss = 0;
    const main = execSync(`ps -o rss= -p ${pid} 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (main) rss += parseInt(main, 10);
    // Get child processes
    try {
      const children = execSync(`pgrep -P ${pid} 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (children) {
        for (const cpid of children.split('\n').filter(Boolean)) {
          const crss = execSync(`ps -o rss= -p ${cpid} 2>/dev/null`, { encoding: 'utf8' }).trim();
          if (crss) rss += parseInt(crss, 10);
          // Recurse one level for grandchildren
          try {
            const grandchildren = execSync(`pgrep -P ${cpid} 2>/dev/null`, { encoding: 'utf8' }).trim();
            for (const gpid of grandchildren.split('\n').filter(Boolean)) {
              const grss = execSync(`ps -o rss= -p ${gpid} 2>/dev/null`, { encoding: 'utf8' }).trim();
              if (grss) rss += parseInt(grss, 10);
            }
          } catch {}
        }
      }
    } catch {}
    return rss; // in KB
  } catch { return 0; }
}

// ── Run one LSP server ───────────────────────────────────────────
async function testLSP({ name, cmd, args, env, rootDir, fileUri, fileContent, languageId, timeoutSec }) {
  const result = {
    name, cmd: `${cmd} ${args.join(' ')}`, version: null,
    started: false, diagnosticsReceived: false,
    diagnostics: null, diagnosticsTimeMs: null,
    peakRSSKB: 0, error: null
  };

  // Get version
  try {
    if (name === 'dart') {
      const dartBin = cmd;
      result.version = execSync(`${dartBin} --version 2>&1`, { encoding: 'utf8', env }).trim();
    } else if (name === 'swift') {
      result.version = execSync(`xcrun swift --version 2>&1`, { encoding: 'utf8', env }).split('\n')[0].trim();
    } else if (name === 'kotlin-lsp') {
      result.version = 'Kotlin/kotlin-lsp v263.4702.0';
    }
  } catch (e) { result.version = `(version check failed: ${e.message})`; }

  console.log(`\n=== ${name} ===`);
  console.log(`cmd: ${cmd} ${args.join(' ')}`);
  console.log(`rootDir: ${rootDir}`);
  console.log(`version: ${result.version}`);

  return new Promise((resolveP) => {
    const startTime = Date.now();
    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
      result.started = true;
    } catch (e) {
      result.error = `spawn failed: ${e.message}`;
      console.log(`ERROR: ${result.error}`);
      resolveP(result);
      return;
    }

    let buf = Buffer.alloc(0);
    let diagnosticsTimer = null;
    let rssInterval = null;
    let done = false;

    function finish(reason) {
      if (done) return;
      done = true;
      if (rssInterval) clearInterval(rssInterval);
      if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
      console.log(`finish: ${reason}`);

      // Shutdown
      try {
        proc.stdin.write(request('shutdown'));
        setTimeout(() => {
          try { proc.stdin.write(notification('exit')); } catch {}
          setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} }, 1000);
        }, 500);
      } catch {}
      setTimeout(() => resolveP(result), 2000);
    }

    // Suppress EPIPE on stdin after process dies
    proc.stdin.on('error', () => {});

    // Poll RSS every 1s
    rssInterval = setInterval(() => {
      if (proc.pid) {
        const rss = getTreeRSS(proc.pid);
        if (rss > result.peakRSSKB) result.peakRSSKB = rss;
      }
    }, 1000);

    // Timeout
    diagnosticsTimer = setTimeout(() => {
      result.error = `timeout after ${timeoutSec}s waiting for diagnostics`;
      console.log(`TIMEOUT: ${timeoutSec}s`);
      finish('timeout');
    }, timeoutSec * 1000);

    // Stderr
    proc.stderr.on('data', (d) => {
      // Log stderr but don't flood
      const lines = d.toString().split('\n').filter(Boolean);
      for (const line of lines.slice(0, 3)) {
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

    // Handle incoming messages
    proc.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { msgs, rest } = parseMessages(buf);
      buf = typeof rest === 'string' ? Buffer.from(rest) : rest;

      for (const msg of msgs) {
        // Handle initialize response
        if (msg.id === 1 && msg.result) {
          console.log(`  initialized OK (server capabilities received)`);
          // Send initialized notification
          proc.stdin.write(notification('initialized'));
          // Send didOpen
          proc.stdin.write(notification('textDocument/didOpen', {
            textDocument: {
              uri: fileUri,
              languageId,
              version: 1,
              text: fileContent
            }
          }));
          console.log(`  didOpen sent: ${fileUri}`);
        }

        // Check for diagnostics
        if (msg.method === 'textDocument/publishDiagnostics' && msg.params) {
          const diags = msg.params.diagnostics || [];
          if (diags.length > 0) {
            result.diagnosticsReceived = true;
            result.diagnosticsTimeMs = Date.now() - startTime;
            result.diagnostics = diags.map(d => ({
              message: d.message,
              severity: d.severity,
              range: d.range
            }));
            console.log(`  diagnostics received! (${diags.length} items, ${result.diagnosticsTimeMs}ms)`);
            for (const d of diags.slice(0, 3)) {
              console.log(`    - ${d.message?.slice(0, 120)}`);
            }
            finish('diagnostics received');
          } else {
            console.log(`  empty diagnostics notification (waiting for non-empty...)`);
          }
        }
      }
    });

    // Send initialize
    const rootUri = `file://${rootDir}`;
    proc.stdin.write(request('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true }
        }
      }
    }));
    console.log(`  initialize sent (rootUri: ${rootUri})`);
  });
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const fixturesDir = resolve(__dirname, 'fixtures');
  const results = [];
  const onlyServer = process.argv[2]; // optional: 'dart', 'swift', 'kotlin'
  console.log(`Running LSP smoke test${onlyServer ? ` (${onlyServer} only)` : ' (all)'}`);

  // --- Dart ---
  const dartPaths = [
    `${process.env.HOME}/SDK/flutter_2.10.5/bin/cache/dart-sdk/bin/dart`,
    `${process.env.HOME}/SDK/flutter_3.16.1/bin/cache/dart-sdk/bin/dart`,
    `${process.env.HOME}/SDK/flutter_3.35.7/bin/cache/dart-sdk/bin/dart`,
  ];
  let dartBin = dartPaths.find(p => existsSync(p));
  if (!dartBin) {
    // fallback: search PATH
    try { dartBin = execSync('which dart 2>/dev/null', { encoding: 'utf8' }).trim(); } catch {}
  }
  if (dartBin && (!onlyServer || onlyServer === 'dart')) {
    const dartRoot = resolve(fixturesDir, 'dart');
    const dartFile = resolve(dartRoot, 'lib/main.dart');
    const dartContent = readFileSync(dartFile, 'utf8');
    const r = await testLSP({
      name: 'dart', cmd: dartBin, args: ['language-server', '--protocol=lsp'],
      env: {}, rootDir: dartRoot,
      fileUri: `file://${dartFile}`, fileContent: dartContent,
      languageId: 'dart', timeoutSec: 120
    });
    results.push(r);
  } else {
    console.log('SKIP dart: no dart binary found');
    results.push({ name: 'dart', error: 'no dart binary found', started: false });
  }

  // --- Swift ---
  if (!onlyServer || onlyServer === 'swift') {
    const swiftRoot = resolve(fixturesDir, 'swift');
    const swiftFile = resolve(swiftRoot, 'Sources/x/main.swift');
    const swiftContent = readFileSync(swiftFile, 'utf8');
    const r = await testLSP({
      name: 'swift', cmd: 'xcrun', args: ['sourcekit-lsp'],
      env: {}, rootDir: swiftRoot,
      fileUri: `file://${swiftFile}`, fileContent: swiftContent,
      languageId: 'swift', timeoutSec: 120
    });
    results.push(r);
  }

  // --- Kotlin LSP ---
  if (!onlyServer || onlyServer === 'kotlin') {
    const kotlinLspDir = `${process.env.HOME}/petak-tools/kotlin-lsp/kotlin-server-263.4702.0`;
    const kotlinLspBin = `${kotlinLspDir}/bin/intellij-server`;
    const kotlinRoot = resolve(fixturesDir, 'kotlin');
    const kotlinFile = resolve(kotlinRoot, 'src/main/kotlin/Main.kt');
    const kotlinContent = readFileSync(kotlinFile, 'utf8');

    // Find JDK 17+
    let javaHome = null;
    const jdkCandidates = [
      '/Library/Java/JavaVirtualMachines/openjdk-19.0.2/Contents/Home',
      `${process.env.HOME}/Library/Java/JavaVirtualMachines/openjdk-19.0.2/Contents/Home`,
      '/Applications/Android Studio 3.app/Contents/jbr/Contents/Home',
      '/Applications/Android Studio 2.app/Contents/jbr/Contents/Home',
    ];
    for (const jh of jdkCandidates) {
      if (existsSync(`${jh}/bin/java`)) {
        // Check version >= 17
        try {
          const ver = execSync(`"${jh}/bin/java" -version 2>&1`, { encoding: 'utf8' });
          const m = ver.match(/version "(\d+)/);
          if (m && parseInt(m[1], 10) >= 17) {
            javaHome = jh;
            console.log(`\nUsing JAVA_HOME: ${jh} (${ver.split('\n')[0].trim()})`);
            break;
          }
        } catch {}
      }
    }

    if (!existsSync(kotlinLspBin)) {
      console.log(`\nSKIP kotlin-lsp: ${kotlinLspBin} not found (need to download)`);
      results.push({ name: 'kotlin-lsp', error: `${kotlinLspBin} not found`, started: false });
    } else {
      // kotlin-lsp bundles its own JBR, but we can set JAVA_HOME to override if needed
      const envVars = {};
      if (javaHome) envVars.JAVA_HOME = javaHome;
      const r = await testLSP({
        name: 'kotlin-lsp', cmd: kotlinLspBin, args: ['--stdio'],
        env: envVars,
        rootDir: kotlinRoot,
        fileUri: `file://${kotlinFile}`, fileContent: kotlinContent,
        languageId: 'kotlin', timeoutSec: 300
      });
      results.push(r);
    }

    // Also try a real Android project if found
    const realProjects = [];
    try {
      const found = execSync(
        'find ~/Documents ~/Projects ~/StudioProjects -maxdepth 4 -name "settings.gradle*" 2>/dev/null',
        { encoding: 'utf8' }
      ).trim().split('\n').filter(Boolean);
      realProjects.push(...found);
    } catch {}

    if (realProjects.length > 0 && existsSync(kotlinLspBin)) {
      const projRoot = dirname(realProjects[0]);
      console.log(`\n--- kotlin-lsp (real project: ${projRoot}) ---`);
      // Find a .kt file in the project
      let ktFile = null;
      try {
        const found = execSync(`find "${projRoot}" -maxdepth 6 -name "*.kt" -not -path "*/build/*" 2>/dev/null | head -1`, { encoding: 'utf8' }).trim();
        if (found) ktFile = found;
      } catch {}
      if (ktFile) {
        const ktContent = readFileSync(ktFile, 'utf8');
        const r = await testLSP({
          name: 'kotlin-lsp (real-project)', cmd: kotlinLspBin, args: ['--stdio'],
          env: javaHome ? { JAVA_HOME: javaHome } : {},
          rootDir: projRoot,
          fileUri: `file://${ktFile}`, fileContent: ktContent,
          languageId: 'kotlin', timeoutSec: 300
        });
        results.push(r);
      }
    }
  }

  // Summary
  console.log('\n\n========== SUMMARY ==========');
  for (const r of results) {
    console.log(`\n${r.name}:`);
    console.log(`  version: ${r.version || 'n/a'}`);
    console.log(`  started: ${r.started}`);
    console.log(`  diagnostics: ${r.diagnosticsReceived || false}`);
    if (r.diagnostics) {
      console.log(`  first diagnostic: ${r.diagnostics[0]?.message?.slice(0, 100)}`);
    }
    console.log(`  time to diagnostics: ${r.diagnosticsTimeMs != null ? r.diagnosticsTimeMs + 'ms' : 'n/a'}`);
    console.log(`  peak RSS: ${r.peakRSSKB ? (r.peakRSSKB / 1024).toFixed(1) + ' MB' : 'n/a'}`);
    if (r.error) console.log(`  error: ${r.error}`);
  }

  // Write JSON for report
  console.log('\n\n========== JSON ==========');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
