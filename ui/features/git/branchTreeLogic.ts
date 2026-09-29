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
 * Build prefix tree from a flat list of branches.
 * e.g. "canary/prod/1.9.0" -> folder "canary/" -> subfolder "prod/" -> leaf "1.9.0"
 * If only 1 branch has that prefix, it can optionally remain unnested or nested.
 * Default: split by "/" into hierarchy.
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
    const result: TreeNode[] = [];

    // Sort folder keys alphabetically
    const folderKeys = Array.from(inter.folders.keys()).sort();
    for (const key of folderKeys) {
      const sub = inter.folders.get(key)!;
      const full = prefixAcc + key;
      const children = convert(sub, full);
      const total = countBranchesInTree(children);
      result.push({
        type: 'folder',
        prefix: key,
        fullPrefix: full,
        children,
        totalBranches: total,
      });
    }

    // Sort leaves alphabetically
    const sortedLeaves = [...inter.leaves].sort((a, b) => a.name.localeCompare(b.name));
    for (const leaf of sortedLeaves) {
      const parts = leaf.name.split('/');
      const leafName = parts[parts.length - 1];
      result.push({
        type: 'branch',
        branch: leaf,
        displayName: leafName,
      });
    }

    return result;
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
