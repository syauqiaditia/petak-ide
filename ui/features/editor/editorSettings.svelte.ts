/**
 * Reactive Svelte 5 store for Petak editor settings (F4).
 */

import { editorSettings as logicSettings } from './editorSettingsLogic.ts';

class EditorSettingsStore {
  ghostText = $state<boolean>(logicSettings.ghostText);
  vimMode = $state<boolean>(logicSettings.vimMode);
  codeFolding = $state<boolean>(logicSettings.codeFolding);

  constructor() {
    logicSettings.onChange((enabled) => {
      this.ghostText = enabled;
    });
    logicSettings.onVimModeChange((enabled) => {
      this.vimMode = enabled;
    });
    logicSettings.onCodeFoldingChange((enabled) => {
      this.codeFolding = enabled;
    });
  }

  setGhostText(enabled: boolean) {
    logicSettings.setGhostText(enabled);
    this.ghostText = logicSettings.ghostText;
  }

  setVimMode(enabled: boolean) {
    logicSettings.setVimMode(enabled);
    this.vimMode = logicSettings.vimMode;
  }

  setCodeFolding(enabled: boolean) {
    logicSettings.setCodeFolding(enabled);
    this.codeFolding = logicSettings.codeFolding;
  }

  toggleGhostText() {
    logicSettings.toggleGhostText();
    this.ghostText = logicSettings.ghostText;
  }
}

export const editorSettings = new EditorSettingsStore();
