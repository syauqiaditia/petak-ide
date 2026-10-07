import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  filterLogLines,
  LogcatRingBuffer,
} from '../ui/features/run/logcat.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// Mock DOM classes for headless testing
class MockHTMLElement {
  isContentEditable = false;
  tagName = 'DIV';
}

class MockHTMLInputElement extends MockHTMLElement {
  tagName = 'INPUT';
  value = '';
}

class MockHTMLTextAreaElement extends MockHTMLElement {
  tagName = 'TEXTAREA';
  value = '';
}

// =============================================================================
// Suite 1: Editor Keydown Input Guard (Editor.svelte)
// =============================================================================

test('b34 Logcat Fix 1: Editor.svelte declares keydown input guard at the top of onKeydown', () => {
  const editorSrc = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');

  // Verify onKeydown has the guard on the very first lines
  assert.ok(editorSrc.includes('function onKeydown(e: KeyboardEvent)'), 'Editor.svelte must declare onKeydown');

  // Extract onKeydown implementation
  const onKeydownIdx = editorSrc.indexOf('function onKeydown(e: KeyboardEvent)');
  assert.ok(onKeydownIdx !== -1, 'function onKeydown must exist');
  const onKeydownSnippet = editorSrc.slice(onKeydownIdx, onKeydownIdx + 400);

  // Check guard conditions
  assert.ok(
    onKeydownSnippet.includes('const target = e.target as HTMLElement | null;'),
    'onKeydown must extract target as HTMLElement'
  );
  assert.ok(
    onKeydownSnippet.includes('target instanceof HTMLInputElement'),
    'onKeydown must check target instanceof HTMLInputElement'
  );
  assert.ok(
    onKeydownSnippet.includes('target instanceof HTMLTextAreaElement'),
    'onKeydown must check target instanceof HTMLTextAreaElement'
  );
  assert.ok(
    onKeydownSnippet.includes('target.isContentEditable'),
    'onKeydown must check target.isContentEditable'
  );
});

test('b34 Logcat Fix 2: Keydown guard prevents intercepting keystrokes inside input / textarea / contentEditable', () => {
  // Replicate exact guard logic from Editor.svelte
  function simulateEditorOnKeydown(e, actions = {}) {
    const target = e.target;
    if (
      target instanceof MockHTMLInputElement ||
      target instanceof MockHTMLTextAreaElement ||
      (target && target.isContentEditable)
    ) {
      return;
    }

    // Editor shortcuts
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key?.toLowerCase() === 'l') {
      e.preventDefault();
      e.stopPropagation();
      actions.sendSelectionToAgent?.();
    } else if ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      actions.handleSave?.();
    } else if ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 'w') {
      e.preventDefault();
      e.stopPropagation();
      actions.handleCloseActiveTab?.();
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key?.toLowerCase() === 'f' || e.code === 'KeyF')) {
      e.preventDefault();
      e.stopPropagation();
      actions.find?.();
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key?.toLowerCase() === 'r' || e.code === 'KeyR')) {
      e.preventDefault();
      e.stopPropagation();
      actions.replace?.();
    } else if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'Enter' || e.code === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      actions.codeAction?.();
    }
  }

  function createMockKeyEvent(key, mods = {}, target = null) {
    let prevented = false;
    let stopped = false;
    return {
      key,
      code: mods.code || undefined,
      metaKey: mods.metaKey || false,
      ctrlKey: mods.ctrlKey || false,
      altKey: mods.altKey || false,
      shiftKey: mods.shiftKey || false,
      target,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; },
      isPrevented: () => prevented,
      isStopped: () => stopped,
    };
  }

  // 1. HTMLInputElement target: shortcuts must NOT be intercepted
  const inputEl = new MockHTMLInputElement();
  const inputShortcuts = [
    { key: 'f', mods: { metaKey: true } },
    { key: 'r', mods: { metaKey: true } },
    { key: 's', mods: { metaKey: true } },
    { key: 'w', mods: { metaKey: true } },
    { key: 'l', mods: { metaKey: true } },
    { key: 'Enter', mods: { altKey: true } },
    { key: 'a', mods: {} },
    { key: 'Backspace', mods: {} },
  ];

  for (const s of inputShortcuts) {
    const event = createMockKeyEvent(s.key, s.mods, inputEl);
    simulateEditorOnKeydown(event);
    assert.equal(
      event.isPrevented(),
      false,
      `Key ${s.key} with target HTMLInputElement must NOT be preventDefaulted`
    );
    assert.equal(
      event.isStopped(),
      false,
      `Key ${s.key} with target HTMLInputElement must NOT be stopPropagation`
    );
  }

  // 2. HTMLTextAreaElement target: shortcuts must NOT be intercepted
  const textareaEl = new MockHTMLTextAreaElement();
  for (const s of inputShortcuts) {
    const event = createMockKeyEvent(s.key, s.mods, textareaEl);
    simulateEditorOnKeydown(event);
    assert.equal(
      event.isPrevented(),
      false,
      `Key ${s.key} with target HTMLTextAreaElement must NOT be preventDefaulted`
    );
  }

  // 3. contentEditable target: shortcuts must NOT be intercepted
  const editableEl = new MockHTMLElement();
  editableEl.isContentEditable = true;
  for (const s of inputShortcuts) {
    const event = createMockKeyEvent(s.key, s.mods, editableEl);
    simulateEditorOnKeydown(event);
    assert.equal(
      event.isPrevented(),
      false,
      `Key ${s.key} with target isContentEditable must NOT be preventDefaulted`
    );
  }

  // 4. Regular element or null target: editor shortcuts MUST be intercepted
  const divEl = new MockHTMLElement();
  const saveEvent = createMockKeyEvent('s', { metaKey: true }, divEl);
  let saved = false;
  simulateEditorOnKeydown(saveEvent, { handleSave: () => { saved = true; } });
  assert.equal(saveEvent.isPrevented(), true, 'Cmd+S on regular element must be preventDefaulted');
  assert.equal(saved, true, 'handleSave must be called on regular element');

  const findEvent = createMockKeyEvent('f', { metaKey: true }, null);
  let findOpened = false;
  simulateEditorOnKeydown(findEvent, { find: () => { findOpened = true; } });
  assert.equal(findEvent.isPrevented(), true, 'Cmd+F on null target must be preventDefaulted');
  assert.equal(findOpened, true, 'find action must be triggered on null target');
});

// =============================================================================
// Suite 2: Logcat Two-Way Binding & Reactive Synchronization
// =============================================================================

test('b34 Logcat Fix 3: LogcatPanel.svelte uses two-way binding on tagInput and searchInput', () => {
  const panelSrc = fs.readFileSync(path.resolve(uiRoot, 'features/run/LogcatPanel.svelte'), 'utf-8');

  // Verify tagInput uses bind:value
  assert.ok(
    panelSrc.includes('bind:value={tagInput}'),
    'LogcatPanel.svelte must use bind:value={tagInput}'
  );
  assert.ok(
    panelSrc.includes('oninput={handleTagInput}'),
    'LogcatPanel.svelte must retain oninput={handleTagInput} for store synchronization'
  );

  // Verify searchInput uses bind:value
  assert.ok(
    panelSrc.includes('bind:value={searchInput}'),
    'LogcatPanel.svelte must use bind:value={searchInput}'
  );
  assert.ok(
    panelSrc.includes('oninput={handleSearchInput}'),
    'LogcatPanel.svelte must retain oninput={handleSearchInput} for store synchronization'
  );

  // Verify legacy one-way bindings are gone from inputs
  assert.ok(
    !panelSrc.match(/[^:]value=\{tagInput\}/),
    'LogcatPanel.svelte must not have one-way value={tagInput}'
  );
  assert.ok(
    !panelSrc.match(/[^:]value=\{searchInput\}/),
    'LogcatPanel.svelte must not have one-way value={searchInput}'
  );
});

test('b34 Logcat Fix 4: logcatStore.svelte.ts contracts for setTagFilter and setSearchQuery', () => {
  const storeSrc = fs.readFileSync(path.resolve(uiRoot, 'features/run/logcatStore.svelte.ts'), 'utf-8');

  // Verify method declarations and debounce
  assert.ok(storeSrc.includes('setTagFilter(tag: string)'), 'logcatStore must declare setTagFilter');
  assert.ok(storeSrc.includes('setSearchQuery(q: string)'), 'logcatStore must declare setSearchQuery');
  assert.ok(storeSrc.includes('this.debounceTimer = setTimeout'), 'setSearchQuery must debounce filter execution');
  assert.ok(storeSrc.includes('this.searchQuery = q'), 'setSearchQuery must update searchQuery immediately');
  assert.ok(storeSrc.includes('this.tagFilter = tag'), 'setTagFilter must update tagFilter immediately');
});

test('b34 Logcat Fix 5: Filter logic synchronization for tag and search queries', () => {
  const sampleLogs = [
    { id: 1, level: 'I', tag: 'ActivityManager', msg: 'Start proc 1234:com.bankjatim.jconnect/u0a123 for activity', ts: '10-07 10:00:00.123', pid: 1234, tid: 1234 },
    { id: 2, level: 'D', tag: 'FlutterJNI', msg: 'Flutter main isolate spawned successfully', ts: '10-07 10:00:01.000', pid: 1234, tid: 1235 },
    { id: 3, level: 'E', tag: 'AndroidRuntime', msg: 'FATAL EXCEPTION: main Process: com.bankjatim.jconnect', ts: '10-07 10:00:02.500', pid: 1234, tid: 1234 },
    { id: 4, level: 'W', tag: 'ViewRootImpl', msg: 'Dropped key event: input queue is full', ts: '10-07 10:00:03.000', pid: 1234, tid: 1236 },
    { id: 5, level: 'V', tag: 'NetworkSecurityConfig', msg: 'Using Network Security Config from resource network_security_config', ts: '10-07 10:00:04.000', pid: 1234, tid: 1237 },
  ];

  const baseFilter = {
    minLevel: 'V',
    tag: '',
    search: '',
    packageMine: false,
    appPid: null,
  };

  // 1. Initial state without filter returns all logs
  const allResult = filterLogLines(sampleLogs, baseFilter);
  assert.equal(allResult.length, 5, 'Base filter must return all 5 lines');

  // 2. Tag filter matches case-insensitively
  const tagFiltered = filterLogLines(sampleLogs, { ...baseFilter, tag: 'flutter' });
  assert.equal(tagFiltered.length, 1, 'Tag filter "flutter" must return 1 matching line');
  assert.equal(tagFiltered[0].tag, 'FlutterJNI');

  // 3. Search query matches in msg
  const searchFiltered = filterLogLines(sampleLogs, { ...baseFilter, search: 'FATAL' });
  assert.equal(searchFiltered.length, 1, 'Search query "FATAL" must return 1 matching line');
  assert.equal(searchFiltered[0].tag, 'AndroidRuntime');

  // 4. Search query matches in tag as well
  const searchTagMatch = filterLogLines(sampleLogs, { ...baseFilter, search: 'ViewRoot' });
  assert.equal(searchTagMatch.length, 1, 'Search query matching tag must return matching line');
  assert.equal(searchTagMatch[0].tag, 'ViewRootImpl');

  // 5. Combined tag and search filter
  const combined = filterLogLines(sampleLogs, { ...baseFilter, tag: 'AndroidRuntime', search: 'EXCEPTION' });
  assert.equal(combined.length, 1, 'Combined tag and search filter must match');

  const combinedMismatch = filterLogLines(sampleLogs, { ...baseFilter, tag: 'ActivityManager', search: 'FATAL' });
  assert.equal(combinedMismatch.length, 0, 'Combined filter with mismatch must return 0 lines');

  // 6. Ring buffer maintains boundedness and batch pushing
  const ringBuffer = new LogcatRingBuffer(3);
  const items = ringBuffer.pushBatch(sampleLogs);
  assert.equal(items.length, 5, 'pushBatch must return converted LogItem array');
  assert.equal(ringBuffer.length, 3, 'Ring buffer must cap items to capacity 3');
  const bufferItems = ringBuffer.getAll();
  assert.equal(bufferItems.length, 3);
  assert.equal(bufferItems[0].id, 3);
  assert.equal(bufferItems[1].id, 4);
  assert.equal(bufferItems[2].id, 5);
});
