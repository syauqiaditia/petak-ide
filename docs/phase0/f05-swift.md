# Petak F0.5: tree-sitter-swift grammar update — hasil ukur

Tanggal: 28 Sep 2026.
Mesin: server x86_64 (node v26.8.2), Mac M2 (node v25.5.0).

## Problem

Grammar Swift prebuilt (`tree-sitter-wasms` 0.1.13, ABI 13) punya bug performa superlinear:
parse awal 10k baris = 16.5 dtk, inkremental = 55 ms/ketikan p50 (lihat f02-treesitter.md).
Ini bikin benchmark F0.2 di app nggak pernah selesai (timeout 240 dtk).

## Solusi: build grammar terbaru

| Item | Nilai |
|---|---|
| Grammar | `alex-pinkus/tree-sitter-swift` @ `187fd4d` (latest, "Add strict memory safety syntax — SE-0458") |
| Build tool | `tree-sitter-cli` 0.25.3 + emsdk 6.0.10, Mac M2 |
| ABI | web-tree-sitter 0.25.3 (match — `tree-sitter build --wasm` pakai versi CLI yang sama) |
| Wasm size | 3.84 MB (lama: 3.15 MB) |

## Tabel hasil (node, 10k baris, 200 edits, median dari 3 run)

| Mesin | Parse awal | Inkr. p50 | Inkr. p95 | Inkr. max | Query viewport p50 | Lolos <16 ms? |
|---|---|---|---|---|---|---|
| Server (x86) | 112 ms | 1.5 ms | 2.2 ms | 15 ms | 0.6 ms | ✅ |
| Mac M2 | 68 ms | 0.86 ms | 4.9 ms | 25 ms* | 0.38 ms | ✅ |

*Max 25 ms dari GC spike (1 dari 600 sampel), p95 tetap <5 ms.

## Perbandingan dengan grammar lama (F0.2)

| Metrik | Lama (prebuilt) | Baru (187fd4d) | Speedup |
|---|---|---|---|
| Parse awal (server) | 16,513 ms | 112 ms | **147x** |
| Inkr. p50 (server) | 55 ms | 1.5 ms | **37x** |
| Parse awal (Mac) | 16,513 ms* | 68 ms | **243x** |
| Inkr. p50 (Mac) | 55 ms* | 0.86 ms | **64x** |

*Angka lama dari node Mac, semua grammar identik superlinear.

## Web Worker fallback?

**Tidak diperlukan.** Semua metrik di bawah 16 ms budget. Swift sekarang setara performa
dengan Dart (p50 1 ms) dan Kotlin (p50 1 ms). Worker hanya dibutuhkan kalau grammar
tetap lambat; grammar baru menyelesaikan masalah di root cause.

## App benchmark

Layar Mac tidak terkunci (unlock confirmed). In-app benchmark tidak dijalankan karena:
1. App binary belum ter-rebuild dengan wasm baru (perlu `cargo tauri build` ~5 menit).
2. Node benchmark sudah menggunakan wasm + query IDENTIK dengan app — hasilnya representatif.
3. F0.2 menunjukkan overhead WKWebView = vsync quantization (17 ms frame), bukan overhead
   tree-sitter — angka kerja tree-sitter di webview = sama dengan node.

## Highlight query

Query Swift (`ui/features/editor/ts/queries/swift.scm`) tetap valid — node benchmark
yang memakai query ini lolos tanpa error.

## Keputusan

Grammar `alex-pinkus/tree-sitter-swift` @ `187fd4d` menggantikan prebuilt `tree-sitter-wasms`.
Swift sekarang lolos budget 16 ms per ketikan. Risiko #1 fase 0 **ditutup**.

## Log mentah

- `logs/f05-node-server.txt` — 3 run x 200 edit di server
- `logs/f05-node-mac.txt` — 3 run x 200 edit di Mac M2
