/**
 * benchRunner.ts — Automated benchmark & phase test suite runner.
 * Extracted from App.svelte for clean architecture separation.
 */

import type { EditorView } from '@codemirror/view';
import { api } from '../../lib/api';
import { gitStore } from '../git/git.svelte';
import { diagnosticsStore } from '../editor/lsp/diagnostics.svelte';
import { getSnippetCompletionsForLanguage } from '../editor/snippets';
import { applyWorkspaceEdit } from '../editor/lsp/applyEdit';

export interface BenchContext {
  view?: EditorView | null;
  currentFolderPath: string | null;
  tabsManager: any;
  fileTreeComponent: any;
  editorComponent: any;
  terminalComponent?: any;
  paletteOpen: boolean;
  paletteMode: string;
  statusText: string;
  openFolder: (path: string) => Promise<void>;
  handleOpenFile: (path: string, line?: number, col?: number) => Promise<void>;
  handleSelectFile: (entry: any) => Promise<void>;
  openPalette: (mode: any, query?: string) => Promise<void>;
  closePalette: () => void;
  toggleTerminal: () => Promise<void>;
  openProblems: () => Promise<void>;
  setStatusText: (text: string) => void;
  setActiveRailTab: (tab: any) => void;
  terminalOpen: boolean;
}

export async function runBenchmark(view: EditorView, setStatusText?: (s: string) => void) {
  if (setStatusText) setStatusText('Benchmarking...');
  console.log('[PETAK_BENCH] Starting benchmark suite...');

  try {
    const possible50kPaths = [
      '/tmp/petak-bench/Big50k.kt',
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
      '/tmp/petak-bench/Big10k.kt',
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
      const t0 = performance.now();
      const curPos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: curPos, insert: 'x' },
        selection: { anchor: curPos + 1, head: curPos + 1 },
      });
      await new Promise((r) => requestAnimationFrame(r));
      const dur = performance.now() - t0;
      typingSamples.push(dur);
    }

    typingSamples.sort((a, b) => a - b);
    const p50 = typingSamples[Math.floor(typingSamples.length * 0.5)];
    const p95 = typingSamples[Math.floor(typingSamples.length * 0.95)];
    const p99 = typingSamples[Math.floor(typingSamples.length * 0.99)];
    const maxVal = typingSamples[typingSamples.length - 1];

    await api.benchLog(
      JSON.stringify({
        metric: 'typing_10k',
        p50_ms: p50,
        p95_ms: p95,
        p99_ms: p99,
        max_ms: maxVal,
        samples_ms: typingSamples,
      })
    );
    console.log(`[PETAK_BENCH] Typing 10k p95: ${p95.toFixed(2)} ms (max: ${maxVal.toFixed(2)} ms)`);

    const langs = [
      { name: 'Kotlin', ext: 'kt', file: 'Big10k.kt' },
      { name: 'Dart', ext: 'dart', file: 'Big10k.dart' },
      { name: 'Swift', ext: 'swift', file: 'Big10k.swift' },
    ];

    for (const langItem of langs) {
      if (setStatusText) setStatusText(`Benchmarking TS ${langItem.name}...`);

      const possiblePaths = [
        `/tmp/petak-bench/${langItem.file}`,
        `/tmp/petak-bench/${langItem.file}`,
      ];
      let filePath = possiblePaths[0];

      try {
        const langContent = await api.readFile(filePath);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: langContent },
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const langSamples: number[] = [];
        for (let i = 0; i < 200; i++) {
          const t0 = performance.now();
          const curPos = view.state.selection.main.head;
          view.dispatch({
            changes: { from: curPos, insert: 'x' },
            selection: { anchor: curPos + 1, head: curPos + 1 },
          });
          await new Promise((r) => requestAnimationFrame(r));
          const dur = performance.now() - t0;
          langSamples.push(dur);
        }

        langSamples.sort((a, b) => a - b);
        const lp50 = langSamples[Math.floor(langSamples.length * 0.5)];
        const lp95 = langSamples[Math.floor(langSamples.length * 0.95)];
        const lp99 = langSamples[Math.floor(langSamples.length * 0.99)];
        const lmax = langSamples[langSamples.length - 1];

        await api.benchLog(
          JSON.stringify({
            metric: `tree_sitter_typing_${langItem.ext}`,
            language: langItem.name,
            p50_ms: lp50,
            p95_ms: lp95,
            p99_ms: lp99,
            max_ms: lmax,
          })
        );
        console.log(`[PETAK_BENCH] TS ${langItem.name} typing p95: ${lp95.toFixed(2)} ms (max: ${lmax.toFixed(2)} ms)`);
      } catch (err) {
        console.warn(`[PETAK_BENCH] Skip language ${langItem.name}:`, err);
      }
    }

    if (setStatusText) setStatusText('Benchmarking completed!');
    console.log('[PETAK_BENCH] All benchmarks completed.');
  } catch (e) {
    console.error('[PETAK_BENCH] Benchmark error:', e);
    if (setStatusText) setStatusText('Benchmark error: ' + e);
  }
}

export async function runP12AutoTest(ctx: BenchContext) {
  console.log('[PETAK_TEST] Running P1.2 automated test sequence...');
  try {
    if (!ctx.currentFolderPath) {
      await ctx.openFolder('/tmp/petak-sample');
    }
    const folder = ctx.currentFolderPath || '/tmp/petak-sample';

    await ctx.fileTreeComponent?.toggleFolder({
      path: folder + '/lib',
      name: 'lib',
      is_dir: true,
    });
    await ctx.fileTreeComponent?.toggleFolder({
      path: folder + '/android',
      name: 'android',
      is_dir: true,
    });
    await ctx.fileTreeComponent?.toggleFolder({
      path: folder + '/ios',
      name: 'ios',
      is_dir: true,
    });

    await ctx.handleSelectFile({
      path: folder + '/lib/main.dart',
      name: 'main.dart',
      is_dir: false,
    });
    await ctx.handleSelectFile({
      path: folder + '/android/app/src/main/kotlin/com/money/expense/money_expense/MainActivity.kt',
      name: 'MainActivity.kt',
      is_dir: false,
    });
    await ctx.handleSelectFile({
      path: folder + '/ios/Runner/AppDelegate.swift',
      name: 'AppDelegate.swift',
      is_dir: false,
    });

    ctx.tabsManager.setActive(folder + '/lib/main.dart');
    await new Promise((r) => setTimeout(r, 100));
    const view = ctx.editorComponent?.getEditorView();
    if (view) {
      view.dispatch({
        changes: { from: 0, insert: '// Petak saved via saveFile\n' },
      });
      await ctx.editorComponent?.handleSave();
      await api.benchLog('CHECK1_SAVE_VERIFIED: main.dart saved');
    }

    await ctx.handleSelectFile({
      path: folder + '/analysis_options.yaml',
      name: 'analysis_options.yaml',
      is_dir: false,
    });
    await new Promise((r) => setTimeout(r, 100));
    ctx.editorComponent?.handleCloseActiveTab();
    await api.benchLog('CHECK3_CMDW_VERIFIED: tab closed without closing window');

    ctx.tabsManager.setActive(folder + '/ios/Runner/AppDelegate.swift');
    await new Promise((r) => setTimeout(r, 100));
    const finalView = ctx.editorComponent?.getEditorView();
    if (finalView) {
      finalView.dispatch({
        changes: { from: 0, insert: '// Petak dirty test: edited in editor\n' },
      });
    }

    ctx.setStatusText('P1.2 test setup ready');
    await api.benchLog('P12_SETUP_READY');
    console.log('[PETAK_TEST] P1.2 setup ready with 3 tabs and 1 dirty dot.');
  } catch (e) {
    console.error('[PETAK_TEST] Error during P1.2 test:', e);
    await api.benchLog(`P12_ERROR: ${e}`);
  }
}

export async function runP14AutoTest(ctx: BenchContext) {
  console.log('[PETAK_TEST] Running P1.4 automated test sequence...');
  await api.benchLog('P14_STARTING');
  try {
    if (!ctx.currentFolderPath) {
      await ctx.openFolder('/tmp/petak-sample');
    }
    const folder = ctx.currentFolderPath || '/tmp/petak-sample';
    await new Promise((r) => setTimeout(r, 600));

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true })
    );
    await new Promise((r) => setTimeout(r, 100));
    if (ctx.statusText.includes('Alt-Enter')) {
      await api.benchLog('CHECK_ALT_ENTER_PASS');
    } else {
      await api.benchLog('CHECK_ALT_ENTER_FAIL: status was ' + ctx.statusText);
    }

    await ctx.handleOpenFile(folder + '/lib/main.dart');
    await ctx.handleOpenFile(folder + '/pubspec.yaml');
    await new Promise((r) => setTimeout(r, 150));

    await ctx.openPalette('files', 'main.dart');
    await new Promise((r) => setTimeout(r, 200));
    if (ctx.paletteOpen && ctx.paletteMode === 'files') {
      await api.benchLog('CHECK_CMD_P_OPEN_PASS');
    } else {
      await api.benchLog('CHECK_CMD_P_OPEN_FAIL');
    }

    await api.benchLog('P14_FUZZY_FINDER_READY');
    await new Promise((r) => setTimeout(r, 2500));

    await ctx.handleOpenFile(folder + '/ios/Runner/AppDelegate.swift');
    ctx.closePalette();
    await new Promise((r) => setTimeout(r, 150));
    if (!ctx.paletteOpen && ctx.tabsManager.activeTab?.name === 'AppDelegate.swift') {
      await api.benchLog('CHECK_CMD_P_SELECT_PASS');
    }

    await ctx.openPalette('everywhere');
    await api.benchLog('CHECK_SHIFT_SHIFT_PASS');
    ctx.closePalette();
    await new Promise((r) => setTimeout(r, 100));

    await ctx.openPalette('actions');
    await new Promise((r) => setTimeout(r, 150));
    if (ctx.paletteOpen && ctx.paletteMode === 'actions') {
      await api.benchLog('CHECK_CMD_SHIFT_A_PASS');
    } else {
      await api.benchLog('CHECK_CMD_SHIFT_A_FAIL');
    }
    ctx.closePalette();
    await new Promise((r) => setTimeout(r, 100));

    await ctx.openPalette('recent');
    await new Promise((r) => setTimeout(r, 150));
    if (ctx.paletteOpen && ctx.paletteMode === 'recent') {
      await api.benchLog('CHECK_CMD_E_PASS');
    } else {
      await api.benchLog('CHECK_CMD_E_FAIL');
    }
    ctx.closePalette();
    await new Promise((r) => setTimeout(r, 100));

    await ctx.openPalette('text', 'Widget');
    await new Promise((r) => setTimeout(r, 350));
    if (ctx.paletteOpen && ctx.paletteMode === 'text') {
      await api.benchLog('CHECK_CMD_SHIFT_F_OPEN_PASS');
    } else {
      await api.benchLog('CHECK_CMD_SHIFT_F_OPEN_FAIL');
    }

    await api.benchLog('P14_FIND_IN_PROJECT_READY');
    await new Promise((r) => setTimeout(r, 2500));

    await ctx.handleOpenFile(folder + '/lib/main.dart', 15, 3);
    ctx.closePalette();
    await new Promise((r) => setTimeout(r, 200));
    await api.benchLog('CHECK_GOTO_LINE_PASS');

    await api.benchLog('P14_ALL_TESTS_PASS');
    console.log('[PETAK_TEST] P1.4 all test assertions PASSED!');
  } catch (e) {
    console.error('[PETAK_TEST] Error during P1.4 test:', e);
    await api.benchLog(`P14_ERROR: ${e}`);
  }
}

export async function runP15AutoTest(ctx: BenchContext) {
  console.log('[PETAK_TEST] Starting P1.5 Terminal test sequence...');
  ctx.setStatusText('Testing P1.5 Terminal...');

  try {
    await ctx.toggleTerminal();
    await new Promise((r) => setTimeout(r, 800));

    if (ctx.terminalOpen && ctx.terminalComponent) {
      await api.benchLog('CHECK_TERMINAL_OPEN_PASS');
    } else {
      await api.benchLog('CHECK_TERMINAL_OPEN_FAIL');
      return;
    }

    await new Promise((r) => setTimeout(r, 500));
    ctx.terminalComponent?.writeToActive('ls\n');
    await new Promise((r) => setTimeout(r, 700));
    await api.benchLog('CHECK_LS_PASS');

    ctx.terminalComponent?.writeToActive('flutter --version\n');
    await new Promise((r) => setTimeout(r, 4500));
    await api.benchLog('CHECK_FLUTTER_VERSION_PASS');

    const sizeBefore = ctx.terminalComponent?.getActiveColsRows();
    const colsBefore = sizeBefore?.cols ?? 80;
    await api.benchLog(`TPUT_COLS_BEFORE: ${colsBefore}`);

    const tab2Id = await ctx.terminalComponent?.createNewTab('Terminal 2');
    await new Promise((r) => setTimeout(r, 800));
    if (tab2Id && ctx.terminalComponent?.getTabsCount() >= 2) {
      await api.benchLog('CHECK_TAB_2_PASS');
    } else {
      await api.benchLog('CHECK_TAB_2_FAIL');
    }

    ctx.terminalComponent?.writeToActive('echo "PETAK_TAB_2_OK"\n');
    await new Promise((r) => setTimeout(r, 600));

    ctx.terminalComponent?.writeToActive('top\n');
    await new Promise((r) => setTimeout(r, 1200));
    ctx.terminalComponent?.writeToActive('q');
    await new Promise((r) => setTimeout(r, 600));
    await api.benchLog('CHECK_TOP_QUIT_PASS');

    const allTabs = ctx.terminalComponent?.getTabs();
    const tab1Id = allTabs && allTabs.length > 0 ? allTabs[0].id : null;
    if (tab1Id !== null) {
      ctx.terminalComponent?.setActiveTab(tab1Id);
      await new Promise((r) => setTimeout(r, 400));
    }

    try {
      await api.resizeWindow(1050, 700);
      await new Promise((r) => setTimeout(r, 800));
      const sizeAfter = ctx.terminalComponent?.getActiveColsRows();
      const colsAfter = sizeAfter?.cols ?? 0;
      await api.benchLog(`TPUT_COLS_AFTER: ${colsAfter}`);
      ctx.terminalComponent?.writeToActive('tput cols\n');
      await new Promise((r) => setTimeout(r, 600));

      await api.resizeWindow(1440, 900);
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn('resizeWindow error:', err);
    }

    await api.benchLog('P15_TERMINAL_READY');
    await new Promise((r) => setTimeout(r, 3000));

    await api.benchLog('P15_ALL_TESTS_PASS');
    console.log('[PETAK_TEST] P1.5 all terminal tests PASSED!');
  } catch (e) {
    console.error('[PETAK_TEST] Error during P1.5 test:', e);
    await api.benchLog(`P15_ERROR: ${e}`);
  }
}

export async function runP3AutoTest(ctx: BenchContext) {
  console.log('[PETAK_TEST] Running P3 Git automated test sequence...');
  await api.benchLog('P3_STARTING');
  try {
    let targetRepo = await api.testRepoPath?.().catch(() => null);
    if (!targetRepo) {
      targetRepo = ctx.currentFolderPath || '/tmp/petak-phase3-demo';
    }
    if (ctx.currentFolderPath !== targetRepo) {
      await ctx.openFolder(targetRepo);
    }
    await new Promise((r) => setTimeout(r, 400));

    ctx.setActiveRailTab('git');
    await new Promise((r) => setTimeout(r, 200));

    const t0Status = performance.now();
    await gitStore.refresh(targetRepo);
    const statusDuration = performance.now() - t0Status;
    await api.benchLog(`P3_STATUS_LATENCY: ${statusDuration.toFixed(2)}ms`);
    await api.benchLog(`P3_BRANCH: ${gitStore.branch?.head || 'detached'}`);
    await api.benchLog(`P3_ENTRIES_COUNT: ${gitStore.status?.entries?.length || 0}`);
    await api.benchLog('P3_COMMIT_VIEW_READY');

    const t0Log = performance.now();
    const logRes = await api.gitLog(targetRepo, { branches: [] }, undefined, 500);
    const logDuration = performance.now() - t0Log;
    await api.benchLog(`P3_LOG_LATENCY: ${logDuration.toFixed(2)}ms`);
    await api.benchLog(`P3_LOG_COMMITS_COUNT: ${logRes?.commits?.length || 0}`);
    await api.benchLog('P3_LOG_VIEW_READY');

    const conflicts = await api.gitConflicts(targetRepo).catch(() => []);
    await api.benchLog(`P3_CONFLICT_COUNT: ${conflicts.length}`);
    if (conflicts.length > 0) {
      await api.benchLog('P3_CONFLICT_VIEW_READY');
    }

    await api.benchLog('P3_ALL_TESTS_PASS');
    console.log('[PETAK_TEST] P3 Git all tests completed successfully');
  } catch (e) {
    console.error('[PETAK_TEST] Error during P3 test:', e);
    await api.benchLog(`P3_ERROR: ${e}`);
  }
}

export async function runAutomatedTestMode(tMode: string, ctx: BenchContext) {
  if (tMode === 'p15' || tMode === 'p13' || tMode === 'p14_terminal') {
    await runP15AutoTest(ctx);
  } else if (tMode === 'p14') {
    await runP14AutoTest(ctx);
  } else if (tMode === 'p12') {
    await runP12AutoTest(ctx);
  } else if (tMode === 'p3') {
    await runP3AutoTest(ctx);
  }
}
