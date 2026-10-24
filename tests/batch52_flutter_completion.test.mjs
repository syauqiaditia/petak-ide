import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import {
  snippet,
  hasNextSnippetField,
  nextSnippetField,
  hasPrevSnippetField,
  prevSnippetField,
} from '@codemirror/autocomplete';
import { registerKeymap } from '../ui/features/search/keymap.ts';
import { createEditorKeyBindings } from '../ui/features/editor/keymap.ts';
import {
  computeGhostFromSuggest,
  computeGhostFromCompletion,
  setGhostTextEffect,
  clearGhostTextEffect,
  ghostStateField,
  ghostDecorationField,
  getActiveGhostText,
  acceptGhostText,
  createGhostTextExtension,
} from '../ui/features/editor/ghostText.ts';

// Helper to create a minimal EditorView mock for testing
function createMockView(state, options = {}) {
  let currentState = state;
  const dispatch = (tr) => {
    if (typeof tr === 'function') {
      tr = tr(currentState);
    }
    if (tr && tr.state) {
      currentState = tr.state;
    } else if (tr) {
      currentState = currentState.update(tr).state;
    }
    view.state = currentState;
  };

  const view = {
    state: currentState,
    dispatch,
    composing: options.composing ?? false,
    cm: options.cm ?? null,
  };
  return view;
}

// =============================================================================
// Suite 1: Alt-Enter (Option-Enter) Unblock & Intention Triggering
// =============================================================================

test('Alt-Enter unblock: invokes showIntentions callback when provided and stops propagation', () => {
  let intentionsCalled = false;
  let prevented = false;
  let stopped = false;

  // Mock window event registration in Node environment
  const originalWindow = globalThis.window;
  const listeners = [];
  globalThis.window = {
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const idx = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (idx >= 0) listeners.splice(idx, 1);
    },
  };

  try {
    const unregister = registerKeymap({
      openPalette: () => {},
      closePalette: () => {},
      isPaletteOpen: () => false,
      showIntentions: () => {
        intentionsCalled = true;
      },
    });

    const keydownListener = listeners.find((l) => l.type === 'keydown')?.fn;
    assert.ok(keydownListener, 'Keydown listener must be registered');

    // Simulate Alt-Enter
    const fakeEvent = {
      altKey: true,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      key: 'Enter',
      code: 'Enter',
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    };

    keydownListener(fakeEvent);

    assert.equal(intentionsCalled, true, 'callbacks.showIntentions must be invoked');
    assert.equal(prevented, true, 'preventDefault should be called when handled');
    assert.equal(stopped, true, 'stopPropagation should be called when handled');

    unregister();
  } finally {
    globalThis.window = originalWindow;
  }
});

test('Alt-Enter unblock: does NOT swallow event when showIntentions callback is omitted', () => {
  let prevented = false;
  let stopped = false;

  const originalWindow = globalThis.window;
  const listeners = [];
  globalThis.window = {
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const idx = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (idx >= 0) listeners.splice(idx, 1);
    },
  };

  try {
    const unregister = registerKeymap({
      openPalette: () => {},
      closePalette: () => {},
      isPaletteOpen: () => false,
      // showIntentions omitted
    });

    const keydownListener = listeners.find((l) => l.type === 'keydown')?.fn;
    assert.ok(keydownListener, 'Keydown listener must be registered');

    // Simulate Option-Enter on macOS (key may be Enter or code Enter)
    const fakeEvent = {
      altKey: true,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      key: 'Enter',
      code: 'Enter',
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    };

    keydownListener(fakeEvent);

    assert.equal(
      prevented,
      false,
      'Must NOT call preventDefault when showIntentions is omitted (allow pass-through to editor)'
    );
    assert.equal(
      stopped,
      false,
      'Must NOT call stopPropagation when showIntentions is omitted (allow pass-through to editor)'
    );

    unregister();
  } finally {
    globalThis.window = originalWindow;
  }
});

// =============================================================================
// Suite 2: Autocomplete Dropdown & Ghost Text Cleanup
// =============================================================================

test('ghost text cleanup: ghost text is cleared when autocomplete or snippet is active', () => {
  let state = EditorState.create({
    doc: 'void main() { final x = ITextF }',
    selection: { anchor: 30, head: 30 },
    extensions: [ghostStateField, ghostDecorationField],
  });
  const view = createMockView(state);

  // Set an active ghost text
  view.dispatch({
    effects: [setGhostTextEffect.of({ text: 'ieldPin()', from: 30 })],
  });
  assert.ok(getActiveGhostText(view.state), 'Ghost text should be set');

  // Clear ghost text
  view.dispatch({
    effects: [clearGhostTextEffect.of()],
  });
  assert.equal(getActiveGhostText(view.state), null, 'Ghost text must be null after clearing');
});

// =============================================================================
// Suite 3: Constructor Snippets & LSP insertTextFormat: 2 Expansion
// =============================================================================

test('snippets: insertTextFormat 2 expands constructor snippet with parameter tabstops', () => {
  // Dart LSP sends templates like "ITextField(${1:controller: $2, }focusNode: ${3:node})"
  const constructorSnippet = 'ITextField(controller: ${1:ctrl}, focusNode: ${2:focus})';
  const applySnippet = snippet(constructorSnippet);

  let state = EditorState.create({
    doc: 'final widget = ',
    selection: { anchor: 15, head: 15 },
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  const view = createMockView(state);

  // Apply snippet at cursor pos 15
  applySnippet(view, { label: 'ITextField' }, 15, 15);

  const doc = view.state.doc.toString();
  assert.equal(doc, 'final widget = ITextField(controller: ctrl, focusNode: focus)');

  // Tabstop 1 should select "ctrl"
  assert.ok(hasNextSnippetField(view.state));
  const selText = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  assert.equal(selText, 'ctrl', 'First tabstop must select default parameter value "ctrl"');

  // Pressing next snippet field moves to Tabstop 2 "focus"
  const moved = nextSnippetField(view);
  assert.ok(moved, 'Should move to next snippet field');
  const selText2 = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  assert.equal(selText2, 'focus', 'Second tabstop must select "focus"');
});

// =============================================================================
// Suite 4: Tab Key Prioritization (Snippet Navigation > Ghost Text > Indent)
// =============================================================================

test('keymap: Tab advances snippet tabstop before ghost text or fallback indent', () => {
  const bindings = createEditorKeyBindings();
  const tabBinding = bindings.find((b) => b.key === 'Tab');
  assert.ok(tabBinding, 'Tab binding must exist');

  // Create state with snippet template
  const applySnippet = snippet('testFunc(${1:arg1}, ${2:arg2})');
  let state = EditorState.create({
    doc: '',
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      ghostStateField,
      ghostDecorationField,
    ],
  });
  const view = createMockView(state);

  // Expand snippet
  applySnippet(view, { label: 'testFunc' }, 0, 0);
  assert.ok(hasNextSnippetField(view.state));

  // Even if ghost text was somehow active, Tab MUST jump to snippet field 2
  view.dispatch({
    effects: [setGhostTextEffect.of({ text: 'hijackText', from: view.state.selection.main.head })],
  });

  // Execute Tab
  const handled = tabBinding.run(view);
  assert.equal(handled, true, 'Tab must handle snippet navigation');

  // Current selection must now be "arg2" (second tabstop), NOT the ghost text insertion!
  const currentSel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  assert.equal(currentSel, 'arg2', 'Tab must navigate to next snippet tabstop "arg2"');
  assert.ok(
    !view.state.doc.toString().includes('hijackText'),
    'Ghost text must not hijack Tab navigation while inside snippet'
  );
});
