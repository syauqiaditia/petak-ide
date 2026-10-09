import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Clean 2-Row Layout & Linear/Raycast Style Contract
// =============================================================================

test('b34 Header UI 1: 2-Row Structured Header Architecture', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const panelSrc = fs.readFileSync(panelPath, 'utf-8');

  // Unified header container exists and uses column flex
  assert.ok(panelSrc.includes('agent-unified-header'), 'AgentsPanel must declare agent-unified-header');
  assert.ok(panelSrc.includes('panel-header'), 'AgentsPanel must declare panel-header');
  assert.ok(
    panelSrc.includes('display: flex;') && panelSrc.includes('flex-direction: column;'),
    'Header container must use display: flex and flex-direction: column for clean 2-row layout'
  );

  // Baris 1: Top Navigation & Primary Actions row
  assert.ok(panelSrc.includes('header-primary-row'), 'Must declare header-primary-row');
  assert.ok(panelSrc.includes('height: 38px;'), 'header-primary-row must declare 38px height');

  // Baris 2: Context & Runtime Metadata Bar row
  assert.ok(panelSrc.includes('header-meta-row'), 'Must declare header-meta-row');
  assert.ok(panelSrc.includes('height: 28px;'), 'header-meta-row must declare 28px height');
});

// =============================================================================
// Suite 2: Baris 1 - Top Navigation & Primary Actions Elements
// =============================================================================

test('b34 Header UI 2: Baris 1 Bot Selector Dropdown with Status Dot', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const panelSrc = fs.readFileSync(panelPath, 'utf-8');

  // Bot selector dropdown & wrapper
  assert.ok(panelSrc.includes('bot-selector-wrap'), 'Must render bot-selector-wrap container');
  assert.ok(panelSrc.includes('bot-select-dropdown'), 'Must render bot-select-dropdown select element');
  assert.ok(panelSrc.includes('onchange={handleProfileSelect}'), 'Bot selector must trigger handleProfileSelect');

  // Runtime status dot (ready vs busy pulse)
  assert.ok(panelSrc.includes('runtime-status-dot'), 'Must render runtime-status-dot');
  assert.ok(panelSrc.includes('class:busy'), 'Must support busy status pulse on status dot');
  assert.ok(panelSrc.includes('class:ready'), 'Must support ready status on status dot');

  // Hermes bot profiles present in options
  assert.ok(panelSrc.includes('🤖 Petak Agent'), 'Must include Petak Agent option');
  assert.ok(panelSrc.includes('⚡ Senior'), 'Must include Senior option');
  assert.ok(panelSrc.includes('⚡ Senior2'), 'Must include Senior2 option');
  assert.ok(panelSrc.includes('🧠 Techlead'), 'Must include Techlead option');
  assert.ok(panelSrc.includes('👑 Manager'), 'Must include Manager option');
  assert.ok(panelSrc.includes('🔍 Reviewer'), 'Must include Reviewer option');
  assert.ok(panelSrc.includes('🎨 Designer'), 'Must include Designer option');
});

test('b34 Header UI 3: Baris 1 Primary Actions (+ New Chat & History Sessions)', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const panelSrc = fs.readFileSync(panelPath, 'utf-8');

  // Session actions group
  assert.ok(panelSrc.includes('session-actions-group'), 'Must render session-actions-group');

  // + New Chat button
  assert.ok(panelSrc.includes('new-chat-btn'), 'Must render new-chat-btn');
  assert.ok(panelSrc.includes('agentsStore.newSession()'), 'New chat button must call agentsStore.newSession()');
  assert.ok(panelSrc.includes('>New<'), 'New chat button must have text New');

  // History button with count badge
  assert.ok(panelSrc.includes('history-btn'), 'Must render history-btn');
  assert.ok(panelSrc.includes('agentsStore.toggleHistory()'), 'History button must call agentsStore.toggleHistory()');
  assert.ok(panelSrc.includes('history-count'), 'History button must display history-count when sessions exist');
});

test('b34 Header UI 4: Baris 1 Subtabs Navigation & Action Group Kanan', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const panelSrc = fs.readFileSync(panelPath, 'utf-8');

  // Subtab navigation group
  assert.ok(panelSrc.includes('agent-subtab-group'), 'Must render agent-subtab-group');
  assert.ok(panelSrc.includes('Chat'), 'Must include Chat subtab');
  assert.ok(panelSrc.includes('⚡ Lanes'), 'Must include ⚡ Lanes subtab');
  assert.ok(panelSrc.includes('Diff'), 'Must include Diff subtab');
  assert.ok(panelSrc.includes('diff-badge'), 'Must render diff-badge when pending hunks exist');

  // Action group kanan: More menu & Close button
  assert.ok(panelSrc.includes('header-action-group'), 'Must render header-action-group');
  assert.ok(panelSrc.includes('more-menu-wrap'), 'Must render more-menu-wrap');
  assert.ok(panelSrc.includes('Quota & Usage'), 'More menu must contain Quota & Usage option');
  assert.ok(panelSrc.includes('Memory'), 'More menu must contain Memory option');
  assert.ok(panelSrc.includes("settingsStore.open('agents')"), 'More menu must contain Settings option');

  // Close panel button
  assert.ok(panelSrc.includes('close-panel-btn'), 'Must render close-panel-btn');
  assert.ok(panelSrc.includes('onclick={onClose}'), 'Close button must call onClose');
});

// =============================================================================
// Suite 3: Baris 2 - Context & Runtime Metadata Bar Elements
// =============================================================================

test('b34 Header UI 5: Baris 2 Metadata Bar (Engine, Model, Tool Scoping)', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const panelSrc = fs.readFileSync(panelPath, 'utf-8');

  // 1. Dynamic Engine badge
  assert.ok(panelSrc.includes('dynamic-engine-badge'), 'Must render dynamic-engine-badge in Baris 2');
  assert.ok(panelSrc.includes('engine-pill-text'), 'Must render engine-pill-text');
  assert.ok(panelSrc.includes('formatEngineName'), 'Engine badge must use formatEngineName');

  // 2. Interactive Model selector dropdown
  assert.ok(panelSrc.includes('dynamic-model-badge interactive'), 'Must render dynamic-model-badge interactive in Baris 2');
  assert.ok(panelSrc.includes('model-select-overlay'), 'Must include model-select-overlay dropdown');
  assert.ok(panelSrc.includes('onchange={handleModelChange}'), 'Model selector must trigger handleModelChange');
  assert.ok(panelSrc.includes('Claude'), 'Model badge must support Claude');
  assert.ok(panelSrc.includes('Gemini'), 'Model badge must support Gemini');
  assert.ok(panelSrc.includes('Ollama'), 'Model badge must support Ollama');

  // 3. Tool Scoping status badge
  assert.ok(panelSrc.includes('tool-scoping-badge'), 'Must render tool-scoping-badge in Baris 2');
  assert.ok(panelSrc.includes('tool-scoping-text'), 'Must render tool-scoping-text');
  assert.ok(panelSrc.includes('🛡️ Tool Scoping: Active'), 'Must display 🛡️ Tool Scoping: Active');
  assert.ok(panelSrc.includes('getRoleScopeBadge'), 'Tool scoping badge must use getRoleScopeBadge');
  assert.ok(panelSrc.includes('getRoleScopeDescription'), 'Tool scoping badge must use getRoleScopeDescription');
});

// =============================================================================
// Suite 4: Anti-Collision & Narrow Layout (<500px) Styling Contract
// =============================================================================

test('b34 Header UI 6: Anti-Collision & Narrow Layout CSS Rules', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const panelSrc = fs.readFileSync(panelPath, 'utf-8');

  // Bot dropdown styling: truncation to prevent collision
  assert.ok(
    panelSrc.includes('.bot-select-dropdown {') || panelSrc.includes('.bot-select-dropdown'),
    'Must define .bot-select-dropdown'
  );
  assert.ok(panelSrc.includes('text-overflow: ellipsis;'), 'Bot select must have text-overflow: ellipsis');
  assert.ok(panelSrc.includes('white-space: nowrap;'), 'Bot select must have white-space: nowrap');
  assert.ok(panelSrc.includes('overflow: hidden;'), 'Bot select must have overflow: hidden');

  // Primary left flex shrinking
  assert.ok(panelSrc.includes('.primary-left'), 'Must declare .primary-left');

  // Action buttons & badges white-space nowrap and flex-shrink 0
  assert.ok(panelSrc.includes('.panel-icon-btn {') || panelSrc.includes('.panel-icon-btn'), 'Must define .panel-icon-btn');
  assert.ok(panelSrc.includes('.dynamic-engine-badge'), 'Must define .dynamic-engine-badge');
  assert.ok(panelSrc.includes('.dynamic-model-badge'), 'Must define .dynamic-model-badge');
  assert.ok(panelSrc.includes('.tool-scoping-badge'), 'Must define .tool-scoping-badge');

  // Baris 2 horizontal scrollbar prevention
  assert.ok(panelSrc.includes('.header-meta-row'), 'Must style .header-meta-row');
  assert.ok(panelSrc.includes('scrollbar-width: none;'), 'header-meta-row must hide horizontal scrollbar cleanly');

  // View area relative positioning for dropdown overlay
  assert.ok(panelSrc.includes('.panel-view-area {'), 'Must define .panel-view-area');
  assert.ok(
    panelSrc.includes('position: relative;') && panelSrc.includes('.panel-view-area'),
    'panel-view-area must have position: relative'
  );
});
