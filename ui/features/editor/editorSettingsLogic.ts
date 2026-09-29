/**
 * Pure settings logic for Petak editor (F4).
 * Usable in both browser/Svelte UI and headless unit tests.
 */

export class EditorSettings {
  ghostText: boolean = true;
  private listeners: Set<(enabled: boolean) => void> = new Set();

  constructor(initialGhostText: boolean = true) {
    this.ghostText = initialGhostText;
    this.loadFromStorage();
  }

  onChange(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  loadFromStorage(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const val = localStorage.getItem('editor.ghostText');
        if (val !== null) {
          this.ghostText = val === 'true';
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

  toggleGhostText(): boolean {
    this.setGhostText(!this.ghostText);
    return this.ghostText;
  }
}

export const editorSettings = new EditorSettings();
