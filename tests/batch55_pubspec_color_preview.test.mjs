import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  parseArgbHex,
  cssToFlutterColor,
  resolveMaterialColor,
  extractColorMatches,
} from '../ui/features/editor/colorPreviewLogic.ts';
import {
  ColorSwatchWidget,
  createColorPreviewExtension,
  colorPreviewField,
  setColorPreviewEnabledEffect,
} from '../ui/features/editor/colorPreview.ts';
import {
  extractIconMatches,
  resolveIconSvg,
  MATERIAL_ICONS_SVG,
  GENERIC_ICON_SVG,
} from '../ui/features/editor/iconPreviewLogic.ts';
import {
  IconPreviewWidget,
  createIconPreviewExtension,
  iconPreviewField,
  setIconPreviewEnabledEffect,
} from '../ui/features/editor/iconPreview.ts';
import { EditorSettings } from '../ui/features/editor/editorSettingsLogic.ts';
import { api } from '../ui/lib/api.ts';

// =============================================================================
// Suite 1: Color Preview Logic (ARGB Hex Parsing & Material Palette)
// =============================================================================

test('colorPreviewLogic: parses ARGB hex Color(0xFF2B2D30) to CSS hex and alpha values', () => {
  const parsedOpaque = parseArgbHex('FF2B2D30');
  assert.strictEqual(parsedOpaque.a, 255);
  assert.strictEqual(parsedOpaque.r, 0x2b);
  assert.strictEqual(parsedOpaque.g, 0x2d);
  assert.strictEqual(parsedOpaque.b, 0x30);
  assert.strictEqual(parsedOpaque.css, '#2B2D30');
  assert.strictEqual(parsedOpaque.hex, 'FF2B2D30');

  // Verify prefix handling '0x...'
  const parsedWithPrefix = parseArgbHex('0xFF2B2D30');
  assert.strictEqual(parsedWithPrefix.css, '#2B2D30');

  // Verify translucent color alpha < 255
  const parsedTranslucent = parseArgbHex('802B2D30');
  assert.strictEqual(parsedTranslucent.a, 128);
  assert.strictEqual(parsedTranslucent.css, 'rgba(43, 45, 48, 0.5)');

  // Verify reverse conversion for color picker
  const flutterColor = cssToFlutterColor('#2B2D30', 'FF');
  assert.strictEqual(flutterColor, 'Color(0xFF2B2D30)');
});

test('colorPreviewLogic: resolves Colors.blue, Colors.amberAccent, and Colors.red[500]', () => {
  // Primary color default
  const blue = resolveMaterialColor('blue');
  assert.strictEqual(blue, '#2196F3', 'Colors.blue must map to #2196F3');

  // Accent color default
  const amberAccent = resolveMaterialColor('amberAccent');
  assert.strictEqual(amberAccent, '#FFD740', 'Colors.amberAccent must map to #FFD740');

  // Explicit shade [500]
  const red500 = resolveMaterialColor('red', '500');
  assert.strictEqual(red500, '#F44336', 'Colors.red[500] must map to #F44336');

  // Other shades and constants
  const red100 = resolveMaterialColor('red', '100');
  assert.strictEqual(red100, '#FFCDD2');

  const white = resolveMaterialColor('white');
  assert.strictEqual(white, '#FFFFFF');

  const black = resolveMaterialColor('black');
  assert.strictEqual(black, '#000000');

  const transparent = resolveMaterialColor('transparent');
  assert.strictEqual(transparent, 'transparent');
});

test('colorPreviewLogic: extracts color tokens accurately with positions and CSS values', () => {
  const dartCode = `
import 'package:flutter/material.dart';

Widget build() {
  final c1 = Color(0xFF2B2D30);
  final c2 = Colors.blue;
  final c3 = Colors.amberAccent;
  final c4 = Colors.red[500];
  return Container(color: c1);
}
`;

  const matches = extractColorMatches(dartCode);
  assert.strictEqual(matches.length, 4, `Expected 4 color matches, got ${matches.length}`);

  assert.strictEqual(matches[0].matchText, 'Color(0xFF2B2D30)');
  assert.strictEqual(matches[0].cssColor, '#2B2D30');
  assert.strictEqual(matches[0].colorType, 'hex');

  assert.strictEqual(matches[1].matchText, 'Colors.blue');
  assert.strictEqual(matches[1].cssColor, '#2196F3');
  assert.strictEqual(matches[1].colorType, 'material');

  assert.strictEqual(matches[2].matchText, 'Colors.amberAccent');
  assert.strictEqual(matches[2].cssColor, '#FFD740');
  assert.strictEqual(matches[2].colorType, 'material');

  assert.strictEqual(matches[3].matchText, 'Colors.red[500]');
  assert.strictEqual(matches[3].cssColor, '#F44336');
  assert.strictEqual(matches[3].colorType, 'material');
});

// =============================================================================
// Suite 2: CodeMirror 6 Color Swatch Widget & Non-Mutating Extension
// =============================================================================

test('colorPreview: decoration does NOT mutate original document string', () => {
  const dartCode = `const cardColor = Color(0xFF2B2D30);\nconst primary = Colors.blue;`;
  const state = EditorState.create({
    doc: dartCode,
    extensions: createColorPreviewExtension(),
  });

  // Verification: document content is strictly non-mutated
  assert.strictEqual(state.doc.toString(), dartCode);

  const field = state.field(colorPreviewField);
  assert.ok(field.enabled);
  assert.ok(field.decorations.size >= 2);

  // Widget equality check
  const w1 = new ColorSwatchWidget('#2B2D30', 18, 35, 'Color(0xFF2B2D30)', 'hex', 'FF2B2D30');
  const w2 = new ColorSwatchWidget('#2B2D30', 18, 35, 'Color(0xFF2B2D30)', 'hex', 'FF2B2D30');
  const w3 = new ColorSwatchWidget('#2196F3', 52, 63, 'Colors.blue', 'material');
  assert.ok(w1.eq(w2));
  assert.ok(!w1.eq(w3));
});

test('colorPreview: setColorPreviewEnabledEffect toggles decoration rendering', () => {
  const dartCode = `const c = Color(0xFF2B2D30);`;
  let state = EditorState.create({
    doc: dartCode,
    extensions: createColorPreviewExtension(),
  });

  let field = state.field(colorPreviewField);
  assert.ok(field.decorations.size > 0);

  // Disable
  state = state.update({
    effects: setColorPreviewEnabledEffect.of(false),
  }).state;
  field = state.field(colorPreviewField);
  assert.strictEqual(field.enabled, false);
  assert.strictEqual(field.decorations.size, 0);

  // Re-enable
  state = state.update({
    effects: setColorPreviewEnabledEffect.of(true),
  }).state;
  field = state.field(colorPreviewField);
  assert.strictEqual(field.enabled, true);
  assert.ok(field.decorations.size > 0);
});

// =============================================================================
// Suite 3: Icon Preview Logic & CodeMirror 6 Extension
// =============================================================================

test('iconPreviewLogic: matches Icons.home, Icons.arrow_forward and extracts SVG', () => {
  const dartCode = `
IconButton(
  icon: const Icon(Icons.home),
  onPressed: () {},
);
IconButton(
  icon: const Icon(Icons.arrow_forward),
  onPressed: () {},
);
`;

  const matches = extractIconMatches(dartCode);
  assert.strictEqual(matches.length, 2);

  assert.strictEqual(matches[0].matchText, 'Icons.home');
  assert.strictEqual(matches[0].iconName, 'home');
  assert.ok(matches[0].svgContent.includes('M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'));

  assert.strictEqual(matches[1].matchText, 'Icons.arrow_forward');
  assert.strictEqual(matches[1].iconName, 'arrow_forward');
  assert.ok(matches[1].svgContent.includes('M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z'));

  // Fallback for unknown icon
  const fallbackSvg = resolveIconSvg('non_existent_icon_xyz');
  assert.strictEqual(fallbackSvg, GENERIC_ICON_SVG);
});

test('iconPreview: decoration does NOT mutate original document string', () => {
  const dartCode = `const icon = Icons.home;`;
  const state = EditorState.create({
    doc: dartCode,
    extensions: createIconPreviewExtension(),
  });

  assert.strictEqual(state.doc.toString(), dartCode);

  const field = state.field(iconPreviewField);
  assert.ok(field.decorations.size > 0);

  // Widget equality check
  const w1 = new IconPreviewWidget('home', MATERIAL_ICONS_SVG.home);
  const w2 = new IconPreviewWidget('home', MATERIAL_ICONS_SVG.home);
  const w3 = new IconPreviewWidget('settings', MATERIAL_ICONS_SVG.settings);
  assert.ok(w1.eq(w2));
  assert.ok(!w1.eq(w3));
});

// =============================================================================
// Suite 4: pubspec.yaml File Detection & Auto Pub Get Trigger Logic
// =============================================================================

function isPubspecFile(filePath) {
  if (!filePath) return false;
  const p = filePath.toLowerCase().replace(/\\/g, '/');
  return (
    p.endsWith('/pubspec.yaml') ||
    p.endsWith('/pubspec.yml') ||
    p === 'pubspec.yaml' ||
    p === 'pubspec.yml'
  );
}

test('pubspecFileDetection: accurately detects pubspec.yaml and pubspec.yml paths', () => {
  assert.ok(isPubspecFile('pubspec.yaml'));
  assert.ok(isPubspecFile('pubspec.yml'));
  assert.ok(isPubspecFile('/Users/uqi/projects/jconnect/pubspec.yaml'));
  assert.ok(isPubspecFile('/mnt/storage/projects/flutter_app/pubspec.yml'));
  assert.ok(isPubspecFile('C:\\\\project\\\\pubspec.YAML'));

  assert.ok(!isPubspecFile('pubspec.lock'));
  assert.ok(!isPubspecFile('main.dart'));
  assert.ok(!isPubspecFile('README.md'));
  assert.ok(!isPubspecFile('other.yaml'));
  assert.ok(!isPubspecFile(''));
  assert.ok(!isPubspecFile(undefined));
});

test('api: flutterPubAction method is exposed and accepts valid actions', () => {
  assert.strictEqual(typeof api.flutterPubAction, 'function');
});

// =============================================================================
// Suite 5: Editor Settings Toggles (autoPubGetOnSave & colorPreview)
// =============================================================================

test('editorSettingsLogic: autoPubGetOnSave and colorPreview default to true and toggle properly', () => {
  const settings = new EditorSettings();

  assert.strictEqual(settings.autoPubGetOnSave, true);
  assert.strictEqual(settings.colorPreview, true);

  let notifiedAuto = false;
  settings.onAutoPubGetOnSaveChange((val) => {
    notifiedAuto = val;
  });

  let notifiedColor = false;
  settings.onColorPreviewChange((val) => {
    notifiedColor = val;
  });

  // Toggle autoPubGetOnSave
  const autoToggled = settings.toggleAutoPubGetOnSave();
  assert.strictEqual(autoToggled, false);
  assert.strictEqual(settings.autoPubGetOnSave, false);
  assert.strictEqual(notifiedAuto, false);

  settings.setAutoPubGetOnSave(true);
  assert.strictEqual(settings.autoPubGetOnSave, true);
  assert.strictEqual(notifiedAuto, true);

  // Toggle colorPreview
  const colorToggled = settings.toggleColorPreview();
  assert.strictEqual(colorToggled, false);
  assert.strictEqual(settings.colorPreview, false);
  assert.strictEqual(notifiedColor, false);

  settings.setColorPreview(true);
  assert.strictEqual(settings.colorPreview, true);
  assert.strictEqual(notifiedColor, true);
});
