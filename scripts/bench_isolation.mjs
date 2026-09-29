import { execSync } from 'node:child_process';
import fs from 'node:fs';

const APP = process.env.PETAK_APP_PATH || '/tmp/Petak-p4-test.app';
const OUT = '/tmp/petak-coldstart.out';
const ERR = '/tmp/petak-coldstart.err';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killPetak() {
  for (let k = 0; k < 5; k++) {
    try {
      execSync('pkill -9 -x petak-app', { stdio: 'ignore' });
    } catch (_) {}
    try {
      execSync('pgrep -x petak-app', { stdio: 'ignore' });
      execSync('sleep 0.2');
    } catch (_) {
      break;
    }
  }
}

async function measureOne(envFlags = '') {
  killPetak();
  await sleep(800);

  fs.writeFileSync(OUT, '');
  fs.writeFileSync(ERR, '');
  const tStart = Date.now();

  const envArgStr = envFlags ? ` ${envFlags} ` : ' ';
  execSync(`open -n --stdout ${OUT} --stderr ${ERR}${envArgStr}"${APP}"`);

  let readyTime = null;
  const timeoutMs = 12000;
  const startWait = Date.now();

  while (Date.now() - startWait < timeoutMs) {
    if (fs.existsSync(OUT)) {
      const content = fs.readFileSync(OUT, 'utf-8');
      const match = content.match(/PETAK_READY\s+(\d+)/);
      if (match) {
        readyTime = parseInt(match[1], 10);
        break;
      }
    }
    await sleep(20);
  }

  const tEnd = Date.now();
  killPetak();

  if (!readyTime) {
    const stdoutContent = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : '(none)';
    const stderrContent = fs.existsSync(ERR) ? fs.readFileSync(ERR, 'utf-8') : '(none)';
    throw new Error(`Timeout waiting for PETAK_READY on ${APP}.\nStdout: ${stdoutContent}\nStderr: ${stderrContent}`);
  }

  const delta = readyTime - tStart;
  const wallDelta = tEnd - tStart;
  return { tStart, readyTime, delta, wallDelta };
}

const configs = [
  { name: '1. Eager Baseline (All eager)', flags: '--env PETAK_EAGER_INIT=1' },
  { name: '2. PETAK_NO_RUNSTORE=1', flags: '--env PETAK_EAGER_INIT=1 --env PETAK_NO_RUNSTORE=1' },
  { name: '3. PETAK_NO_DEVICES=1', flags: '--env PETAK_EAGER_INIT=1 --env PETAK_NO_DEVICES=1' },
  { name: '4. PETAK_NO_GIT=1', flags: '--env PETAK_EAGER_INIT=1 --env PETAK_NO_GIT=1' },
  { name: '5. PETAK_NO_AUTOOPEN=1', flags: '--env PETAK_EAGER_INIT=1 --env PETAK_NO_AUTOOPEN=1' },
  { name: '6. Post-fix (Lazy + Deferred)', flags: '' },
];

async function run() {
  console.log('=== Component Isolation Benchmark ===');
  console.log(`Target App: ${APP}`);

  let load = '';
  let batt = '';
  let up = '';
  try {
    load = execSync('sysctl vm.loadavg').toString().trim();
    batt = execSync('pmset -g batt').toString().trim();
    up = execSync('uptime').toString().trim();
    console.log(`Load: ${load}`);
    console.log(`Battery: ${batt}`);
    console.log(`Uptime: ${up}`);
  } catch (_) {}

  killPetak();
  await sleep(1500);

  const results = [];

  for (const cfg of configs) {
    console.log(`\nEvaluating: ${cfg.name}...`);
    // Warmup
    const warm = await measureOne(cfg.flags);
    console.log(`  Warmup: ${warm.delta} ms`);
    await sleep(1500);

    const runs = [];
    for (let i = 1; i <= 5; i++) {
      const res = await measureOne(cfg.flags);
      runs.push(res.delta);
      console.log(`  Run ${i}: ${res.delta} ms`);
      await sleep(1500);
    }
    const sorted = [...runs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    results.push({ name: cfg.name, flags: cfg.flags, warm: warm.delta, runs: sorted, median });
    console.log(`  => Median: ${median} ms`);
  }

  console.log('\n=== Summary Table: Component Breakdown ===');
  console.log('| Komponen / Konfigurasi | Warmup (ms) | Runs (ms) | Median (ms) | Delta vs Eager |');
  console.log('| --- | --- | --- | --- | --- |');

  const eagerMedian = results[0].median;
  for (const r of results) {
    const delta = r.median - eagerMedian;
    const deltaStr = delta === 0 ? '0 ms' : `${delta > 0 ? '+' : ''}${delta} ms`;
    console.log(`| ${r.name} | ${r.warm} | ${r.runs.join(', ')} | ${r.median} | ${deltaStr} |`);
  }

  const lines = [
    '=== Cold Start Component Isolation Benchmark ===',
    `Date: ${new Date().toISOString()}`,
    `App: ${APP}`,
    `Load: ${load}`,
    `Battery: ${batt}`,
    `Uptime: ${up}`,
    '',
    '| Komponen / Konfigurasi | Warmup (ms) | Runs (ms) | Median (ms) | Delta vs Eager |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const r of results) {
    const delta = r.median - eagerMedian;
    const deltaStr = delta === 0 ? '0 ms' : `${delta > 0 ? '+' : ''}${delta} ms`;
    lines.push(`| ${r.name} | ${r.warm} | ${r.runs.join(', ')} | ${r.median} | ${deltaStr} |`);
  }

  fs.writeFileSync('docs/phase4/logs/mac-coldstart-components.txt', lines.join('\n'));
  console.log('\nSaved log to docs/phase4/logs/mac-coldstart-components.txt');
}

run().catch((err) => {
  console.error('Isolation benchmark failed:', err);
  process.exit(1);
});
