# F0.3 — Smoke Test LSP + ACP Handshake

Spike fase 0 bagian 3. Tes server LSP (Dart, Swift, Kotlin) nyala dan ngirim diagnostics + ACP handshake ke coding agent, semua di Mac M2 UQi.

## Lingkungan

- Mac M2 (MuhammadAditiaSyauqi-DBPDiv3), macOS
- Node v26.8.2 (`~/.local/bin/node`)
- Disk awal: ~7 GB, akhir: ~5.1 GB (kotlin-lsp 1.1 GB)
- Script: `spike/lsp-smoke.mjs` (LSP), `spike/acp-smoke.mjs` (ACP di Mac), `spike/hermes-acp-smoke.mjs` (Hermes ACP di server)

## LSP Results

| Server | Versi | Nyala? | Diagnostics masuk? | Contoh pesan | Waktu ke diagnostics | RSS puncak | Catatan |
|--------|-------|--------|--------------------|--------------|---------------------|------------|---------|
| Dart analysis server | Dart SDK 2.16.2 (Flutter 2.10.5) | ✅ | ✅ | "A value of type 'String' can't be assigned to a variable of type 'int'." | 1871 ms | 143.9 MB | Versi lama (2022) tapi LSP jalan sempurna. Pakai `dart language-server --protocol=lsp`. |
| sourcekit-lsp (Swift) | Swift 6.3.1 (Xcode terbaru) | ✅ | ✅ | "Cannot convert value of type 'String' to specified type 'Int'" | 2778 ms | 63.3 MB | Paling ringan. `xcrun sourcekit-lsp`, built-in, zero setup. |
| Kotlin/kotlin-lsp (JetBrains) | v263.4702.0 (IntelliJ-based) | ✅ (initialized) | ❌ (timeout 300s) | — | >300 s | 481.8 MB | Berat. Download Gradle 9.7.0 di run pertama. Run kedua (Gradle cached) tetap timeout — indexing IntelliJ lambat. Ukuran install 1.1 GB + ~15 GB .gradle cache. Butuh `--stdio` flag. |

### Catatan per server

**Dart**: analysis server dari Dart SDK bawaan Flutter 2.10.5. Meskipun versi lama, LSP protocol-nya lengkap dan diagnostics muncul cepat (< 2 detik). Path: `~/SDK/flutter_2.10.5/bin/cache/dart-sdk/bin/dart`.

**Swift**: sourcekit-lsp built-in macOS, zero install, paling ringan (63 MB). Diagnostics muncul dalam ~3 detik.

**Kotlin LSP (JetBrains)**: ini server baru berbasis IntelliJ Platform, standalone. Download dari [Kotlin/kotlin-lsp releases](https://github.com/Kotlin/kotlin-lsp/releases/tag/kotlin-lsp/v263.4702.0). Perlu `bin/intellij-server --stdio`. Server berhasil initialize + terima didOpen, tapi tidak kirim non-empty diagnostics dalam 300 detik. Kemungkinan: Gradle sync + IntelliJ indexing sangat lambat untuk project kecil pun. RSS puncak 481 MB — jauh lebih berat dari Dart/Swift. Bundled JBR sudah termasuk (ga perlu install JDK terpisah), tapi JDK 19 dari Mac juga terdeteksi.

> Alternatif: [fwcd/kotlin-language-server](https://github.com/fwcd/kotlin-language-server) v1.3.13 — community, lebih ringan, tapi juga butuh Gradle sync.

**Real project test** (indorack-android di `~/Documents/Coding/Mobile Flutter/`): belum dijalankan karena kotlin-lsp fixture sudah timeout 300s — diprediksi lebih lama lagi dengan project besar.

## ACP Results

| Agent | Handshake? | sessionId? | Auth | RSS puncak | Catatan |
|-------|-----------|------------|------|------------|---------|
| `@zed-industries/claude-code-acp` (npx) | ✅ | ✅ `001be519-...` | OK (session langsung jadi, login Claude Code sudah ada) | 237.7 MB | Package deprecated, renamed ke `@agentclientprotocol/claude-agent-acp`. Supports image, embeddedContext, MCP http+sse, session fork/list/resume. |
| `@anthropic-ai/claude-code-acp` (npx) | ❌ | — | — | — | Package 404 — tidak ada di npm. |
| `@anthropics/claude-code-acp` (npx) | ❌ | — | — | — | Package 404 — tidak ada di npm. |
| opencode acp | ❌ | — | — | — | opencode tidak terinstall di Mac. |
| Hermes ACP (`hermes acp`, di server) | ✅ | ✅ `0cce11b0-...` | OK (pakai custom runtime credentials yang sudah terkonfigurasi) | 159.9 MB | v0.21.2. Supports image, session fork/list/resume. Auth via configured provider. Model list lengkap (Anthropic, OpenAI, dll). |

### ACP Detail

**Claude Code ACP** (di Mac): Handshake sukses penuh via `@zed-industries/claude-code-acp`. Initialize → agentCapabilities + authMethods → session/new → sessionId. Claude Code sudah login di Mac jadi session langsung jadi. Auth method: "Run `claude /login` in the terminal". Package ini deprecated dan akan pindah ke `@agentclientprotocol/claude-agent-acp`.

**Hermes ACP** (di server): ✅ Ada dan jalan. `hermes acp --version` = 0.21.2, `hermes acp --check` = OK. Handshake via stdio JSON-RPC sukses — initialize response berisi agentCapabilities (image prompt, session fork/list/resume), authMethods (custom runtime credentials + hermes-setup). session/new langsung berhasil (sessionId dapet) karena Hermes sudah terkonfigurasi di server. RSS 160 MB.

Dokumentasi Hermes ACP:
- `hermes acp --help` menunjukkan: "Start Hermes Agent in ACP mode for editor integration (VS Code, Zed, JetBrains)"
- Opsi: `--accept-hooks`, `--version`, `--check`, `--setup`, `--setup-browser`
- Domain `claude-code.nousresearch.com/docs` tidak resolve (DNS error). Docs ada di `hermes-agent.nousresearch.com/docs`.
- Evidence: log mentah di `docs/phase0/logs/f03-hermes.txt`.

## Log Files

- `docs/phase0/logs/f03-dart.txt` — Dart LSP full output
- `docs/phase0/logs/f03-swift.txt` — Swift sourcekit-lsp full output
- `docs/phase0/logs/f03-kotlin.txt` — Kotlin LSP full output (timeout)
- `docs/phase0/logs/f03-acp-claude.txt` — Claude Code ACP handshake output
- `docs/phase0/logs/f03-hermes.txt` — Hermes ACP handshake output

## Ringkasan

- **2 dari 3 LSP server** berhasil full (spawn → initialize → diagnostics non-kosong). Dart dan Swift jalan out-of-the-box.
- **Kotlin LSP** nyala tapi terlalu lambat untuk kasih diagnostics dalam 5 menit. Ini blocker kalau mau real-time diagnostics — perlu strategi (lazy loading, background indexing, atau fallback ke fwcd/kotlin-language-server).
- **ACP handshake berhasil** ke Claude Code (via npx deprecated package) dan Hermes ACP (native). Dua agent siap dipakai.
- Disk impact: kotlin-lsp 1.1 GB + 15 GB .gradle cache (sudah ada sebelumnya). Sisa disk Mac 5.1 GB.
