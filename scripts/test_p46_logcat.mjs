import assert from 'node:assert';
import { performance } from 'node:perf_hooks';
import {
  LEVEL_WEIGHT,
  LEVEL_COLORS,
  LEVEL_BG,
  parseStackLinks,
  splitLogMessageWithLinks,
  defaultLogcatFilter,
  matchesFilter,
  filterLogLines,
  LogcatRingBuffer,
} from '../ui/features/run/logcat.ts';

console.log('=== Running P4.6 Logcat Logic & Benchmark Tests ===\n');

// 1. Ring Buffer Tests
console.log('1. Testing Ring Buffer...');
{
  const buf = new LogcatRingBuffer(10);
  assert.strictEqual(buf.length, 0);

  // Push 5 items
  const b1 = [
    { ts: '10:00:01', pid: 100, tid: 101, level: 'D', tag: 'Tag1', msg: 'Msg 1' },
    { ts: '10:00:02', pid: 100, tid: 101, level: 'I', tag: 'Tag2', msg: 'Msg 2' },
    { ts: '10:00:03', pid: 100, tid: 101, level: 'W', tag: 'Tag3', msg: 'Msg 3' },
    { ts: '10:00:04', pid: 100, tid: 101, level: 'E', tag: 'Tag4', msg: 'Msg 4' },
    { ts: '10:00:05', pid: 100, tid: 101, level: 'V', tag: 'Tag5', msg: 'Msg 5' },
  ];
  buf.pushBatch(b1);
  assert.strictEqual(buf.length, 5);
  assert.strictEqual(buf.get(0)?.msg, 'Msg 1');
  assert.strictEqual(buf.get(4)?.msg, 'Msg 5');

  // Push 8 more items -> total 13, cap is 10 -> oldest 3 evicted
  const b2 = [];
  for (let i = 6; i <= 13; i++) {
    b2.push({ ts: `10:00:${i < 10 ? '0' + i : i}`, pid: 100, tid: 101, level: 'D', tag: `Tag${i}`, msg: `Msg ${i}` });
  }
  buf.pushBatch(b2);
  assert.strictEqual(buf.length, 10);
  // First item in buffer should now be Msg 4 (indices 4..13: 4,5,6,7,8,9,10,11,12,13 = 10 items)
  assert.strictEqual(buf.get(0)?.msg, 'Msg 4');
  assert.strictEqual(buf.get(9)?.msg, 'Msg 13');

  // Push single batch exceeding capacity
  const bBig = [];
  for (let i = 1; i <= 25; i++) {
    bBig.push({ ts: '10:01:00', pid: 100, tid: 101, level: 'I', tag: 'Big', msg: `Big ${i}` });
  }
  buf.pushBatch(bBig);
  assert.strictEqual(buf.length, 10);
  assert.strictEqual(buf.get(0)?.msg, 'Big 16');
  assert.strictEqual(buf.get(9)?.msg, 'Big 25');

  // Test clear
  buf.clear();
  assert.strictEqual(buf.length, 0);
  assert.deepStrictEqual(buf.getAll(), []);

  // Cap 50k buffer verification
  const buf50k = new LogcatRingBuffer(50000);
  const chunk1k = [];
  for (let i = 0; i < 1000; i++) {
    chunk1k.push({ ts: '10:00:00', pid: 100, tid: 101, level: 'D', tag: 'Bench', msg: `Item ${i}` });
  }
  for (let k = 0; k < 55; k++) {
    buf50k.pushBatch(chunk1k);
  }
  assert.strictEqual(buf50k.length, 50000);
  console.log('✓ Ring buffer capacity, FIFO eviction, and clearing verified');
}

// 2. Filter Logic Tests
console.log('\n2. Testing Filter Logic...');
{
  const lines = [
    { id: 1, ts: '10:00:01', pid: 100, tid: 1, level: 'V', tag: 'System', msg: 'Verbose message' },
    { id: 2, ts: '10:00:02', pid: 100, tid: 1, level: 'D', tag: 'Checkout', msg: 'applyVoucher(HEMAT50)' },
    { id: 3, ts: '10:00:03', pid: 200, tid: 2, level: 'I', tag: 'OkHttp', msg: '--> POST /cart' },
    { id: 4, ts: '10:00:04', pid: 100, tid: 1, level: 'W', tag: 'Checkout', msg: 'voucher response empty' },
    { id: 5, ts: '10:00:05', pid: 100, tid: 1, level: 'E', tag: 'AndroidRuntime', msg: 'FATAL EXCEPTION: main' },
  ];

  // Default filter (V, no tag, no search, packageMine false) -> all lines
  const defaultF = defaultLogcatFilter();
  assert.strictEqual(filterLogLines(lines, defaultF).length, 5);

  // Level minimum: D (excludes V)
  const filterD = { ...defaultF, minLevel: 'D' };
  const resD = filterLogLines(lines, filterD);
  assert.strictEqual(resD.length, 4);
  assert.ok(!resD.some((l) => l.level === 'V'));

  // Level minimum: W (excludes V, D, I)
  const filterW = { ...defaultF, minLevel: 'W' };
  const resW = filterLogLines(lines, filterW);
  assert.strictEqual(resW.length, 2);
  assert.deepStrictEqual(resW.map((l) => l.level), ['W', 'E']);

  // Level minimum: E
  const filterE = { ...defaultF, minLevel: 'E' };
  const resE = filterLogLines(lines, filterE);
  assert.strictEqual(resE.length, 1);
  assert.strictEqual(resE[0].tag, 'AndroidRuntime');

  // Tag filter: 'checkout' (case insensitive)
  const filterTag = { ...defaultF, tag: 'checkout' };
  const resTag = filterLogLines(lines, filterTag);
  assert.strictEqual(resTag.length, 2);
  assert.ok(resTag.every((l) => l.tag === 'Checkout'));

  // Text search: 'voucher'
  const filterSearch = { ...defaultF, search: 'voucher' };
  const resSearch = filterLogLines(lines, filterSearch);
  assert.strictEqual(resSearch.length, 2);
  assert.ok(resSearch.every((l) => l.msg.toLowerCase().includes('voucher')));

  // Package:mine toggle (pid=100)
  const filterMine = { ...defaultF, packageMine: true, appPid: 100 };
  const resMine = filterLogLines(lines, filterMine);
  assert.strictEqual(resMine.length, 4); // lines 1, 2, 4, 5
  assert.ok(resMine.every((l) => l.pid === 100));

  // Package:mine for pid=200
  const filterPid200 = { ...defaultF, packageMine: true, appPid: 200 };
  const resPid200 = filterLogLines(lines, filterPid200);
  assert.strictEqual(resPid200.length, 1);
  assert.strictEqual(resPid200[0].tag, 'OkHttp');

  // Combined: package:mine (100) + minLevel (W) + tag ('Checkout')
  const filterComb = {
    minLevel: 'W',
    tag: 'checkout',
    search: '',
    packageMine: true,
    appPid: 100,
  };
  const resComb = filterLogLines(lines, filterComb);
  assert.strictEqual(resComb.length, 1);
  assert.strictEqual(resComb[0].id, 4);
  console.log('✓ Level, tag, text, and package:mine filters verified');
}

// 3. Stack Trace Link Parser Tests
console.log('\n3. Testing Stack Trace Link Parsing...');
{
  // 1. Dart package link
  const dartPkgMsg = 'Flutter exception: package:id_shop/features/checkout.dart:42:10 caught by handler';
  const links1 = parseStackLinks(dartPkgMsg);
  assert.strictEqual(links1.length, 1);
  assert.strictEqual(links1[0].file, 'lib/features/checkout.dart');
  assert.strictEqual(links1[0].line, 42);
  assert.strictEqual(links1[0].col, 10);
  assert.strictEqual(links1[0].raw, 'package:id_shop/features/checkout.dart:42:10');

  // Dart package with custom root
  const links1Root = parseStackLinks(dartPkgMsg, '/home/user/app');
  assert.strictEqual(links1Root[0].file, '/home/user/app/lib/features/checkout.dart');

  // 2. Dart file URI
  const dartFileUriMsg = 'Unhandled exception at file:///mnt/storage/projects/petak/lib/main.dart:15:3';
  const links2 = parseStackLinks(dartFileUriMsg);
  assert.strictEqual(links2.length, 1);
  assert.strictEqual(links2[0].file, '/mnt/storage/projects/petak/lib/main.dart');
  assert.strictEqual(links2[0].line, 15);
  assert.strictEqual(links2[0].col, 3);

  // 3. Dart relative lib/...
  const dartRelMsg = 'Reloaded lib/features/cart/cart_service.dart:88:5 in 120ms';
  const links3 = parseStackLinks(dartRelMsg);
  assert.strictEqual(links3.length, 1);
  assert.strictEqual(links3[0].file, 'lib/features/cart/cart_service.dart');
  assert.strictEqual(links3[0].line, 88);
  assert.strictEqual(links3[0].col, 5);

  // 4. Java/Kotlin stack trace
  const jvmMsg = '    at id.shop.checkout.CartRepository.applyVoucher(CartRepository.kt:48)';
  const links4 = parseStackLinks(jvmMsg);
  assert.strictEqual(links4.length, 1);
  assert.strictEqual(links4[0].file, 'CartRepository.kt');
  assert.strictEqual(links4[0].line, 48);

  const jvmJavaMsg = '    at android.os.Handler.dispatchMessage(Handler.java:106)';
  const links5 = parseStackLinks(jvmJavaMsg);
  assert.strictEqual(links5.length, 1);
  assert.strictEqual(links5[0].file, 'Handler.java');
  assert.strictEqual(links5[0].line, 106);

  // Message with no links
  const plainMsg = 'Normal info log without stack frames';
  assert.strictEqual(parseStackLinks(plainMsg).length, 0);

  // Split message with links helper
  const parts = splitLogMessageWithLinks(jvmMsg, links4);
  assert.strictEqual(parts.length, 3);
  assert.strictEqual(parts[0].text, '    at id.shop.checkout.CartRepository.applyVoucher(');
  assert.strictEqual(parts[0].link, undefined);
  assert.strictEqual(parts[1].text, 'CartRepository.kt:48');
  assert.strictEqual(parts[1].link?.file, 'CartRepository.kt');
  assert.strictEqual(parts[1].link?.line, 48);
  assert.strictEqual(parts[2].text, ')');

  console.log('✓ Dart package, file URI, relative, and JVM stack links verified');
}

// 4. Benchmark: 2,000 lines/second for 5 seconds (10,000 lines total)
console.log('\n4. Running Throughput Benchmark (2,000 lines/sec for 5 seconds = 10,000 lines)...');
{
  const buffer = new LogcatRingBuffer(50000);
  const filter = {
    minLevel: 'D',
    tag: '',
    search: '',
    packageMine: false,
    appPid: null,
  };

  const totalLines = 10000;
  const batchSize = 100;
  const numBatches = totalLines / batchSize; // 100 batches
  const batchTimes = [];

  const tags = ['OkHttp', 'Checkout', 'Flutter', 'AndroidRuntime', 'ActivityManager', 'SurfaceView'];
  const levels = ['V', 'D', 'I', 'W', 'E'];

  // Pre-generate batches to measure pure logic (buffer push + filtering) without generation overhead
  const prebuiltBatches = [];
  let counter = 1;
  for (let b = 0; b < numBatches; b++) {
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      const idx = counter++;
      const lvl = idx % 20 === 0 ? 'E' : levels[idx % levels.length];
      const tag = idx % 20 === 0 ? 'AndroidRuntime' : tags[idx % tags.length];
      const msg = idx % 20 === 0
        ? `FATAL ERROR at id.shop.checkout.CartRepository.applyVoucher(CartRepository.kt:48) #${idx}`
        : idx % 15 === 0
        ? `package:id_shop/features/checkout.dart:42:10 event #${idx}`
        : `Network request transaction processed #${idx}`;
      batch.push({
        ts: '10:42:18.000',
        pid: 12345,
        tid: 12360,
        level: lvl,
        tag,
        msg,
      });
    }
    prebuiltBatches.push(batch);
  }

  // Pre-fill buffer with 40,000 lines so test runs at near full 50k capacity
  console.log('Pre-filling buffer to 40,000 lines to test worst-case buffer size...');
  for (let k = 0; k < 40; k++) {
    const fillBatch = [];
    for (let j = 0; j < 1000; j++) {
      fillBatch.push({
        ts: '10:00:00.000',
        pid: 999,
        tid: 999,
        level: 'D',
        tag: 'PreFill',
        msg: 'Prefilled log item',
      });
    }
    buffer.pushBatch(fillBatch);
  }
  assert.strictEqual(buffer.length, 40000);

  const tStartAll = performance.now();
  for (let b = 0; b < numBatches; b++) {
    const t0 = performance.now();
    // 1. Push to ring buffer (cap 50k, handles eviction)
    buffer.pushBatch(prebuiltBatches[b]);
    // 2. Filter lines (simulating rAF filter evaluation)
    const filtered = filterLogLines(buffer.getAll(), filter);
    const t1 = performance.now();
    const dur = t1 - t0;
    batchTimes.push(dur);
  }
  const tEndAll = performance.now();
  const totalElapsedMs = tEndAll - tStartAll;

  // Stats calculation
  const sortedTimes = [...batchTimes].sort((a, b) => a - b);
  const minMs = sortedTimes[0];
  const maxMs = sortedTimes[sortedTimes.length - 1];
  const avgMs = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;
  const p95Ms = sortedTimes[Math.floor(sortedTimes.length * 0.95)];

  console.log(`Buffer final size: ${buffer.length.toLocaleString()} lines`);
  console.log(`Total batches: ${numBatches} (${batchSize} lines/batch = ${totalLines.toLocaleString()} lines total)`);
  console.log(`Total execution time: ${totalElapsedMs.toFixed(2)} ms`);
  console.log(`Min time per batch:   ${minMs.toFixed(3)} ms`);
  console.log(`Avg time per batch:   ${avgMs.toFixed(3)} ms`);
  console.log(`P95 time per batch:   ${p95Ms.toFixed(3)} ms`);
  console.log(`Max time per batch:   ${maxMs.toFixed(3)} ms`);

  // Target budget: avg batch processing time must be well below 16ms frame budget (typically <3ms even for 50k lines)
  assert.ok(avgMs < 10, `Average batch time ${avgMs}ms exceeded 10ms threshold`);
  console.log('✓ 2,000 lines/sec throughput benchmark passed comfortably under frame budget');
}

console.log('\n=== All P4.6 Logcat Tests Passed Successfully ===');
