# F0.3 — Smoke test LSP + ACP handshake

Spike fase 0 bagian 3. Semua angka di bawah diambil dari log mentah di `docs/phase0/logs/`. LSP + ACP Claude jalan di Mac M2 UQi; Hermes ACP jalan di server (uqiflutter1).

Script (Node murni, tanpa dependency npm):
- `spike/lsp-smoke.mjs [dart|swift|kotlin]` — Content-Length JSON-RPC: spawn → initialize → initialized → didOpen → tunggu `publishDiagnostics` non-kosong → shutdown/exit. RSS = `ps -o rss=` proses + anak + cucu (`pgrep -P`), dipoll tiap 1 detik.
- `spike/acp-smoke.mjs` — ACP newline-delimited JSON-RPC: initialize (protocolVersion 1, fs read/write false) → session/new (cwd fixture, mcpServers []).
- `spike/hermes-acp-smoke.mjs` — handshake yang sama ke `hermes acp`, jalan di server.
- Fixture `spike/fixtures/{dart,swift,kotlin}`, masing-masing punya 1 error tipe yang disengaja (`int/Int = "hello"`).

Env Mac: Node v26.8.2, disk bebas ~6.9 GB di awal → 5.1 GB di akhir.

## LSP

| Server | Versi | Nyala? | Diagnostics masuk? (contoh) | Waktu ke diagnostics pertama | RSS puncak | Catatan |
|---|---|---|---|---|---|---|
| Dart (`dart language-server --protocol=lsp`) | Dart SDK 2.16.2 (Flutter 2.10.5, `~/SDK/flutter_2.10.5`), binary x64 via Rosetta | ✅ | ✅ "A value of type 'String' can't be assigned to a variable of type 'int'." | 1884 ms | 143.2 MB | SDK 2022, LSP tetap jalan normal. Ada juga Flutter 3.16/3.19/3.35 di `~/SDK`. |
| Swift (`xcrun sourcekit-lsp`) | Apple Swift 6.3.1 (Xcode) | ✅ | ✅ "Cannot convert value of type 'String' to specified type 'Int'" | 2864 ms | 137.4 MB | Bawaan Xcode, tanpa install. |
| Kotlin (`kotlin-lsp`, `bin/intellij-server --stdio`) | Kotlin/kotlin-lsp v263.4702.0 (standalone aarch64, JBR sudah dibundel) | ✅ (initialize OK) | ❌ cuma dapat 2x `publishDiagnostics` kosong, habis timeout 300 dtk | >300 dtk (timeout) | 481.8 MB | Lihat catatan di bawah. |

### Catatan Kotlin
- Install: zip 343 MB → **1.1 GB** setelah diekstrak di `~/petak-tools/kotlin-lsp/`. Zip-nya sudah dihapus.
- Wajib pakai flag `--stdio`. Tanpa flag itu, server listen di socket 127.0.0.1:9999 dan tidak merespons stdio. Run pertama sudah dicoba tanpa `--stdio` dan kena timeout; RSS-nya 270 MB. `kotlin-lsp.sh` sekarang deprecated dan diganti `bin/intellij-server`.
- Run pertama yang pakai `--stdio` sempat download Gradle 9.7.0 (163 MB, ke `~/.gradle/wrapper/dists`). Run berikutnya, dengan Gradle sudah di-cache, **tetap timeout** 300 dtk: server cuma kirim diagnostics kosong. Yang dicatat di log adalah run terakhir itu.
- Dugaan (belum dibuktikan): Gradle import atau indexing IntelliJ belum kelar dalam 5 menit, atau error baru dikirim setelah import selesai. Log internal server ada di `/var/folders/.../idea-system*/system/log/intellij-server.log`, tapi folder temp itu sudah hilang setelah proses exit. Kalau mau diselidiki lebih lanjut: pakai `--system-path` biar log-nya tetap tersimpan, atau coba pull diagnostics (`textDocument/diagnostic`).
- Tes di project Android asli: **N/A**. Satu-satunya hasil `find ~/Documents ~/Projects ~/StudioProjects -maxdepth 4 -name 'settings.gradle*'` adalah `~/Documents/Coding/Mobile Flutter/indorack-android`, dan isinya 0 file `.kt` (project Java). Selain itu ada perubahan UQi yang belum di-commit, jadi sengaja tidak disentuh.

## ACP

| Agent | Handshake? | sessionId? | Auth | RSS puncak | Catatan |
|---|---|---|---|---|---|
| `npx -y @zed-industries/claude-code-acp` (Mac) | ✅ | ✅ `a63dfe9f-c872-4944-8092-b8bada6287f0` | Tidak perlu login baru; authMethods `claude-login` ("Run `claude /login`"). session/new langsung jalan pakai login Claude Code yang sudah ada. | 186.5 MB (termasuk wrapper npx) | v0.16.2, **deprecated** → sekarang `@agentclientprotocol/claude-agent-acp`. Capabilities: image, embeddedContext, MCP http/sse, loadSession, session fork/list/resume. |
| `@anthropic-ai/claude-code-acp`, `@anthropics/claude-code-acp` | ❌ | — | — | — | npm 404, paketnya tidak ada. |
| `opencode acp` | — | — | — | — | opencode tidak terpasang di Mac, jadi dilewati. |
| `hermes acp` (server) | ✅ | ✅ `0cce11b0-462a-48cd-82b8-3ad224fe6e65` | authMethods `custom` (kredensial runtime yang sudah dikonfigurasi) + `hermes-setup` (terminal). Session langsung jadi. | 159.9 MB | Capabilities: image, loadSession, session fork/list/resume. |

Tidak ada `session/prompt` yang dikirim, jadi tidak ada biaya.

## Hermes ACP: **YA, ada dan jalan**

Buktinya:
- `hermes --help` → ada subcommand `acp`: "Run Hermes Agent as an ACP (Agent Client Protocol)".
- `hermes acp --help` → "Start Hermes Agent in ACP mode for editor integration (VS Code, Zed, JetBrains)". Opsinya `--check`, `--setup`, `--version`, `--accept-hooks`, `--setup-browser`.
- `hermes acp --version` → `0.21.2`; `hermes acp --check` → `Hermes ACP check OK`.
- Handshake beneran sampai dapat sessionId, lihat `logs/f03-hermes.txt`. Stderr server mencatat `Initialize from petak-spike (protocol v1)` dan `Created ACP session ...`.
- URL docs yang ditulis di task (`claude-code.nousresearch.com/docs`) tidak resolve dari server (curl exit 6, DNS). Jadi buktinya cukup dari CLI dan handshake di atas.
- Catatan: tesnya di server, bukan di Mac, karena Hermes tidak terpasang di Mac. Kalau Petak mau pakai Hermes dari Mac, harus install Hermes di Mac dulu, atau bikin jembatan stdio lewat `ssh server hermes acp`. Opsi SSH ini belum dites.

## Kesimpulan
- Dart dan Swift lolos: diagnostics masuk dalam < 3 dtk, RSS sekitar 140 MB per server.
- Kotlin (kotlin-lsp JetBrains) **belum lolos**: server nyala, tapi tidak ada diagnostics dalam 5 menit, RSS ~480 MB, install 1.1 GB. Ini risiko terbesar buat fitur Kotlin. Opsinya: selidiki lewat log server dan pull diagnostics, coba fwcd/kotlin-language-server, atau Kotlin cukup pakai highlight tree-sitter dulu di fase awal.
- ACP: 2 agent berhasil handshake sampai dapat sessionId (Claude Code ACP di Mac, Hermes ACP di server).

## Log mentah
- `logs/f03-dart.txt`, `logs/f03-swift.txt`, `logs/f03-kotlin.txt`
- `logs/f03-acp-claude.txt` (semua kandidat ACP di Mac, termasuk yang 404 dan opencode)
- `logs/f03-hermes.txt`
