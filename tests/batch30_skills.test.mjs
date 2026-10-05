import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isValidSkillName,
  parseSkillFrontmatter,
  formatSkillsForPrompt,
  SkillsStoreLogic,
} from '../ui/features/agents/skillsLogic.ts';

import { applyDisciplineDirectives } from '../ui/features/agents/agentsLogic.ts';
import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// ── 1. API Bindings & Skill Contracts in api.ts ─────────────────────────

test('b30: SkillSummary & Skill types / API contracts in api.ts', async () => {
  assert.equal(typeof api.agentSkillsList, 'function', 'api.agentSkillsList must be a function');
  assert.equal(typeof api.agentSkillGet, 'function', 'api.agentSkillGet must be a function');
  assert.equal(typeof api.agentSkillSave, 'function', 'api.agentSkillSave must be a function');
  assert.equal(typeof api.agentSkillDelete, 'function', 'api.agentSkillDelete must be a function');

  // List initial skills (mock store provides ponytail and caveman)
  const skills = await api.agentSkillsList();
  assert.ok(Array.isArray(skills), 'Skills list must be an array');
  assert.ok(skills.length >= 2, 'Should at least contain ponytail and caveman');

  const ponytail = skills.find((s) => s.name === 'ponytail');
  assert.ok(ponytail, 'Core skill ponytail must exist');
  assert.equal(ponytail.isCore, true);
  assert.equal(ponytail.scope, 'system');

  const caveman = skills.find((s) => s.name === 'caveman');
  assert.ok(caveman, 'Core skill caveman must exist');
  assert.equal(caveman.isCore, true);
  assert.equal(caveman.scope, 'system');

  // Get full skill
  const ponytailFull = await api.agentSkillGet('ponytail');
  assert.equal(ponytailFull.name, 'ponytail');
  assert.ok(ponytailFull.content && ponytailFull.content.length > 0);
  assert.equal(ponytailFull.isCore, true);

  // Save new project skill
  const saved = await api.agentSkillSave(
    'test-flutter-dev',
    'Flutter development rules',
    'Always use const constructors and follow BLoC pattern.'
  );
  assert.equal(saved.name, 'test-flutter-dev');
  assert.equal(saved.description, 'Flutter development rules');
  assert.equal(saved.isCore, false);
  assert.equal(saved.scope, 'project');

  // Verify it appears in list
  const updatedList = await api.agentSkillsList();
  assert.ok(updatedList.some((s) => s.name === 'test-flutter-dev'));

  // Protection guard: core skills cannot be deleted
  await assert.rejects(
    async () => {
      await api.agentSkillDelete('ponytail');
    },
    /Cannot delete core skill/i,
    'Attempting to delete core skill ponytail must throw'
  );

  await assert.rejects(
    async () => {
      await api.agentSkillDelete('caveman');
    },
    /Cannot delete core skill/i,
    'Attempting to delete core skill caveman must throw'
  );

  // Delete project skill succeeds
  const deleteResult = await api.agentSkillDelete('test-flutter-dev');
  assert.equal(deleteResult, true);
  const afterDeleteList = await api.agentSkillsList();
  assert.ok(!afterDeleteList.some((s) => s.name === 'test-flutter-dev'));
});

// ── 2. SkillsLogic Validation, Frontmatter, and Prompt Formatting ───────

test('b30: skillsLogic validation, frontmatter parsing, and prompt formatting', () => {
  // 1. isValidSkillName
  assert.equal(isValidSkillName('flutter-expert'), true);
  assert.equal(isValidSkillName('clean_code_v2'), true);
  assert.equal(isValidSkillName('Skill123'), true);
  assert.equal(isValidSkillName('a'), true);

  assert.equal(isValidSkillName(''), false);
  assert.equal(isValidSkillName('   '), false);
  assert.equal(isValidSkillName('flutter expert'), false);
  assert.equal(isValidSkillName('skill@dev'), false);
  assert.equal(isValidSkillName('skill/path'), false);
  assert.equal(isValidSkillName('../hack'), false);
  assert.equal(isValidSkillName(null), false);
  assert.equal(isValidSkillName(undefined), false);

  // 2. parseSkillFrontmatter
  const rawWithFrontmatter = `---
name: test-skill
description: "Handles test automation"
scope: project
---
# Test Automation Skill

1. Run tests before commit.
2. Ensure 0 errors.
`;

  const parsed = parseSkillFrontmatter(rawWithFrontmatter);
  assert.equal(parsed.metadata.name, 'test-skill');
  assert.equal(parsed.metadata.description, 'Handles test automation');
  assert.equal(parsed.metadata.scope, 'project');
  assert.ok(parsed.content.startsWith('# Test Automation Skill'));
  assert.ok(parsed.content.includes('Ensure 0 errors.'));

  // Content without frontmatter
  const rawPlain = '# Plain skill markdown\nJust instructions.';
  const parsedPlain = parseSkillFrontmatter(rawPlain);
  assert.deepEqual(parsedPlain.metadata, {});
  assert.equal(parsedPlain.content, rawPlain);

  // Empty string
  const parsedEmpty = parseSkillFrontmatter('');
  assert.deepEqual(parsedEmpty.metadata, {});
  assert.equal(parsedEmpty.content, '');

  // 3. formatSkillsForPrompt
  const sampleSkills = [
    {
      name: 'ponytail',
      description: 'Minimal diff',
      content: 'Forces the laziest solution that actually works.',
      isCore: true,
      scope: 'system',
      path: '~/.hermes/skills/ponytail/SKILL.md',
    },
    {
      name: 'lint-guard',
      description: 'Linter rules',
      content: 'Never suppress warnings without comments.',
      isCore: false,
      scope: 'project',
      path: '.petak/skills/lint-guard/SKILL.md',
    },
  ];

  const formatted = formatSkillsForPrompt(sampleSkills);
  assert.ok(formatted.includes('[ACTIVE SKILL: ponytail]'));
  assert.ok(formatted.includes('Forces the laziest solution that actually works.'));
  assert.ok(formatted.includes('[/ACTIVE SKILL]'));

  assert.ok(formatted.includes('[ACTIVE SKILL: lint-guard]'));
  assert.ok(formatted.includes('Never suppress warnings without comments.'));

  assert.equal(formatSkillsForPrompt([]), '');
  assert.equal(formatSkillsForPrompt(null), '');
});

// ── 3. SkillsStore Lifecycle & Core Protection Guard ────────────────────

test('b30: skillsStore lifecycle (load, toggle, save, delete, core protection guard)', async () => {
  const store = new SkillsStoreLogic();

  assert.deepEqual(store.skills, []);
  assert.equal(store.isLoading, false);
  assert.equal(store.isFormOpen, false);
  assert.equal(store.editingSkill, null);

  // 1. loadSkills
  await store.loadSkills();
  assert.ok(store.skills.length >= 2);
  assert.ok(store.skills.some((s) => s.name === 'ponytail'));
  assert.ok(store.skills.some((s) => s.name === 'caveman'));

  // 2. toggleSkill
  assert.equal(store.activeCustomSkills.includes('custom-rule'), false);
  store.toggleSkill('custom-rule');
  assert.equal(store.activeCustomSkills.includes('custom-rule'), true);
  store.toggleSkill('custom-rule');
  assert.equal(store.activeCustomSkills.includes('custom-rule'), false);

  // 3. saveSkill validation failure
  await assert.rejects(
    async () => {
      await store.saveSkill('invalid skill name!', 'Desc', 'Content');
    },
    /tidak valid/i,
    'Invalid skill name must be rejected with Indonesian error'
  );

  // 4. saveSkill success
  const savedSkill = await store.saveSkill(
    'my-arch-rule',
    'Architecture Rule',
    'Follow clean architecture layers.'
  );
  assert.equal(savedSkill.name, 'my-arch-rule');
  assert.ok(store.skills.some((s) => s.name === 'my-arch-rule'));
  assert.equal(store.isFormOpen, false);

  // 5. toggle active custom skill
  store.toggleSkill('my-arch-rule');
  assert.ok(store.activeCustomSkills.includes('my-arch-rule'));

  // 6. getActiveSkillsContent
  const activeContents = await store.getActiveSkillsContent();
  assert.equal(activeContents.length, 1);
  assert.equal(activeContents[0].name, 'my-arch-rule');
  assert.equal(activeContents[0].content, 'Follow clean architecture layers.');

  // 7. Core Protection Guard: cannot delete ponytail or caveman
  await assert.rejects(
    async () => {
      await store.deleteSkill('ponytail');
    },
    /dilindungi sistem/i,
    'Attempting to delete core skill ponytail via store must throw protected error'
  );

  await assert.rejects(
    async () => {
      await store.deleteSkill('caveman');
    },
    /dilindungi sistem/i,
    'Attempting to delete core skill caveman via store must throw protected error'
  );

  // 8. deleteSkill custom skill succeeds and prunes activeCustomSkills
  const delResult = await store.deleteSkill('my-arch-rule');
  assert.equal(delResult, true);
  assert.ok(!store.skills.some((s) => s.name === 'my-arch-rule'));
  assert.ok(!store.activeCustomSkills.includes('my-arch-rule'));
});

// ── 4. Chat Composer Context Pills Rendering & Prompt Injection ─────────

test('b30: Chat Composer context pills rendering & prompt injection integration', () => {
  // 1. AgentChat.svelte structure check
  const agentChatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  assert.ok(fs.existsSync(agentChatPath), 'AgentChat.svelte must exist');
  const chatSrc = fs.readFileSync(agentChatPath, 'utf-8');

  assert.ok(chatSrc.includes('skillsStore'), 'AgentChat must import and use skillsStore');
  assert.ok(chatSrc.includes('context-pill custom-skill'), 'AgentChat must render custom-skill context pill');
  assert.ok(chatSrc.includes('skillsStore.activeCustomSkills.includes'), 'AgentChat must check activeCustomSkills');
  assert.ok(chatSrc.includes('skillsStore.toggleSkill'), 'AgentChat must allow toggling skill');
  assert.ok(chatSrc.includes('+ Skill'), 'AgentChat must include + Skill trigger button');

  // 2. SettingsModal.svelte structure check
  const settingsModalPath = path.resolve(uiRoot, 'features/settings/SettingsModal.svelte');
  assert.ok(fs.existsSync(settingsModalPath), 'SettingsModal.svelte must exist');
  const settingsSrc = fs.readFileSync(settingsModalPath, 'utf-8');

  assert.ok(
    settingsSrc.includes('🧠 Manajemen Skills & Disiplin'),
    'SettingsModal must declare section 🧠 Manajemen Skills & Disiplin'
  );
  assert.ok(
    settingsSrc.includes('Core System 🔒'),
    'SettingsModal must display Core System 🔒 badge'
  );
  assert.ok(
    settingsSrc.includes('Project Skill 📂'),
    'SettingsModal must display Project Skill 📂 badge'
  );
  assert.ok(
    settingsSrc.includes('+ Tambah Skill Baru'),
    'SettingsModal must display + Tambah Skill Baru button'
  );
  assert.ok(
    settingsSrc.includes('✏️ Edit'),
    'SettingsModal must display ✏️ Edit button'
  );
  assert.ok(
    settingsSrc.includes('🗑️ Hapus'),
    'SettingsModal must display 🗑️ Hapus button'
  );
  assert.ok(
    settingsSrc.includes('skill-content-input') || settingsSrc.includes('Konten Petunjuk'),
    'SettingsModal must include skill content textarea'
  );

  // 3. Prompt Injection verification in applyDisciplineDirectives
  const rawPrompt = 'Buatkan service autentikasi';
  const customSkillsSnippet = `[ACTIVE SKILL: clean-arch]\nUse domain, data, presentation layers.\n[/ACTIVE SKILL]`;

  const injectedPrompt = applyDisciplineDirectives(
    rawPrompt,
    true, // Ponytail
    true, // Caveman
    false, // Self-improve
    '', // Memory
    customSkillsSnippet
  );

  assert.ok(injectedPrompt.includes('[DISCIPLINE: PONYTAIL'));
  assert.ok(injectedPrompt.includes('[DISCIPLINE: CAVEMAN'));
  assert.ok(injectedPrompt.includes('[ACTIVE SKILL: clean-arch]'));
  assert.ok(injectedPrompt.includes('Use domain, data, presentation layers.'));
  assert.ok(injectedPrompt.includes('[/ACTIVE SKILL]'));
  assert.ok(injectedPrompt.endsWith('Buatkan service autentikasi'));
});
