<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Entry } from './lib/api';
  import TitleBar from './shell/TitleBar.svelte';
  import Rail from './shell/Rail.svelte';
  import FileTree from './shell/FileTree.svelte';
  import StatusBar from './shell/StatusBar.svelte';
  import Editor from './features/editor/Editor.svelte';
  import type { EditorView } from '@codemirror/view';

  // Sample default content from design/Main.html
  const DEFAULT_CONTENT = `package id.shop.checkout

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.*

@HiltViewModel
class CheckoutViewModel @Inject constructor(
    private val repo: CartRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(CheckoutState())
    val state = _state.asStateFlow()

    // Voucher dari input user, divalidasi server
    fun applyVoucher(code: String) {
        val total = _state.value.subtotal
        viewModelScope.launch {
            repo.applyVoucher(code)
                .onSuccess { v -> _state.update { it.copy(voucher = v) } }
                .onFailure { e -> _state.update { it.copy(error = e.message) } }
        }
    }

    fun retry() = applyVoucher("HEMAT50")
}
`;

  let currentFolderPath = $state('');
  let entries = $state<Entry[]>([]);
  let activeFilename = $state('CheckoutViewModel.kt');
  let activeFilePath = $state('src/main/kotlin/id/shop/checkout/CheckoutViewModel.kt');
  let editorContent = $state(DEFAULT_CONTENT);
  let statusText = $state('Ready');
  let isBench = $state(false);
  let cursorInfo = $state('Ln 1, Col 1');

  import { preloadAllLanguages, treeSitterPlugin } from './features/editor/ts/highlight';

  let fileType = $derived(
    activeFilename.endsWith('.kt') || activeFilename.endsWith('.kts') ? 'Kotlin' :
    activeFilename.endsWith('.dart') ? 'Dart' :
    activeFilename.endsWith('.swift') ? 'Swift' :
    activeFilename.endsWith('.toml') ? 'TOML' :
    activeFilename.endsWith('.json') ? 'JSON' :
    activeFilename.endsWith('.rs') ? 'Rust' :
    activeFilename.endsWith('.svelte') ? 'Svelte' :
    activeFilename.endsWith('.ts') ? 'TypeScript' :
    activeFilename.endsWith('.md') ? 'Markdown' : 'Plain Text'
  );

  let editorComponent: any = null;

  async function handlePickFolder() {
    try {
      const folder = await api.pickFolder();
      if (folder) {
        currentFolderPath = folder;
        entries = await api.listDir(folder);
      }
    } catch (e) {
      console.error('Failed to pick folder:', e);
    }
  }

  async function handleSelectFile(entry: Entry) {
    try {
      const text = await api.readFile(entry.path);
      editorContent = text;
      activeFilename = entry.name;
      activeFilePath = entry.path;
    } catch (e) {
      console.error('Failed to read file:', e);
    }
  }

  async function runBenchmark(view: EditorView) {
    statusText = 'Benchmarking...';
    console.log('[PETAK_BENCH] Starting benchmark suite...');

    try {
      // Step 2: Buka file 50k baris
      // Path: ~/petak-bench/Big50k.kt (resolve homedir or check /tmp/petak-bench or /Users/uqi/petak-bench)
      const possible50kPaths = [
        '/Users/uqi/petak-bench/Big50k.kt',
        '/tmp/petak-bench/Big50k.kt',
      ];
      let big50kPath = possible50kPaths[0];

      console.log('[PETAK_BENCH] Measuring open 50k lines (5 runs)...');
      const openRuns: number[] = [];

      for (let run = 0; run < 5; run++) {
        // Clear editor first
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

      // Step 3: Latency ketik di file 10k baris
      const possible10kPaths = [
        '/Users/uqi/petak-bench/Big10k.kt',
        '/tmp/petak-bench/Big10k.kt',
      ];
      const big10kPath = possible10kPaths[0];

      console.log('[PETAK_BENCH] Measuring typing latency on 10k lines (200 insertions)...');
      const content10k = await api.readFile(big10kPath);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content10k },
      });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Move cursor to middle of file
      const midPos = Math.floor(view.state.doc.length / 2);
      view.dispatch({ selection: { anchor: midPos, head: midPos } });

      const typingSamples: number[] = [];
      for (let i = 0; i < 200; i++) {
        const char = String.fromCharCode(97 + (i % 26)); // 'a'..'z'
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

      // Step 4: F0.2 Tree-sitter Benchmark (Dart, Kotlin, Swift)
      console.log('[PETAK_BENCH] Starting F0.2 Tree-sitter Benchmark...');

      // Signal for RAM measurement before loading WASM grammars
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

      // Signal for RAM measurement after loading WASM grammars
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

        // 1. Switch filename
        activeFilename = langItem.file;
        activeFilePath = filePath;

        // Clear editor
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        // Read 10k content
        const content = await api.readFile(filePath);

        // 2. Measure full initial parse
        const plugin = view.plugin(treeSitterPlugin);
        const tInitial0 = performance.now();
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const tInitial1 = performance.now();
        const initialParseFullTimeMs = plugin?.lastInitialParseMs || (tInitial1 - tInitial0);
        console.log(`[PETAK_BENCH] ${langItem.name} initial parse: ${initialParseFullTimeMs.toFixed(2)} ms`);

        // 3. Move cursor to middle of file
        const midPos = Math.floor(view.state.doc.length / 2);
        view.dispatch({ selection: { anchor: midPos, head: midPos } });
        await new Promise((r) => requestAnimationFrame(r));

        // 4. 200x insert 1 character
        const incParseSamples: number[] = [];
        const queryDecoSamples: number[] = [];
        const frameSamples: number[] = [];

        for (let i = 0; i < 200; i++) {
          const char = String.fromCharCode(97 + (i % 26)); // 'a'..'z'
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
        console.log(
          `[PETAK_BENCH] ${langItem.name}: Initial=${initialParseFullTimeMs.toFixed(1)}ms, IncP50=${incStats.p50.toFixed(2)}ms, DecoP50=${queryStats.p50.toFixed(2)}ms, FrameP50=${frameStats.p50.toFixed(2)}ms, Pass=${frameStats.p50 <= 16.0}`
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
        // Run benchmarks automatically
        setTimeout(() => runBenchmark(view), 200);
      }
    } catch (e) {
      console.warn('api.benchMode error:', e);
    }
  }

  onMount(async () => {
    // Initial folder auto-load if in petak project
    const candidates = ['/Users/uqi/petak', '/mnt/storage/uqi-projects/petak', '.'];
    for (const dir of candidates) {
      try {
        const list = await api.listDir(dir);
        if (list && list.length > 0) {
          currentFolderPath = dir;
          entries = list;
          break;
        }
      } catch (_) {}
    }

    // Periodic file open trigger from /tmp/petak_open.txt
    const checkOpenTarget = async () => {
      try {
        const p = await api.readFile('/tmp/petak_open.txt');
        if (p && p.trim()) {
          const target = p.trim();
          if (target !== activeFilePath) {
            const text = await api.readFile(target);
            editorContent = text;
            activeFilename = target.split('/').pop() || target;
            activeFilePath = target;
          }
        }
      } catch (_) {}
    };

    checkOpenTarget();
    const interval = setInterval(checkOpenTarget, 500);
    return () => clearInterval(interval);
  });
</script>

<div class="app-layout">
  <TitleBar
    projectName={currentFolderPath ? currentFolderPath.split('/').filter(Boolean).pop() || 'petak' : 'petak'}
    branchName="main"
    onPickFolder={handlePickFolder}
  />

  <div class="main-body">
    <Rail />
    <FileTree
      {entries}
      folderPath={currentFolderPath}
      {activeFilePath}
      onPickFolder={handlePickFolder}
      onSelectFile={handleSelectFile}
    />
    <Editor
      bind:this={editorComponent}
      content={editorContent}
      filename={activeFilename}
      filepath={activeFilePath}
      onReady={onEditorReady}
    />
  </div>

  <StatusBar
    branchName="main"
    {statusText}
    {isBench}
    {fileType}
    {cursorInfo}
  />
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
