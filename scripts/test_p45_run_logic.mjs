import assert from 'node:assert';
import {
  initialRunLogicState,
  reduceRunEvent,
  mapBuildErrorToLink,
  parseBuildErrorLine,
  formatAppState,
} from '../ui/features/run/logic.ts';

console.log('=== Running P4.5 Run Logic Tests ===');

// 1. Initial State
{
  const s0 = initialRunLogicState();
  assert.strictEqual(s0.state, 'stopped');
  assert.strictEqual(s0.runId, null);
  assert.strictEqual(s0.appId, null);
  assert.strictEqual(s0.devtoolsUri, null);
  assert.strictEqual(s0.pid, null);
  assert.deepStrictEqual(s0.buildErrors, []);
  assert.deepStrictEqual(s0.outputLines, []);
  console.log('✓ Initial state verified');
}

// 2. Reducer: state events
{
  let s = initialRunLogicState();
  s = reduceRunEvent(s, { type: 'state', state: 'building' });
  assert.strictEqual(s.state, 'building');

  s = reduceRunEvent(s, { type: 'state', state: 'installing' });
  assert.strictEqual(s.state, 'installing');

  s = reduceRunEvent(s, {
    type: 'appStarted',
    appId: 'id.co.bankjatim.jconnect',
    devtoolsUri: 'http://127.0.0.1:9100?uri=http://127.0.0.1:8181',
    vmServiceUri: 'http://127.0.0.1:8181',
    pid: 12345,
  });
  assert.strictEqual(s.state, 'running');
  assert.strictEqual(s.appId, 'id.co.bankjatim.jconnect');
  assert.strictEqual(s.devtoolsUri, 'http://127.0.0.1:9100?uri=http://127.0.0.1:8181');
  assert.strictEqual(s.vmServiceUri, 'http://127.0.0.1:8181');
  assert.strictEqual(s.pid, 12345);

  // Reload event
  s = reduceRunEvent(s, {
    type: 'reloaded',
    fullRestart: false,
    ok: true,
    ms: 240,
    message: 'Reloaded 1 of 652 libraries in 240ms',
  });
  assert.strictEqual(s.state, 'running');
  assert.strictEqual(s.lastReloadMs, 240);
  assert.strictEqual(s.lastReloadOk, true);

  // Stopped event
  s = reduceRunEvent(s, { type: 'stopped', code: 0 });
  assert.strictEqual(s.state, 'stopped');
  assert.strictEqual(s.runId, null);
  assert.strictEqual(s.pid, null);
  console.log('✓ Reducer state transitions verified');
}

// 3. Reducer: buildError events
{
  let s = initialRunLogicState();
  s = reduceRunEvent(s, {
    type: 'buildError',
    file: 'lib/main.dart',
    line: 42,
    col: 10,
    message: "Undefined name 'myVar'",
  });
  s = reduceRunEvent(s, {
    type: 'buildError',
    file: 'android/app/src/main/kotlin/MainActivity.kt',
    line: 18,
    col: 4,
    message: 'Unresolved reference: JConnectPlugin',
  });

  assert.strictEqual(s.buildErrors.length, 2);
  assert.strictEqual(s.buildErrors[0].file, 'lib/main.dart');
  assert.strictEqual(s.buildErrors[0].line, 42);
  assert.strictEqual(s.buildErrors[0].col, 10);
  assert.strictEqual(s.buildErrors[1].file, 'android/app/src/main/kotlin/MainActivity.kt');
  assert.strictEqual(s.buildErrors[1].line, 18);
  console.log('✓ Reducer buildError accumulation verified');
}

// 4. Reducer: output events & capping
{
  let s = initialRunLogicState();
  s = reduceRunEvent(s, { type: 'output', stream: 'stdout', line: 'Connecting to device...' });
  s = reduceRunEvent(s, { type: 'output', stream: 'stdout', line: 'Flutter run initialized' });
  s = reduceRunEvent(s, { type: 'output', stream: 'stderr', line: 'Warning: deprecated API' });

  assert.strictEqual(s.outputLines.length, 3);
  assert.strictEqual(s.outputLines[0].line, 'Connecting to device...');
  assert.strictEqual(s.outputLines[0].stream, 'stdout');
  assert.strictEqual(s.outputLines[2].line, 'Warning: deprecated API');
  assert.strictEqual(s.outputLines[2].stream, 'stderr');

  // Test capping
  for (let i = 0; i < 20; i++) {
    s = reduceRunEvent(s, { type: 'output', stream: 'stdout', line: `Line ${i}` }, 10);
  }
  assert.strictEqual(s.outputLines.length, 10);
  assert.strictEqual(s.outputLines[9].line, 'Line 19');
  console.log('✓ Reducer output lines and capping verified');
}

// 5. Mapping build error to link
{
  const link1 = mapBuildErrorToLink({
    file: '/home/uqi/projects/petak/lib/main.dart',
    line: 42,
    col: 10,
    message: "Undefined name 'foo'",
  });
  assert.strictEqual(link1.filename, 'main.dart');
  assert.strictEqual(link1.label, 'main.dart:42:10');
  assert.strictEqual(link1.line, 42);
  assert.strictEqual(link1.col, 10);

  const link2 = mapBuildErrorToLink({
    file: 'app/src/MainActivity.kt',
    line: 15,
    col: null,
    message: 'Error',
  });
  assert.strictEqual(link2.filename, 'MainActivity.kt');
  assert.strictEqual(link2.label, 'MainActivity.kt:15');
  assert.strictEqual(link2.col, null);
  console.log('✓ mapBuildErrorToLink verified');
}

// 6. parseBuildErrorLine
{
  const dartErr = parseBuildErrorLine("lib/pages/home.dart:12:8: Error: Method 'init' not found.");
  assert.ok(dartErr);
  assert.strictEqual(dartErr.file, 'lib/pages/home.dart');
  assert.strictEqual(dartErr.line, 12);
  assert.strictEqual(dartErr.col, 8);
  assert.strictEqual(dartErr.message, "Method 'init' not found.");

  const ktErr = parseBuildErrorLine('e: src/main/kotlin/App.kt:25:3 Unresolved reference: x');
  assert.ok(ktErr);
  assert.strictEqual(ktErr.file, 'src/main/kotlin/App.kt');
  assert.strictEqual(ktErr.line, 25);
  assert.strictEqual(ktErr.col, 3);
  assert.strictEqual(ktErr.message, 'Unresolved reference: x');

  const swiftErr = parseBuildErrorLine('Sources/App/main.swift:5:10: error: cannot find value in scope');
  assert.ok(swiftErr);
  assert.strictEqual(swiftErr.file, 'Sources/App/main.swift');
  assert.strictEqual(swiftErr.line, 5);
  assert.strictEqual(swiftErr.col, 10);

  const nonErr = parseBuildErrorLine('Regular build stdout message');
  assert.strictEqual(nonErr, null);
  console.log('✓ parseBuildErrorLine verified');
}

// 7. formatAppState
{
  assert.strictEqual(formatAppState('building').label, 'Building...');
  assert.strictEqual(formatAppState('running').label, 'Running');
  assert.strictEqual(formatAppState('stopped').label, 'Ready');
  console.log('✓ formatAppState verified');
}

console.log('All P4.5 logic tests passed!');
