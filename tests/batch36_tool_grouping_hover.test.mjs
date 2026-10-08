import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatToolGroupSummary,
  isToolGroupCollapsed,
  toggleToolGroupCollapsed,
  separateStreamingToolCalls,
} from '../ui/features/agents/agentsLogic.ts';

import {
  computeAdaptiveHoverCoords,
  shouldPlaceHoverAbove,
  computeTooltipMaxWidth,
} from '../ui/features/editor/lsp/hoverLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Tool Group Summary Formatting
// =============================================================================

test('b36 Tool Grouping 1: formatToolGroupSummary calculates counts and formats summary string', () => {
  // Empty or null inputs
  assert.equal(formatToolGroupSummary([]), '');
  assert.equal(formatToolGroupSummary(null), '');
  assert.equal(formatToolGroupSummary(undefined), '');

  // Single tool
  assert.equal(formatToolGroupSummary([{ name: 'read_file' }]), 'read_file (1)');

  // Multiple instances of same tool
  assert.equal(
    formatToolGroupSummary([
      { name: 'read_file' },
      { name: 'read_file' },
      { name: 'read_file' },
      { name: 'read_file' },
    ]),
    'read_file (4)'
  );

  // Mixed tools in order of appearance
  const mixedTools = [
    { name: 'read_file' },
    { name: 'terminal' },
    { name: 'read_file' },
    { name: 'read_file' },
    { name: 'terminal' },
    { name: 'read_file' },
  ];
  assert.equal(formatToolGroupSummary(mixedTools), 'read_file (4), terminal (2)');

  // Tools with search_files and missing name fallback
  const assortedTools = [
    { name: 'search_files' },
    { name: 'read_file' },
    { name: 'patch' },
    {}, // fallback to 'tool'
  ];
  assert.equal(formatToolGroupSummary(assortedTools), 'search_files (1), read_file (1), patch (1), tool (1)');
});

// =============================================================================
// Suite 2: Collapsed State Logic (Default Collapsed = true & Toggle per ID)
// =============================================================================

test('b36 Tool Grouping 2: isToolGroupCollapsed defaults to true and toggle flips state per group ID', () => {
  let state = {};

  // Default is true (collapsed) when unset
  assert.equal(isToolGroupCollapsed(state, 'msg-101'), true, 'Unset group ID must default to collapsed: true');
  assert.equal(isToolGroupCollapsed(state, 'live-tools'), true, 'Live stream tools must default to collapsed: true');
  assert.equal(isToolGroupCollapsed(null, 'msg-101'), true);

  // Toggle msg-101 open
  state = toggleToolGroupCollapsed(state, 'msg-101');
  assert.equal(isToolGroupCollapsed(state, 'msg-101'), false, 'Toggled once must be expanded: false');
  assert.equal(isToolGroupCollapsed(state, 'msg-102'), true, 'Other group IDs remain collapsed: true');

  // Toggle msg-101 closed again
  state = toggleToolGroupCollapsed(state, 'msg-101');
  assert.equal(isToolGroupCollapsed(state, 'msg-101'), true, 'Toggled twice must return to collapsed: true');

  // Multiple independent IDs
  state = toggleToolGroupCollapsed(state, 'msg-a');
  state = toggleToolGroupCollapsed(state, 'msg-b');
  assert.equal(isToolGroupCollapsed(state, 'msg-a'), false);
  assert.equal(isToolGroupCollapsed(state, 'msg-b'), false);
  assert.equal(isToolGroupCollapsed(state, 'msg-c'), true);
});

// =============================================================================
// Suite 3: Live Streaming Tool Separation (Active Running vs Completed Folded)
// =============================================================================

test('b36 Tool Grouping 3: separateStreamingToolCalls separates active running tool and completed tools', () => {
  // 1. Empty tools
  const emptyRes = separateStreamingToolCalls([]);
  assert.deepEqual(emptyRes.completedTools, []);
  assert.equal(emptyRes.activeRunningTool, null);

  // 2. Single running tool -> no completed tools, activeRunningTool populated
  const singleRunning = [{ name: 'read_file', status: 'running' }];
  const singleRes = separateStreamingToolCalls(singleRunning);
  assert.equal(singleRes.completedTools.length, 0);
  assert.equal(singleRes.activeRunningTool?.name, 'read_file');
  assert.equal(singleRes.activeRunningTool?.status, 'running');

  // 3. 4 completed tools and 1 running tool
  const streamWithRunning = [
    { name: 'read_file', status: 'completed' },
    { name: 'read_file', status: 'completed' },
    { name: 'search_files', status: 'completed' },
    { name: 'terminal', status: 'completed' },
    { name: 'terminal', status: 'running' },
  ];
  const streamRes = separateStreamingToolCalls(streamWithRunning);
  assert.equal(streamRes.completedTools.length, 4);
  assert.equal(streamRes.completedTools[0].name, 'read_file');
  assert.equal(streamRes.completedTools[3].name, 'terminal');
  assert.equal(streamRes.activeRunningTool?.name, 'terminal');
  assert.equal(streamRes.activeRunningTool?.status, 'running');

  // 4. All tools completed -> activeRunningTool is null, all in completedTools
  const allCompleted = [
    { name: 'read_file', status: 'completed' },
    { name: 'patch', status: 'completed' },
    { name: 'terminal', status: 'failed' },
  ];
  const allDoneRes = separateStreamingToolCalls(allCompleted);
  assert.equal(allDoneRes.completedTools.length, 3);
  assert.equal(allDoneRes.activeRunningTool, null);
});

// =============================================================================
// Suite 4: computeAdaptiveHoverCoords Quad-Direction Bounding
// =============================================================================

test('b36 Hover Logic 4: computeAdaptiveHoverCoords quad-direction bounding (right, bottom, top, left)', () => {
  const editorRect = { top: 40, bottom: 600, left: 100, right: 900, width: 800 };
  const viewportWidth = 1200;
  const viewportHeight = 800;

  // Case 1: Right Boundary Shift (near right dock/edge)
  // Cursor at left = 750, tooltip width = 300. Unshifted right = 1050 > 900 - 12 (888).
  const visualNearRight = { top: 200, bottom: 220, left: 750 };
  const rightCoords = computeAdaptiveHoverCoords(
    visualNearRight,
    editorRect,
    { width: 300, height: 150 },
    { viewportWidth, viewportHeight, padding: 12 }
  );

  assert.equal(rightCoords.shiftLeft, true, 'Should flag shiftLeft when tooltip overflows right boundary');
  assert.ok(rightCoords.translateX < 0, `translateX must be negative to shift left, got ${rightCoords.translateX}`);
  assert.ok(
    visualNearRight.left + 300 + rightCoords.translateX <= 900 - 12,
    'Shifted right edge must stay within editorRight - padding'
  );

  // Case 2: Bottom Dock Flip Above
  // Cursor visualPos.bottom = 450, bottomDockTop = 500 (space below = 50 < 260px)
  const visualNearBottom = { top: 430, bottom: 450, left: 300 };
  const bottomCoords = computeAdaptiveHoverCoords(
    visualNearBottom,
    editorRect,
    { width: 300, height: 150 },
    { viewportWidth, viewportHeight, bottomDockTop: 500 }
  );
  assert.equal(bottomCoords.above, true, 'Must force above: true when remaining bottom space is < 260px');

  // Case 3: Top Clamp (near top edge of editor/window)
  // Cursor visualPos.top = 45, editorRect.top = 40 (space above = 5 < 100px)
  const visualNearTop = { top: 45, bottom: 65, left: 300 };
  const topCoords = computeAdaptiveHoverCoords(
    visualNearTop,
    editorRect,
    { width: 300, height: 150 },
    { viewportWidth, viewportHeight }
  );
  assert.equal(topCoords.above, false, 'Must keep above: false near top edge to prevent clipping offscreen');

  // Case 4: Left Boundary Clamp
  // Tooltip starts at left = 80, editor left is 100. Should clamp to editor.left + 12 = 112.
  const visualNearLeft = { top: 200, bottom: 220, left: 80 };
  const leftCoords = computeAdaptiveHoverCoords(
    visualNearLeft,
    editorRect,
    { width: 250, left: 80 },
    { viewportWidth, viewportHeight, padding: 12 }
  );
  assert.ok(
    80 + leftCoords.translateX >= 100 + 12,
    `Tooltip left edge after transform must be clamped to >= editor.left + padding (got ${80 + leftCoords.translateX})`
  );

  // Case 5: Null visualPos returns safe defaults
  const nullCoords = computeAdaptiveHoverCoords(null, editorRect, null, {});
  assert.equal(nullCoords.above, false);
  assert.equal(nullCoords.translateX, 0);
  assert.ok(nullCoords.maxWidth > 0);
});

// =============================================================================
// Suite 5: Synchronous Mount & Positioning Contracts (Zero Flicker)
// =============================================================================

test('b36 Hover Polish 5: hover.ts eliminates async requestAnimationFrame delay in mount()', () => {
  const hoverSrc = fs.readFileSync(path.resolve(uiRoot, 'features/editor/lsp/hover.ts'), 'utf-8');

  // Must not have requestAnimationFrame inside mount()
  assert.ok(
    !hoverSrc.includes('mount() {\n                  requestAnimationFrame('),
    'mount() must NOT contain requestAnimationFrame delay to eliminate flicker'
  );

  // Must call adjustPosition synchronously in mount()
  assert.ok(
    hoverSrc.includes('mount() {\n                  adjustPosition();\n                }'),
    'mount() must execute adjustPosition() synchronously'
  );

  // Must call adjustPosition synchronously in positioned()
  assert.ok(
    hoverSrc.includes('positioned() {\n                  adjustPosition();\n                }'),
    'positioned() must execute adjustPosition() synchronously'
  );

  // Must export computeAdaptiveHoverCoords
  assert.ok(
    hoverSrc.includes('computeAdaptiveHoverCoords'),
    'hover.ts must import and re-export computeAdaptiveHoverCoords'
  );
});

// =============================================================================
// Suite 6: Horizontal Scroll Styling on Hover Tooltips
// =============================================================================

test('b36 Hover Polish 6: hover.ts styling enables horizontal scroll and thin scrollbar', () => {
  const hoverSrc = fs.readFileSync(path.resolve(uiRoot, 'features/editor/lsp/hover.ts'), 'utf-8');

  // .cm-tooltip-hover horizontal scroll
  assert.ok(
    hoverSrc.includes("overflowX: 'auto !important'"),
    'hoverTheme must set overflowX to auto !important on tooltips'
  );

  // scrollbarWidth: 'thin !important'
  assert.ok(
    hoverSrc.includes("scrollbarWidth: 'thin !important'"),
    'hoverTheme must set scrollbarWidth: thin !important'
  );
});

// =============================================================================
// Suite 7: AgentChat Accordion Structure Contracts
// =============================================================================

test('b36 Tool Grouping 7: AgentChat.svelte declares accordion grouping, default collapsed, and live streaming', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // Accordion CSS classes
  assert.ok(chatSrc.includes('.tool-group-accordion {'), 'AgentChat must style .tool-group-accordion');
  assert.ok(chatSrc.includes('.tool-group-header {'), 'AgentChat must style .tool-group-header');
  assert.ok(chatSrc.includes('.tool-group-title {'), 'AgentChat must style .tool-group-title');
  assert.ok(chatSrc.includes('.tool-group-arrow {'), 'AgentChat must style .tool-group-arrow');
  assert.ok(chatSrc.includes('.tool-group-content {'), 'AgentChat must style .tool-group-content');

  // Accordion template header with gear icon and tindakan alat
  assert.ok(
    chatSrc.includes('tindakan alat'),
    'AgentChat accordion must show tindakan alat summary'
  );
  assert.ok(
    chatSrc.includes('formatToolGroupSummary'),
    'AgentChat must invoke formatToolGroupSummary'
  );

  // Live streaming tool separation
  assert.ok(
    chatSrc.includes('separateStreamingToolCalls'),
    'AgentChat must use separateStreamingToolCalls for live stream'
  );
  assert.ok(
    chatSrc.includes('tindakan alat selesai'),
    'AgentChat live stream must fold completed tools into accordion'
  );
});
