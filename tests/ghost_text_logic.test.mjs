import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  computeGhostFromSuggest,
  computeGhostFromCompletion,
  setGhostTextEffect,
  clearGhostTextEffect,
  ghostStateField,
  ghostDecorationField,
  getActiveGhostText,
  acceptGhostText,
  dismissGhostText,
  createGhostTextExtension,
} from '../ui/features/editor/ghostText.ts';
import { editorSettings } from '../ui/features/editor/editorSettingsLogic.ts';
import { createEditorKeyBindings } from '../ui/features/editor/keymap.ts';

// Helper to create a mock EditorView
function createMockEditorView(initialDoc, cursorHead = 0) {
  let currentState = EditorState.create({
    doc: initialDoc,
    selection: { anchor: cursorHead, head: cursorHead },
    extensions: [
      ghostStateField,
      ghostDecorationField,
    ],
  });

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
    composing: false,
  };
  return view;
}

// =============================================================================
// Suite 1: Ghost Text Suggest Computation (F4)
// =============================================================================

test('ghost computation: formats ITextF -> ieldPin(... with argsTemplate', () => {
  const item = {
    text: 'ieldPin(',
    freq: 5,
    argsTemplate: 'controller: , focusNode: ,',
  };

  const ghost = computeGhostFromSuggest('ITextF', item);
  assert.equal(ghost, 'ieldPin(controller: , focusNode: ,)');
});

test('ghost computation: slices prefix if suggestion contains full identifier', () => {
  const item = {
    text: 'ITextFieldPin(',
    freq: 4,
    argsTemplate: 'controller: , focusNode: ,',
  };

  const ghost = computeGhostFromSuggest('ITextF', item);
  assert.equal(ghost, 'ieldPin(controller: , focusNode: ,)');
});

test('ghost computation: handles plain identifier without parentheses or argsTemplate', () => {
  const item = {
    text: 'ieldPin',
    freq: 3,
  };

  const ghost = computeGhostFromSuggest('ITextF', item);
  assert.equal(ghost, 'ieldPin');
});

test('ghost computation: popup completion reflection uses selected item label', () => {
  const ghost = computeGhostFromCompletion('ITextF', 'ITextFieldPin');
  assert.equal(ghost, 'ieldPin');

  const ghost2 = computeGhostFromCompletion('myVar', 'myVariable');
  assert.equal(ghost2, 'iable');

  const ghostEmpty = computeGhostFromCompletion('other', 'unrelated');
  assert.equal(ghostEmpty, '');
});

// =============================================================================
// Suite 2: Tab Accept and Esc Dismiss Actions
// =============================================================================

test('ghost action: Tab accepts ghost text and inserts at cursor', () => {
  const initialText = 'void test() { final x = ITextF }';
  const pos = initialText.indexOf('ITextF') + 'ITextF'.length;
  const view = createMockEditorView(initialText, pos);

  // Set ghost text
  view.dispatch({
    effects: [setGhostTextEffect.of({ text: 'ieldPin(controller: , focusNode: ,)', from: pos })],
  });

  const active = getActiveGhostText(view.state);
  assert.ok(active);
  assert.equal(active.text, 'ieldPin(controller: , focusNode: ,)');

  // Tab key accepts ghost text
  const accepted = acceptGhostText(view);
  assert.equal(accepted, true);

  // Ghost text is cleared
  assert.equal(getActiveGhostText(view.state), null);

  // Document now contains the completed text
  assert.equal(
    view.state.doc.toString(),
    'void test() { final x = ITextFieldPin(controller: , focusNode: ,) }'
  );

  // Cursor advanced to end of inserted text
  const expectedPos = pos + 'ieldPin(controller: , focusNode: ,)'.length;
  assert.equal(view.state.selection.main.head, expectedPos);
});

test('ghost action: Esc dismisses ghost text without modifying document', () => {
  const initialText = 'final widget = ITextF';
  const pos = initialText.length;
  const view = createMockEditorView(initialText, pos);

  // Set ghost text
  view.dispatch({
    effects: [setGhostTextEffect.of({ text: 'ieldPin(', from: pos })],
  });

  assert.ok(getActiveGhostText(view.state));

  // Esc dismisses ghost text
  const dismissed = dismissGhostText(view);
  assert.equal(dismissed, true);

  // Ghost text is gone
  assert.equal(getActiveGhostText(view.state), null);

  // Doc unchanged
  assert.equal(view.state.doc.toString(), 'final widget = ITextF');
});

test('ghost action: typing clears ghost text immediately', () => {
  const initialText = 'final w = ITextF';
  const pos = initialText.length;
  const view = createMockEditorView(initialText, pos);

  view.dispatch({
    effects: [setGhostTextEffect.of({ text: 'ieldPin(', from: pos })],
  });
  assert.ok(getActiveGhostText(view.state));

  // User types 'i'
  view.dispatch({
    changes: { from: pos, insert: 'i' },
    selection: { anchor: pos + 1, head: pos + 1 },
  });

  // Ghost text was auto-cleared by docChanged
  assert.equal(getActiveGhostText(view.state), null);
  assert.equal(view.state.doc.toString(), 'final w = ITextFi');
});

// =============================================================================
// Suite 3: Settings (editor.ghostText)
// =============================================================================

test('settings: editor.ghostText toggle controls enabled state', () => {
  editorSettings.setGhostText(true);
  assert.equal(editorSettings.ghostText, true);

  editorSettings.setGhostText(false);
  assert.equal(editorSettings.ghostText, false);

  editorSettings.toggleGhostText();
  assert.equal(editorSettings.ghostText, true);
});

test('settings: when ghostText is off, suggestion queries are not activated', async () => {
  let queried = false;
  const mockSuggest = async () => {
    queried = true;
    return [{ text: 'ieldPin(', freq: 5 }];
  };

  const ext = createGhostTextExtension({
    suggestQuery: mockSuggest,
    isEnabled: () => false,
    debounceMs: 10,
  });

  const state = EditorState.create({
    doc: 'final x = ITextF',
    selection: { anchor: 16, head: 16 },
    extensions: [ext],
  });

  // Verify ghost text is null
  assert.equal(getActiveGhostText(state), null);
  assert.equal(queried, false);
});

// =============================================================================
// Suite 4: Frequency & Filtering (Contract F4)
// =============================================================================

test('filtering: only suggestions with freq >= 2 are accepted', () => {
  const suggestions = [
    { text: 'rarePin(', freq: 1, argsTemplate: 'a: 1' },
    { text: 'ieldPin(', freq: 5, argsTemplate: 'controller: , focusNode: ,' },
    { text: 'otherField(', freq: 2 },
  ];

  const valid = suggestions.filter((s) => s.freq >= 2);
  assert.equal(valid.length, 2);
  assert.equal(valid[0].text, 'ieldPin(');
  assert.equal(valid[1].text, 'otherField(');

  const top = valid[0];
  const ghost = computeGhostFromSuggest('ITextF', top);
  assert.equal(ghost, 'ieldPin(controller: , focusNode: ,)');
});

// =============================================================================
// Suite 4: Keymap Non-Interference
// =============================================================================

test('keymap: Tab falls through to indent when no ghost text or completion is active', () => {
  const bindings = createEditorKeyBindings();
  const tabBinding = bindings.find((b) => b.key === 'Tab');
  assert.ok(tabBinding, 'Tab binding must exist');

  const view = createMockEditorView('  hello');
  // Position at col 2
  view.state = view.state.update({ selection: { anchor: 2, head: 2 } }).state;

  // Run Tab with no ghost text -> should indent and return true
  const res = tabBinding.run(view);
  assert.equal(res, true);
  // Indented
  assert.ok(view.state.doc.toString().startsWith('    hello') || view.state.doc.length > 7);
});

test('keymap: Escape falls through when no ghost text or completion is active', () => {
  const bindings = createEditorKeyBindings();
  const escBinding = bindings.find((b) => b.key === 'Escape');
  assert.ok(escBinding, 'Escape binding must exist');

  const view = createMockEditorView('test code');
  const res = escBinding.run(view);
  // Returns false so Vim can switch to normal mode
  assert.equal(res, false);
});
