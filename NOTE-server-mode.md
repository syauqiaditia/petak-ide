# MODE SERVER — Mac UQi OFFLINE (UQi keluar)

Mulai sekarang kerjain fase 2 di SERVER, jangan SSH ke Mac (bakal timeout). UQi mau pas balik tinggal tes tanpa blocker.

## Toolchain server (udah dicek Hermes, jalan)
```
export CARGO_HOME=/mnt/storage/uqi-cache/cargo RUSTUP_HOME=/mnt/storage/uqi-cache/rustup \
       CARGO_TARGET_DIR=/mnt/storage/uqi-cache/cargo-target-petak \
       PATH=/mnt/storage/uqi-cache/cargo/bin:$PATH
cd /mnt/storage/uqi-projects/petak
cargo test -p petak-core      # 63 test lolos (55 unit + 8 integrasi)
npm run build                 # UI build lolos
```
- Dart LS: `dart language-server` (Dart 3.9.2 di PATH, /mnt/storage/flutter-uqi).
- Kotlin LS (fwcd 1.3.13): `/mnt/storage/uqi-cache/lsp/server/bin/kotlin-language-server` (Java 21 ada).
- Swift sourcekit-lsp: GA ADA di server → Swift dites di Mac nanti. Kode Swift tetap ditulis (config server aja beda).
- Tauri app (`crates/app`) GA BISA dibuild di server (ga ada webkit2gtk, sudo butuh password). `cargo check -p petak-app` kemungkinan gagal di link/pkg-config — jangan buang waktu di situ.
- SSD `/` hampir penuh: semua cache di /mnt/storage.

## Cara verifikasi tanpa Mac
- Logic di `crates/core`: unit test + integration test pakai LSP asli (Dart & Kotlin) di server — mis. diagnostics masuk, completion `Tex`→`Text`, code action "Wrap with Padding" → apply WorkspaceEdit → teks hasil bener. Ini bukti utama.
- UI (Svelte/CM6): `npm run build` + test logic murni kalau ada (mapping posisi, konversi diagnostics→CM6 lint, render completion). Kalau perlu lihat UI: `npm run dev` (vite) di browser Chromium headless (ada di ~/.cache/ms-playwright) dengan `ui/lib/api.ts` di-mock — HANYA buat cek tampilan, bukan bukti fitur jalan, dan tandai jelas "preview browser, bukan app".
- Commit sering.

## Yang ditunda ke Mac (JANGAN block task karena ini)
Build .app, bench di app (ketik/cold start/popup latency), screenshot app asli, Swift LSP, install /Applications.
→ Kumpulin semuanya ke SATU task akhir "P2.M Verifikasi di Mac" (senior) dengan checklist + script siap jalan (`scripts/phase2-mac-verify.sh`: build, bench, screenshot, ditto ke /Applications), plus daftar langkah tes manual buat UQi (5–10 langkah, bahasa simpel). Task itu boleh blocked nunggu Mac; task lain jangan.
- P2.5 (bench+install) & P2.7 (QA) bagian yang butuh Mac pindahin ke P2.M; bagian server (test core, review kode, report draft) tetap jalan.
