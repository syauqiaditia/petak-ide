/**
 * Pure settings logic for Petak editor (F4).
 * Usable in both browser/Svelte UI and headless unit tests.
 */

export class EditorSettings {
  ghostText: boolean = true;
  vimMode: boolean = false;
  codeFolding: boolean = true;
  closingLabels: boolean = true;
  autoPubGetOnSave: boolean = true;
  colorPreview: boolean = true;
  theme: string = 'darcula';
  private listeners: Set<(enabled: boolean) => void> = new Set();
  private vimListeners: Set<(enabled: boolean) => void> = new Set();
  private foldListeners: Set<(enabled: boolean) => void> = new Set();
  private closingLabelsListeners: Set<(enabled: boolean) => void> = new Set();
  private autoPubGetListeners: Set<(enabled: boolean) => void> = new Set();
  private colorPreviewListeners: Set<(enabled: boolean) => void> = new Set();
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

  onClosingLabelsChange(listener: (enabled: boolean) => void): () => void {
    this.closingLabelsListeners.add(listener);
    return () => this.closingLabelsListeners.delete(listener);
  }

  onAutoPubGetOnSaveChange(listener: (enabled: boolean) => void): () => void {
    this.autoPubGetListeners.add(listener);
    return () => this.autoPubGetListeners.delete(listener);
  }

  onColorPreviewChange(listener: (enabled: boolean) => void): () => void {
    this.colorPreviewListeners.add(listener);
    return () => this.colorPreviewListeners.delete(listener);
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
        const closingLabelsVal = localStorage.getItem('editor.closingLabels');
        if (closingLabelsVal !== null) {
          this.closingLabels = closingLabelsVal !== 'false';
        }
        const autoPubGetVal = localStorage.getItem('editor.autoPubGetOnSave');
        if (autoPubGetVal !== null) {
          this.autoPubGetOnSave = autoPubGetVal !== 'false';
        }
        const colorPreviewVal = localStorage.getItem('editor.colorPreview');
        if (colorPreviewVal !== null) {
          this.colorPreview = colorPreviewVal !== 'false';
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

  setClosingLabels(enabled: boolean): void {
    this.closingLabels = enabled;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('editor.closingLabels', String(enabled));
      } catch {
        // ignore
      }
    }
    for (const listener of this.closingLabelsListeners) {
      try {
        listener(enabled);
      } catch {
        // ignore
      }
    }
  }

  setAutoPubGetOnSave(enabled: boolean): void {
    this.autoPubGetOnSave = enabled;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('editor.autoPubGetOnSave', String(enabled));
      } catch {
        // ignore
      }
    }
    for (const listener of this.autoPubGetListeners) {
      try {
        listener(enabled);
      } catch {
        // ignore
      }
    }
  }

  setColorPreview(enabled: boolean): void {
    this.colorPreview = enabled;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('editor.colorPreview', String(enabled));
      } catch {
        // ignore
      }
    }
    for (const listener of this.colorPreviewListeners) {
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

  toggleVimMode(): boolean {
    this.setVimMode(!this.vimMode);
    return this.vimMode;
  }

  toggleCodeFolding(): boolean {
    this.setCodeFolding(!this.codeFolding);
    return this.codeFolding;
  }

  toggleClosingLabels(): boolean {
    this.setClosingLabels(!this.closingLabels);
    return this.closingLabels;
  }

  toggleAutoPubGetOnSave(): boolean {
    this.setAutoPubGetOnSave(!this.autoPubGetOnSave);
    return this.autoPubGetOnSave;
  }

  toggleColorPreview(): boolean {
    this.setColorPreview(!this.colorPreview);
    return this.colorPreview;
  }
}

export const editorSettings = new EditorSettings();
