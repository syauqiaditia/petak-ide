export type CopyPathMode =
  | 'absolute'
  | 'relative'
  | 'name'
  | 'stem'
  | 'line'
  | 'package';

/**
 * Extracts the relative path from root directory.
 */
export function getRelativePath(absPath: string, rootPath: string): string {
  if (!rootPath) return absPath;
  const normAbs = absPath.replace(/\\/g, '/');
  const normRoot = rootPath.replace(/\\/g, '/');
  if (normAbs.startsWith(normRoot)) {
    let rel = normAbs.slice(normRoot.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }
  return normAbs;
}

/**
 * Checks if a file qualifies for Dart 'package:' import syntax.
 */
export function canCopyPackageImport(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  return (norm.startsWith('lib/') || norm === 'lib') && norm.endsWith('.dart');
}

/**
 * Formats a file path according to the requested copy mode.
 */
export function formatCopyPath(
  mode: CopyPathMode,
  absPath: string,
  rootPath: string,
  line?: number,
  pubspecName?: string
): string {
  const normAbs = absPath.replace(/\\/g, '/');
  const leafName = normAbs.split('/').filter(Boolean).pop() || '';
  const relPath = getRelativePath(absPath, rootPath);

  switch (mode) {
    case 'absolute':
      return normAbs;

    case 'relative':
      return relPath;

    case 'name':
      return leafName;

    case 'stem': {
      const lastDot = leafName.lastIndexOf('.');
      return lastDot > 0 ? leafName.slice(0, lastDot) : leafName;
    }

    case 'line': {
      const lineNo = line && line > 0 ? line : 1;
      return `${relPath}:${lineNo}`;
    }

    case 'package': {
      const normRel = relPath.replace(/\\/g, '/');
      const prefix = 'lib/';
      const idx = normRel.indexOf(prefix);
      if (idx !== -1) {
        const afterLib = normRel.slice(idx + prefix.length);
        const pkg = (pubspecName || 'petak').trim();
        return `import 'package:${pkg}/${afterLib}';`;
      }
      return normRel;
    }

    default:
      return normAbs;
  }
}

/**
 * Generates duplicate name with ' copy' suffix.
 * e.g. "button.dart" -> "button copy.dart", "assets" -> "assets copy"
 */
export function makeDuplicateName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot > 0) {
    const stem = fileName.slice(0, lastDot);
    const ext = fileName.slice(lastDot);
    return `${stem} copy${ext}`;
  }
  return `${fileName} copy`;
}

export interface MenuCapabilitiesParams {
  selectedCount: number;
  isFolder: boolean;
  isRepo: boolean;
  clipboardHasContent: boolean;
  areAllFiles: boolean;
}

export interface MenuCapabilities {
  showMultiHeader: boolean;
  multiHeaderLabel?: string;
  canRename: boolean;
  renameDisabledReason?: string;
  canDuplicate: boolean;
  canPaste: boolean;
  canFindInFolder: boolean;
  compareMode: 'single' | 'compare_two' | 'none';
  gitVisible: boolean;
}

/**
 * Computes context menu item capabilities and visibility flags.
 */
export function getMenuCapabilities(params: MenuCapabilitiesParams): MenuCapabilities {
  const isMulti = params.selectedCount > 1;

  let compareMode: 'single' | 'compare_two' | 'none' = 'none';
  if (params.selectedCount === 2 && params.areAllFiles) {
    compareMode = 'compare_two';
  } else if (params.selectedCount === 1 && !params.isFolder) {
    compareMode = 'single';
  }

  return {
    showMultiHeader: isMulti,
    multiHeaderLabel: isMulti ? `${params.selectedCount} items selected` : undefined,
    canRename: params.selectedCount === 1,
    renameDisabledReason: isMulti ? 'Cannot rename multiple items at once' : undefined,
    canDuplicate: params.selectedCount === 1 && !params.isFolder,
    canPaste: params.isFolder && params.clipboardHasContent,
    canFindInFolder: params.isFolder,
    compareMode,
    gitVisible: params.isRepo,
  };
}

/**
 * Determines whether "Close Others" is allowed for tabs.
 */
export function canCloseOthers(totalTabs: number): boolean {
  return totalTabs > 1;
}

/**
 * Determines whether "Close to the Right" is allowed for a given tab index.
 */
export function canCloseToRight(index: number, totalTabs: number): boolean {
  return index >= 0 && index < totalTabs - 1;
}

/**
 * Returns paths of all tabs other than the active one.
 */
export function getCloseOthersPaths(activePath: string, tabs: { path: string }[]): string[] {
  return tabs.filter((t) => t.path !== activePath).map((t) => t.path);
}

/**
 * Returns paths of all tabs to the right of the given index.
 */
export function getCloseToRightPaths(index: number, tabs: { path: string }[]): string[] {
  if (index < 0 || index >= tabs.length - 1) return [];
  return tabs.slice(index + 1).map((t) => t.path);
}
