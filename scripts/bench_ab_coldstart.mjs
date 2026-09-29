import { execSync } from 'node:child_process';
import fs from 'node:fs';

const APP_A = process.env.APP_A || '/tmp/Petak-p3.app';
const APP_B = process.env.APP_B || '/tmp/Petak-p4-head.app';
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
      // Still running, sleep and retry
      execSync('sleep 0.2');
    } catch (_) {
      // Not running, clean
      break;
    }
  }
}

async function measureOne(appPath) {
  killPetak();
  await sleep(1000);

  fs.writeFileSync(OUT, '');
  fs.writeFileSync(ERR, '');
  const tStart = Date.now();

  execSync(`open -n --stdout ${OUT} --stderr ${ERR} "${appPath}"`);

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
    throw new Error(`Timeout waiting for PETAK_READY on ${appPath}.\nStdout: ${stdoutContent}\nStderr: ${stderrContent}`);
  }

  const delta = readyTime - tStart;
  const wallDelta = tEnd - tStart;
  return { tStart, readyTime, delta, wallDelta };
}

async function run() {
  console.log('=== Cold Start A/B Benchmark ===');
  console.log(`App A (Phase 3): ${APP_A}`);
  console.log(`App B (Phase 4): ${APP_B}`);

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

  console.log('\n--- Warmup (Run 0) ---');
  const warmA = await measureOne(APP_A);
  console.log(`Warmup A (Phase 3): ${warmA.delta} ms (wall: ${warmA.wallDelta} ms)`);
  await sleep(2000);

  const warmB = await measureOne(APP_B);
  console.log(`Warmup B (Phase 4): ${warmB.delta} ms (wall: ${warmB.wallDelta} ms)`);
  await sleep(2000);

  const runsA = [];
  const runsB = [];

  console.log('\n--- Alternating Runs 1..5 ---');
  for (let i = 1; i <= 5; i++) {
    console.log(`\nRound ${i}:`);
    const resA = await measureOne(APP_A);
    runsA.push(resA.delta);
    console.log(`  Run ${i} A (Phase 3): ${resA.delta} ms (wall: ${resA.wallDelta} ms)`);
    await sleep(2000);

    const resB = await measureOne(APP_B);
    runsB.push(resB.delta);
    console.log(`  Run ${i} B (Phase 4): ${resB.delta} ms (wall: ${resB.wallDelta} ms)`);
    await sleep(2000);
  }

  const sortedA = [...runsA].sort((a, b) => a - b);
  const sortedB = [...runsB].sort((a, b) => a - b);
  const medianA = sortedA[Math.floor(sortedA.length / 2)];
  const medianB = sortedB[Math.floor(sortedB.length / 2)];
  const gap = medianB - medianA;

  console.log('\n=== Summary Results ===');
  console.log(`Phase 3 (A) Warmup: ${warmA.delta} ms`);
  console.log(`Phase 3 (A) Runs:   ${sortedA.join(', ')} ms`);
  console.log(`Phase 3 (A) Median: ${medianA} ms`);
  console.log('');
  console.log(`Phase 4 (B) Warmup: ${warmB.delta} ms`);
  console.log(`Phase 4 (B) Runs:   ${sortedB.join(', ')} ms`);
  console.log(`Phase 4 (B) Median: ${medianB} ms`);
  console.log('');
  console.log(`Gap (B - A):        ${gap > 0 ? '+' : ''}${gap} ms`);
  if (gap >= 30) {
    console.log('Conclusion: REAL REGRESSION detected (gap >= 30 ms).');
  } else {
    console.log('Conclusion: Noise or negligible difference (< 30 ms).');
  }

  const logContent = [
    '=== Cold Start A/B Benchmark ===',
    `Date: ${new Date().toISOString()}`,
    `Load: ${load}`,
    `Battery: ${batt}`,
    `Uptime: ${up}`,
    `App A (Phase 3): ${APP_A}`,
    `App B (Phase 4): ${APP_B}`,
    '',
    `Phase 3 Warmup: ${warmA.delta} ms`,
    `Phase 3 Runs:   ${sortedA.join(', ')} ms`,
    `Phase 3 Median: ${medianA} ms`,
    '',
    `Phase 4 Warmup: ${warmB.delta} ms`,
    `Phase 4 Runs:   ${sortedB.join(', ')} ms`,
    `Phase 4 Median: ${medianB} ms`,
    '',
    `Gap (Phase 4 - Phase 3): ${gap > 0 ? '+' : ''}${gap} ms`,
    `Conclusion: ${gap >= 30 ? 'REAL REGRESSION detected (gap >= 30 ms)' : 'Noise or negligible (< 30 ms)'}`,
  ].join('\n');

  fs.writeFileSync('docs/phase4/logs/mac-coldstart-ab.txt', logContent);
  console.log('\nSaved log to docs/phase4/logs/mac-coldstart-ab.txt');
}

run().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
