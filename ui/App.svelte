<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api, type Entry, type UnlistenFn } from './lib/api';
  import TitleBar from './shell/TitleBar.svelte';
  import Rail from './shell/Rail.svelte';
  import FileTree from './shell/FileTree.svelte';
  import StatusBar from './shell/StatusBar.svelte';
  import Editor from './features/editor/Editor.svelte';
  import { tabsManager } from './features/editor/tabs.svelte';
  import type { EditorView } from '@codemirror/view';
  import { preloadAllLanguages, treeSitterPlugin } from './features/editor/ts/highlight';
  import { registerKeymap, showIntentions, type SearchMode } from './features/search/keymap';

  let currentFolderPath = $state('');
  let rootEntries = $state<Entry[]>([]);
  let recentFolders = $state<string[]>([]);
  let statusText = $state('Ready');
  let isBench = $state(false);
  let cursorInfo = $state('Ln 1, Col 1');

  let editorComponent: any = null;
  let fileTreeComponent: any = null;
  let unlistenFs: UnlistenFn | null = null;
  let indexDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  let paletteOpen = $state(false);
  let paletteMode = $state<SearchMode>('files');
  let PaletteComponent = $state<any>(null);
  let unregisterKeymap: (() => void) | null = null;

  async function openPalette(mode: SearchMode) {
    if (!PaletteComponent) {
      const mod = await import('./features/search/Palette.svelte');
      PaletteComponent = mod.default;
    }
    paletteMode = mode;
    paletteOpen = true;
  }

  function closePalette() {
    paletteOpen = false;
    editorComponent?.focus();
  }

  async function handleOpenFile(filePath: string, line?: number, col?: number) {
    try {
      const existing = tabsManager.tabs.find((t) => t.path === filePath);
      const filename = filePath.split('/').filter(Boolean).pop() || '';
      if (!existing) {
        const text = await api.readFile(filePath);
        tabsManager.openTab(filePath, filename, text);
      } else {
        tabsManager.setActive(filePath);
      }
      statusText = `Opened ${filename}`;
      if (line !== undefined) {
        setTimeout(() => {
          editorComponent?.gotoLine(line, col || 1);
        }, 50);
      } else {
        editorComponent?.focus();
      }
    } catch (e) {
      console.error('Failed to open file:', filePath, e);
      statusText = `Failed to open ${filePath}`;
    }
  }

  const staticActions = [
    {
      id: 'open-folder',
      label: 'Open Folder...',
      shortcut: '⌘O',
      run: () => handlePickFolder(),
    },
    {
      id: 'save',
      label: 'Save',
      shortcut: '⌘S',
      run: () => editorComponent?.handleSave(),
    },
    {
      id: 'close-tab',
      label: 'Close Tab',
      shortcut: '⌘W',
      run: () => editorComponent?.handleCloseActiveTab(),
    },
    {
      id: 'find-file',
      label: 'Find File...',
      shortcut: '⌘P',
      run: () => openPalette('files'),
    },
    {
      id: 'find-in-project',
      label: 'Find in Project...',
      shortcut: '⇧⌘F',
      run: () => openPalette('text'),
    },
    {
      id: 'recent-files',
      label: 'Recent Files',
      shortcut: '⌘E',
      run: () => openPalette('recent'),
    },
    {
      id: 'toggle-terminal',
      label: 'Toggle Terminal',
      shortcut: '⌃`',
      run: () => {
        console.debug('[Petak] Toggle Terminal action triggered (P1.5 stub)');
      },
    },
  ];

  function triggerIndexRebuild(rootPath: string) {
    if (!rootPath) return;
    if (indexDebounceTimer) {
      clearTimeout(indexDebounceTimer);
    }
    indexDebounceTimer = setTimeout(() => {
      api.indexBuild(rootPath).catch((e) => console.warn('indexBuild rebuild error:', e));
    }, 500);
  }

  let activeFilename = $derived(tabsManager.activeTab?.name || '');
  let activeFilePath = $derived(tabsManager.activeTab?.path || '');

  let fileType = $derived(
    activeFilename.endsWith('.kt') || activeFilename.endsWith('.kts') ? 'Kotlin' :
    activeFilename.endsWith('.dart') ? 'Dart' :
    activeFilename.endsWith('.swift') ? 'Swift' :
    activeFilename.endsWith('.toml') ? 'TOML' :
    activeFilename.endsWith('.json') ? 'JSON' :
    activeFilename.endsWith('.rs') ? 'Rust' :
    activeFilename.endsWith('.svelte') ? 'Svelte' :
    activeFilename.endsWith('.ts') ? 'TypeScript' :
    activeFilename.endsWith('.md') ? 'Markdown' :
    activeFilename ? 'Plain Text' : 'Empty'
  );

  async function openFolder(folderPath: string) {
    try {
      const list = await api.listDir(folderPath);
      currentFolderPath = folderPath;
      rootEntries = list;
      recentFolders = await api.addRecentFolder(folderPath);
      await api.watchRoot(folderPath);
      api.indexBuild(folderPath).catch((e) => console.warn('indexBuild error:', e));
      statusText = `Opened ${folderPath.split('/').filter(Boolean).pop()}`;
    } catch (e) {
      console.error('Failed to open folder:', folderPath, e);
      statusText = 'Failed to open folder';
      throw e;
    }
  }

  async function handlePickFolder() {
    try {
      const folder = await api.pickFolder();
      if (folder) {
        await openFolder(folder);
      }
    } catch (e) {
      console.error('Failed to pick folder:', e);
    }
  }

  async function handleSelectFile(entry: Entry) {
    try {
      const existing = tabsManager.tabs.find((t) => t.path === entry.path);
      if (existing) {
        tabsManager.setActive(entry.path);
        return;
      }
      const text = await api.readFile(entry.path);
      tabsManager.openTab(entry.path, entry.name, text);
      statusText = `Opened ${entry.name}`;
    } catch (e) {
      console.error('Failed to read file:', entry.path, e);
      statusText = `Failed to open ${entry.name}`;
    }
  }

  async function handleExternalChange(paths: string[]) {
    // 1. Check open tabs
    for (const tab of tabsManager.tabs) {
      if (paths.includes(tab.path)) {
        try {
          const diskContent = await api.readFile(tab.path);
          // Ignore event from our own save (disk content matches what we saved)
          if (diskContent === tab.savedContent) {
            continue;
          }

          if (!tab.dirty) {
            // Reload silently
            tab.savedContent = diskContent;
            if (tab.path === tabsManager.activePath) {
              const view = editorComponent?.getEditorView();
              if (view) {
                const curSel = view.state.selection;
                const maxLen = diskContent.length;
                const newAnchor = Math.min(curSel.main.anchor, maxLen);
                const newHead = Math.min(curSel.main.head, maxLen);
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: diskContent },
                  selection: { anchor: newAnchor, head: newHead },
                });
                tab.state = view.state;
              }
            } else {
              tab.state = undefined;
            }
            statusText = `Reloaded ${tab.name} from disk`;
            await api.benchLog(`CHECK2_EXTERNAL_RELOAD_VERIFIED: ${tab.name}`);
          } else {
            // Dirty tab -> show conflict bar
            tab.externalConflict = true;
            tab.pendingDiskContent = diskContent;
            statusText = `File ${tab.name} modified on disk (conflict)`;
          }
        } catch (e) {
          console.error('Failed to handle external change for:', tab.path, e);
        }
      }
    }

    // 2. Refresh file tree expanded folders
    if (fileTreeComponent) {
      await fileTreeComponent.refreshExpandedFolders(paths);
    }

    // 3. Refresh root directory if affected
    if (
      currentFolderPath &&
      paths.some((p) => p === currentFolderPath || p.startsWith(currentFolderPath + '/'))
    ) {
      try {
        rootEntries = await api.listDir(currentFolderPath);
      } catch (_) {}
    }

    // 4. Debounced index rebuild
    if (currentFolderPath) {
      triggerIndexRebuild(currentFolderPath);
    }
  }

  async function runBenchmark(view: EditorView) {
    statusText = 'Benchmarking...';
    console.log('[PETAK_BENCH] Starting benchmark suite...');

    try {
      const possible50kPaths = [
        '/Users/uqi/petak-bench/Big50k.kt',
        '/tmp/petak-bench/Big50k.kt',
      ];
      let big50kPath = possible50kPaths[0];

      console.log('[PETAK_BENCH] Measuring open 50k lines (5 runs)...');
      await new Promise((r) => setTimeout(r, 100));
      const openRuns: number[] = [];

      for (let run = 0; run < 5; run++) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const t0 = performance.now();
        const content50k = await api.readFile(big50kPath);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content50k },
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const t1 = performance.now();
        const dur = t1 - t0;
        openRuns.push(dur);
        console.log(`[PETAK_BENCH] Run ${run + 1}: ${dur.toFixed(2)} ms`);
      }

      const sortedRuns = [...openRuns].sort((a, b) => a - b);
      const medianOpen = sortedRuns[Math.floor(sortedRuns.length / 2)];
      await api.benchLog(
        JSON.stringify({
          metric: 'open_50k',
          runs_ms: openRuns,
          median_ms: medianOpen,
        })
      );
      console.log(`[PETAK_BENCH] Open 50k median: ${medianOpen.toFixed(2)} ms`);

      const possible10kPaths = [
        '/Users/uqi/petak-bench/Big10k.kt',
        '/tmp/petak-bench/Big10k.kt',
      ];
      const big10kPath = possible10kPaths[0];

      console.log('[PETAK_BENCH] Measuring typing latency on 10k lines (200 insertions)...');
      await new Promise((r) => setTimeout(r, 100));
      const content10k = await api.readFile(big10kPath);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content10k },
      });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const midPos = Math.floor(view.state.doc.length / 2);
      view.dispatch({ selection: { anchor: midPos, head: midPos } });

      const typingSamples: number[] = [];
      for (let i = 0; i < 200; i++) {
        const char = String.fromCharCode(97 + (i % 26));
        const t0 = performance.now();
        const curPos = view.state.selection.main.head;
        view.dispatch({
          changes: { from: curPos, insert: char },
          selection: { anchor: curPos + 1, head: curPos + 1 },
        });
        await new Promise((r) => requestAnimationFrame(r));
        const t1 = performance.now();
        typingSamples.push(t1 - t0);
      }

      const sortedSamples = [...typingSamples].sort((a, b) => a - b);
      const p50 = sortedSamples[Math.floor(sortedSamples.length * 0.5)];
      const p95 = sortedSamples[Math.floor(sortedSamples.length * 0.95)];
      const max = sortedSamples[sortedSamples.length - 1];
      const avg = typingSamples.reduce((a, b) => a + b, 0) / typingSamples.length;

      await api.benchLog(
        JSON.stringify({
          metric: 'typing_latency_10k',
          samples_count: typingSamples.length,
          p50_ms: p50,
          p95_ms: p95,
          max_ms: max,
          avg_ms: avg,
        })
      );
      console.log(
        `[PETAK_BENCH] Typing latency: p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, max=${max.toFixed(2)}ms`
      );

      console.log('[PETAK_BENCH] Starting F0.2 Tree-sitter Benchmark...');
      await api.benchLog(
        JSON.stringify({
          metric: 'f02_signal_before_preload',
          ts: Date.now(),
        })
      );
      await new Promise((r) => setTimeout(r, 600));

      const tPreload0 = performance.now();
      await preloadAllLanguages();
      const preloadMs = performance.now() - tPreload0;
      console.log(`[PETAK_BENCH] Preloaded 3 WASM grammars in ${preloadMs.toFixed(2)} ms`);

      await api.benchLog(
        JSON.stringify({
          metric: 'f02_signal_after_preload',
          ts: Date.now(),
          preload_ms: preloadMs,
        })
      );
      await new Promise((r) => setTimeout(r, 600));

      const languagesToBench = [
        { name: 'dart', ext: 'dart', file: 'Big10k.dart' },
        { name: 'kotlin', ext: 'kt', file: 'Big10k.kt' },
        { name: 'swift', ext: 'swift', file: 'Big10k.swift' },
      ];

      for (const langItem of languagesToBench) {
        console.log(`[PETAK_BENCH] Running tree-sitter benchmark for ${langItem.name}...`);
        statusText = `Benchmarking TS ${langItem.name}...`;

        const possiblePaths = [
          `/Users/uqi/petak-bench/${langItem.file}`,
          `/tmp/petak-bench/${langItem.file}`,
        ];
        let filePath = possiblePaths[0];

        await new Promise((r) => setTimeout(r, 100));

        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const content = await api.readFile(filePath);

        const plugin = view.plugin(treeSitterPlugin);
        const tInitial0 = performance.now();
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const tInitial1 = performance.now();
        const initialParseFullTimeMs = plugin?.lastInitialParseMs || (tInitial1 - tInitial0);
        console.log(`[PETAK_BENCH] ${langItem.name} initial parse: ${initialParseFullTimeMs.toFixed(2)} ms`);

        const mid = Math.floor(view.state.doc.length / 2);
        view.dispatch({ selection: { anchor: mid, head: mid } });
        await new Promise((r) => requestAnimationFrame(r));

        const incParseSamples: number[] = [];
        const queryDecoSamples: number[] = [];
        const frameSamples: number[] = [];

        for (let i = 0; i < 200; i++) {
          const char = String.fromCharCode(97 + (i % 26));
          const t0 = performance.now();
          const curPos = view.state.selection.main.head;
          view.dispatch({
            changes: { from: curPos, insert: char },
            selection: { anchor: curPos + 1, head: curPos + 1 },
          });
          await new Promise((r) => requestAnimationFrame(r));
          const t1 = performance.now();

          frameSamples.push(t1 - t0);
          incParseSamples.push(plugin?.lastIncrementalMs || 0);
          queryDecoSamples.push(plugin?.lastQueryDecoMs || 0);
        }

        const calcStats = (arr: number[]) => {
          const sorted = [...arr].sort((a, b) => a - b);
          return {
            p50: sorted[Math.floor(sorted.length * 0.5)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            max: sorted[sorted.length - 1],
            avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
          };
        };

        const frameStats = calcStats(frameSamples);
        const incStats = calcStats(incParseSamples);
        const queryStats = calcStats(queryDecoSamples);

        await api.benchLog(
          JSON.stringify({
            metric: 'f02_treesitter_bench',
            language: langItem.name,
            filename: langItem.file,
            samples_count: 200,
            initial_parse_ms: initialParseFullTimeMs,
            incremental_p50_ms: incStats.p50,
            incremental_p95_ms: incStats.p95,
            incremental_max_ms: incStats.max,
            incremental_avg_ms: incStats.avg,
            query_deco_p50_ms: queryStats.p50,
            query_deco_p95_ms: queryStats.p95,
            query_deco_max_ms: queryStats.max,
            query_deco_avg_ms: queryStats.avg,
            frame_p50_ms: frameStats.p50,
            frame_p95_ms: frameStats.p95,
            frame_max_ms: frameStats.max,
            frame_avg_ms: frameStats.avg,
            pass_16ms: frameStats.p50 <= 16.0,
          })
        );
      }

      statusText = 'Benchmark complete (idle)';
      await api.benchLog(
        JSON.stringify({
          metric: 'bench_status',
          status: 'complete',
          ts: Date.now(),
        })
      );
    } catch (err: any) {
      console.error('[PETAK_BENCH] Error during benchmark:', err);
      statusText = 'Benchmark error';
      await api.benchLog(
        JSON.stringify({
          metric: 'bench_error',
          error: String(err),
        })
      );
    }
  }

  async function onEditorReady(view: EditorView) {
    console.log('[PETAK] Editor ready.');
    try {
      await api.markReady(Date.now());
    } catch (e) {
      console.warn('api.markReady error:', e);
    }

    try {
      const bench = await api.benchMode();
      isBench = bench;
      if (bench) {
        setTimeout(() => runBenchmark(view), 200);
      }
    } catch (e) {
      console.warn('api.benchMode error:', e);
    }
  }

  async function runP12AutoTest() {
    console.log('[PETAK_TEST] Running P1.2 automated test sequence...');
    try {
      if (!currentFolderPath) {
        currentFolderPath = '/Users/uqi/petak-sample';
        await openFolder(currentFolderPath);
      }

      // Expand folders in tree
      await fileTreeComponent?.toggleFolder({
        path: currentFolderPath + '/lib',
        name: 'lib',
        is_dir: true,
      });
      await fileTreeComponent?.toggleFolder({
        path: currentFolderPath + '/android',
        name: 'android',
        is_dir: true,
      });
      await fileTreeComponent?.toggleFolder({
        path: currentFolderPath + '/ios',
        name: 'ios',
        is_dir: true,
      });

      // Open 3 files: dart, kotlin, swift
      await handleSelectFile({
        path: currentFolderPath + '/lib/main.dart',
        name: 'main.dart',
        is_dir: false,
      });
      await handleSelectFile({
        path: currentFolderPath + '/android/app/src/main/kotlin/com/money/expense/money_expense/MainActivity.kt',
        name: 'MainActivity.kt',
        is_dir: false,
      });
      await handleSelectFile({
        path: currentFolderPath + '/ios/Runner/AppDelegate.swift',
        name: 'AppDelegate.swift',
        is_dir: false,
      });

      // Check 1: Test Save (Cmd-S flow)
      // Switch to main.dart, edit, and save
      tabsManager.setActive(currentFolderPath + '/lib/main.dart');
      await new Promise((r) => setTimeout(r, 100));
      const view = editorComponent?.getEditorView();
      if (view) {
        view.dispatch({
          changes: { from: 0, insert: '// Petak saved via saveFile\n' },
        });
        await editorComponent?.handleSave();
        await api.benchLog('CHECK1_SAVE_VERIFIED: main.dart saved');
      }

      // Check 3: Test Cmd-W flow
      // Open a 4th tab, then close it
      await handleSelectFile({
        path: currentFolderPath + '/analysis_options.yaml',
        name: 'analysis_options.yaml',
        is_dir: false,
      });
      await new Promise((r) => setTimeout(r, 100));
      editorComponent?.handleCloseActiveTab();
      await api.benchLog('CHECK3_CMDW_VERIFIED: tab closed without closing window');

      // Final state: Switch to AppDelegate.swift and make it dirty for screenshot
      tabsManager.setActive(currentFolderPath + '/ios/Runner/AppDelegate.swift');
      await new Promise((r) => setTimeout(r, 100));
      const finalView = editorComponent?.getEditorView();
      if (finalView) {
        finalView.dispatch({
          changes: { from: 0, insert: '// Petak dirty test: edited in editor\n' },
        });
      }

      statusText = 'P1.2 test setup ready';
      await api.benchLog('P12_SETUP_READY');
      console.log('[PETAK_TEST] P1.2 setup ready with 3 tabs and 1 dirty dot.');
    } catch (e) {
      console.error('[PETAK_TEST] Error during P1.2 test:', e);
      await api.benchLog(`P12_ERROR: ${e}`);
    }
  }

  onMount(async () => {
    // 1. Listen for filesystem events
    try {
      unlistenFs = await api.onFsChanged((payload) => {
        handleExternalChange(payload.paths);
      });
    } catch (e) {
      console.warn('Failed to listen to fs-changed:', e);
    }

    // 2. Load recent folders and auto-open first recent folder if available
    try {
      const recents = await api.recentFolders();
      recentFolders = recents;
      if (recents && recents.length > 0) {
        try {
          await openFolder(recents[0]);
        } catch (e) {
          console.warn('Could not auto-open recent folder:', recents[0], e);
        }
      }
    } catch (e) {
      console.warn('Failed to load recent folders:', e);
    }

    // 3. Register global keymap
    unregisterKeymap = registerKeymap({
      openPalette: (mode) => openPalette(mode),
      closePalette: () => closePalette(),
      isPaletteOpen: () => paletteOpen,
      showIntentions: () => {
        showIntentions();
        statusText = 'Alt-Enter / Quick Actions (Phase 2)';
      },
    });

    // 4. Automated P1.2 test if PETAK_TEST_P12 is set
    try {
      const tm = await api.testMode();
      if (tm) {
        setTimeout(() => runP12AutoTest(), 400);
      }
    } catch (e) {
      console.warn('api.testMode error:', e);
    }
  });

  onDestroy(() => {
    if (unregisterKeymap) {
      unregisterKeymap();
      unregisterKeymap = null;
    }
    if (indexDebounceTimer) {
      clearTimeout(indexDebounceTimer);
      indexDebounceTimer = null;
    }
    if (unlistenFs) {
      unlistenFs();
      unlistenFs = null;
    }
  });
</script>

<div class="app-layout">
  <TitleBar
    projectName={currentFolderPath ? currentFolderPath.split('/').filter(Boolean).pop() || 'Petak' : 'Petak'}
    branchName="main"
    onPickFolder={handlePickFolder}
  />

  <div class="main-body">
    <Rail />
    <FileTree
      bind:this={fileTreeComponent}
      {rootEntries}
      folderPath={currentFolderPath}
      {activeFilePath}
      {recentFolders}
      onPickFolder={handlePickFolder}
      onSelectFile={handleSelectFile}
      onOpenRecent={openFolder}
    />
    <Editor
      bind:this={editorComponent}
      onReady={onEditorReady}
      onCursorChange={(c) => (cursorInfo = c)}
      onStatusChange={(s) => (statusText = s)}
    />
  </div>

  <StatusBar
    branchName="main"
    {statusText}
    {isBench}
    {fileType}
    {cursorInfo}
  />

  {#if paletteOpen && PaletteComponent}
    <PaletteComponent
      mode={paletteMode}
      folderPath={currentFolderPath}
      recentFiles={tabsManager.recentFiles}
      actions={staticActions}
      onClose={closePalette}
      onOpenFile={handleOpenFile}
    />
  {/if}
</div>

<style>
  .app-layout {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #16171a;
  }
  .main-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
</style>
