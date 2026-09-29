import {
  type Extension,
  StateField,
  StateEffect,
  type EditorState,
} from '@codemirror/state';
import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  completionStatus,
  selectedCompletion,
} from '@codemirror/autocomplete';
import type { SuggestItem } from '../../lib/api.ts';
import { editorSettings } from './editorSettingsLogic.ts';

async function defaultSuggestQuery(prefix: string, lang: string): Promise<SuggestItem[]> {
  try {
    const { api } = await import('../../lib/api.ts');
    return await api.suggestQuery(prefix, lang, 3);
  } catch {
    return [];
  }
}

export interface GhostState {
  text: string;
  from: number;
}

export const setGhostTextEffect = StateEffect.define<GhostState | null>();
export const clearGhostTextEffect = StateEffect.define<void>();

export class GhostTextWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  eq(other: GhostTextWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    if (typeof document !== 'undefined') {
      const span = document.createElement('span');
      span.className = 'cm-ghost-text';
      span.textContent = this.text;
      span.style.color = '#7d808a';
      span.style.pointerEvents = 'none';
      span.style.userSelect = 'none';
      span.style.fontFamily = "'JetBrains Mono', monospace";
      span.style.fontSize = '13px';
      span.style.opacity = '0.65';
      span.style.whiteSpace = 'pre';
      return span;
    }
    return {} as HTMLElement;
  }
}

export const ghostStateField = StateField.define<GhostState | null>({
  create() {
    return null;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhostTextEffect)) {
        return effect.value;
      }
      if (effect.is(clearGhostTextEffect)) {
        return null;
      }
    }
    // If doc changed or cursor moved without explicit ghost effect, clear ghost text
    if (tr.docChanged || (tr.selection && !tr.selection.eq(tr.startState.selection))) {
      return null;
    }
    return value;
  },
});

export const ghostDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    if (!editorSettings.ghostText) {
      return Decoration.none;
    }
    const ghost = tr.state.field(ghostStateField, false);
    if (!ghost || !ghost.text) {
      return Decoration.none;
    }
    const pos = Math.min(ghost.from, tr.state.doc.length);
    return Decoration.set([
      Decoration.widget({
        widget: new GhostTextWidget(ghost.text),
        side: 1,
      }).range(pos),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function getActiveGhostText(state: EditorState): GhostState | null {
  try {
    if (!editorSettings.ghostText) {
      return null;
    }
    return state.field(ghostStateField, false) || null;
  } catch {
    return null;
  }
}

export function acceptGhostText(view: EditorView): boolean {
  const ghost = getActiveGhostText(view.state);
  if (!ghost || !ghost.text) {
    return false;
  }

  const { text, from } = ghost;
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length, head: from + text.length },
    effects: [setGhostTextEffect.of(null)],
  });
  return true;
}

export function dismissGhostText(view: EditorView): boolean {
  const ghost = getActiveGhostText(view.state);
  if (!ghost || !ghost.text) {
    return false;
  }

  view.dispatch({
    effects: [setGhostTextEffect.of(null)],
  });
  return true;
}

export function computeGhostFromCompletion(prefix: string, selectedLabel: string): string {
  if (!selectedLabel) return '';
  if (prefix && selectedLabel.startsWith(prefix)) {
    return selectedLabel.slice(prefix.length);
  }
  if (!prefix) {
    return selectedLabel;
  }
  return '';
}

export function computeGhostFromSuggest(prefix: string, item: SuggestItem): string {
  if (!item || !item.text) return '';
  let suffix = item.text.startsWith(prefix) ? item.text.slice(prefix.length) : item.text;
  if (item.argsTemplate) {
    if (suffix.endsWith('(')) {
      suffix += `${item.argsTemplate})`;
    } else if (!suffix.includes('(')) {
      suffix += `(${item.argsTemplate})`;
    }
  }
  return suffix;
}

export interface GhostTextOptions {
  getPath?: () => string | null;
  debounceMs?: number;
  suggestQuery?: (prefix: string, lang: string) => Promise<SuggestItem[]>;
  getTopLspCompletion?: (prefix: string) => Promise<string | null>;
  isEnabled?: () => boolean;
}

export function createGhostTextViewPlugin(options: GhostTextOptions = {}) {
  return ViewPlugin.fromClass(
    class {
      private timer: any = null;
      private requestId = 0;
      private destroyed = false;
      private unsubSettings: (() => void) | null = null;

      readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        this.unsubSettings = editorSettings.onChange((enabled) => {
          if (!enabled) {
            if (this.timer) {
              clearTimeout(this.timer);
              this.timer = null;
            }
            this.requestId++;
            this.view.dispatch({ effects: [clearGhostTextEffect.of()] });
          } else {
            this.check(this.view);
          }
        });
        this.check(view);
      }

      update(update: ViewUpdate) {
        for (const tr of update.transactions) {
          for (const effect of tr.effects) {
            if (effect.is(clearGhostTextEffect)) {
              if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
              }
              this.requestId++;
              return;
            }
          }
        }
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          this.check(update.view);
        }
      }

      check(view: EditorView) {
        if (this.destroyed) return;
        const isEnabled = options.isEnabled ? options.isEnabled() : editorSettings.ghostText;
        if (!isEnabled) {
          if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
          }
          this.requestId++;
          if (getActiveGhostText(view.state)) {
            queueMicrotask(() => {
              if (!this.destroyed) {
                view.dispatch({ effects: [clearGhostTextEffect.of()] });
              }
            });
          }
          return;
        }

        // 1. If autocomplete popup is active, ghost = selected item
        const status = completionStatus(view.state);
        if (status === 'active') {
          const selected = selectedCompletion(view.state);
          if (selected) {
            if (this.timer) {
              clearTimeout(this.timer);
              this.timer = null;
            }
            this.requestId++; // cancel pending suggest requests

            const head = view.state.selection.main.head;
            const line = view.state.doc.lineAt(head);
            const textBefore = line.text.slice(0, head - line.from);
            const match = textBefore.match(/[\w$]+$/);
            const prefix = match ? match[0] : '';

            const ghost = computeGhostFromCompletion(prefix, selected.label);
            const current = getActiveGhostText(view.state);
            if (current?.text !== ghost || current?.from !== head) {
              queueMicrotask(() => {
                if (!this.destroyed && completionStatus(view.state) === 'active') {
                  view.dispatch({
                    effects: [setGhostTextEffect.of(ghost ? { text: ghost, from: head } : null)],
                  });
                }
              });
            }
            return;
          }
        }

        // 2. Autocomplete popup is not active. Debounce suggest_query.
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }

        if (!view.state.selection.main.empty) {
          return;
        }

        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        const textBefore = line.text.slice(0, head - line.from);
        const match = textBefore.match(/[\w$]+$/);
        if (!match) {
          return;
        }

        const prefix = match[0];
        const reqId = ++this.requestId;
        const delay = options.debounceMs ?? 120;

        this.timer = setTimeout(async () => {
          // Check stale conditions (Step 5)
          if (this.requestId !== reqId || this.destroyed) return;
          if (view.state.selection.main.head !== head) return;
          if (completionStatus(view.state) === 'active') return;
          const isEnabledNow = options.isEnabled ? options.isEnabled() : editorSettings.ghostText;
          if (!isEnabledNow) return;

          const path = options.getPath ? options.getPath() : null;
          const lang = path && path.endsWith('.dart') ? 'dart' : 'dart';

          try {
            const queryFn = options.suggestQuery || defaultSuggestQuery;
            const results = await queryFn(prefix, lang);

            if (this.requestId !== reqId || this.destroyed) return;
            if (view.state.selection.main.head !== head) return;
            if (completionStatus(view.state) === 'active') return;
            const isStillEnabled = options.isEnabled ? options.isEnabled() : editorSettings.ghostText;
            if (!isStillEnabled) return;

            // Only results with freq >= 2 per contract
            const matching = (results || []).filter((r: SuggestItem) => r.freq >= 2);
            if (matching.length > 0) {
              const top = matching[0];
              const ghost = computeGhostFromSuggest(prefix, top);
              if (ghost) {
                view.dispatch({
                  effects: [setGhostTextEffect.of({ text: ghost, from: head })],
                });
                return;
              }
            }

            // Top LSP completion fallback if provided
            if (options.getTopLspCompletion) {
              const lspTop = await options.getTopLspCompletion(prefix);
              if (this.requestId === reqId && !this.destroyed && lspTop) {
                const ghost = computeGhostFromCompletion(prefix, lspTop);
                if (ghost) {
                  view.dispatch({
                    effects: [setGhostTextEffect.of({ text: ghost, from: head })],
                  });
                  return;
                }
              }
            }

            // No suggestion found
            view.dispatch({
              effects: [setGhostTextEffect.of(null)],
            });
          } catch {
            // ignore network/invoke failures
          }
        }, delay);
      }

      destroy() {
        this.destroyed = true;
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        if (this.unsubSettings) {
          this.unsubSettings();
          this.unsubSettings = null;
        }
      }
    }
  );
}

export function createGhostTextExtension(options: GhostTextOptions = {}): Extension {
  return [
    ghostStateField,
    ghostDecorationField,
    createGhostTextViewPlugin(options),
  ];
}
