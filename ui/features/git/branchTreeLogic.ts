/**
 * Pure logic for folding git branches into collapsible prefix trees and filtering them.
 */

export interface BranchInfo {
  name: string;
  isCurrent?: boolean;
  ahead?: number;
  behind?: number;
  upstream?: string | null;
  sha?: string;
}

export interface TreeFolderNode {
  type: 'folder';
  prefix: string; // e.g. "canary/"
  fullPrefix: string; // e.g. "canary/" or "canary/dev/"
  children: TreeNode[];
  totalBranches: number;
}

export interface TreeLeafNode {
  type: 'branch';
  branch: BranchInfo;
  displayName: string;
}

export type TreeNode = TreeFolderNode | TreeLeafNode;

export interface FlatDisplayItem {
  type: 'folder' | 'branch';
  id: string;
  name: string;
  fullName: string;
  depth: number;
  isExpanded?: boolean;
  isCurrent?: boolean;
  ahead?: number;
  behind?: number;
  upstream?: string | null;
  count?: number;
}

/**
 * Check if a TreeNode is or contains the current active branch.
 */
export function nodeHasCurrent(node: TreeNode): boolean {
  if (node.type === 'branch') {
    return !!node.branch.isCurrent;
  }
  return node.children.some(nodeHasCurrent);
}

/**
 * Build prefix tree from a flat list of branches.
 * e.g. "canary/prod/1.9.0" -> folder "canary/" -> subfolder "prod/" -> leaf "1.9.0"
 * Current active branch (isCurrent === true) is always sorted to the top:
 * - If at root level, placed at the top preceding other branches & folders.
 * - If inside a folder, that folder is sorted to the top of its level, and within it,
 *   subfolders containing the active branch or the active leaf are sorted to the top.
 */
export function buildBranchTree(branches: BranchInfo[]): TreeNode[] {
  interface IntermediateFolder {
    folders: Map<string, IntermediateFolder>;
    leaves: BranchInfo[];
  }

  const root: IntermediateFolder = { folders: new Map(), leaves: [] };

  for (const b of branches) {
    const parts = b.name.split('/');
    if (parts.length === 1) {
      root.leaves.push(b);
    } else {
      let current = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i] + '/';
        if (!current.folders.has(seg)) {
          current.folders.set(seg, { folders: new Map(), leaves: [] });
        }
        current = current.folders.get(seg)!;
      }
      current.leaves.push(b);
    }
  }

  function convert(inter: IntermediateFolder, prefixAcc: string): TreeNode[] {
    // Sort folder keys alphabetically
    const folderKeys = Array.from(inter.folders.keys()).sort();
    const folderNodes: TreeFolderNode[] = [];
    for (const key of folderKeys) {
      const sub = inter.folders.get(key)!;
      const full = prefixAcc + key;
      const children = convert(sub, full);
      const total = countBranchesInTree(children);
      folderNodes.push({
        type: 'folder',
        prefix: key,
        fullPrefix: full,
        children,
        totalBranches: total,
      });
    }

    // Sort leaves alphabetically
    const sortedLeaves = [...inter.leaves].sort((a, b) => a.name.localeCompare(b.name));
    const leafNodes: TreeLeafNode[] = [];
    for (const leaf of sortedLeaves) {
      const parts = leaf.name.split('/');
      const leafName = parts[parts.length - 1];
      leafNodes.push({
        type: 'branch',
        branch: leaf,
        displayName: leafName,
      });
    }

    // Rule 1: If any leaf at this level is the current active branch, it goes to the very top (index 0)
    const activeLeafIdx = leafNodes.findIndex((l) => l.branch.isCurrent);
    if (activeLeafIdx !== -1) {
      const activeLeaf = leafNodes.splice(activeLeafIdx, 1)[0];
      return [activeLeaf, ...folderNodes, ...leafNodes];
    }

    // Rule 2: If any folder at this level contains the current active branch, that folder goes to the very top (index 0)
    const activeFolderIdx = folderNodes.findIndex((f) => nodeHasCurrent(f));
    if (activeFolderIdx !== -1) {
      const activeFolder = folderNodes.splice(activeFolderIdx, 1)[0];
      return [activeFolder, ...folderNodes, ...leafNodes];
    }

    return [...folderNodes, ...leafNodes];
  }

  return convert(root, '');
}

export function countBranchesInTree(nodes: TreeNode[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'branch') count++;
    else count += n.totalBranches;
  }
  return count;
}

/**
 * Filter tree by query (case-insensitive substring).
 * Returns matching subtree.
 */
export function filterBranchTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const result: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === 'branch') {
      if (n.branch.name.toLowerCase().includes(q)) {
        result.push(n);
      }
    } else {
      const filteredChildren = filterBranchTree(n.children, q);
      if (filteredChildren.length > 0) {
        result.push({
          ...n,
          children: filteredChildren,
          totalBranches: countBranchesInTree(filteredChildren),
        });
      }
    }
  }
  return result;
}

/**
 * Flatten tree into display rows given an expanded folders set.
 */
export function flattenBranchTree(
  nodes: TreeNode[],
  expandedFolders: Set<string>,
  depth = 0
): FlatDisplayItem[] {
  const rows: FlatDisplayItem[] = [];

  for (const node of nodes) {
    if (node.type === 'folder') {
      const isExpanded = expandedFolders.has(node.fullPrefix);
      rows.push({
        type: 'folder',
        id: 'f:' + node.fullPrefix,
        name: node.prefix,
        fullName: node.fullPrefix,
        depth,
        isExpanded,
        count: node.totalBranches,
      });

      if (isExpanded) {
        rows.push(...flattenBranchTree(node.children, expandedFolders, depth + 1));
      }
    } else {
      const b = node.branch;
      rows.push({
        type: 'branch',
        id: 'b:' + b.name,
        name: node.displayName,
        fullName: b.name,
        depth,
        isCurrent: b.isCurrent,
        ahead: b.ahead,
        behind: b.behind,
        upstream: b.upstream,
      });
    }
  }

  return rows;
}
