import { invoke } from '@tauri-apps/api/core';

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

export const api = {
  listDir(path: string): Promise<Entry[]> {
    return invoke<Entry[]>('list_dir', { path });
  },

  readFile(path: string): Promise<string> {
    return invoke<string>('read_file', { path });
  },

  pickFolder(): Promise<string | null> {
    return invoke<string | null>('pick_folder');
  },

  markReady(tsMs: number): Promise<void> {
    return invoke('mark_ready', { tsMs });
  },

  benchLog(line: string): Promise<void> {
    return invoke('bench_log', { line });
  },

  benchMode(): Promise<boolean> {
    return invoke<boolean>('bench_mode');
  },
};
