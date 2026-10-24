import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EditorState } from '@codemirror/state';
import {
  extractClosingLabels,
  convertLspClosingLabels,
} from '../ui/features/editor/closingLabelsLogic.ts';
import {
  ClosingLabelWidget,
  createClosingLabelsExtension,
  closingLabelsField,
  setClosingLabelsEffect,
  setClosingLabelsEnabledEffect,
} from '../ui/features/editor/closingLabels.ts';
import { EditorSettings } from '../ui/features/editor/editorSettingsLogic.ts';

// =============================================================================
// Suite 1: Client Dart AST / Token Scanner (extractClosingLabels)
// =============================================================================

test('extractClosingLabels: detects nested Flutter widget tree constructors', () => {
  const sampleDart = `import 'package:flutter/material.dart';

class HomeScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Petak Closing Labels'),
      ),
      body: Center(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Consumer<AuthViewModel>(
                builder: (context, vm, child) => Text(
                  'User: \${vm.user}',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
`;

  const labels = extractClosingLabels(sampleDart);

  // Line numbers in sampleDart:
  // line 6:  return Scaffold(
  // line 7:    appBar: AppBar(
  // line 8:      title: const Text('Petak Closing Labels'),  <-- single line, ignored
  // line 9:    ),                                            <-- closes AppBar
  // line 10:   body: Center(
  // line 11:     child: Column(
  // line 13:         Padding(
  // line 14:           padding: const EdgeInsets.all(16.0),  <-- single line, ignored
  // line 15:           child: Consumer<AuthViewModel>(
  // line 16:             builder: (context, vm, child) => Text(
  // line 18:             ),                                   <-- closes Text
  // line 19:           ),                                     <-- closes Consumer<AuthViewModel>
  // line 20:         ),                                       <-- closes Padding
  // line 22:     ),                                         <-- closes Column
  // line 23:   ),                                           <-- closes Center
  // line 24: );                                             <-- closes Scaffold

  assert.ok(labels.length >= 6, `Expected at least 6 closing labels, got ${labels.length}`);

  const labelsMap = new Map(labels.map((l) => [l.line, l.label]));

  assert.strictEqual(labelsMap.get(9), 'AppBar');
  assert.strictEqual(labelsMap.get(18), 'Text');
  assert.strictEqual(labelsMap.get(19), 'Consumer<AuthViewModel>');
  assert.strictEqual(labelsMap.get(20), 'Padding');
  assert.strictEqual(labelsMap.get(22), 'Column');
  assert.strictEqual(labelsMap.get(23), 'Center');
  assert.strictEqual(labelsMap.get(24), 'Scaffold');
});

test('extractClosingLabels: ignores single-line widget constructors', () => {
  const singleLineDart = `
Widget build(BuildContext context) {
  const a = SizedBox(width: 8);
  const b = Text('Single Line');
  final c = Container(color: Colors.red);
  return SizedBox.shrink();
}
`;

  const labels = extractClosingLabels(singleLineDart);
  assert.strictEqual(labels.length, 0, 'Single-line constructors must not emit closing labels');
});

test('extractClosingLabels: ignores lowercase functions, control flow, and comments', () => {
  const mixedDart = `
void test() {
  // Scaffold(
  //   commented: true,
  // )
  /*
  Padding(
    blocked: true,
  )
  */
  if (true) {
    setState(() {
      print('hello');
    });
  }
}
`;

  const labels = extractClosingLabels(mixedDart);
  assert.strictEqual(labels.length, 0, 'Comments and lowercase calls must not emit closing labels');
});

// =============================================================================
// Suite 2: Dart LSP publishClosingLabels Converter
// =============================================================================

test('convertLspClosingLabels: converts 0-based LSP lines to 1-based editor lines', () => {
  const lspPayload = [
    {
      label: 'Scaffold',
      range: {
        start: { line: 5, character: 11 },
        end: { line: 23, character: 5 },
      },
    },
    {
      label: 'Center',
      range: {
        start: { line: 9, character: 12 },
        end: { line: 22, character: 7 },
      },
    },
    {
      label: 'SingleLineWidget',
      range: {
        start: { line: 12, character: 4 },
        end: { line: 12, character: 25 },
      },
    },
  ];

  const converted = convertLspClosingLabels(lspPayload);

  // SingleLineWidget on line 12 start and end must be ignored
  assert.strictEqual(converted.length, 2);

  assert.strictEqual(converted[0].line, 23); // end.line 22 + 1
  assert.strictEqual(converted[0].label, 'Center');

  assert.strictEqual(converted[1].line, 24); // end.line 23 + 1
  assert.strictEqual(converted[1].label, 'Scaffold');
});

test('convertLspClosingLabels: handles null or malformed items gracefully', () => {
  assert.deepStrictEqual(convertLspClosingLabels(null), []);
  assert.deepStrictEqual(convertLspClosingLabels([]), []);
  assert.deepStrictEqual(
    convertLspClosingLabels([
      null,
      {},
      { range: null, label: 'Invalid' },
      { range: { end: null }, label: 'Invalid' },
    ]),
    []
  );
});

// =============================================================================
// Suite 3: CodeMirror 6 Decoration & Non-Mutating Document Guarantee
// =============================================================================

test('closingLabels: decoration widget renders muted label and does NOT mutate document', () => {
  const docText = `Scaffold(
  body: Center(
    child: Text(
      'Parity',
    ),
  ),
);`;

  const state = EditorState.create({
    doc: docText,
    extensions: createClosingLabelsExtension(),
  });

  // 1. Verify document text is 100% identical (strictly non-mutating)
  assert.strictEqual(
    state.doc.toString(),
    docText,
    'CodeMirror document string must remain strictly identical to source'
  );

  // 2. Check closingLabelsField decorations
  const fieldVal = state.field(closingLabelsField);
  assert.ok(fieldVal, 'closingLabelsField must be populated');
  assert.strictEqual(fieldVal.enabled, true);
  assert.ok(fieldVal.labels.length >= 3, 'Must have at least 3 labels');

  // Verify ClosingLabelWidget DOM rendering
  const widget = new ClosingLabelWidget('Scaffold');
  assert.strictEqual(widget.label, 'Scaffold');
  const dom = widget.toDOM();
  assert.strictEqual(dom.className, 'cm-flutter-closing-label');
  assert.strictEqual(dom.textContent, '// Scaffold');
  assert.ok(
    dom.style.color === '#70747e' || dom.style.color === 'rgb(112, 116, 126)',
    'Color must be muted slate grey #70747e'
  );
  assert.strictEqual(dom.style.userSelect, 'none');
  assert.strictEqual(dom.style.pointerEvents, 'none');
});

test('closingLabels: setClosingLabelsEffect overrides labels without mutating doc', () => {
  const docText = `Container(\n  child: Text(\n    'Hi',\n  ),\n);`;

  let state = EditorState.create({
    doc: docText,
    extensions: createClosingLabelsExtension(),
  });

  const customLspLabels = [
    { line: 4, label: 'Text' },
    { line: 5, label: 'Container' },
  ];

  state = state.update({
    effects: setClosingLabelsEffect.of(customLspLabels),
  }).state;

  assert.strictEqual(state.doc.toString(), docText);
  const fieldVal = state.field(closingLabelsField);
  assert.deepStrictEqual(fieldVal.labels, customLspLabels);
});

// =============================================================================
// Suite 4: Editor Settings Toggle
// =============================================================================

test('editorSettingsLogic: closingLabels defaults to true and toggles properly', () => {
  const settings = new EditorSettings();

  assert.strictEqual(settings.closingLabels, true, 'closingLabels must default to true');

  let notifiedValue = null;
  const unlisten = settings.onClosingLabelsChange((enabled) => {
    notifiedValue = enabled;
  });

  // Toggle off
  const turnedOff = settings.toggleClosingLabels();
  assert.strictEqual(turnedOff, false);
  assert.strictEqual(settings.closingLabels, false);
  assert.strictEqual(notifiedValue, false);

  // Toggle on
  const turnedOn = settings.toggleClosingLabels();
  assert.strictEqual(turnedOn, true);
  assert.strictEqual(settings.closingLabels, true);
  assert.strictEqual(notifiedValue, true);

  unlisten();
});

// =============================================================================
// Suite 5: Rust Dart LSP InitializationOptions & Notification Event Parity
// =============================================================================

test('Rust Dart LSP: registry.rs specifies closingLabels in initialization_options', () => {
  const registryPath = path.resolve('crates/core/src/lsp/registry.rs');
  const content = fs.readFileSync(registryPath, 'utf8');

  assert.ok(
    content.includes('"closingLabels": true'),
    'crates/core/src/lsp/registry.rs must contain "closingLabels": true under Lang::Dart initialization_options'
  );
});

test('Rust App: lib.rs emits lsp-closing-labels on dart/textDocument/publishClosingLabels', () => {
  const libPath = path.resolve('crates/app/src/lib.rs');
  const content = fs.readFileSync(libPath, 'utf8');

  assert.ok(
    content.includes('dart/textDocument/publishClosingLabels'),
    'crates/app/src/lib.rs must handle dart/textDocument/publishClosingLabels notification'
  );
  assert.ok(
    content.includes('"lsp-closing-labels"'),
    'crates/app/src/lib.rs must emit "lsp-closing-labels" Tauri event'
  );
});
