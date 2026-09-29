/**
 * Reactive Svelte 5 store for Petak editor settings (F4).
 */

import { EditorSettings } from './editorSettingsLogic.ts';

class EditorSettingsStore {
  private logic = new EditorSettings();
  ghostText = $state<boolean>(true);

  constructor() {
    this.ghostText = this.logic.ghostText;
  }

  setGhostText(enabled: boolean) {
    this.logic.setGhostText(enabled);
    this.ghostText = this.logic.ghostText;
  }

  toggleGhostText() {
    this.logic.toggleGhostText();
    this.ghostText = this.logic.ghostText;
  }
}

export const editorSettings = new EditorSettingsStore();
