export type SearchMode = 'files' | 'actions' | 'everywhere' | 'recent' | 'text';

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
  function onKeyDown(e: KeyboardEvent) {
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

      // Cmd-Shift-O or Cmd-P: Find files
      if ((e.shiftKey && key === 'o') || (!e.shiftKey && key === 'p')) {
        e.preventDefault();
        e.stopPropagation();
        callbacks.openPalette('files');
        return;
      }
    }
  }

  window.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}
