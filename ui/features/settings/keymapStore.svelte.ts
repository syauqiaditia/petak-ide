/**
 * Keymap Store: manages default and custom keyboard shortcuts.
 * Custom mappings persist in localStorage('petak.keymaps').
 */

export interface KeymapEntry {
  id: string;
  action: string;
  defaultShortcut: string;
  shortcut: string;
  category: string;
}

export interface ConflictInfo {
  conflictingActionId: string;
  conflictingAction: string;
}

const DEFAULT_KEYMAPS: Omit<KeymapEntry, 'shortcut'>[] = [
  { id: 'search-everywhere', action: 'Search Everywhere', defaultShortcut: 'Shift Shift', category: 'Navigasi' },
  { id: 'quick-open', action: 'Buka Berkas Cepat (Quick Open)', defaultShortcut: '⌘P', category: 'Navigasi' },
  { id: 'hot-reload', action: 'Flutter Hot Reload', defaultShortcut: '⌘\\', category: 'Run' },
  { id: 'hot-restart', action: 'Flutter Hot Restart', defaultShortcut: '⇧⌘\\', category: 'Run' },
  { id: 'toggle-agents', action: 'Toggle AI Agents Panel', defaultShortcut: '⌘6', category: 'View' },
  { id: 'toggle-mirror', action: 'Toggle Device Mirror', defaultShortcut: '⇧⌘D', category: 'View' },
  { id: 'gitlab-mrs', action: 'GitLab Merge Requests', defaultShortcut: '⌘5', category: 'Git' },
  { id: 'settings', action: 'Buka Pengaturan (Settings)', defaultShortcut: '⌘,', category: 'General' },
  { id: 'find-replace', action: 'Find & Replace in File', defaultShortcut: '⌘F / ⌘R', category: 'Editor' },
  { id: 'fold-unfold', action: 'Fold / Unfold Code Block', defaultShortcut: '⌥⌘- / ⌥⌘+', category: 'Editor' },
  { id: 'toggle-terminal', action: 'Toggle Terminal Panel', defaultShortcut: '⌘`', category: 'View' },
  { id: 'go-to-line', action: 'Go to Line', defaultShortcut: '⌘G', category: 'Navigasi' },
  { id: 'select-all', action: 'Select All', defaultShortcut: '⌘A', category: 'Editor' },
  { id: 'undo', action: 'Undo', defaultShortcut: '⌘Z', category: 'Editor' },
  { id: 'redo', action: 'Redo', defaultShortcut: '⇧⌘Z', category: 'Editor' },
];

function loadCustomMappings(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem('petak.keymaps');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveCustomMappings(mappings: Record<string, string>) {
  if (typeof localStorage === 'undefined') return;
  if (Object.keys(mappings).length === 0) {
    localStorage.removeItem('petak.keymaps');
  } else {
    localStorage.setItem('petak.keymaps', JSON.stringify(mappings));
  }
}

function buildKeymaps(customMappings: Record<string, string>): KeymapEntry[] {
  return DEFAULT_KEYMAPS.map((k) => ({
    ...k,
    shortcut: customMappings[k.id] ?? k.defaultShortcut,
  }));
}

class KeymapStore {
  customMappings = $state<Record<string, string>>(loadCustomMappings());
  keymaps = $state<KeymapEntry[]>(buildKeymaps(loadCustomMappings()));

  /** Update a shortcut. Returns conflict info if shortcut already used by another action. */
  updateShortcut(actionId: string, newShortcut: string): ConflictInfo | null {
    const trimmed = newShortcut.trim();
    if (!trimmed) return null;

    // Check for conflict
    const conflict = this.keymaps.find(
      (k) => k.id !== actionId && k.shortcut === trimmed
    );
    if (conflict) {
      return { conflictingActionId: conflict.id, conflictingAction: conflict.action };
    }

    // Find default to check if same as default
    const def = DEFAULT_KEYMAPS.find((d) => d.id === actionId);
    if (!def) return null;

    if (trimmed === def.defaultShortcut) {
      // Remove custom override, back to default
      delete this.customMappings[actionId];
    } else {
      this.customMappings[actionId] = trimmed;
    }

    // Reassign to trigger reactivity
    this.customMappings = { ...this.customMappings };
    this.keymaps = buildKeymaps(this.customMappings);
    saveCustomMappings(this.customMappings);
    return null;
  }

  /** Force-update even if conflict exists (user confirmed override). */
  forceUpdateShortcut(actionId: string, newShortcut: string) {
    const trimmed = newShortcut.trim();
    if (!trimmed) return;

    // Remove any other action using this shortcut
    for (const k of this.keymaps) {
      if (k.id !== actionId && k.shortcut === trimmed) {
        const otherDef = DEFAULT_KEYMAPS.find((d) => d.id === k.id);
        if (otherDef) {
          // Reset conflicting action to default
          delete this.customMappings[k.id];
        }
      }
    }

    const def = DEFAULT_KEYMAPS.find((d) => d.id === actionId);
    if (!def) return;

    if (trimmed === def.defaultShortcut) {
      delete this.customMappings[actionId];
    } else {
      this.customMappings[actionId] = trimmed;
    }

    this.customMappings = { ...this.customMappings };
    this.keymaps = buildKeymaps(this.customMappings);
    saveCustomMappings(this.customMappings);
  }

  resetSingle(actionId: string) {
    delete this.customMappings[actionId];
    this.customMappings = { ...this.customMappings };
    this.keymaps = buildKeymaps(this.customMappings);
    saveCustomMappings(this.customMappings);
  }

  resetDefaults() {
    this.customMappings = {};
    this.keymaps = buildKeymaps({});
    saveCustomMappings({});
  }

  isCustomized(actionId: string): boolean {
    return actionId in this.customMappings;
  }
}

export const keymapStore = new KeymapStore();

/** Convert a KeyboardEvent into a human-readable shortcut string. */
export function keyEventToShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  // macOS convention
  if (e.ctrlKey) parts.push('⌃');
  if (e.altKey) parts.push('⌥');
  if (e.shiftKey) parts.push('⇧');
  if (e.metaKey) parts.push('⌘');

  const key = e.key;
  // Skip standalone modifier keys
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return '';

  // Map special keys
  const keyMap: Record<string, string> = {
    'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
    'Backspace': '⌫', 'Delete': '⌦', 'Enter': '↩', 'Tab': '⇥',
    'Escape': 'Esc', ' ': 'Space',
  };
  parts.push(keyMap[key] || key.length === 1 ? key.toUpperCase() : (keyMap[key] || key));

  return parts.join('');
}
