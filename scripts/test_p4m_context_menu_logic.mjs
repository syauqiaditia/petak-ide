import assert from 'node:assert';
import { placeMenu, placeSubmenu, calculateSubmenuHeight } from '../ui/shell/menuPos.ts';
import {
  getRelativePath,
  canCopyPackageImport,
  formatCopyPath,
  makeDuplicateName,
  getMenuCapabilities,
  canCloseOthers,
  canCloseToRight,
  getCloseOthersPaths,
  getCloseToRightPaths,
} from '../ui/shell/contextMenuLogic.ts';

console.log('=== Running Petak P4.M Context Menu Logic Tests ===');

// 1. placeMenu positioning & boundary flips
{
  const menu = { w: 240, h: 300 };
  const viewport = { w: 1024, h: 768 };

  // Case A: normal position
  const p1 = placeMenu({ x: 100, y: 100 }, menu, viewport);
  assert.strictEqual(p1.x, 102); // 100 + 2
  assert.strictEqual(p1.y, 102); // 100 + 2
  console.log('✓ placeMenu normal offset (+2, +2) verified');

  // Case B: flip horizontally (near right edge)
  // viewport.w = 1024; click at 900 -> 902 + 240 = 1142 > 1016 -> flip: 900 - 240 - 2 = 658
  const p2 = placeMenu({ x: 900, y: 100 }, menu, viewport);
  assert.strictEqual(p2.x, 658);
  assert.strictEqual(p2.y, 102);
  console.log('✓ placeMenu horizontal flip verified');

  // Case C: flip vertically (near bottom edge)
  // viewport.h = 768; click at 600 -> 602 + 300 = 902 > 760 -> flip: 600 - 300 - 2 = 298
  const p3 = placeMenu({ x: 100, y: 600 }, menu, viewport);
  assert.strictEqual(p3.x, 102);
  assert.strictEqual(p3.y, 298);
  console.log('✓ placeMenu vertical flip verified');

  // Case D: corner flip (both horizontal and vertical)
  const p4 = placeMenu({ x: 950, y: 700 }, menu, viewport);
  assert.strictEqual(p4.x, 950 - 240 - 2);
  assert.strictEqual(p4.y, 700 - 300 - 2);
  console.log('✓ placeMenu corner flip (both X and Y) verified');

  // Case E: clamping when flipped goes negative
  const p5 = placeMenu({ x: 100, y: 700 }, { w: 240, h: 750 }, viewport);
  assert.strictEqual(p5.y, 8); // clamped to 8
  console.log('✓ placeMenu viewport boundary clamping (>= 8) verified');
}

// 2. placeSubmenu
{
  const parent = { x: 200, y: 150, w: 240, h: 300 };
  const subMenu = { w: 200, h: 180 };
  const viewport = { w: 1024, h: 768 };

  // Case A: normal cascading to the right
  const s1 = placeSubmenu(parent, 180, subMenu, viewport);
  assert.strictEqual(s1.x, 200 + 240 - 4); // 436
  assert.strictEqual(s1.y, 180 - 4); // 176
  console.log('✓ placeSubmenu normal cascading verified');

  // Case B: horizontal overflow flipping to left of parent
  const parentNearRight = { x: 800, y: 150, w: 240, h: 300 };
  const s2 = placeSubmenu(parentNearRight, 180, subMenu, viewport);
  assert.strictEqual(s2.x, 800 - 200 + 4); // 604
  console.log('✓ placeSubmenu horizontal flip to left verified');

  // Case C: vertical overflow clamped to bottom
  const s3 = placeSubmenu(parent, 700, subMenu, viewport);
  assert.strictEqual(s3.y, 768 - 180 - 8); // 580
  console.log('✓ placeSubmenu vertical clamp verified');

  // Case D: calculateSubmenuHeight dynamic calculation
  assert.strictEqual(calculateSubmenuHeight([]), 12);
  // Git submenu: 9 items + 2 separators = 9 * 26 + 2 * 9 + 12 = 264px
  const gitSubmenuItems = [
    { label: 'Show Diff' },
    { label: 'Compare with Branch…' },
    { label: 'Compare with Revision…' },
    { label: 'Show History' },
    { label: 'Annotate / Blame' },
    { separator: true },
    { label: 'Add to VCS' },
    { label: 'Commit File…' },
    { label: 'Rollback Changes…' },
    { separator: true },
    { label: 'Add to .gitignore' },
  ];
  const gitH = calculateSubmenuHeight(gitSubmenuItems);
  assert.strictEqual(gitH, 264);
  console.log('✓ calculateSubmenuHeight for Git submenu (9 items, 2 separators) = 264px verified');

  // Case E: Git submenu near bottom avoids clipping with dynamic height
  // itemTop at 550; with old h=200 it wouldn't shift (546 + 200 = 746 <= 760)
  // With dynamic h=264: 546 + 264 = 810 > 760, shifts up to 768 - 264 - 8 = 496!
  const sGit = placeSubmenu(parent, 550, { w: 220, h: gitH }, viewport);
  assert.strictEqual(sGit.y, 768 - 264 - 8); // 496
  assert.ok(sGit.y + gitH <= viewport.h - 8, 'Git submenu bottom fits within viewport boundary');
  console.log('✓ Git submenu boundary detection with dynamic height prevents clipping verified');
}

// 3. contextMenuLogic: Menu capabilities
{
  // Single file, in git repo
  const capSingle = getMenuCapabilities({
    selectedCount: 1,
    isFolder: false,
    isRepo: true,
    clipboardHasContent: false,
    areAllFiles: true,
  });
  assert.strictEqual(capSingle.showMultiHeader, false);
  assert.strictEqual(capSingle.canRename, true);
  assert.strictEqual(capSingle.canDuplicate, true);
  assert.strictEqual(capSingle.canPaste, false); // cannot paste on file
  assert.strictEqual(capSingle.canFindInFolder, false);
  assert.strictEqual(capSingle.compareMode, 'single');
  assert.strictEqual(capSingle.gitVisible, true);
  console.log('✓ getMenuCapabilities single file verified');

  // Single folder, not a git repo
  const capFolder = getMenuCapabilities({
    selectedCount: 1,
    isFolder: true,
    isRepo: false,
    clipboardHasContent: true,
    areAllFiles: false,
  });
  assert.strictEqual(capFolder.canRename, true);
  assert.strictEqual(capFolder.canDuplicate, false); // cannot duplicate folder via simple action
  assert.strictEqual(capFolder.canPaste, true); // can paste in folder
  assert.strictEqual(capFolder.canFindInFolder, true);
  assert.strictEqual(capFolder.compareMode, 'none');
  assert.strictEqual(capFolder.gitVisible, false); // hidden when not a repo
  console.log('✓ getMenuCapabilities single folder & non-repo verified');

  // Multi-selection (3 items)
  const capMulti3 = getMenuCapabilities({
    selectedCount: 3,
    isFolder: false,
    isRepo: true,
    clipboardHasContent: false,
    areAllFiles: true,
  });
  assert.strictEqual(capMulti3.showMultiHeader, true);
  assert.strictEqual(capMulti3.multiHeaderLabel, '3 items selected');
  assert.strictEqual(capMulti3.canRename, false);
  assert.strictEqual(capMulti3.renameDisabledReason, 'Cannot rename multiple items at once');
  assert.strictEqual(capMulti3.compareMode, 'none');
  console.log('✓ getMenuCapabilities multi-selection (3 items) verified');

  // Exactly 2 files selected -> compare_two enabled
  const capTwoFiles = getMenuCapabilities({
    selectedCount: 2,
    isFolder: false,
    isRepo: true,
    clipboardHasContent: false,
    areAllFiles: true,
  });
  assert.strictEqual(capTwoFiles.compareMode, 'compare_two');
  console.log('✓ getMenuCapabilities compare 2 files verified');

  // 2 items selected, but one is a folder -> compare none
  const capMixedTwo = getMenuCapabilities({
    selectedCount: 2,
    isFolder: false,
    isRepo: true,
    clipboardHasContent: false,
    areAllFiles: false,
  });
  assert.strictEqual(capMixedTwo.compareMode, 'none');
  console.log('✓ getMenuCapabilities 2 items mixed with folder disables compare');
}

// 4. Copy Path formatting
{
  const root = '/Users/uqi/Projects/jconnect';
  const fileDart = '/Users/uqi/Projects/jconnect/lib/features/auth/login_screen.dart';

  assert.strictEqual(getRelativePath(fileDart, root), 'lib/features/auth/login_screen.dart');
  assert.strictEqual(formatCopyPath('absolute', fileDart, root), fileDart);
  assert.strictEqual(
    formatCopyPath('relative', fileDart, root),
    'lib/features/auth/login_screen.dart'
  );
  assert.strictEqual(formatCopyPath('name', fileDart, root), 'login_screen.dart');
  assert.strictEqual(formatCopyPath('stem', fileDart, root), 'login_screen');
  assert.strictEqual(
    formatCopyPath('line', fileDart, root, 42),
    'lib/features/auth/login_screen.dart:42'
  );
  assert.strictEqual(
    formatCopyPath('package', fileDart, root, undefined, 'jconnect_app'),
    "import 'package:jconnect_app/features/auth/login_screen.dart';"
  );
  assert.strictEqual(canCopyPackageImport('lib/features/auth/login_screen.dart'), true);
  assert.strictEqual(canCopyPackageImport('test/widget_test.dart'), false);
  console.log('✓ formatCopyPath and package import formatter verified');
}

// 5. makeDuplicateName helper
{
  assert.strictEqual(makeDuplicateName('main.dart'), 'main copy.dart');
  assert.strictEqual(makeDuplicateName('styles.module.css'), 'styles.module copy.css');
  assert.strictEqual(makeDuplicateName('temp_folder'), 'temp_folder copy');
  console.log('✓ makeDuplicateName verified');
}

// 6. Tab close logic
{
  assert.strictEqual(canCloseOthers(1), false);
  assert.strictEqual(canCloseOthers(3), true);

  assert.strictEqual(canCloseToRight(0, 3), true);
  assert.strictEqual(canCloseToRight(2, 3), false);

  const tabs = [
    { path: '/a.dart' },
    { path: '/b.dart' },
    { path: '/c.dart' },
    { path: '/d.dart' },
  ];

  const others = getCloseOthersPaths('/b.dart', tabs);
  assert.deepStrictEqual(others, ['/a.dart', '/c.dart', '/d.dart']);

  const rightOfB = getCloseToRightPaths(1, tabs);
  assert.deepStrictEqual(rightOfB, ['/c.dart', '/d.dart']);

  const rightOfD = getCloseToRightPaths(3, tabs);
  assert.deepStrictEqual(rightOfD, []);

  console.log('✓ Tab close logic (canCloseOthers, canCloseToRight, paths) verified');
}

console.log('=== All Petak P4.M Context Menu Logic Tests Passed Successfully ===');
