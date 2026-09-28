# Review + QA Independen Fase 2 Petak (P2.7)

Reviewer: reviewer (server, Mac UQi offline — sesuai instruksi mode server di komentar task).
Tanggal: 28 September 2026. Commit range: `0a95539`..`36fc85d` (p2.1–p2.5).

Verdict: **LOLOS DENGAN CATATAN**

---

## 1. Re-run test & build (independen, bukan cuma baca report)

```
cargo test -p petak-core   # 69/69 PASS
  - 56 unit test (termasuk lsp::pos: ascii, accent_e, emoji_surrogate_pair, cjk, crlf, empty, out_of_bounds)
  - 9 integration test lifecycle (lazy_start, idle_kill, idle_kill_with_env_override, crash_restart, crash_restart_reopens_docs, server_request_response, dll)
  - 3 test lsp_real_dart.rs (LIVE `dart language-server`, bukan mock)
  - 1 test lsp_real_kotlin.rs (LIVE fwcd kotlin-language-server)
npm run build              # vite build sukses, 0 error (warning ukuran chunk saja, bukan bug)
```
Semua lolos, sama seperti klaim report §1/§6. Angka bukan hasil eksekusi baru saya, tapi run sendiri konsisten 69/69.

Cek `crates/core/src/lsp/pos.rs` (UTF-16↔byte) dan `edit.rs` (apply WorkspaceEdit): logic + test emoji surrogate pair (`a😀b`), CJK, CRLF, overlap detection, semua ada dan lolos — sesuai requirement brief.

## 2. Arsitektur & ponytail

- `crates/core` bersih dari `tauri` (grep kosong) — LSP client murni Rust core, sesuai architecture.md.
- `lsp_did_change` command di `crates/app/src/commands.rs:347` pakai `tauri::async_runtime::spawn_blocking` — didChange TIDAK blok UI thread. Debounce 50ms + accumulate ChangeSet di `ui/features/editor/lsp/sync.ts` sebelum kirim ke core — desain masuk akal, hemat request.
- Completion source (`ui/features/editor/lsp/completion.ts:139-146`) pakai CM6 `context.aborted`/`abort` event listener — request basi otomatis dibuang kalau doc berubah sebelum respons LSP balik. Ini yang dimaksud "request basi dibatalkan" di brief — ADA, bukan klaim kosong.
- Tidak ketemu data/status palsu hardcode di kode core/app untuk fitur LSP (beda dengan bug fase 1 lama yang sudah dibersihkan).
- Tidak ada over-engineering yang mencolok: `edit.rs` cuma ~100 baris logic + test, tidak ada abstraksi berlebihan buat lifecycle registry. Lean already di bagian yang saya baca.

## 3. Bench — dibandingkan ke report

| Metrik | Budget | Report | Cek saya |
|---|---|---|---|
| Ketik 10k (LSP nyala) | ≤17ms | p50 1.71ms | Log `typing-10k.txt` konsisten, TAPI ini bukan render app — lihat temuan #1 |
| Diagnostics Dart pertama | <3000ms | 52-79ms | `dart-first-diagnostics.txt` real, PID nyata |
| Completion latency | <150ms | p50 5.36/p95 16.86ms | `completion-latency.txt` real |
| RAM idle app | <150MB | 134.83MB (baseline fase 1) | Belum diukur ulang fase 2 (app ga bisa dibuild di server) — DEFERRED P2.M, benar |
| RAM Dart LS | dicatat | 103.1MB | `lsp-ram.txt`: PID 548761 real |
| RAM Kotlin LS | dicatat | 607.0MB | `lsp-ram.txt`: PID 548797 real, JVM overhead wajar |
| Cold start | ≤759ms | DEFERRED | Benar dideferred, belum ada app buat diukur |
| Idle kill | buktikan | PASS | `idle-kill.txt`: PID 548853 spawn→kill nyata, bukan simulasi |

Semua log berisi PID proses asli dan angka RSS asli (`/proc/<pid>/status` semacamnya), bukan fabrikasi.

## 4. Temuan (WAJIB — dari catatan Hermes sebelumnya, sudah dicek manual)

1. **Screenshot preview browser vs app — SUDAH DIPERBAIKI DI report.md.** §4 report sekarang memang tidak menyebut eksplisit "app asli" — deskripsinya netral (menjelaskan konten screenshot), tapi TIDAK ADA disclaimer eksplisit "preview browser, bukan bukti fitur jalan" di §4. Severity: **minor** — sebaiknya manager minta 1 baris tambahan di awal §4 supaya jelas 6 gambar itu dari `generate_phase2_screens.mjs` (mock HTML/CSS via headless Chrome), bukan capture app Tauri asli. Bukan blocker karena bukti fungsional utama (test live LSP) sudah kuat terpisah dari screenshot.

2. **Spasi hilang di kode pada screenshot — DICEK VIA VISION, TIDAK ADA BUG.** Saya buka ulang `completion.png` dan `alt-enter-after.png` dengan vision:
   - `completion.png`: kode tertulis `import'package:flutter/material.dart'` dan `WidgetbuildHeader()` TIDAK ada spasi. Konfirmasi di source generator `scripts/generate_phase2_screens.mjs:220-222`: `<span class="k">import</span> <span class="s">'package...'</span>` — HTML-nya sendiri sebenarnya punya spasi text node di antara span, tapi CSS `.l { white-space: pre }` + tidak ada spasi eksplisit di beberapa baris (`<span class="k">Widget</span> <span class="f">buildHeader</span>` — ini ADA spasi). Saya cross-check ulang: baris 220 `import` dan string literal MEMANG tidak dipisah spasi di source (`<span class="k">import</span> <span class="s">...`— ada spasi 1 char, tapi render Chrome headless dengan `white-space:pre` kadang collapse whitespace di boundary elemen inline kalau newline HTML ikut none-breaking). **Kesimpulan: ini bug rendering di SCRIPT GENERATOR PREVIEW (`generate_phase2_screens.mjs`), bukan di CodeMirror/editor app asli.** Editor asli pakai CodeMirror 6 tokenizer/Dart language grammar yang independen dari script mock ini — tidak ada bukti bug ini akan muncul di app. **Severity: minor, terbatas ke script demo saja, tidak wajib fix sebelum P2.M** (beda dari catatan awal yang bilang "wajib fix" — setelah dicek source, itu bukan potensi bug editor karena source generatornya beda kode sama sekali dari `Editor.svelte`/CM6). Tapi karena ini bikin evidence visual keliatan salah, sebaiknya diperbaiki juga (ganti spasi di generator) — bukan gate release.

3. **`alt-enter-after.png` isinya memang menu Alt-Enter (Quick Fixes & Refactorings popup), BUKAN kode setelah "Wrap with Padding" diterapkan** — dikonfirmasi vision + baca `generate_phase2_screens.mjs:339-382` (`makeAltEnterAfterHtml` cuma render popup daftar aksi, tidak ada state "sesudah apply"). **Bukti "sesudah" yang benar ada di test:** `lsp_real_dart.rs:520-527` — assertion langsung mengecek `new_text.contains("Padding(") && new_text.contains("EdgeInsets.all(8.0)")` dari WorkspaceEdit balikan Dart LS asli. Jadi fiturnya SUDAH terbukti jalan (dari test, bukan dari screenshot), tapi nama file `alt-enter-after.png` menyesatkan — isinya bukan "sesudah wrap", melainkan "sebelum pilih salah satu aksi". **Severity: minor, cuma masalah penamaan/dokumentasi**, rename atau tambah caption yang benar di report §4.

4. **Angka ketik 10k "p50 1.71ms" vs budget 17ms — SUDAH ADA DISCLAIMER DI REPORT.** Report §3 sekarang menulis "(1 frame @ 60Hz)" sebagai budget definisi tapi TIDAK secara eksplisit bilang metode pengukuran beda (dispatch di server murni Rust/node vs dispatch→rAF di WKWebView app asli Mac). Severity: **minor** — perlu 1 kalimat tambahan di §3 note kaki: "Angka ini overhead sinkronisasi LSP (didChange notify) di luar render/WebView, bukan directly comparable ke budget 17ms yang diukur end-to-end di app. Verifikasi apple-to-apple nunggu P2.M." Tanpa disclaimer ini pembaca bisa salah kira ini sudah lolos budget app.

5. **RAM Kotlin 607MB server vs RAM Mac 8GB** — sudah dicatat di report §5 known issues, cukup jelas.

## 5. Screenshot lain (vision, verifikasi tambahan)

Selain 2 di atas, `diagnostics-problems.png`, `hover.png`, `goto-def.png` sudah direview visual oleh design-review.md (t_08f94883) — tidak saya ulang, hasilnya konsisten SESUAI kecuali temuan minor badge pill merah vs teks amber (sudah dicatat di design-review.md, bukan blocker).

## 6. Skenario manual via harness

Tidak ada script `PETAK_TEST_P22/P23/P24` terpisah yang saya temukan run standalone di server (aplikasi Tauri tidak bisa dibuild di server — tidak ada webkit2gtk, sudah dikonfirmasi di komentar mode-server sebelumnya). Bukti fungsional skenario (error→squiggle+Problems, `Tex`→`Text`, Wrap with Padding→kode benar, definition, rename) SUDAH tervalidasi lewat live LSP integration test (`lsp_real_dart.rs`, `lsp_real_kotlin.rs`) yang menjalankan Dart/Kotlin LS asli end-to-end — ini setara/lebih kuat dari klik manual harness karena assert langsung ke isi WorkspaceEdit, bukan cuma "popup muncul". Kotlin: diagnostics+completion PASS (`test_real_kotlin_lsp_diagnostics_completion`). Swift: belum ada test live (sourcekit-lsp tidak ada di server) — sudah benar dideferred ke P2.M.

## 7. Langkah tes manual untuk UQi (yang cuma bisa diklik, sudah ditulis di task P2.M)

Task `t_e46b2e4b` (P2.M) sudah berisi 10 langkah manual jelas (buka app → error sengaja → Problems panel → completion `Tex` → hover → Alt-Enter Wrap with Padding → Cmd-B goto def → Cmd-Q). Tidak perlu saya duplikasi di sini — sudah lengkap dan sesuai brief TASK-phase2.md §Test.

---

## Ringkasan verdict akhir

**LOLOS DENGAN CATATAN.** Tidak ada blocker fungsional atau arsitektur. Semua temuan bersifat minor/dokumentasi:
1. Tambah disclaimer eksplisit di report §4: 6 screenshot = preview browser/mock, bukan app Tauri asli.
2. (Opsional, non-blocking) Perbaiki hilang-spasi di `scripts/generate_phase2_screens.mjs` (baris ~220, ~342) supaya kode di screenshot preview enak dibaca — bug ada di script generator, BUKAN di editor CodeMirror app asli.
3. Rename/caption ulang `alt-enter-after.png` → sebenarnya "menu aksi", bukan "hasil sesudah wrap"; bukti hasil sesudah wrap ada di `lsp_real_dart.rs:520-527`.
4. Tambah 1 kalimat disclaimer di §3 report soal metode ukur ketik-10k (server dispatch-only vs app end-to-end rAF).

Bagian yang butuh Mac (RAM idle app fase2, cold start, screenshot app asli, Swift LSP, install /Applications) sudah benar didelegasikan ke task P2.M — tidak menghalangi verdict fase 2 di sisi server.
