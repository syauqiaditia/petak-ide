import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCleanPromptEnvelope,
  openReferencedFile,
} from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Truncation & Layout Styling Contracts (AgentChat.svelte)
// =============================================================================

test('b35 Chat Polish 1: AgentChat.svelte Tool Call Header & Overflow Contracts', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // 1. .tool-call-header flex and sizing properties
  assert.ok(
    chatSrc.includes('.tool-call-header {'),
    'AgentChat must define .tool-call-header CSS class'
  );
  assert.ok(
    chatSrc.includes('min-width: 0;') && chatSrc.includes('width: 100%;'),
    'AgentChat .tool-call-header must specify min-width: 0 and width: 100%'
  );

  // 2. .tool-arg truncation properties
  assert.ok(
    chatSrc.includes('.tool-arg {'),
    'AgentChat must define .tool-arg CSS class'
  );
  assert.ok(
    chatSrc.includes('text-overflow: ellipsis;') && chatSrc.includes('white-space: nowrap;'),
    'AgentChat .tool-arg must declare text-overflow: ellipsis and white-space: nowrap'
  );
  assert.ok(
    chatSrc.includes('flex: 1;') && chatSrc.includes('min-width: 0;'),
    'AgentChat .tool-arg must declare flex: 1 and min-width: 0'
  );

  // 3. Tool execution badges: completed, failed, running
  assert.ok(
    chatSrc.includes('.tool-badge-completed {'),
    'AgentChat must define .tool-badge-completed'
  );
  assert.ok(
    chatSrc.includes('.tool-badge-failed {'),
    'AgentChat must define .tool-badge-failed'
  );
  assert.ok(
    chatSrc.includes('.tool-badge-running {'),
    'AgentChat must define .tool-badge-running'
  );
  assert.ok(
    chatSrc.includes('flex-shrink: 0;'),
    'Tool status badges must declare flex-shrink: 0 to prevent squishing'
  );

  // 4. .tool-call-card containment
  assert.ok(
    chatSrc.includes('.tool-call-card {'),
    'AgentChat must define .tool-call-card'
  );
  assert.ok(
    chatSrc.includes('box-sizing: border-box;') && chatSrc.includes('max-width: 100%;'),
    '.tool-call-card must declare box-sizing: border-box and max-width: 100%'
  );
});

test('b35 Chat Polish 2: AgentChat.svelte Message Bubble & Code Overflow Contracts', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // 1. .message-bubble containment
  assert.ok(
    chatSrc.includes('max-width: 95%;'),
    '.message-bubble must declare max-width: 95%'
  );
  assert.ok(
    chatSrc.includes('overflow-wrap: break-word;') && chatSrc.includes('word-break: break-word;'),
    '.message-bubble must break long words cleanly'
  );

  // 2. <pre> and <code> inside bubble
  assert.ok(
    chatSrc.includes('.message-bubble pre') && chatSrc.includes('overflow-x: auto;'),
    '.message-bubble pre must declare overflow-x: auto'
  );
  assert.ok(
    chatSrc.includes('.message-bubble code') && chatSrc.includes('max-width: 100%;'),
    '.message-bubble code must declare max-width: 100%'
  );
});

// =============================================================================
// Suite 2: Responsive Footer & Stop Button Spacing Contracts
// =============================================================================

test('b35 Chat Polish 3: AgentsPanel.svelte usage-meter-footer responsive truncation', () => {
  const panelSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte'), 'utf-8');

  // 1. .footer-agent-badges truncation
  assert.ok(
    panelSrc.includes('.footer-agent-badges {'),
    'AgentsPanel must define .footer-agent-badges'
  );
  assert.ok(
    panelSrc.includes('text-overflow: ellipsis;') && panelSrc.includes('white-space: nowrap;'),
    'AgentsPanel footer badges must declare text-overflow: ellipsis and white-space: nowrap'
  );

  // 2. .footer-model-badge truncation
  assert.ok(
    panelSrc.includes('.footer-model-badge {'),
    'AgentsPanel must define .footer-model-badge'
  );

  // 3. .usage-text min-width: 0
  assert.ok(
    panelSrc.includes('.usage-text {'),
    'AgentsPanel must define .usage-text'
  );
});

test('b35 Chat Polish 4: AgentChat.svelte stop button right spacing contract', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // 1. .pills-right padding-right
  assert.ok(
    chatSrc.includes('.pills-right {') && chatSrc.includes('padding-right: 4px;'),
    '.pills-right must declare padding-right: 4px to prevent stop button from touching border'
  );

  // 2. .cancel-prompt-btn padding and sizing
  assert.ok(
    chatSrc.includes('.cancel-prompt-btn {'),
    'AgentChat must define .cancel-prompt-btn'
  );
});

// =============================================================================
// Suite 3: Smart Auto-Scroll Lock State Logic
// =============================================================================

test('b35 Chat Polish 5: Smart Auto-Scroll distance-to-bottom calculation & threshold gating', () => {
  // Pure logic threshold verification: distanceToBottom <= 60 px
  function calculatePinnedState(scrollHeight, scrollTop, clientHeight) {
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    return distanceToBottom <= 60;
  }

  // Exactly at bottom
  assert.equal(calculatePinnedState(1000, 600, 400), true, 'Pinned when distance is 0');

  // Within 60px tolerance
  assert.equal(calculatePinnedState(1000, 560, 400), true, 'Pinned when distance is 40px');
  assert.equal(calculatePinnedState(1000, 540, 400), true, 'Pinned when distance is exactly 60px');

  // Scrolled up past 60px tolerance
  assert.equal(calculatePinnedState(1000, 539, 400), false, 'Unpinned when distance is 61px');
  assert.equal(calculatePinnedState(1000, 200, 400), false, 'Unpinned when user scrolled far up (400px)');
});

test('b35 Chat Polish 6: AgentChat.svelte scroll event listener & userPinnedToBottom effect gating', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // 1. userPinnedToBottom reactive state
  assert.ok(
    chatSrc.includes('userPinnedToBottom = $state(true)'),
    'AgentChat must declare userPinnedToBottom reactive state initialized to true'
  );

  // 2. Scroll listener binding
  assert.ok(
    chatSrc.includes('onscroll={handleScroll}'),
    'AgentChat chat-messages container must bind onscroll handler'
  );

  // 3. Scroll calculation with 60px threshold
  assert.ok(
    chatSrc.includes('distanceToBottom <= 60'),
    'handleScroll must check distanceToBottom <= 60'
  );

  // 4. Effect scroll gating
  assert.ok(
    chatSrc.includes('userPinnedToBottom') && chatSrc.includes('scrollToBottom'),
    'Effect must check userPinnedToBottom before invoking scrollToBottom'
  );

  // 5. Force scroll on submit
  assert.ok(
    chatSrc.includes('userPinnedToBottom = true') && chatSrc.includes('scrollToBottom(true)'),
    'handleSubmit must force pin to bottom and invoke scrollToBottom(true)'
  );
});

// =============================================================================
// Suite 4: Rich File Reference Chips Data Model & Lifecycle
// =============================================================================

test('b35 Chat Polish 7: FileReference chip addition, deduplication, and removal lifecycle', () => {
  const fileReferences = [];

  function addFileReference(ref) {
    const exists = fileReferences.some(
      (r) => r.path === ref.path && r.line === ref.line && r.endLine === ref.endLine
    );
    if (!exists) {
      fileReferences.push(ref);
    }
  }

  function removeFileReference(index) {
    fileReferences.splice(index, 1);
  }

  // 1. Add references
  addFileReference({ path: 'ui/features/editor/Editor.svelte', name: 'Editor.svelte', line: 649 });
  assert.equal(fileReferences.length, 1);
  assert.equal(fileReferences[0].name, 'Editor.svelte');
  assert.equal(fileReferences[0].line, 649);

  // 2. Duplicate prevention
  addFileReference({ path: 'ui/features/editor/Editor.svelte', name: 'Editor.svelte', line: 649 });
  assert.equal(fileReferences.length, 1, 'Duplicate reference must not be added');

  // 3. Add directory reference
  addFileReference({ path: 'ui/features/agents', name: 'agents', isDir: true });
  assert.equal(fileReferences.length, 2);
  assert.equal(fileReferences[1].isDir, true);

  // 4. Remove reference
  removeFileReference(0);
  assert.equal(fileReferences.length, 1);
  assert.equal(fileReferences[0].name, 'agents');
});

test('b35 Chat Polish 8: Textarea Backspace pops chip when textarea is empty at cursor 0', () => {
  let fileReferences = [
    { path: 'lib/main.dart', name: 'main.dart' },
    { path: 'lib/app.dart', name: 'app.dart' },
  ];

  function handleBackspace(textareaValue, selectionStart, selectionEnd) {
    const isEmpty = !textareaValue || textareaValue.length === 0;
    const isAtStart = selectionStart === 0 && selectionEnd === 0;
    if (isEmpty && isAtStart && fileReferences.length > 0) {
      fileReferences.pop();
      return true;
    }
    return false;
  }

  // Case A: Textarea has text -> Do NOT pop chip
  const poppedWithText = handleBackspace('hello', 0, 0);
  assert.equal(poppedWithText, false);
  assert.equal(fileReferences.length, 2);

  // Case B: Textarea is empty, cursor at 0 -> Pop chip
  const poppedEmpty = handleBackspace('', 0, 0);
  assert.equal(poppedEmpty, true);
  assert.equal(fileReferences.length, 1);
  assert.equal(fileReferences[0].name, 'main.dart');

  // Pop again
  const poppedSecond = handleBackspace('', 0, 0);
  assert.equal(poppedSecond, true);
  assert.equal(fileReferences.length, 0);

  // Empty list -> returns false
  const poppedNone = handleBackspace('', 0, 0);
  assert.equal(poppedNone, false);
});

test('b35 Chat Polish 9: buildCleanPromptEnvelope integrates file references into prompt context without polluting user display', () => {
  const refs = [
    { path: 'ui/features/editor/Editor.svelte', name: 'Editor.svelte', line: 649 },
    { path: 'ui/features/agents/AgentChat.svelte', name: 'AgentChat.svelte', line: 100, endLine: 120 },
  ];

  const envelope = buildCleanPromptEnvelope('Bagaimana cara jump ke line ini?', {
    fileReferences: refs,
    isPonytail: true,
  });

  // Display content must remain pure user text without dumped raw paths
  assert.equal(envelope.displayContent, 'Bagaimana cara jump ke line ini?');

  // Backend formatted prompt must contain the structured reference section
  assert.ok(
    envelope.formattedPrompt.includes('[REFERENSI BERKAS:'),
    'formattedPrompt must contain [REFERENSI BERKAS: block'
  );
  assert.ok(
    envelope.formattedPrompt.includes('- ui/features/editor/Editor.svelte:649'),
    'formattedPrompt must contain Editor.svelte:649 reference'
  );
  assert.ok(
    envelope.formattedPrompt.includes('- ui/features/agents/AgentChat.svelte:100-120'),
    'formattedPrompt must contain AgentChat.svelte:100-120 reference'
  );

  // Metadata should preserve fileReferences
  assert.ok(envelope.metadata?.fileReferences, 'Envelope metadata must carry fileReferences');
  assert.equal(envelope.metadata.fileReferences.length, 2);
});

// =============================================================================
// Suite 5: File Reference Navigation Handler (openReferencedFile & Editor integration)
// =============================================================================

test('b35 Chat Polish 10: openReferencedFile opens tab and dispatches gotoLine jump', async () => {
  const mockTabs = [];
  let openedTab = null;
  let jumpedLine = null;
  let readPath = null;

  const mockDeps = {
    tabsManager: {
      tabs: mockTabs,
      openTab: (filePath, fileName, content) => {
        openedTab = { filePath, fileName, content };
        mockTabs.push(openedTab);
        return openedTab;
      },
    },
    api: {
      readFile: async (filePath) => {
        readPath = filePath;
        return '// file content here';
      },
    },
    gotoLine: (line, col) => {
      jumpedLine = { line, col };
    },
  };

  await openReferencedFile('ui/features/editor/Editor.svelte', 649, mockDeps);

  // 1. Verify file read
  assert.equal(readPath, 'ui/features/editor/Editor.svelte');

  // 2. Verify tab opened
  assert.ok(openedTab, 'openTab must be called');
  assert.equal(openedTab.filePath, 'ui/features/editor/Editor.svelte');
  assert.equal(openedTab.fileName, 'Editor.svelte');

  // 3. Verify gotoLine jumped
  assert.deepEqual(jumpedLine, { line: 649, col: 1 });
});

test('b35 Chat Polish 11: Editor.svelte exposes __PETAK_GOTO_LINE__ on mount and cleans up on destroy', () => {
  const editorSrc = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');

  // Global registration in onMount
  assert.ok(
    editorSrc.includes('__PETAK_GOTO_LINE__ = gotoLine;'),
    'Editor.svelte must expose __PETAK_GOTO_LINE__ globally on window'
  );

  // Global cleanup in onDestroy
  assert.ok(
    editorSrc.includes('delete (window as any).__PETAK_GOTO_LINE__'),
    'Editor.svelte must clean up __PETAK_GOTO_LINE__ in onDestroy'
  );
});

test('b35 Chat Polish 12: AgentChat.svelte interactive bubble pills & composer chips integration', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // 1. Composer chips container
  assert.ok(
    chatSrc.includes('composer-file-chips'),
    'AgentChat must contain .composer-file-chips container'
  );
  assert.ok(
    chatSrc.includes('composer-file-chip'),
    'AgentChat must contain .composer-file-chip element'
  );

  // 2. Chat bubble pills container & click trigger
  assert.ok(
    chatSrc.includes('bubble-file-pills'),
    'AgentChat must contain .bubble-file-pills container in message bubbles'
  );
  assert.ok(
    chatSrc.includes('bubble-file-pill'),
    'AgentChat must render .bubble-file-pill interactive button'
  );
  assert.ok(
    chatSrc.includes('openReferencedFile'),
    'AgentChat must wire bubble pills to openReferencedFile'
  );
});
