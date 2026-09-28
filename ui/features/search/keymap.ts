export type SearchMode = 'files' | 'actions' | 'everywhere' | 'recent' | 'text';

export interface ActionItem {
  id: string;
  label: string;
  shortcut: string;
  run: () => void;
}

export interface KeymapCallbacks {
  openPalette: (mode: SearchMode) => void;
  closePalette: () => void;
  isPaletteOpen: () => boolean;
  showIntentions?: () => void;
}

export function showIntentions() {
  console.debug('[Petak] Alt-Enter / showIntentions called (Phase 2 stub)');
}

export function registerKeymap(callbacks: KeymapCallbacks): () => void {
  let lastShiftKeyUp = 0;
  let shiftInterrupted = false;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Shift') {
      shiftInterrupted = true;
    }

    // Alt-Enter (Option-Enter on macOS): Quick fix / intentions stub
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (callbacks.showIntentions) {
        callbacks.showIntentions();
      } else {
        showIntentions();
      }
      return;
    }

    // Escape closes palette if open
    if (e.key === 'Escape') {
      if (callbacks.isPaletteOpen()) {
        e.preventDefault();
        e.stopPropagation();
        callbacks.closePalette();
        return;
      }
    }

    // Meta or Ctrl shortcuts
    const isCmd = e.metaKey || e.ctrlKey;
    if (isCmd && !e.altKey) {
      const key = e.key.toLowerCase();

      // Cmd-Shift-A: Actions
      if (e.shiftKey && key === 'a') {
        e.preventDefault();
        e.stopPropagation();
        callbacks.openPalette('actions');
        return;
      }

      // Cmd-Shift-F: Find in project (text)
      if (e.shiftKey && key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        callbacks.openPalette('text');
        return;
      }

      // Cmd-Shift-O or Cmd-P: Find files
      if ((e.shiftKey && key === 'o') || (!e.shiftKey && key === 'p')) {
        e.preventDefault();
        e.stopPropagation();
        callbacks.openPalette('files');
        return;
      }

      // Cmd-E: Recent files
      if (!e.shiftKey && key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        callbacks.openPalette('recent');
        return;
      }
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === 'Shift') {
      if (!shiftInterrupted && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const now = performance.now();
        if (lastShiftKeyUp > 0 && now - lastShiftKeyUp <= 300) {
          lastShiftKeyUp = 0;
          callbacks.openPalette('everywhere');
          return;
        } else {
          lastShiftKeyUp = now;
        }
      } else {
        lastShiftKeyUp = 0;
      }
      shiftInterrupted = false;
    } else {
      shiftInterrupted = true;
    }
  }

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
  };
}
