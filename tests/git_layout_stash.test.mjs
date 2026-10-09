import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { clampBottomPanelHeight, MIN_BOTTOM_PANEL_HEIGHT } from '../ui/features/terminal/bottomPanelResize.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('git layout 1: App.svelte layout structure has bottom dock spanning workspace column and stopping at right dock', () => {
  const appFile = fs.readFileSync(path.join(uiRoot, 'App.svelte'), 'utf8');

  // Verify workspace-column and bottom-dock-container exist
  assert.ok(appFile.includes('class="workspace-column"'), 'App.svelte must contain workspace-column container');
  assert.ok(appFile.includes('class="bottom-dock-container"'), 'App.svelte must contain bottom-dock-container');

  // Verify bottom dock is placed inside workspace-column below center-area
  const workspaceColIndex = appFile.indexOf('class="workspace-column"');
  const centerAreaIndex = appFile.indexOf('class="center-area"');
  const bottomIndex = appFile.indexOf('class="bottom-dock-container"');
  assert.ok(workspaceColIndex !== -1 && centerAreaIndex !== -1 && bottomIndex !== -1, 'Containers must exist');
  assert.ok(bottomIndex > centerAreaIndex && centerAreaIndex > workspaceColIndex, 'bottom-dock-container must be placed below center-area in workspace-column');

  // Verify TerminalPanelComponent is inside bottom-dock-container, not inside center-area
  const bottomDockSection = appFile.slice(bottomIndex);
  assert.ok(bottomDockSection.includes('<TerminalPanelComponent'), 'TerminalPanelComponent must be inside bottom-dock-container');

  // Verify RightDock and RightRail are outside workspace-column as siblings in main-body
  const rightDockIndex = appFile.indexOf('<RightDock');
  assert.ok(rightDockIndex > bottomIndex, 'RightDock must be placed as sibling after workspace-column');

  // Verify CSS styles for flex layout
  assert.ok(appFile.includes('.main-body {'), 'Must have main-body styles');
  assert.ok(appFile.includes('flex-direction: row;'), 'main-body must be flex-direction: row for horizontal layout');
  assert.ok(appFile.includes('.workspace-column {'), 'Must have workspace-column styles');
  assert.ok(appFile.includes('.bottom-dock-container {'), 'Must have bottom-dock-container styles');
  assert.ok(appFile.includes('width: 100%;'), 'bottom-dock-container must span width: 100%');

  // Verify bottom panel resize clamp logic enforces min 140px
  assert.equal(MIN_BOTTOM_PANEL_HEIGHT, 140);
  assert.equal(clampBottomPanelHeight(50, 1000), 140);
  assert.equal(clampBottomPanelHeight(240, 1000), 240);
});

test('git layout 1b: Left Rail Git icon toggles Bottom Dock on Git tab (⌘9) instead of full screen', () => {
  const railFile = fs.readFileSync(path.join(uiRoot, 'shell/Rail.svelte'), 'utf8');
  const appFile = fs.readFileSync(path.join(uiRoot, 'App.svelte'), 'utf8');

  // Rail accepts onOpenGit and isGitOpen props
  assert.ok(railFile.includes('onOpenGit?: () => void;'), 'Rail must declare onOpenGit callback prop');
  assert.ok(railFile.includes('isGitOpen?: boolean;'), 'Rail must declare isGitOpen prop');

  // Rail Git button triggers onOpenGit and shows active state & ⌘9 title
  assert.ok(railFile.includes('onclick={() => onOpenGit?.()}'), 'Git button must call onOpenGit instead of selectTab');
  assert.ok(railFile.includes('class:active={isGitOpen}'), 'Git button active state must bind isGitOpen');
  assert.ok(railFile.includes('title="Git (⌘9)"'), 'Git button title must show Git (⌘9)');

  // App.svelte wires onOpenGit and isGitOpen to Rail
  assert.ok(appFile.includes('onOpenGit={openGit}'), 'App.svelte must pass onOpenGit={openGit} to Rail');
  assert.ok(appFile.includes('isGitOpen={terminalOpen && terminalComponent?.getActiveSection?.() === \'git\'}'), 'App.svelte must pass isGitOpen condition to Rail');

  // App.svelte openGit minimizes/closes dock when already open on git
  assert.ok(appFile.includes("if (terminalOpen && terminalComponent?.getActiveSection?.() === 'git')"), 'openGit must check if already open on git');
  assert.ok(appFile.includes('terminalOpen = false;'), 'openGit must toggle/minimize bottom dock');
});

test('git layout 2: Rail.svelte and App.svelte declare Commit tab with ⌘K shortcut', () => {
  const railFile = fs.readFileSync(path.join(uiRoot, 'shell/Rail.svelte'), 'utf8');
  const appFile = fs.readFileSync(path.join(uiRoot, 'App.svelte'), 'utf8');

  // Rail has commit button with ⌘K hint
  assert.ok(railFile.includes("activeTab === 'commit'"), 'Rail must support activeTab commit');
  assert.ok(railFile.includes('title="Commit & Stashes (⌘K)"'), 'Rail commit button title must display Commit & Stashes (⌘K)');
  assert.ok(railFile.includes('aria-label="Commit"'), 'Rail commit button must have aria-label Commit');

  // Rail keydown handles ⌘K
  assert.ok(
    railFile.includes("e.key === 'k'") || railFile.includes("e.key === 'K'"),
    'Rail keydown handler must recognize ⌘K shortcut'
  );

  // Rail Tool Windows menu includes Commit & Stashes (⌘K)
  assert.ok(railFile.includes('Commit & Stashes'), 'Tool Windows quick menu must include Commit & Stashes');
  assert.ok(railFile.includes('⌘K'), 'Tool Windows quick menu must include ⌘K hint');

  // App.svelte handles global ⌘K toggle
  assert.ok(
    appFile.includes("e.key === 'k'") || appFile.includes("e.key === 'K'"),
    'App.svelte global keydown listener must handle ⌘K'
  );
  assert.ok(appFile.includes("activeRailTab = 'commit'"), 'App.svelte must switch activeRailTab to commit on ⌘K');

  // App.svelte renders CommitPanel when activeRailTab === commit
  assert.ok(appFile.includes("activeRailTab === 'commit'"), 'App.svelte must check activeRailTab === commit');
  assert.ok(appFile.includes('<CommitPanel'), 'App.svelte must render CommitPanel component');
});

test('git layout 3: CommitPanel.svelte segmented switcher for Changes & Stashes', () => {
  const commitFile = fs.readFileSync(path.join(uiRoot, 'features/git/CommitPanel.svelte'), 'utf8');

  // Active panel tab state
  assert.ok(commitFile.includes("activePanelTab = $state<'changes' | 'stashes'>('changes')"), 'Must declare activePanelTab state');

  // Segmented header buttons
  assert.ok(commitFile.includes('class="panel-header-tabs"'), 'Must render panel-header-tabs container');
  assert.ok(commitFile.includes('class="tab-segments"'), 'Must render tab-segments container');
  assert.ok(commitFile.includes("activePanelTab = 'changes'"), 'Must toggle activePanelTab to changes');
  assert.ok(commitFile.includes("activePanelTab = 'stashes'"), 'Must toggle activePanelTab to stashes');

  // Tab Changes elements
  assert.ok(commitFile.includes('class="files-container"'), 'Changes tab must contain files-container');
  assert.ok(commitFile.includes('class="commit-box"'), 'Changes tab must contain commit-box textarea');
  assert.ok(commitFile.includes('class="commit-btn"'), 'Changes tab must contain commit button');

  // Tab Stashes elements
  assert.ok(commitFile.includes('class="stashes-container"'), 'Stashes tab must contain stashes-container');
  assert.ok(commitFile.includes('class="compact-stash-card"'), 'Must render compact-stash-card for stashes');
  assert.ok(commitFile.includes('stash@&#123;{item.index}&#125;'), 'Must render stash@{n} index badge');
  assert.ok(commitFile.includes('class="stash-act-btn apply"'), 'Must provide Apply action button');
  assert.ok(commitFile.includes('class="stash-act-btn pop"'), 'Must provide Pop action button');
  assert.ok(commitFile.includes('class="stash-act-btn drop"'), 'Must provide Drop action button');
  assert.ok(commitFile.includes('class="stash-file-row"'), 'Must render files list in selected stash');

  // Resize handle
  assert.ok(commitFile.includes('class="commit-resize-handle"'), 'CommitPanel must have horizontal resize handle');
  assert.ok(commitFile.includes('onmousedown={startResize}'), 'Resize handle must bind startResize');
});

test('git layout 4: Clicking stash file opens comparison diff in center editor', () => {
  const commitFile = fs.readFileSync(path.join(uiRoot, 'features/git/CommitPanel.svelte'), 'utf8');
  const gitStoreFile = fs.readFileSync(path.join(uiRoot, 'features/git/git.svelte.ts'), 'utf8');
  const editorFile = fs.readFileSync(path.join(uiRoot, 'features/editor/Editor.svelte'), 'utf8');
  const diffViewFile = fs.readFileSync(path.join(uiRoot, 'features/git/DiffView.svelte'), 'utf8');

  // gitStore methods & state
  assert.ok(gitStoreFile.includes('centerDiff = $state<GitCenterDiff | null>(null)'), 'gitStore must have centerDiff state');
  assert.ok(gitStoreFile.includes('openCenterDiff('), 'gitStore must export openCenterDiff');
  assert.ok(gitStoreFile.includes('closeCenterDiff('), 'gitStore must export closeCenterDiff');
  assert.ok(gitStoreFile.includes('openStashFileDiff('), 'gitStore must export openStashFileDiff');
  assert.ok(gitStoreFile.includes('api.gitStashDiff('), 'openStashFileDiff must call api.gitStashDiff');

  // CommitPanel wires stash file click
  assert.ok(commitFile.includes('handleStashFileClick('), 'CommitPanel must declare handleStashFileClick');
  assert.ok(commitFile.includes('gitStore.openStashFileDiff('), 'handleStashFileClick must invoke gitStore.openStashFileDiff');

  // Editor renders center diff tab and panel
  assert.ok(editorFile.includes('diff-center-tab'), 'Editor tabs-bar must render diff-center-tab');
  assert.ok(editorFile.includes('center-editor-diff-panel'), 'Editor must render center-editor-diff-panel in center area');
  assert.ok(editorFile.includes('<DiffView'), 'Center diff panel must embed DiffView component');
  assert.ok(editorFile.includes('class="diff-comparison-badge"'), 'Center diff panel must display comparison badge');
  assert.ok(editorFile.includes('gitStore.closeCenterDiff()'), 'Must allow closing center diff');

  // DiffView supports custom leftLabel and rightLabel
  assert.ok(diffViewFile.includes('leftLabel ='), 'DiffView must accept leftLabel prop');
  assert.ok(diffViewFile.includes('rightLabel ='), 'DiffView must accept rightLabel prop');
  assert.ok(diffViewFile.includes('compare-badge'), 'DiffView must render comparison badge when labels are present');
});

test('git layout 5: StashView.svelte integrates with gitStore.openStashFileDiff', () => {
  const stashViewFile = fs.readFileSync(path.join(uiRoot, 'features/git/StashView.svelte'), 'utf8');

  // StashView calls openStashFileDiff when selecting a file
  assert.ok(stashViewFile.includes('gitStore.openStashFileDiff('), 'StashView selectFile must invoke gitStore.openStashFileDiff');
});
