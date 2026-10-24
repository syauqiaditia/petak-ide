/**
 * CodeMirror 6 extension for Flutter Color Previews (Batch 55).
 * Renders inline 12x12px color swatches with interactive color picking.
 */

import { StateEffect, StateField, RangeSetBuilder, type Extension } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet, WidgetType } from '@codemirror/view';
import {
  extractColorMatches,
  cssToFlutterColor,
  type ColorMatchItem,
} from './colorPreviewLogic.ts';
import { editorSettings } from './editorSettingsLogic.ts';

export const setColorPreviewEnabledEffect = StateEffect.define<boolean>();

/**
 * Non-mutating inline 12x12px color swatch widget with click-to-pick interaction.
 */
export class ColorSwatchWidget extends WidgetType {
  readonly cssColor: string;
  readonly from: number;
  readonly to: number;
  readonly matchText: string;
  readonly colorType: 'hex' | 'material';
  readonly hexArgb?: string;

  constructor(
    cssColor: string,
    from: number,
    to: number,
    matchText: string,
    colorType: 'hex' | 'material',
    hexArgb?: string
  ) {
    super();
    this.cssColor = cssColor;
    this.from = from;
    this.to = to;
    this.matchText = matchText;
    this.colorType = colorType;
    this.hexArgb = hexArgb;
  }

  eq(other: ColorSwatchWidget): boolean {
    return (
      other.cssColor === this.cssColor &&
      other.from === this.from &&
      other.to === this.to &&
      other.matchText === this.matchText
    );
  }

  toDOM(view: EditorView): HTMLElement {
    if (typeof document === 'undefined') {
      return {
        className: 'cm-flutter-color-swatch-wrap',
        style: {},
      } as unknown as HTMLElement;
    }

    const wrap = document.createElement('span');
    wrap.className = 'cm-flutter-color-swatch-wrap';
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.verticalAlign = 'middle';
    wrap.style.marginRight = '4px';
    wrap.style.lineHeight = '1';

    const swatch = document.createElement('span');
    swatch.className = 'cm-flutter-color-swatch';
    swatch.style.display = 'inline-block';
    swatch.style.width = '12px';
    swatch.style.height = '12px';
    swatch.style.borderRadius = '2px';
    swatch.style.backgroundColor = this.cssColor;
    swatch.style.border = '1px solid rgba(255, 255, 255, 0.25)';
    swatch.style.boxShadow = '0 0 1px rgba(0, 0, 0, 0.5)';
    swatch.style.cursor = 'pointer';
    swatch.title = `Click to change color (${this.cssColor})`;

    // Native platform color input
    const input = document.createElement('input');
    input.type = 'color';
    let pickerVal = '#000000';
    if (this.cssColor.startsWith('#') && this.cssColor.length >= 7) {
      pickerVal = this.cssColor.substring(0, 7);
    }
    input.value = pickerVal;
    input.style.position = 'absolute';
    input.style.opacity = '0';
    input.style.width = '0';
    input.style.height = '0';
    input.style.pointerEvents = 'none';

    swatch.appendChild(input);

    swatch.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.click();
    });

    input.addEventListener('input', (e) => {
      const newHex = (e.target as HTMLInputElement).value; // #RRGGBB
      const alpha = this.hexArgb ? this.hexArgb.substring(0, 2) : 'FF';
      const replacement = cssToFlutterColor(newHex, alpha);

      const currentDoc = view.state.doc.toString();
      const currentSlice = currentDoc.slice(this.from, this.to);
      if (currentSlice === this.matchText) {
        view.dispatch({
          changes: { from: this.from, to: this.to, insert: replacement },
        });
      }
    });

    wrap.appendChild(swatch);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Base styling for color swatches.
 */
export const colorSwatchTheme = EditorView.baseTheme({
  '.cm-flutter-color-swatch-wrap': {
    display: 'inline-flex',
    alignItems: 'center',
    verticalAlign: 'middle',
    marginRight: '4px',
    lineHeight: '1',
  },
  '.cm-flutter-color-swatch': {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    borderRadius: '2px',
    border: '1px solid rgba(255, 255, 255, 0.25)',
    boxShadow: '0 0 1px rgba(0, 0, 0, 0.5)',
    cursor: 'pointer',
  },
});

function buildColorDecorations(doc: any, enabled: boolean): DecorationSet {
  if (!enabled) return Decoration.none;
  const text = doc.toString();
  const matches = extractColorMatches(text);
  if (matches.length === 0) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  for (const item of matches) {
    builder.add(
      item.from,
      item.from,
      Decoration.widget({
        widget: new ColorSwatchWidget(
          item.cssColor,
          item.from,
          item.to,
          item.matchText,
          item.colorType,
          item.hexArgb
        ),
        side: -1,
      })
    );
  }
  return builder.finish();
}

export interface ColorPreviewState {
  enabled: boolean;
  decorations: DecorationSet;
}

export const colorPreviewField = StateField.define<ColorPreviewState>({
  create(state) {
    const enabled = editorSettings.colorPreview;
    const decorations = buildColorDecorations(state.doc, enabled);
    return { enabled, decorations };
  },

  update(current, tr) {
    let enabled = current.enabled;
    let changed = false;

    for (const effect of tr.effects) {
      if (effect.is(setColorPreviewEnabledEffect)) {
        enabled = effect.value;
        changed = true;
      }
    }

    if (tr.docChanged) {
      changed = true;
    }

    if (changed) {
      const decorations = buildColorDecorations(tr.state.doc, enabled);
      return { enabled, decorations };
    }

    return current;
  },

  provide: (f) => EditorView.decorations.from(f, (val) => val.decorations),
});

/**
 * Creates the CodeMirror 6 color preview extension.
 */
export function createColorPreviewExtension(): Extension[] {
  return [colorPreviewField, colorSwatchTheme];
}
