import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEMO_HERMES_DETECTION, DEMO_SLOTS, DEMO_TEAM_CONFIG, DEMO_PROPOSALS } from '../ui/features/agents/fixtures.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('b26 V2: 1. Single Unified Header 38px & 6 Hermes Bot Profiles Selector', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const code = fs.readFileSync(panelPath, 'utf-8');

  // Single Unified Header height 38px declaration
  assert.ok(code.includes('height: 38px;'), 'Header must declare height 38px');
  assert.ok(code.includes('agent-unified-header'), 'Header must have agent-unified-header class');

  // Dropdown selector bot Hermes 6 profil
  assert.ok(code.includes('👑 Manager') || code.includes('Manager (Planner'), 'Must include 👑 Manager');
  assert.ok(code.includes('🧠 Techlead') || code.includes('Techlead (System Architect'), 'Must include 🧠 Techlead');
  assert.ok(code.includes('⚡ Senior') || code.includes('Senior (Fullstack'), 'Must include ⚡ Senior');
  assert.ok(code.includes('⚡ Senior2') || code.includes('Senior2 (Toolchains'), 'Must include ⚡ Senior2');
  assert.ok(code.includes('🔍 Reviewer') || code.includes('Reviewer (QA'), 'Must include 🔍 Reviewer');
  assert.ok(code.includes('🎨 Designer') || code.includes('Designer (UI/UX'), 'Must include 🎨 Designer');

  // Runtime status dot (Ready / Busy)
  assert.ok(code.includes('runtime-status-dot'), 'Must include runtime status dot indicator');
  assert.ok(code.includes('class:busy'), 'Must support busy status pulse');
  assert.ok(code.includes('class:ready'), 'Must support ready status');

  // Dynamic model icon: Claude, Gemini, Ollama
  assert.ok(code.includes('dynamic-model-badge') || code.includes('dynamic-model-icon'), 'Must have dynamic model indicator');
  assert.ok(code.includes('Claude'), 'Must render Claude model indicator');
  assert.ok(code.includes('Gemini'), 'Must render Gemini model indicator');
  assert.ok(code.includes('Ollama'), 'Must render Ollama model indicator');

  // Concise subtabs Chat and Diff with hunk count badge
  assert.ok(code.includes('Chat'), 'Must have Chat subtab');
  assert.ok(code.includes('Diff'), 'Must have Diff subtab');
  assert.ok(code.includes('diff-badge'), 'Must have diff-badge element for hunk count');

  // Access to secondary subtabs / settings
  assert.ok(code.includes('Quota'), 'Must have Quota access');
  assert.ok(code.includes('Memory'), 'Must have Memory access');
  assert.ok(code.includes("settingsStore.open('agents')"), 'Must link to Settings Center agents category');
});

test('b26 V2: 2. Context Pills in AgentChat prompt composer', () => {
  const chatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const code = fs.readFileSync(chatPath, 'utf-8');

  // Floating Context Composer Container
  assert.ok(code.includes('agent-composer-container'), 'Must have agent-composer-container');
  assert.ok(code.includes('composer-pills-row'), 'Must have composer-pills-row container');

  // @Context Pill
  assert.ok(code.includes('context-picker-pill') || code.includes('context-pill context-btn'), 'Must have @Context pill button');
  assert.ok(code.includes('@'), 'Must display @ symbol');
  assert.ok(code.includes('Context'), 'Must display Context label');

  // Permission Mode Pill (Read, Ask, Auto, Full)
  assert.ok(code.includes('permission-pill-select') || code.includes('permission-pill'), 'Must have permission pill');
  assert.ok(code.includes('value="read"'), 'Permission pill must include Read option');
  assert.ok(code.includes('value="ask"'), 'Permission pill must include Ask option');
  assert.ok(code.includes('value="auto"'), 'Permission pill must include Auto option');
  assert.ok(code.includes('value="full"'), 'Permission pill must include Full option');
  assert.ok(code.includes('setPermissionMode'), 'Must trigger setPermissionMode on change');

  // Discipline Pills: Ponytail: ON/OFF and Caveman: ON/OFF
  assert.ok(code.includes('context-pill ponytail'), 'Must have Ponytail context pill');
  assert.ok(code.includes('context-pill caveman'), 'Must have Caveman context pill');
  assert.ok(code.includes("Ponytail: {agentsStore.isPonytailActive ? 'ON' : 'OFF'}"), 'Must render dynamic Ponytail ON/OFF text');
  assert.ok(code.includes("Caveman: {agentsStore.isCavemanActive ? 'ON' : 'OFF'}"), 'Must render dynamic Caveman ON/OFF text');
  assert.ok(code.includes('agentsStore.togglePonytail()'), 'Must toggle Ponytail on click');
  assert.ok(code.includes('agentsStore.toggleCaveman()'), 'Must toggle Caveman on click');
});

test('b26 V2: 3. Settings Center 2-Column Master-Detail with 9 Navigation Categories', () => {
  const settingsPath = path.resolve(uiRoot, 'features/settings/SettingsModal.svelte');
  const code = fs.readFileSync(settingsPath, 'utf-8');

  // 2-column master-detail layout
  assert.ok(code.includes('settings-body-split'), 'Must have settings-body-split container');
  assert.ok(code.includes('settings-cat-sidebar'), 'Must have settings-cat-sidebar (left column)');
  assert.ok(code.includes('settings-content-pane'), 'Must have settings-content-pane (right column)');

  // 9 Navigasi Kategori
  const requiredCategories = [
    'general',     // 1. Umum (General)
    'editor',      // 2. Editor Kode
    'keymap',      // 3. Pintasan Keyboard
    'agents',      // 4. AI Agents & Disiplin
    'toolchains',  // 5. Toolchain & SDK
    'git',         // 6. Git & GitLab
    'accounts',    // 7. Akun & Jaringan
    'devices',     // 8. Perangkat & Mirror
    'appearance',  // 9. Tampilan Antarmuka (Appearance)
  ];

  for (const catId of requiredCategories) {
    assert.ok(code.includes(`id: '${catId}'`), `Must declare category '${catId}'`);
  }

  // 1.5px SVG icon stroke width on navigation sidebar
  assert.ok(code.includes('stroke-width="1.5"'), 'Sidebar icons must use 1.5px stroke width');

  // Search bar
  assert.ok(code.includes('settings-search-bar'), 'Must include settings search bar');
});

test('b26 V2: 4. Settings Center: AI Agents & Disiplin panel configuration', () => {
  const settingsPath = path.resolve(uiRoot, 'features/settings/SettingsModal.svelte');
  const code = fs.readFileSync(settingsPath, 'utf-8');

  // Model Configuration Editor
  assert.ok(code.includes('Model Configuration Editor'), 'Must have Model Configuration Editor');
  assert.ok(code.includes('Anthropic Claude'), 'Must include Claude provider option');
  assert.ok(code.includes('Google Gemini'), 'Must include Gemini provider option');
  assert.ok(code.includes('Local Ollama'), 'Must include Local Ollama provider option');
  assert.ok(code.includes('Stored in OS Keychain'), 'Must display Keychain security badge');

  // 3-Tier Fallback Chain
  assert.ok(code.includes('Fallback Model Chain'), 'Must display Fallback Model Chain');
  assert.ok(code.includes('1° Primary:'), 'Must display 1° Primary tier');
  assert.ok(code.includes('2° Fallback:'), 'Must display 2° Fallback tier');
  assert.ok(code.includes('3° Local:'), 'Must display 3° Local tier');

  // Deteksi Bot Hermes Lokal & Terapkan Semua
  assert.ok(code.includes('Deteksi Bot Hermes Lokal'), 'Must have Deteksi Bot Hermes Lokal section');
  assert.ok(code.includes('api.agentDetectHermes'), 'Must call api.agentDetectHermes()');
  assert.ok(code.includes('Terapkan Semua ke Proyek (Adopt All to .petak/team.json)'), 'Must have Adopt All button');
  assert.ok(code.includes('api.agentSaveTeam'), 'Must call api.agentSaveTeam()');

  // 9Router Quota Tracker riil
  assert.ok(code.includes('9Router Quota & Token Tracker'), 'Must have 9Router Quota Tracker');
  assert.ok(code.includes('api.agentGetQuotaReport'), 'Must call api.agentGetQuotaReport()');
  assert.ok(code.includes('Total Requests'), 'Must show Total Requests metric');
  assert.ok(code.includes('Prompt Tokens'), 'Must show Prompt Tokens metric');
  assert.ok(code.includes('Completion'), 'Must show Completion Tokens metric');
  assert.ok(code.includes('Total Tokens'), 'Must show Total Tokens metric');
  assert.ok(code.includes('Est. Cost (USD)'), 'Must show USD cost metric');
  assert.ok(code.includes('quota-bar-track'), 'Must visualize model breakdown stacked bar');
});

test('b26 V2: 5. Appearance Theme Switch: Varian A (.variant-a) vs Varian B (.variant-b)', () => {
  const storePath = path.resolve(uiRoot, 'features/settings/settingsStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  // State declaration for variant
  assert.ok(storeCode.includes("variant = $state<'a' | 'b'>"), 'settingsStore must declare variant state');
  assert.ok(storeCode.includes("setVariant(newVariant: 'a' | 'b')"), 'settingsStore must declare setVariant');
  assert.ok(storeCode.includes("document.body.classList.remove('variant-a')"));
  assert.ok(storeCode.includes("document.body.classList.add('variant-b')"));
  assert.ok(storeCode.includes("document.body.classList.remove('variant-b')"));
  assert.ok(storeCode.includes("document.body.classList.add('variant-a')"));
  assert.ok(storeCode.includes("'appearance'"), 'settingsStore must support appearance category in open()');

  const settingsPath = path.resolve(uiRoot, 'features/settings/SettingsModal.svelte');
  const modalCode = fs.readFileSync(settingsPath, 'utf-8');

  // Buttons in SettingsModal calling setVariant
  assert.ok(modalCode.includes("settingsStore.setVariant('a')"), 'Modal must have button calling setVariant(a)');
  assert.ok(modalCode.includes("settingsStore.setVariant('b')"), 'Modal must have button calling setVariant(b)');
  assert.ok(modalCode.includes('variant-card'), 'Modal must have variant card selectors');
  assert.ok(modalCode.includes('Varian A (Cursor / Linear Modern)'), 'Modal must describe Variant A');
  assert.ok(modalCode.includes('Varian B (Zed / Fleet Zen Focus)'), 'Modal must describe Variant B');

  // Functional simulation of variant class switching
  const simulatedBody = {
    classes: new Set(),
    classList: {
      add(c) { simulatedBody.classes.add(c); },
      remove(c) { simulatedBody.classes.delete(c); },
      contains(c) { return simulatedBody.classes.has(c); },
    },
  };

  function applyVariant(v) {
    if (v === 'b') {
      simulatedBody.classList.remove('variant-a');
      simulatedBody.classList.add('variant-b');
    } else {
      simulatedBody.classList.remove('variant-b');
      simulatedBody.classList.add('variant-a');
    }
  }

  // Set Variant B
  applyVariant('b');
  assert.equal(simulatedBody.classList.contains('variant-b'), true);
  assert.equal(simulatedBody.classList.contains('variant-a'), false);

  // Set Variant A
  applyVariant('a');
  assert.equal(simulatedBody.classList.contains('variant-a'), true);
  assert.equal(simulatedBody.classList.contains('variant-b'), false);
});

test('b26 V2: 6. Fixtures & Hunk Count Accuracy', () => {
  // 6 Hermes detection profiles present
  assert.equal(DEMO_HERMES_DETECTION.profiles.length, 6, 'DEMO_HERMES_DETECTION must have 6 profiles');
  const profileNames = DEMO_HERMES_DETECTION.profiles.map((p) => p.name);
  assert.ok(profileNames.includes('manager'));
  assert.ok(profileNames.includes('techlead'));
  assert.ok(profileNames.includes('senior'));
  assert.ok(profileNames.includes('senior2'));
  assert.ok(profileNames.includes('reviewer'));
  assert.ok(profileNames.includes('designer'));

  // 6 Slots configured in DEMO_SLOTS
  assert.equal(DEMO_SLOTS.length, 6, 'DEMO_SLOTS must have 6 slots');

  // Proposed diff hunks count is 2 (for "Diff 2" badge test)
  assert.equal(DEMO_PROPOSALS[0].hunks.length, 2, 'DEMO_PROPOSALS[0] must have 2 hunks for Diff 2 badge test');
});
