import type { GitStashFileEntry } from '../../lib/api';

export interface StashFolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: StashTreeNode[];
  totalFiles: number;
}

export interface StashFileNode {
  type: 'file';
  name: string;
  file: GitStashFileEntry;
}

export type StashTreeNode = StashFolderNode | StashFileNode;

export interface FlatStashDisplayItem {
  type: 'folder' | 'file';
  id: string;
  name: string;
  path: string;
  depth: number;
  totalFiles?: number;
  file?: GitStashFileEntry;
  isExpanded?: boolean;
}

export function countFilesInTree(nodes: StashTreeNode[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'file') {
      count++;
    } else {
      count += countFilesInTree(n.children);
    }
  }
  return count;
}

/**
 * Build a nested folder/file tree from a flat list of stash files.
 * e.g. "src/components/foo.ts" -> folder "src" -> folder "components" -> file "foo.ts"
 */
export function buildStashTree(files: GitStashFileEntry[]): StashTreeNode[] {
  interface IntermediateFolder {
    folders: Map<string, IntermediateFolder>;
    files: GitStashFileEntry[];
  }

  const root: IntermediateFolder = { folders: new Map(), files: [] };

  for (const f of files) {
    const parts = f.path.split('/');
    if (parts.length === 1) {
      root.files.push(f);
    } else {
      let current = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        if (!current.folders.has(seg)) {
          current.folders.set(seg, { folders: new Map(), files: [] });
        }
        current = current.folders.get(seg)!;
      }
      current.files.push(f);
    }
  }

  function convert(inter: IntermediateFolder, parentPath: string): StashTreeNode[] {
    const folderKeys = Array.from(inter.folders.keys()).sort((a, b) => a.localeCompare(b));
    const folderNodes: StashFolderNode[] = [];

    for (const key of folderKeys) {
      const sub = inter.folders.get(key)!;
      const fullPath = parentPath ? `${parentPath}/${key}` : key;
      const children = convert(sub, fullPath);
      const totalFiles = countFilesInTree(children);
      folderNodes.push({
        type: 'folder',
        name: key,
        path: fullPath,
        children,
        totalFiles,
      });
    }

    const fileNodes: StashFileNode[] = inter.files
      .sort((a, b) => {
        const nameA = a.path.split('/').pop() || a.path;
        const nameB = b.path.split('/').pop() || b.path;
        return nameA.localeCompare(nameB);
      })
      .map((f) => ({
        type: 'file',
        name: f.path.split('/').pop() || f.path,
        file: f,
      }));

    return [...folderNodes, ...fileNodes];
  }

  return convert(root, '');
}

/**
 * Flatten stash tree into a display list respecting collapsed folders.
 * Default is expanded unless path exists in collapsedFolders set.
 */
export function flattenStashTree(
  nodes: StashTreeNode[],
  collapsedFolders: Set<string>,
  depth = 0
): FlatStashDisplayItem[] {
  const result: FlatStashDisplayItem[] = [];

  for (const node of nodes) {
    if (node.type === 'folder') {
      const isExpanded = !collapsedFolders.has(node.path);
      result.push({
        type: 'folder',
        id: `folder:${node.path}`,
        name: node.name,
        path: node.path,
        depth,
        totalFiles: node.totalFiles,
        isExpanded,
      });

      if (isExpanded) {
        result.push(...flattenStashTree(node.children, collapsedFolders, depth + 1));
      }
    } else {
      result.push({
        type: 'file',
        id: `file:${node.file.path}`,
        name: node.name,
        path: node.file.path,
        depth,
        file: node.file,
      });
    }
  }

  return result;
}
