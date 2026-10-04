export interface MenuEntry {
  id?: string;
  label: string;
  shortcut?: string;
  isDivider?: boolean;
  actionId?: string;
}

export interface MenuCategory {
  id: string;
  label: string;
  items: MenuEntry[];
}

export const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { id: 'new-project', label: 'New Flutter Project…', shortcut: '⌘N' },
      { id: 'open-folder', label: 'Open Folder…', shortcut: '⌘O' },
      { id: 'open-recent', label: 'Open Recent' },
      { isDivider: true, label: '' },
      { id: 'save', label: 'Save', shortcut: '⌘S' },
      { id: 'save-all', label: 'Save All', shortcut: '⌥⌘S' },
      { isDivider: true, label: '' },
      { id: 'close-project', label: 'Close Project' },
      { id: 'exit', label: 'Exit', shortcut: '⌘Q' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { id: 'undo', label: 'Undo', shortcut: '⌘Z' },
      { id: 'redo', label: 'Redo', shortcut: '⇧⌘Z' },
      { isDivider: true, label: '' },
      { id: 'cut', label: 'Cut', shortcut: '⌘X' },
      { id: 'copy', label: 'Copy', shortcut: '⌘C' },
      { id: 'paste', label: 'Paste', shortcut: '⌘V' },
      { isDivider: true, label: '' },
      { id: 'find', label: 'Find in File', shortcut: '⌘F' },
      { id: 'replace', label: 'Replace', shortcut: '⌘R' },
      { id: 'search-project', label: 'Search in Project', shortcut: '⇧⌘F' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      { id: 'toggle-tree', label: 'Toggle File Tree', shortcut: '⌘B' },
      { id: 'toggle-terminal', label: 'Toggle Terminal', shortcut: '⌘J' },
      { id: 'toggle-agents', label: 'Toggle AI Agents', shortcut: '⌘6' },
      { id: 'toggle-mirror', label: 'Toggle Device Mirror', shortcut: '⇧⌘D' },
      { isDivider: true, label: '' },
      { id: 'fullscreen', label: 'Full Screen', shortcut: '⌃⌘F' },
      { id: 'zen-mode', label: 'Zen Mode', shortcut: '⌘K Z' },
    ],
  },
  {
    id: 'navigate',
    label: 'Navigate',
    items: [
      { id: 'go-to-file', label: 'Go to File', shortcut: '⌘P' },
      { id: 'go-to-symbol', label: 'Go to Symbol', shortcut: '⌘⌥O' },
      { id: 'go-to-line', label: 'Go to Line', shortcut: '⌘G' },
      { isDivider: true, label: '' },
      { id: 'back', label: 'Back', shortcut: '⌘[' },
      { id: 'forward', label: 'Forward', shortcut: '⌘]' },
      { id: 'next-problem', label: 'Next Problem', shortcut: 'F2' },
    ],
  },
  {
    id: 'code',
    label: 'Code',
    items: [
      { id: 'format', label: 'Format Document', shortcut: '⌥⇧F' },
      { id: 'ai-completion', label: 'AI Inline Completion', shortcut: 'Tab' },
      { id: 'organize-imports', label: 'Organize Imports', shortcut: '⌥⇧O' },
      { isDivider: true, label: '' },
      { id: 'inspect-code', label: 'Inspect Code' },
      { id: 'quick-fix', label: 'Quick Fix', shortcut: '⌘.' },
    ],
  },
  {
    id: 'refactor',
    label: 'Refactor',
    items: [
      { id: 'rename', label: 'Rename Symbol', shortcut: '⇧F6' },
      { id: 'extract-widget', label: 'Extract Widget', shortcut: '⌥⌘W' },
      { id: 'extract-method', label: 'Extract Method', shortcut: '⌥⌘M' },
      { isDivider: true, label: '' },
      { id: 'move-file', label: 'Move File', shortcut: 'F6' },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    items: [
      { id: 'build-apk', label: 'Flutter Build APK' },
      { id: 'build-ios', label: 'Flutter Build iOS' },
      { isDivider: true, label: '' },
      { id: 'gradle-clean', label: 'Gradle Clean Build' },
      { id: 'assemble-debug', label: 'Assemble Debug' },
      { id: 'sync-toolchains', label: 'Sync Toolchains' },
    ],
  },
  {
    id: 'run',
    label: 'Run',
    items: [
      { id: 'start-debugging', label: 'Start Debugging', shortcut: 'F5' },
      { id: 'run-no-debug', label: 'Run Without Debugging', shortcut: '⌃F5' },
      { isDivider: true, label: '' },
      { id: 'hot-reload', label: 'Flutter Hot Reload', shortcut: '⌘\\' },
      { id: 'hot-restart', label: 'Flutter Hot Restart', shortcut: '⇧⌘\\' },
      { id: 'stop', label: 'Stop', shortcut: '⇧F5' },
    ],
  },
  {
    id: 'git',
    label: 'Git',
    items: [
      { id: 'commit', label: 'Commit', shortcut: '⌘K' },
      { id: 'push', label: 'Push', shortcut: '⇧⌘K' },
      { id: 'pull', label: 'Pull/Update', shortcut: '⌘T' },
      { isDivider: true, label: '' },
      { id: 'branches', label: 'Branches Switcher' },
      { id: 'gitlab-mr', label: 'GitLab Merge Requests', shortcut: '⌘5' },
      { id: 'stash', label: 'Stash Changes' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      { id: 'doctor', label: 'Toolchain Doctor' },
      { id: 'kotlin-ls', label: 'Kotlin Language Server Manager' },
      { id: 'scrcpy', label: 'Scrcpy Device Manager' },
      { isDivider: true, label: '' },
      { id: 'open-terminal', label: 'Open Terminal Here' },
    ],
  },
  {
    id: 'window',
    label: 'Window',
    items: [
      { id: 'minimize', label: 'Minimize', shortcut: '⌘M' },
      { id: 'zoom', label: 'Zoom' },
      { isDivider: true, label: '' },
      { id: 'split-right', label: 'Split Editor Right', shortcut: '⌘\\' },
      { id: 'split-down', label: 'Split Editor Down' },
      { isDivider: true, label: '' },
      { id: 'close-all-tabs', label: 'Close All Tabs' },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: [
      { id: 'documentation', label: 'Documentation' },
      { id: 'shortcuts', label: 'Keyboard Shortcuts Reference', shortcut: '⌘K ⌘S' },
      { isDivider: true, label: '' },
      { id: 'doctor-health', label: 'Petak Doctor Health Check' },
      { id: 'check-updates', label: 'Check for Updates' },
      { isDivider: true, label: '' },
      { id: 'about', label: 'About Petak' },
    ],
  },
];

export function isTitleBarInteractive(target: HTMLElement | null): boolean {
  if (!target) return false;
  let curr: HTMLElement | null = target;
  while (curr && !curr.classList?.contains('titlebar')) {
    const tagName = curr.tagName ? curr.tagName.toLowerCase() : '';
    if (
      tagName === 'button' ||
      tagName === 'input' ||
      tagName === 'select' ||
      tagName === 'textarea' ||
      tagName === 'a'
    ) {
      return true;
    }
    const role = curr.getAttribute ? curr.getAttribute('role') : null;
    if (role === 'button' || role === 'menuitem' || role === 'combobox' || role === 'menu') {
      return true;
    }
    if (curr.classList) {
      if (
        curr.classList.contains('project-btn') ||
        curr.classList.contains('project-popup-menu') ||
        curr.classList.contains('run-btn') ||
        curr.classList.contains('config-btn') ||
        curr.classList.contains('device-btn') ||
        curr.classList.contains('tool-btn') ||
        curr.classList.contains('run-action-btn') ||
        curr.classList.contains('reload-btn') ||
        curr.classList.contains('more-btn') ||
        curr.classList.contains('interactive') ||
        curr.classList.contains('menu-item-btn') ||
        curr.classList.contains('menu-dropdown') ||
        curr.classList.contains('dropdown-row') ||
        curr.classList.contains('cockpit-btn') ||
        curr.classList.contains('cockpit-select') ||
        curr.classList.contains('search-everywhere-btn') ||
        curr.classList.contains('search-btn') ||
        curr.classList.contains('agents-toggle-btn') ||
        curr.classList.contains('mirror-toggle-btn') ||
        curr.classList.contains('settings-toggle-btn') ||
        curr.classList.contains('titlebar-action-btn')
      ) {
        return true;
      }
    }
    curr = curr.parentElement;
  }
  return false;
}
