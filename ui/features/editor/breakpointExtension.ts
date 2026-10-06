import {
  gutter,
  GutterMarker,
  EditorView,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import {
  StateField,
  StateEffect,
  RangeSet,
  RangeSetBuilder,
  type Extension,
} from '@codemirror/state';
import { breakpointStore } from './breakpoints.svelte';
import { gitStore } from '../git/git.svelte';

export const toggleBreakpointEffect = StateEffect.define<{ line: number }>();
export const setBreakpointsEffect = StateEffect.define<number[]>();

class BreakpointDotMarker extends GutterMarker {
  toDOM() {
    const dot = document.createElement('div');
    dot.className = 'cm-breakpoint-dot';
    dot.title = 'Breakpoint (Klik untuk menghapus)';
    return dot;
  }
}

const dotMarker = new BreakpointDotMarker();

export const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(markers, tr) {
    markers = markers.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBreakpointsEffect)) {
        const builder = new RangeSetBuilder<GutterMarker>();
        const sorted = [...e.value].sort((a, b) => a - b);
        for (const lineNum of sorted) {
          if (lineNum >= 1 && lineNum <= tr.state.doc.lines) {
            const line = tr.state.doc.line(lineNum);
            builder.add(line.from, line.from, dotMarker);
          }
        }
        markers = builder.finish();
      } else if (e.is(toggleBreakpointEffect)) {
        const lineNum = Math.min(e.value.line, tr.state.doc.lines);
        if (lineNum < 1) continue;
        const line = tr.state.doc.line(lineNum);

        let hasExisting = false;
        markers.between(line.from, line.from, () => {
          hasExisting = true;
        });

        const builder = new RangeSetBuilder<GutterMarker>();
        if (hasExisting) {
          markers.between(0, tr.state.doc.length, (from, to, val) => {
            if (from !== line.from) {
              builder.add(from, to, val);
            }
          });
        } else {
          let added = false;
          markers.between(0, tr.state.doc.length, (from, to, val) => {
            if (!added && from > line.from) {
              builder.add(line.from, line.from, dotMarker);
              added = true;
            }
            builder.add(from, to, val);
          });
          if (!added) {
            builder.add(line.from, line.from, dotMarker);
          }
        }
        markers = builder.finish();
      }
    }
    return markers;
  },
});

// Line background highlight decoration on breakpoint lines
export const breakpointLineDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBreakpointsEffect) || e.is(toggleBreakpointEffect)) {
        // Rebuild from breakpointField in next cycle or current state
        const bpMarkers = tr.state.field(breakpointField, false);
        if (bpMarkers) {
          const builder = new RangeSetBuilder<Decoration>();
          bpMarkers.between(0, tr.state.doc.length, (from) => {
            builder.add(
              from,
              from,
              Decoration.line({ attributes: { class: 'cm-breakpoint-line-highlight' } })
            );
          });
          return builder.finish();
        }
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function createBreakpointExtension(getPath: () => string | null | undefined): Extension {
  const breakpointGutter = gutter({
    class: 'cm-breakpoint-gutter',
    markers: (view) => view.state.field(breakpointField),
    initialSpacer: () => dotMarker,
    domEventHandlers: {
      mousedown(view, line) {
        const lineNum = view.state.doc.lineAt(line.from).number;
        const path = getPath();
        if (path) {
          const added = breakpointStore.toggle(path, lineNum);
          view.dispatch({
            effects: toggleBreakpointEffect.of({ line: lineNum }),
          });
          gitStore.showToast(
            added
              ? `Breakpoint ditambahkan pada baris ${lineNum}`
              : `Breakpoint dihapus pada baris ${lineNum}`,
            { type: 'info' }
          );
        }
        return true;
      },
    },
  });

  return [breakpointField, breakpointGutter, breakpointLineDecoField];
}

/**
 * Toggle breakpoint at current cursor position (⌘F8)
 */
export function toggleBreakpointAtCursor(
  view: EditorView,
  getPath: () => string | null | undefined
): boolean {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const path = getPath();
  if (!path) return false;

  const added = breakpointStore.toggle(path, line.number);
  view.dispatch({
    effects: toggleBreakpointEffect.of({ line: line.number }),
  });
  gitStore.showToast(
    added
      ? `Breakpoint ditambahkan pada baris ${line.number}`
      : `Breakpoint dihapus pada baris ${line.number}`,
    { type: 'info' }
  );
  return true;
}
