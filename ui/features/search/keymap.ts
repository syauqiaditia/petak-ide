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
  toggleTerminal?: () => void;
  onTreeNew?: () => void;
  onTreeRename?: () => void;
  onTreeDelete?: () => void;
  onTreeCopyPath?: () => void;
  onTreeReveal?: () => void;
}

export function showIntentions() {
  console.debug('[Petak] Alt-Enter / showIntentions called (Phase 2 stub)');
}

export interface DoubleShiftOptions {
  thresholdMs?: number;
  onTrigger: () => void;
  now?: () => number;
}

export function createDoubleShiftDetector(options: DoubleShiftOptions) {
  const threshold = options.thresholdMs ?? 350;
  const getNow = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  let lastShiftKeyUp = 0;
  let shiftPressed = false;
  let interrupted = false;

  return {
    handleKeyDown(e: { key: string; repeat?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) {
      if (e.repeat) return;
      if (e.key === 'Shift') {
        shiftPressed = true;
        interrupted = false;
      } else {
        interrupted = true;
        lastShiftKeyUp = 0;
      }
    },
    handleKeyUp(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) {
      if (e.key === 'Shift') {
        const wasPressed = shiftPressed;
        shiftPressed = false;
        if (!interrupted && wasPressed && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = getNow();
          if (lastShiftKeyUp > 0 && now - lastShiftKeyUp <= threshold) {
            lastShiftKeyUp = 0;
            options.onTrigger();
          } else {
            lastShiftKeyUp = now;
          }
        } else {
          lastShiftKeyUp = 0;
        }
        interrupted = false;
      } else {
        interrupted = true;
        lastShiftKeyUp = 0;
      }
    },
    reset() {
      lastShiftKeyUp = 0;
      shiftPressed = false;
      interrupted = false;
    },
  };
}

export function registerKeymap(callbacks: KeymapCallbacks): () => void {
  const shiftDetector = createDoubleShiftDetector({
    thresholdMs: 350,
    onTrigger: () => {
      callbacks.openPalette('everywhere');
    },
  });

  function onKeyDown(e: KeyboardEvent) {
    shiftDetector.handleKeyDown(e);

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

    // Option-F1: Reveal in Finder (when tree or editor has focus)
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.key === 'F1') {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onTreeReveal?.();
      return;
    }

    // Shift-F6: Rename (when tree has focus)
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'F6') {
      const isTree = typeof document !== 'undefined' && !!document.activeElement?.closest('.file-tree');
      if (isTree) {
        e.preventDefault();
        e.stopPropagation();
        callbacks.onTreeRename?.();
        return;
      }
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

    // Ctrl-` (Backquote) toggle terminal
    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault();
      e.stopPropagation();
      callbacks.toggleTerminal?.();
      return;
    }

    // Meta or Ctrl shortcuts
    const isCmd = e.metaKey || e.ctrlKey;
    if (isCmd && !e.altKey) {
      const key = e.key.toLowerCase();

      // Cmd-J: Toggle terminal
      if (!e.shiftKey && key === 'j') {
        e.preventDefault();
        e.stopPropagation();
        callbacks.toggleTerminal?.();
        return;
      }

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

      // Tree shortcuts (only when tree is focused)
      const isTree = typeof document !== 'undefined' && !!document.activeElement?.closest('.file-tree');
      if (isTree) {
        // Cmd-N: New
        if (!e.shiftKey && key === 'n') {
          e.preventDefault();
          e.stopPropagation();
          callbacks.onTreeNew?.();
          return;
        }

        // Cmd-Backspace: Delete
        if (e.key === 'Backspace') {
          e.preventDefault();
          e.stopPropagation();
          callbacks.onTreeDelete?.();
          return;
        }

        // Shift-Cmd-C: Copy Path
        if (e.shiftKey && key === 'c') {
          e.preventDefault();
          e.stopPropagation();
          callbacks.onTreeCopyPath?.();
          return;
        }
      }
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    shiftDetector.handleKeyUp(e);
  }

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
  };
}
