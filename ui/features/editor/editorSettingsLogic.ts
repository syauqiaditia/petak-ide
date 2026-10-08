/**
 * Pure settings logic for Petak editor (F4).
 * Usable in both browser/Svelte UI and headless unit tests.
 */

export class EditorSettings {
  ghostText: boolean = true;
  vimMode: boolean = false;
  codeFolding: boolean = true;
  theme: string = 'darcula';
  private listeners: Set<(enabled: boolean) => void> = new Set();
  private vimListeners: Set<(enabled: boolean) => void> = new Set();
  private foldListeners: Set<(enabled: boolean) => void> = new Set();
  private themeListeners: Set<(theme: string) => void> = new Set();

  constructor(initialGhostText: boolean = true) {
    this.ghostText = initialGhostText;
    this.loadFromStorage();
  }

  onChange(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onVimModeChange(listener: (enabled: boolean) => void): () => void {
    this.vimListeners.add(listener);
    return () => this.vimListeners.delete(listener);
  }

  onCodeFoldingChange(listener: (enabled: boolean) => void): () => void {
    this.foldListeners.add(listener);
    return () => this.foldListeners.delete(listener);
  }

  onThemeChange(listener: (theme: string) => void): () => void {
    this.themeListeners.add(listener);
    return () => this.themeListeners.delete(listener);
  }

  loadFromStorage(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const val = localStorage.getItem('editor.ghostText');
        if (val !== null) {
          this.ghostText = val === 'true';
        }
        const vimVal = localStorage.getItem('editor.vimMode');
        if (vimVal !== null) {
          this.vimMode = vimVal === 'true';
        }
        const foldVal = localStorage.getItem('editor.codeFolding');
        if (foldVal !== null) {
          this.codeFolding = foldVal !== 'false';
        }
        const themeVal = localStorage.getItem('editor.theme');
        if (themeVal !== null) {
          this.theme = themeVal;
        }
      } catch {
        // ignore
      }
    }
  }

  setGhostText(enabled: boolean): void {
    this.ghostText = enabled;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('editor.ghostText', String(enabled));
      } catch {
        // ignore
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(enabled);
      } catch {
        // ignore
      }
    }
  }

  setVimMode(enabled: boolean): void {
    this.vimMode = enabled;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('editor.vimMode', String(enabled));
      } catch {
        // ignore
      }
    }
    for (const listener of this.vimListeners) {
      try {
        listener(enabled);
      } catch {
        // ignore
      }
    }
  }

  setCodeFolding(enabled: boolean): void {
    this.codeFolding = enabled;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('editor.codeFolding', String(enabled));
      } catch {
        // ignore
      }
    }
    for (const listener of this.foldListeners) {
      try {
        listener(enabled);
      } catch {
        // ignore
      }
    }
  }

  setTheme(theme: string): void {
    this.theme = theme;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('editor.theme', theme);
      } catch {
        // ignore
      }
    }
    for (const listener of this.themeListeners) {
      try {
        listener(theme);
      } catch {
        // ignore
      }
    }
  }

  toggleGhostText(): boolean {
    this.setGhostText(!this.ghostText);
    return this.ghostText;
  }
}

export const editorSettings = new EditorSettings();
