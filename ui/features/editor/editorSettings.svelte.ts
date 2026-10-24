/**
 * Reactive Svelte 5 store for Petak editor settings (F4).
 */

import { editorSettings as logicSettings } from './editorSettingsLogic.ts';

class EditorSettingsStore {
  ghostText = $state<boolean>(logicSettings.ghostText);
  vimMode = $state<boolean>(logicSettings.vimMode);
  codeFolding = $state<boolean>(logicSettings.codeFolding);
  closingLabels = $state<boolean>(logicSettings.closingLabels);
  autoPubGetOnSave = $state<boolean>(logicSettings.autoPubGetOnSave);
  colorPreview = $state<boolean>(logicSettings.colorPreview);

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
    logicSettings.onClosingLabelsChange((enabled) => {
      this.closingLabels = enabled;
    });
    logicSettings.onAutoPubGetOnSaveChange((enabled) => {
      this.autoPubGetOnSave = enabled;
    });
    logicSettings.onColorPreviewChange((enabled) => {
      this.colorPreview = enabled;
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

  setClosingLabels(enabled: boolean) {
    logicSettings.setClosingLabels(enabled);
    this.closingLabels = logicSettings.closingLabels;
  }

  toggleGhostText() {
    logicSettings.toggleGhostText();
    this.ghostText = logicSettings.ghostText;
  }

  toggleVimMode() {
    logicSettings.toggleVimMode();
    this.vimMode = logicSettings.vimMode;
  }

  toggleCodeFolding() {
    logicSettings.toggleCodeFolding();
    this.codeFolding = logicSettings.codeFolding;
  }

  toggleClosingLabels() {
    logicSettings.toggleClosingLabels();
    this.closingLabels = logicSettings.closingLabels;
  }

  setAutoPubGetOnSave(enabled: boolean) {
    logicSettings.setAutoPubGetOnSave(enabled);
    this.autoPubGetOnSave = logicSettings.autoPubGetOnSave;
  }

  setColorPreview(enabled: boolean) {
    logicSettings.setColorPreview(enabled);
    this.colorPreview = logicSettings.colorPreview;
  }

  toggleAutoPubGetOnSave() {
    logicSettings.toggleAutoPubGetOnSave();
    this.autoPubGetOnSave = logicSettings.autoPubGetOnSave;
  }

  toggleColorPreview() {
    logicSettings.toggleColorPreview();
    this.colorPreview = logicSettings.colorPreview;
  }
}

export const editorSettings = new EditorSettingsStore();
