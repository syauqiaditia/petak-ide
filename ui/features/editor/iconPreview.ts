/**
 * CodeMirror 6 extension for Flutter Icon Previews (Batch 55).
 * Renders inline 14x14px SVG preview next to Icons.<name> tokens.
 */

import { StateEffect, StateField, RangeSetBuilder, type Extension } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet, WidgetType } from '@codemirror/view';
import { extractIconMatches, type IconMatchItem } from './iconPreviewLogic.ts';
import { editorSettings } from './editorSettingsLogic.ts';

export const setIconPreviewEnabledEffect = StateEffect.define<boolean>();

/**
 * Non-mutating inline 14x14px icon preview widget.
 */
export class IconPreviewWidget extends WidgetType {
  readonly iconName: string;
  readonly svgContent: string;

  constructor(iconName: string, svgContent: string) {
    super();
    this.iconName = iconName;
    this.svgContent = svgContent;
  }

  eq(other: IconPreviewWidget): boolean {
    return other.iconName === this.iconName;
  }

  toDOM(): HTMLElement {
    if (typeof document === 'undefined') {
      return {
        className: 'cm-flutter-icon-preview',
        style: {},
      } as unknown as HTMLElement;
    }

    const span = document.createElement('span');
    span.className = 'cm-flutter-icon-preview';
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.verticalAlign = 'middle';
    span.style.marginRight = '4px';
    span.style.lineHeight = '1';
    span.style.color = '#a9b7c6';
    span.style.opacity = '0.85';
    span.title = `Icon: Icons.${this.iconName}`;

    span.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">${this.svgContent}</svg>`;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Base styling for icon previews.
 */
export const iconPreviewTheme = EditorView.baseTheme({
  '.cm-flutter-icon-preview': {
    display: 'inline-flex',
    alignItems: 'center',
    verticalAlign: 'middle',
    marginRight: '4px',
    lineHeight: '1',
    color: '#a9b7c6',
    opacity: '0.85',
    userSelect: 'none',
    pointerEvents: 'none',
  },
});

function buildIconDecorations(doc: any, enabled: boolean): DecorationSet {
  if (!enabled) return Decoration.none;
  const text = doc.toString();
  const matches = extractIconMatches(text);
  if (matches.length === 0) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  for (const item of matches) {
    builder.add(
      item.from,
      item.from,
      Decoration.widget({
        widget: new IconPreviewWidget(item.iconName, item.svgContent),
        side: -1,
      })
    );
  }
  return builder.finish();
}

export interface IconPreviewState {
  enabled: boolean;
  decorations: DecorationSet;
}

export const iconPreviewField = StateField.define<IconPreviewState>({
  create(state) {
    const enabled = editorSettings.colorPreview;
    const decorations = buildIconDecorations(state.doc, enabled);
    return { enabled, decorations };
  },

  update(current, tr) {
    let enabled = current.enabled;
    let changed = false;

    for (const effect of tr.effects) {
      if (effect.is(setIconPreviewEnabledEffect)) {
        enabled = effect.value;
        changed = true;
      }
    }

    if (tr.docChanged) {
      changed = true;
    }

    if (changed) {
      const decorations = buildIconDecorations(tr.state.doc, enabled);
      return { enabled, decorations };
    }

    return current;
  },

  provide: (f) => EditorView.decorations.from(f, (val) => val.decorations),
});

/**
 * Creates the CodeMirror 6 icon preview extension.
 */
export function createIconPreviewExtension(): Extension[] {
  return [iconPreviewField, iconPreviewTheme];
}
