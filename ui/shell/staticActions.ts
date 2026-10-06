import { gitStore } from '../features/git/git.svelte';

export interface ActionContext {
  handlePickFolder: () => Promise<void>;
  editorComponent?: any;
  openPalette: (mode: any) => Promise<void>;
  toggleTerminal: () => Promise<void>;
  openProblems: () => Promise<void>;
}

export function buildStaticActions(ctx: ActionContext) {
  return [
    {
      id: 'open-folder',
      label: 'Open Folder...',
      shortcut: '⌘O',
      run: () => ctx.handlePickFolder(),
    },
    {
      id: 'save',
      label: 'Save',
      shortcut: '⌘S',
      run: () => ctx.editorComponent?.handleSave(),
    },
    {
      id: 'format-document',
      label: 'Format Document',
      shortcut: '⌥⌘L',
      run: () => ctx.editorComponent?.handleFormat(),
    },
    {
      id: 'format-selection',
      label: 'Format Selection',
      run: () => ctx.editorComponent?.handleFormat(),
    },
    {
      id: 'close-tab',
      label: 'Close Tab',
      shortcut: '⌘W',
      run: () => ctx.editorComponent?.handleCloseActiveTab(),
    },
    {
      id: 'find-file',
      label: 'Find File...',
      shortcut: '⌘P',
      run: () => ctx.openPalette('files'),
    },
    {
      id: 'find-in-project',
      label: 'Find in Project...',
      shortcut: '⇧⌘F',
      run: () => ctx.openPalette('text'),
    },
    {
      id: 'recent-files',
      label: 'Recent Files',
      shortcut: '⌘E',
      run: () => ctx.openPalette('recent'),
    },
    {
      id: 'toggle-terminal',
      label: 'Toggle Terminal',
      shortcut: '⌃`',
      run: () => ctx.toggleTerminal(),
    },
    {
      id: 'toggle-problems',
      label: 'Toggle Problems Panel',
      shortcut: '⇧⌘M',
      run: () => ctx.openProblems(),
    },
    {
      id: 'reformat-code',
      label: 'Reformat Code',
      shortcut: '⌥⌘L',
      run: () => ctx.editorComponent?.handleFormat(),
    },
    {
      id: 'rename-symbol',
      label: 'Rename Symbol',
      shortcut: '⇧F6',
      run: () => ctx.editorComponent?.handleRename(),
    },
    {
      id: 'goto-definition',
      label: 'Go to Definition',
      shortcut: '⌘B',
      run: () => ctx.editorComponent?.handleGoToDefinition(),
    },
    {
      id: 'find-usages',
      label: 'Find Usages',
      shortcut: '⌥F7',
      run: () => ctx.editorComponent?.handleFindUsages(),
    },
    {
      id: 'git-stash',
      label: 'Git: Stash Changes…',
      run: () => gitStore.openStash(),
    },
    {
      id: 'git-unstash',
      label: 'Git: Unstash Changes…',
      run: () => gitStore.openUnstash(),
    },
  ];
}
