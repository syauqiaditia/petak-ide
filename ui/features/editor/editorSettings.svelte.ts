/**
 * Reactive Svelte 5 store for Petak editor settings (F4).
 */

import { editorSettings as logicSettings } from './editorSettingsLogic.ts';

class EditorSettingsStore {
  ghostText = $state<boolean>(logicSettings.ghostText);

  constructor() {
    logicSettings.onChange((enabled) => {
      this.ghostText = enabled;
    });
  }

  setGhostText(enabled: boolean) {
    logicSettings.setGhostText(enabled);
    this.ghostText = logicSettings.ghostText;
  }

  toggleGhostText() {
    logicSettings.toggleGhostText();
    this.ghostText = logicSettings.ghostText;
  }
}

export const editorSettings = new EditorSettingsStore();
