import { execSync } from 'node:child_process';
import fs from 'node:fs';

const APP = '/Users/uqi/petak/target/release/bundle/macos/Petak.app';
const OUT = '/tmp/petak-coldstart.out';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killPetak() {
  try {
    execSync('pkill -x petak-app', { stdio: 'ignore' });
  } catch (_) {}
}

async function measureOne() {
  killPetak();
  await sleep(500);

  fs.writeFileSync(OUT, '');
  const tStart = Date.now();

  execSync(`open -n --stdout ${OUT} ${APP}`);

  let readyTime = null;
  const timeoutMs = 8000;
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
    throw new Error('Timeout waiting for PETAK_READY');
  }

  const delta = readyTime - tStart;
  const wallDelta = tEnd - tStart;
  return { tStart, readyTime, delta, wallDelta };
}

async function run() {
  console.log('=== Cold Start Benchmark ===');
  killPetak();
  await sleep(1000);

  console.log('--- Run 0: First Launch ---');
  const run0 = await measureOne();
  console.log(`First Launch: ${run0.delta} ms (wall: ${run0.wallDelta} ms)`);
  await sleep(2000);

  const runs = [];
  console.log('--- Runs 1..5: Subsequent Launches ---');
  for (let i = 1; i <= 5; i++) {
    const res = await measureOne();
    console.log(`Run ${i}: ${res.delta} ms (wall: ${res.wallDelta} ms)`);
    runs.push(res.delta);
    await sleep(2000);
  }

  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  console.log(`\nResults:`);
  console.log(`First launch: ${run0.delta} ms`);
  console.log(`Subsequent runs: ${runs.join(', ')} ms`);
  console.log(`Median cold start: ${median} ms`);

  const resultObj = {
    first_launch_ms: run0.delta,
    runs_ms: runs,
    median_ms: median,
  };
  fs.writeFileSync('/tmp/petak-coldstart.json', JSON.stringify(resultObj, null, 2));
}

run().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
