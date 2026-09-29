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
import {
  SNIPPETS_BY_LANG,
  getSnippetCompletionsForLanguage,
  createSnippetCompletionSource,
} from '../ui/features/editor/snippets.ts';
import {
  createEditorKeyBindings,
  isVimInNormalOrVisualMode,
} from '../ui/features/editor/keymap.ts';

// Helper to create a minimal EditorView mock for headless unit testing
function createMockView(state, options = {}) {
  let currentState = state;
  const dispatch = (tr) => {
    if (typeof tr === 'function') {
      tr = tr(currentState);
    }
    if (tr && tr.state) {
      currentState = tr.state;
    } else if (tr) {
      currentState = currentState.update(tr);
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

test('snippets: provides built-in snippets for Dart, Kotlin, and Swift', () => {
  assert.ok(SNIPPETS_BY_LANG.dart.length >= 15, 'Dart should have at least 15 snippets');
  assert.ok(SNIPPETS_BY_LANG.kotlin.length >= 6, 'Kotlin should have at least 6 snippets');
  assert.ok(SNIPPETS_BY_LANG.swift.length >= 6, 'Swift should have at least 6 snippets');

  const dartLabels = SNIPPETS_BY_LANG.dart.map((s) => s.label);
  const requiredDart = [
    'stless',
    'stful',
    'stanim',
    'initS',
    'dis',
    'build',
    'mateapp',
    'cupapp',
    'sfw',
    'tryc',
    'fori',
    'foreach',
    'main',
    'print',
    'log',
    'futureb',
    'streamb',
  ];
  for (const label of requiredDart) {
    assert.ok(dartLabels.includes(label), `Missing Dart snippet: ${label}`);
  }

  const kotlinLabels = SNIPPETS_BY_LANG.kotlin.map((s) => s.label);
  const requiredKotlin = ['fun', 'main', 'class', 'dataclass', 'when', 'for'];
  for (const label of requiredKotlin) {
    assert.ok(kotlinLabels.includes(label), `Missing Kotlin snippet: ${label}`);
  }

  const swiftLabels = SNIPPETS_BY_LANG.swift.map((s) => s.label);
  const requiredSwift = ['func', 'guard', 'iflet', 'struct', 'class', 'main'];
  for (const label of requiredSwift) {
    assert.ok(swiftLabels.includes(label), `Missing Swift snippet: ${label}`);
  }
});

test('snippets: stful expands to synchronized StatefulWidget + State with tabstops', () => {
  const stfulDef = SNIPPETS_BY_LANG.dart.find((s) => s.label === 'stful');
  assert.ok(stfulDef, 'stful snippet must exist');

  // Verify template contains ${1:Name} in both class declaration and State declaration
  assert.match(stfulDef.template, /class \$\{1:Name\} extends StatefulWidget/);
  assert.match(stfulDef.template, /State<\$\{1:Name\}> createState\(\) => _\$\{1:Name\}State\(\);/);
  assert.match(stfulDef.template, /class _\$\{1:Name\}State extends State<\$\{1:Name\}>/);
  assert.match(stfulDef.template, /\$\{2:const Placeholder\(\)\}/);

  // Test expanding snippet with CodeMirror snippet engine
  const applyFn = snippet(stfulDef.template);
  let state = EditorState.create({
    doc: '',
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  const view = createMockView(state);

  applyFn(view, { label: 'stful' }, 0, 0);

  const expandedDoc = view.state.doc.toString();
  assert.ok(expandedDoc.includes('class Name extends StatefulWidget'));
  assert.ok(expandedDoc.includes('State<Name> createState() => _NameState();'));
  assert.ok(expandedDoc.includes('class _NameState extends State<Name>'));
  assert.ok(expandedDoc.includes('const Placeholder()'));

  // Initial tabstop: Name is selected across all synchronized instances (class + state)
  assert.equal(view.state.selection.ranges.length, 6);
  for (const range of view.state.selection.ranges) {
    assert.equal(view.state.sliceDoc(range.from, range.to), 'Name');
  }

  // Test synchronized editing: replacing Name with Counter updates all synchronized places!
  view.dispatch(view.state.update(view.state.replaceSelection('Counter')));
  const syncedDoc = view.state.doc.toString();
  assert.ok(syncedDoc.includes('class Counter extends StatefulWidget'));
  assert.ok(syncedDoc.includes('const Counter({super.key});'));
  assert.ok(syncedDoc.includes('State<Counter> createState() => _CounterState();'));
  assert.ok(syncedDoc.includes('class _CounterState extends State<Counter>'));

  // Check next tabstop moves to Placeholder
  assert.ok(hasNextSnippetField(view.state));
  const moved = nextSnippetField(view);
  assert.ok(moved);
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), 'const Placeholder()');
});

test('snippets: stless expands correctly with StatelessWidget and tabstop', () => {
  const stlessDef = SNIPPETS_BY_LANG.dart.find((s) => s.label === 'stless');
  assert.ok(stlessDef, 'stless snippet must exist');
  assert.match(stlessDef.template, /class \$\{1:Name\} extends StatelessWidget/);

  const applyFn = snippet(stlessDef.template);
  let state = EditorState.create({ doc: '' });
  const view = createMockView(state);

  applyFn(view, { label: 'stless' }, 0, 0);
  const expanded = view.state.doc.toString();
  assert.ok(expanded.includes('class Name extends StatelessWidget'));
  assert.ok(expanded.includes('const Name({super.key});'));
  assert.ok(expanded.includes('Widget build(BuildContext context)'));
});

test('snippet source: filters by filename extension (.dart, .kt, .swift)', () => {
  const dartSource = createSnippetCompletionSource(() => '/path/to/main.dart');
  const mockContextDart = {
    matchBefore: () => ({ from: 0, to: 2, text: 'st' }),
    explicit: false,
    pos: 2,
  };
  const dartRes = dartSource(mockContextDart);
  assert.ok(dartRes);
  assert.ok(dartRes.options.some((o) => o.label === 'stful'));
  assert.ok(dartRes.options.some((o) => o.label === 'stless'));

  const ktSource = createSnippetCompletionSource(() => '/path/to/app.kt');
  const mockContextKt = {
    matchBefore: () => ({ from: 0, to: 3, text: 'fun' }),
    explicit: false,
    pos: 3,
  };
  const ktRes = ktSource(mockContextKt);
  assert.ok(ktRes);
  assert.ok(ktRes.options.some((o) => o.label === 'fun'));
  assert.ok(ktRes.options.some((o) => o.label === 'dataclass'));

  const swiftSource = createSnippetCompletionSource(() => '/path/to/View.swift');
  const mockContextSwift = {
    matchBefore: () => ({ from: 0, to: 4, text: 'func' }),
    explicit: false,
    pos: 4,
  };
  const swiftRes = swiftSource(mockContextSwift);
  assert.ok(swiftRes);
  assert.ok(swiftRes.options.some((o) => o.label === 'func'));
  assert.ok(swiftRes.options.some((o) => o.label === 'guard'));

  const unsupportedSource = createSnippetCompletionSource(() => '/path/to/readme.md');
  assert.equal(unsupportedSource(mockContextDart), null);
});

test('keymap: Tab indents and always returns true (preventDefault) to retain focus', () => {
  const bindings = createEditorKeyBindings();
  const tabBinding = bindings.find((b) => b.key === 'Tab');
  assert.ok(tabBinding, 'Tab binding must exist');

  let state = EditorState.create({ doc: 'hello\nworld' });
  const view = createMockView(state);

  // Pressing Tab should indent and return true
  const handled = tabBinding.run(view);
  assert.equal(handled, true, 'Tab must always return true to prevent browser focus movement');
  // First line indented with 2 spaces
  assert.ok(view.state.doc.line(1).text.startsWith('  hello'));
});

test('keymap: Shift-Tab dedents and returns true', () => {
  const bindings = createEditorKeyBindings();
  const shiftTabBinding = bindings.find((b) => b.key === 'Shift-Tab');
  assert.ok(shiftTabBinding, 'Shift-Tab binding must exist');

  let state = EditorState.create({ doc: '  hello' });
  const view = createMockView(state);

  const handled = shiftTabBinding.run(view);
  assert.equal(handled, true, 'Shift-Tab must return true');
  assert.equal(view.state.doc.toString(), 'hello');
});

test('keymap: Enter returns false when no popup is open to allow normal newline', () => {
  const bindings = createEditorKeyBindings();
  const enterBinding = bindings.find((b) => b.key === 'Enter');
  assert.ok(enterBinding, 'Enter binding must exist');

  let state = EditorState.create({ doc: 'text' });
  const view = createMockView(state);

  const handled = enterBinding.run(view);
  assert.equal(handled, false, 'Enter must return false when completion popup is closed');
});

test('keymap: Escape returns false when no popup is open to allow Vim normal mode', () => {
  const bindings = createEditorKeyBindings();
  const escBinding = bindings.find((b) => b.key === 'Escape');
  assert.ok(escBinding, 'Escape binding must exist');

  let state = EditorState.create({ doc: 'text' });
  const view = createMockView(state);

  const handled = escBinding.run(view);
  assert.equal(handled, false, 'Escape must return false when completion popup is closed');
});

test('keymap: Vim normal mode detection lets Vim handle Tab and Shift-Tab', () => {
  const bindings = createEditorKeyBindings();
  const tabBinding = bindings.find((b) => b.key === 'Tab');
  const shiftTabBinding = bindings.find((b) => b.key === 'Shift-Tab');

  // Mock Vim in normal mode (insertMode: false)
  const normalVimState = {
    vim: { insertMode: false, mode: 'normal' },
  };
  let state = EditorState.create({ doc: 'text' });
  const normalView = createMockView(state, { cm: { state: normalVimState } });

  assert.equal(isVimInNormalOrVisualMode(normalView), true);
  // Tab should return false in normal mode so Vim handles it
  assert.equal(tabBinding.run(normalView), false);
  assert.equal(shiftTabBinding.run(normalView), false);

  // Mock Vim in insert mode (insertMode: true)
  const insertVimState = {
    vim: { insertMode: true, mode: 'insert' },
  };
  const insertView = createMockView(state, { cm: { state: insertVimState } });

  assert.equal(isVimInNormalOrVisualMode(insertView), false);
  // Tab should return true and indent in insert mode
  assert.equal(tabBinding.run(insertView), true);
  assert.ok(insertView.state.doc.toString().startsWith('  text'));
});

test('keymap: IME composition prevents consuming Enter or Tab', () => {
  const bindings = createEditorKeyBindings();
  const tabBinding = bindings.find((b) => b.key === 'Tab');
  const enterBinding = bindings.find((b) => b.key === 'Enter');

  let state = EditorState.create({ doc: 'text' });
  const composingView = createMockView(state, { composing: true });

  assert.equal(tabBinding.run(composingView), false);
  assert.equal(enterBinding.run(composingView), false);
});
