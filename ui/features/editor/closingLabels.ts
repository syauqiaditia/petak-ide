/**
 * CodeMirror 6 extension for Flutter Closing Labels in Petak (Batch 54).
 * Renders non-mutating '// WidgetName' muted annotations at the end of closing brackets
 * for multi-line Flutter widgets, achieving parity with Android Studio & VS Code.
 */

import { StateEffect, StateField, RangeSetBuilder, type Extension } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet, WidgetType } from '@codemirror/view';
import { extractClosingLabels, type ClosingLabelItem } from './closingLabelsLogic.ts';
import { editorSettings } from './editorSettingsLogic.ts';

export const setClosingLabelsEffect = StateEffect.define<ClosingLabelItem[] | null>();
export const setClosingLabelsEnabledEffect = StateEffect.define<boolean>();

/**
 * Non-mutating widget rendering the muted slate grey closing label.
 */
export class ClosingLabelWidget extends WidgetType {
  readonly label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  eq(other: ClosingLabelWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    if (typeof document !== 'undefined') {
      const span = document.createElement('span');
      span.className = 'cm-flutter-closing-label';
      span.textContent = `// ${this.label}`;
      span.style.color = '#70747e';
      span.style.fontSize = '11px';
      span.style.fontStyle = 'italic';
      span.style.fontFamily = "'JetBrains Mono', monospace";
      span.style.marginLeft = '8px';
      span.style.userSelect = 'none';
      span.style.pointerEvents = 'none';
      span.style.opacity = '0.75';
      span.style.whiteSpace = 'pre';
      return span;
    }
    return {
      className: 'cm-flutter-closing-label',
      textContent: `// ${this.label}`,
      style: {
        color: '#70747e',
        fontSize: '11px',
        fontStyle: 'italic',
        fontFamily: "'JetBrains Mono', monospace",
        marginLeft: '8px',
        userSelect: 'none',
        pointerEvents: 'none',
        opacity: '0.75',
        whiteSpace: 'pre',
      },
    } as unknown as HTMLElement;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Slate grey styling for closing labels (zero pitch black, AAA contrast compliance).
 */
export const closingLabelTheme = EditorView.baseTheme({
  '.cm-flutter-closing-label': {
    color: '#70747e',
    fontSize: '11px',
    fontStyle: 'italic',
    fontFamily: "'JetBrains Mono', monospace",
    marginLeft: '8px',
    userSelect: 'none',
    pointerEvents: 'none',
    opacity: '0.75',
    whiteSpace: 'pre',
  },
});

function buildClosingDecorations(
  doc: any,
  labels: ClosingLabelItem[],
  enabled: boolean
): DecorationSet {
  if (!enabled || !labels || labels.length === 0) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const totalLines = doc.lines;

  // Filter valid lines and sort ascending
  const valid = labels
    .filter((l) => l.line >= 1 && l.line <= totalLines && l.label)
    .sort((a, b) => a.line - b.line);

  const seenLines = new Set<number>();

  for (const item of valid) {
    if (seenLines.has(item.line)) continue;
    seenLines.add(item.line);

    try {
      const line = doc.line(item.line);
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new ClosingLabelWidget(item.label),
          side: 1,
        })
      );
    } catch {
      // Ignore if line out of bounds during rapid edit
    }
  }

  return builder.finish();
}

export interface ClosingLabelsState {
  enabled: boolean;
  labels: ClosingLabelItem[];
  decorations: DecorationSet;
}

export const closingLabelsField = StateField.define<ClosingLabelsState>({
  create(state) {
    const enabled = editorSettings.closingLabels;
    const labels = enabled ? extractClosingLabels(state.doc.toString()) : [];
    const decorations = buildClosingDecorations(state.doc, labels, enabled);
    return { enabled, labels, decorations };
  },

  update(current, tr) {
    let enabled = current.enabled;
    let labels = current.labels;
    let labelsChanged = false;

    // Check effects
    for (const effect of tr.effects) {
      if (effect.is(setClosingLabelsEnabledEffect)) {
        enabled = effect.value;
        labelsChanged = true;
      } else if (effect.is(setClosingLabelsEffect)) {
        if (effect.value !== null) {
          labels = effect.value;
          labelsChanged = true;
        }
      }
    }

    if (tr.docChanged) {
      if (enabled) {
        labels = extractClosingLabels(tr.state.doc.toString());
      } else {
        labels = [];
      }
      labelsChanged = true;
    }

    if (labelsChanged) {
      const decorations = buildClosingDecorations(tr.state.doc, labels, enabled);
      return { enabled, labels, decorations };
    }

    return current;
  },

  provide: (f) => EditorView.decorations.from(f, (val) => val.decorations),
});

/**
 * Creates the CodeMirror 6 closing labels extension.
 */
export function createClosingLabelsExtension(initialLabels?: ClosingLabelItem[]): Extension[] {
  return [
    closingLabelsField,
    closingLabelTheme,
  ];
}
