# Petak F0.2: Tree-sitter WASM highlight (Dart/Kotlin/Swift) — hasil ukur

Tanggal: 27 Sep 2026. Mesin: Mac UQi (Apple M2, 8 GB, macOS 26.5), Petak.app release (Tauri 2 + WKWebView).
Stack: `web-tree-sitter` 0.25.3 + grammar `.wasm` di `ui/public/ts/`, query `ui/features/editor/ts/queries/{dart,kotlin,swift}.scm`,
plugin `ui/features/editor/ts/highlight.ts` (parse awal, `tree.edit()` + `parser.parse(text, oldTree)`, query cuma `view.visibleRanges`).
File uji: `~/petak-bench/Big10k.{dart,kt,swift}` (10.000 baris, dari `scripts/gen-bench.mjs`), 200x insert 1 karakter di tengah file.

## Tabel utama (di dalam app, WKWebView)

| Bahasa | Parse awal | Parse inkremental p50/p95 | Query+deco viewport p50/p95 | Frame dispatch→rAF p50/p95/max | Lolos <16 ms? |
|---|---|---|---|---|---|
| Dart   | 357 ms | 1 / 1 ms | 0 / 1 ms | 17 / 17 / 19 ms | Kerja TS ✅ (~2 ms). Frame 17 ms = 1 vsync, sama dgn baseline tanpa TS |
| Kotlin | 84 ms  | 1 / 1 ms | 0 / 1 ms | 17 / 18 / 19 ms | Kerja TS ✅ (~2 ms). Frame idem baseline |
| Swift  | **GAGAL** — tidak selesai | — | — | — | ❌ |

Baseline tanpa tree-sitter (bench F0.1, run yang sama): ketik 10k baris p50 17 / p95 17 / max 20 ms. Jadi highlight tree-sitter
**tidak menambah frame** untuk Dart & Kotlin; angka 17 ms adalah kuantisasi vsync 60 Hz dari metode ukur dispatch→rAF, bukan biaya highlight.
Catatan presisi: `performance.now()` di WKWebView dibulatkan ke 1 ms, makanya nilai muncul 0/1/17.

Swift di app: bench jalan sampai `Running tree-sitter benchmark for swift...` lalu runner timeout 240 dtk tanpa hasil (log: `logs/f02-bench-app.txt`).
Run ulang dgn timeout 900 dtk batal karena layar Mac terkunci (WebKit nge-throttle, log macet sebelum bench mulai) — lihat `logs/f02-ram.txt`.

## Angka pembanding di luar webview (node v26 di Mac yang sama, wasm + query identik)

Log: `logs/f02-bench-node-mac.txt` (script `scripts/f02_node_bench.mjs`).

| Bahasa | Parse awal | Inkremental p50/p95/max | Query viewport p50/p95 |
|---|---|---|---|
| Dart   | 83 ms | 0.33 / 0.39 / 1.8 ms | 0.40 / 0.65 ms |
| Kotlin | 47 ms | 0.30 / 0.43 / 2.4 ms | 0.28 / 0.35 ms |
| Swift  | **16.513 ms** | 55 / 73 / 73 ms (20 sampel) | 0.29 / 0.42 ms |

Swift = masalah grammar `tree-sitter-swift` (prebuilt, ABI 13), bukan webview: parse awal 16,5 dtk dan tiap ketikan 35–73 ms,
jauh di atas 16 ms. Di server (node, x86) juga sama: 1k baris 31 ms, 2k baris 1,2 dtk, 5k baris 7 dtk (superlinear),
dan waktunya nggak stabil: parse penuh 10k pernah 29 dtk, pernah 124 ms lalu edit inkremental pertama sesudahnya 30 dtk. Ini yang bikin bench Swift di app nggak pernah selesai.

## Ukuran wasm (di-commit, `ui/public/ts/`)

| File | Byte |
|---|---|
| tree-sitter.wasm (runtime) | 205.965 |
| tree-sitter-dart.wasm | 984.666 |
| tree-sitter-kotlin.wasm | 4.052.705 |
| tree-sitter-swift.wasm | 3.147.876 |
| **Total** | **8.391.212 (~8,0 MiB)** |

## RAM tambahan

WebContent RSS sebelum load 3 grammar 178,9 MB → sesudah 219,7 MB = **+40,7 MB** (`ps -o rss=`, log `logs/f02-ram.txt`).
Waktu preload 3 grammar + compile query: 1.076 ms.

## Screenshot

`screens/ts-dart.png`, `screens/ts-kotlin.png`, `screens/ts-swift.png` — highlight berwarna di app asli (dicek vision: keyword oranye,
tipe ungu, string hijau, angka cyan, komentar abu miring). Sample kecil Swift (48 baris) highlight normal; masalahnya cuma di file besar.

## Kesimpulan

- Dart & Kotlin: **lolos** — kerja tree-sitter per ketikan ~1–2 ms di webview, frame sama dengan tanpa highlight.
- Swift: **gagal** dengan grammar prebuilt `tree-sitter-wasms` — 16,5 dtk parse awal, 55 ms/ketikan (node), di app nggak selesai.
  Opsi berikut (butuh keputusan): build `alex-pinkus/tree-sitter-swift` terbaru ke wasm (`tree-sitter build --wasm`, perlu emscripten/docker),
  atau parse Swift di Rust (native tree-sitter) / di Web Worker dengan timeout + fallback tanpa highlight.
- Perubahan kecil di run ini: polling `/tmp/petak_open.txt` dimatikan saat mode bench (dia sempat nimpa file bench), runner bench
  membersihkan file itu dan timeout dinaikkan ke 900 dtk.
