# Petak Fase 5 — SPEC: Agent/Orkestrator + GitLab MR viewer

Status: SPEC saja. Belum ada kode. Kode mulai setelah batch2 (t_23fd0fa0) dan batch3 (t_19054fb8) merge dan terpasang.
Aturan keras: dilarang menyentuh GitLab kantor / PAT UQi / repo jatim-ist-mb-flutter untuk tes. Uji MR pakai mock server lokal. Uji nyata di GitLab kantor hanya oleh UQi, manual, read-only dulu.

## 0. Keputusan (dikunci manajer, berlaku untuk semua kartu)

1. Layer agent = ACP client di Rust core (`crates/core/src/agent/`). Satu proses ACP per slot (stdio JSON-RPC newline-delimited, terbukti Fase 0: claude-code-acp dan `hermes acp`).
2. Hermes-aware = deteksi, bukan dependensi. Kalau binary `hermes` ada di PATH (resolver toolchain yang sudah ada), Petak memakai Hermes. Kalau tidak, slot bawaan (Claude Code ACP / OpenAI-compatible) tetap jalan.
3. Tim disimpan per-project di `.petak/team.json` (bisa di-commit atau tidak) dengan fallback global `~/.config/petak/team.json`. Bukan di dalam repo project kalau user menolak.
4. Tidak ada orkestrator ala Hermes yang ditulis ulang. "Orkestrator ringan bawaan" = daftar slot + router prompt manual (user pilih tab, kirim). Tidak ada auto-planner/kanban sendiri di v1 (ponytail).
5. MR = klien GitLab REST v4 di Rust (`crates/core/src/gitlab/`), pakai `reqwest`? TIDAK: cek dulu dependensi yang sudah ada (budget app <20 MB). Default pakai `ureq` (blocking, kecil, rustls) di thread pool. Keputusan akhir di kartu G1 setelah ukur delta binary; batas naik binary +0.6 MB.
6. Diff MR memakai `DiffView.svelte` / `sbs.ts` / `wordDiff.ts` yang sudah ada. Core mengubah `changes[].diff` (unified per file dari GitLab) ke model hunk yang sama dengan `git/model.rs`. Tidak ada viewer diff baru.
7. Semua panggilan jaringan lazy dan hanya saat panel dibuka. Nol polling saat panel tertutup (cold start budget 646 ms tidak boleh tersentuh).

## 1. Arsitektur Agent

### 1.1 Komponen
- `agent/acp.rs` — client ACP: initialize, session/new, session/prompt, session/update (stream), session/request_permission, fs/read_text_file & fs/write_text_file (kita jadi server fs agar edit agent bisa dicegat), session/cancel, session/load bila didukung.
- `agent/slot.rs` — definisi slot dan lifecycle (spawn, kill, restart, idle-reap).
- `agent/hermes.rs` — deteksi Hermes (lihat 1.3).
- `agent/perm.rs` — mesin izin (1.4).
- `agent/openai.rs` — adapter OpenAI-compatible: bukan ACP, jadi kita bungkus jadi "ACP-lite" (chat-only, tanpa tool edit; edit hanya lewat blok diff yang user apply manual). Ditunda ke A5 (opsional).
- UI `ui/features/agents/`: `AgentsPanel.svelte` (daftar slot + status), `AgentTabs.svelte`, `AgentChat.svelte`, `ProposedEdits.svelte` (review diff), `TeamEditor.svelte`, `agents.svelte.ts` (state).

### 1.2 Model slot (`team.json`)
```json
{
  "version": 1,
  "slots": [
    {
      "id": "s1", "label": "Techlead",
      "kind": "claude-code" ,
      "command": null,
      "hermesProfile": null,
      "model": "opus", "fallbackModel": "sonnet",
      "permission": "ask",
      "cwd": "project"
    }
  ]
}
```
- `kind`: `claude-code` (spawn `npx @agentclientprotocol/claude-agent-acp`, atau binary yang ditemukan), `hermes` (spawn `hermes -p <profile> acp`), `acp-custom` (command + args bebas, mis. opencode acp), `openai` (baseUrl + keyRef Keychain + model; A5).
- Beberapa slot dengan kind sama diizinkan (mis. 3 instance Claude Code = 3 proses, 3 sesi).
- `permission`: `read` | `ask` | `auto` | `full`. Arti (dipetakan ke handler `session/request_permission` + policy fs):
  - read: tolak semua write/exec, fs/write ditolak.
  - ask: setiap tool call write/exec minta persetujuan user (kartu di chat).
  - auto: otomatis izinkan build, test, install (allowlist perintah: `flutter|dart|gradlew|npm|cargo test|pod install` dll, editable); sisanya ask.
  - full: izinkan semua (label merah, konfirmasi sekali per sesi).
- `model` / `fallbackModel`: dikirim lewat ACP `session/set_model` bila agen mengiklankan `models` di response `session/new`; kalau tidak, UI menonaktifkan pilih model dan menampilkan "diatur di agen". Fallback = pindah otomatis ke `fallbackModel` saat error rate-limit/overloaded (sekali, dengan notifikasi), hanya bila agen mendukung set_model.
- Tambah/hapus/ganti slot: hot (proses di-kill/spawn tanpa restart app). Ganti kind = kill lalu spawn baru, riwayat chat lama tetap terlihat (read-only).

### 1.3 Deteksi Hermes
Semua read-only, dijalankan hanya saat panel Agents dibuka pertama kali (atau tombol Refresh):
1. `which hermes` via resolver PATH (`toolchain.rs`). Tidak ada, berarti mode tanpa Hermes.
2. Versi: `hermes acp --version`. Health: `hermes acp --check` (terbukti Fase 0, output "Hermes ACP check OK").
3. Daftar profil: `hermes profile list` (parse tabel: Profile, Model, Gateway, Alias). Dicoba dulu `--json` bila ada; kalau tidak, parse teks dengan test fixture. Alternatif tanpa spawn: baca `~/.hermes/profiles/*/config.yaml` (key `model`). Dipilih: spawn `profile list` (satu sumber kebenaran), fallback baca folder.
4. Status kanban (read-only): `hermes kanban list` (cek dulu flag `--json`/`--board` di kartu H2) dan `hermes kanban show <id>`. Ditampilkan sebagai badge per profil (jumlah running/ready/blocked). Refresh manual + tiap 30 dtk HANYA saat panel Agents terlihat.
5. Tiap profil terdeteksi muncul sebagai "kandidat slot": klik "Tambah ke tim" membuat slot `kind: hermes`. Petak TIDAK memodifikasi profil Hermes, TIDAK menulis ke kanban.db (tidak menyentuh internal). Membuat task kanban dari Petak = di luar v1.
6. Catatan Fase 0: `hermes acp` di Mac membutuhkan Hermes terpasang di Mac; opsi jembatan `ssh server hermes acp` belum dites. Slot `acp-custom` dengan command `ssh host hermes -p x acp` mencakup ini tanpa kode tambahan; verifikasi di Mac oleh techlead (kartu terpisah, butuh Mac).
7. Perlu diverifikasi di kartu H1 (belum terbukti): apakah `hermes -p <profile> acp` memakai model milik profil itu. Uji dengan `session/new` lalu baca `models` / tanya model. Kalau tidak, gunakan env `HERMES_HOME=~/.hermes/profiles/<p>`.

### 1.4 Edit agen sebagai diff yang harus di-review
- Petak mengiklankan `fs.writeTextFile: true` saat initialize. Setiap `fs/write_text_file` dari agen TIDAK langsung menulis disk: disimpan di `ProposedEdits` (buffer per sesi: path, isi lama, isi baru).
- UI: daftar file berubah + `DiffView` (side-by-side dan word-diff yang ada). Aksi per file dan per hunk: Terima, Tolak, Terima semua. Terima = tulis via `fsops.rs` + entri `local_history.rs` (rollback tersedia). Agen menerima balasan sukses (agar lanjut) atau error "ditolak user" bila ditolak.
- Agen yang menulis file langsung lewat tool bawaannya sendiri (bukan fs ACP; contoh Claude Code memakai Edit tool internal) tidak bisa dicegat: mitigasi = mode `ask` menampilkan permission request dengan diff dari `toolCall.content` (ACP mengirim diff pada tool_call), dan sebagai jaring pengaman: snapshot `git stash create`-style / local_history sebelum sesi mulai. Di v1 "wajib review sebelum diterima" hanya dijamin untuk edit yang lewat fs ACP atau permission request; sisanya ditampilkan setelah fakta lewat watcher (`watch.rs`) sebagai "file berubah oleh agen X" + tombol Revert. Ini batasan jujur, dicatat di UI.
- Konflik: bila file diubah user setelah proposal dibuat, tampilkan 3-way (pakai `ConflictView` yang ada) atau tolak proposal kadaluarsa.

### 1.5 Fix with agent
- Sumber: Logcat (baris error terpilih + stack), popup lint/diagnostic LSP (`ui/features/problems`), output run.
- Kirim konteks otomatis: pesan error, file:line, ±30 baris sekitar, versi toolchain, ringkasan git status. Ditampilkan ke user sebagai draf prompt yang bisa diedit sebelum kirim (tidak kirim diam-diam, jaga biaya + privasi).
- Target: slot aktif atau pilih slot dari dropdown. Hasil masuk alur 1.4.

### 1.6 Usage meter
- Hanya bila agen melapor: baca `session/update` jenis `usage_update` (bila ada) dan `_meta` dari response `session/prompt`. Tampilkan context %, token, biaya bila tersedia. Kalau tidak ada: teks abu "agen tidak melapor" (jangan mengarang angka). Limit 5 jam/mingguan: TIDAK diimplementasi v1 (belum terbukti bisa; per plan.md perlu riset per agen). Kartu riset terpisah opsional (A6).

### 1.7 Sesi paralel dan tab
- Satu tab per slot, tiap slot 1 sesi aktif (sesi baru = tombol "New session"). Semua sesi jalan bersamaan; UI hanya merender tab aktif (tab lain: buffer event di core, kirim ringkasan badge "n pesan baru").
- Panel Agents ditempatkan di kiri panel Device (sesuai plan.md 4.5) dengan aturan exclusivity panel dari batch3 (contract `docs/batch3/contract.md`, baca sebelum coding).

## 2. Arsitektur GitLab MR

### 2.1 Endpoint (API v4, `{base}/api/v4`, base dari remote `origin` atau setelan manual; mendukung self-hosted)
Project id: `GET /projects/:url_encoded_path` (dari remote URL).

| Fitur | Endpoint |
|---|---|
| Cek token/scope/expiry | `GET /personal_access_tokens/self` (scopes, expires_at); user: `GET /user` |
| Daftar MR | `GET /projects/:id/merge_requests?state=opened&scope=all&per_page=30&page=N` |
| filter Mine | `scope=created_by_me` |
| Assigned to me | `scope=assigned_to_me` |
| Review requested | `reviewer_id=<my user id>` (atau `reviewer_username=`) |
| Detail | `GET /projects/:id/merge_requests/:iid` (termasuk `detailed_merge_status`, `head_pipeline`, `diff_refs`, `has_conflicts`) |
| Pipeline | `GET /projects/:id/merge_requests/:iid/pipelines`; job: `GET /projects/:id/pipelines/:pid/jobs` |
| Perubahan/diff | `GET /projects/:id/merge_requests/:iid/changes` (deprecated) diganti `GET .../diffs?per_page=` (paginated, GitLab >=15.7/16). Deteksi versi: coba `/diffs`, fallback `/changes` |
| Diskusi/komentar | `GET .../merge_requests/:iid/discussions?per_page=100` |
| Komentar umum | `POST .../merge_requests/:iid/notes` body=... |
| Komentar inline | `POST .../merge_requests/:iid/discussions` dengan `position[position_type]=text`, `position[base_sha|start_sha|head_sha]` (dari `diff_refs`), `position[new_path|old_path]`, `position[new_line]` atau `old_line` |
| Balas thread | `POST .../discussions/:did/notes` |
| Resolve thread | `PUT .../discussions/:did?resolved=true` |
| Approve | `POST .../merge_requests/:iid/approve` (opsional `sha` untuk pengaman) |
| Unapprove | `POST .../merge_requests/:iid/unapprove` |
| Status approval | `GET .../merge_requests/:iid/approvals` (atau `approval_state`) |
| Merge | `PUT .../merge_requests/:iid/merge` dengan `squash`, `should_remove_source_branch`, `merge_when_pipeline_succeeds`, `sha` (wajib disertakan agar tidak merge commit yang berbeda dari yang dilihat user), `squash_commit_message`, `merge_commit_message` |
| Batalkan MWPS | `POST .../merge_requests/:iid/cancel_merge_when_pipeline_succeeds` |
| Checkout lokal | tanpa API tulis: `git fetch origin merge-requests/:iid/head:mr-:iid` lalu `git switch mr-:iid` (pakai `git/ops.rs`; refspec ini disediakan GitLab). Bila pakai branch sumber di fork: tetap lewat refspec ini. |

Merge butuh: `detailed_merge_status == "mergeable"` (atau `ci_still_running` untuk opsi MWPS). Tombol Merge dinonaktifkan sesuai status + alasan ditampilkan (`blocked_status`, `not_approved`, `discussions_not_resolved`, `draft_status`, `conflict`). Hasil 405/406/409 dari server diterjemahkan ke pesan manusia.

### 2.2 Scope PAT minimum
- Baca saja (list, detail, diff, thread, pipeline): `read_api`.
- Tulis (komentar, approve, merge): `api`. Tidak ada scope lebih kecil yang mengizinkan POST/PUT MR (`read_api` hanya GET).
- Keputusan produk: Petak berjalan dalam dua mode. Token `read_api` = mode lihat saja (semua tombol tulis nonaktif dengan tooltip "butuh scope api"). Token `api` = penuh. Deteksi lewat `GET /personal_access_tokens/self` (field `scopes`). Tidak butuh `read_repository`/`write_repository` (git lewat kredensial git yang sudah ada).
- Sarankan user membuat PAT berumur pendek dengan role Developer. Peringatan expiry <14 hari (plan.md fase 6).
- Token dari Keychain (terkait Fase 6): baca lewat `git credential fill` untuk host tersebut (protocol=https, host=...), sama mekanisme dengan yang disimpan `git credential approve` di Fase 6. Token tidak pernah masuk log, tidak pernah dikirim ke webview (request dijalankan di Rust; UI hanya menerima hasil). Header `PRIVATE-TOKEN`. Bila belum ada token: empty-state "Tambah token di Akun" (link ke Fase 6). Sebelum Fase 6 rampung: field token sementara ke Keychain lewat `git credential approve`.

### 2.3 Rate limit dan cache
- GitLab.com: 2.000 req/menit per user terautentikasi (API umum). Self-hosted: default tidak dibatasi kecuali admin mengaturnya; header `RateLimit-Remaining`/`RateLimit-Reset`, dan 429 memuat `Retry-After`. Client wajib hormati 429: backoff sesuai `Retry-After`, tanpa retry otomatis pada POST/PUT.
- Paginasi: header `X-Next-Page`, `X-Total-Pages`; jangan `X-Total` untuk >10.000 item (dihilangkan GitLab). Ambil halaman per halaman (lazy, scroll).
- Cache: in-memory di core (LRU kecil, maks ~2 MB), key = URL, simpan `ETag`; kirim `If-None-Match` supaya 304 murah (GitLab mendukung ETag pada banyak endpoint GET). TTL lunak 30 dtk untuk daftar, diff per (`iid`, `head_sha`) immutable (cache selamanya selama sesi). Cache invalid saat aksi tulis. Tidak ada cache di disk (token/isi privat).
- Refresh: manual (tombol) + saat panel difokuskan setelah >60 dtk. Tidak ada polling latar belakang. Pipeline berjalan: poll 15 dtk hanya selama detail MR terbuka dan pipeline running.

### 2.4 UI
- `ui/features/mr/`: `MrList.svelte` (tab filter: Open / Mine / Assigned to me / Review requested, pencarian), `MrDetail.svelte` (deskripsi markdown aman/sanitasi, badge pipeline + job, approval, thread), `MrFiles.svelte` (daftar file + `DiffView` yang ada), `MrThread.svelte`, `MrMergeBar.svelte` (checkbox squash, hapus source branch, merge when pipeline succeeds; Approve/Unapprove; konfirmasi sebelum Merge menampilkan sha), `mr.svelte.ts`.
- Markdown deskripsi/komentar: render minimal, sanitasi ketat (tanpa HTML mentah, tanpa gambar eksternal otomatis) — tanpa library baru bila bisa; kalau butuh, satu parser kecil dan ukur bundle.
- Aksi "Checkout MR" memakai alur git existing; bila working tree kotor, tolak dengan pesan (jangan stash otomatis).
- Aksi tulis selalu dikonfirmasi; tidak ada aksi tulis otomatis dari agen (agen tidak diberi akses token MR).

## 3. Rencana uji (tanpa GitLab kantor)
1. Mock server GitLab lokal: `crates/core/tests/gitlab_mock/` server HTTP kecil (`tiny_http`, dev-dependency) yang menyajikan fixture JSON (`fixtures/gitlab/*.json`, dibuat manual dan dianonimkan; JANGAN salin dari repo/akun kantor). Mendukung: paginasi header, ETag/304, 429+Retry-After, 401/403 scope, 405/406 merge gagal, `/diffs` 404 untuk uji fallback `/changes`.
2. Unit test Rust: parsing tiap endpoint, pembangunan posisi komentar inline, pilihan endpoint diff, mapping `detailed_merge_status` ke tombol, cache/ETag, Retry-After. Fixture proses hermes: teks `hermes profile list` contoh.
3. Unit test UI (vitest yang sudah ada): state filter, disable tombol per scope/status, render thread.
4. Agent: agen ACP palsu (script Node kecil, seperti `spike/acp-smoke.mjs`) yang mengirim update, permission request, fs write. Uji izin (4 mode), alur proposal edit, fallback model, cancel. Uji integrasi nyata `hermes acp` (server) memakai `session/new` tanpa `session/prompt` (tidak berbiaya) seperti Fase 0.
5. Opsi tambahan: GitLab CE dummy lokal via Docker (image besar, ~2.5 GB, RAM 4 GB+) — hanya bila ruang disk HDD /mnt/storage cukup dan atas persetujuan; bukan syarat lulus. Mock server jadi syarat utama.
6. Uji manual UQi (di GitLab kantor, read-only dulu, token `read_api`): checklist di `docs/phase5/manual-test.md` (dibuat di kartu G4). Tidak dikerjakan agen.
7. Mac (techlead saja): jalan slot Claude Code ACP di Mac, Keychain lewat git credential, ukur RAM/cold start/size.

## 4. Budget RAM dan ukuran
- Target: idle app tanpa agen <150 MB (total), binary <20 MB. Binary sekarang 19.48 MB (fase 2): headroom ~0.5 MB. Konsekuensi: tidak boleh menambah HTTP client besar. Cek dulu: `reqwest` penuh (hyper+tokio+rustls) bisa +1-2 MB, kemungkinan melanggar. Gunakan `ureq` (rustls, tanpa tokio) atau shell-out `curl` (ada di macOS) sebagai fallback bila binary melewati batas. Kartu G0 mengukur (A/B `cargo build --release` + strip) sebelum memilih dan mencatat hasil. Kalau semua opsi melewati 20 MB, blok dan tanya UQi (naikkan budget atau shell-out curl).
- Proses agen = di luar app (child process), bukan bagian budget app tapi ditampilkan di panel Agents (RSS tiap slot, dibaca `ps`). Claude ACP ~186 MB, Hermes ACP ~160 MB (Fase 0) per slot. Tim 3 slot = ~500 MB tambahan. Mitigasi: spawn lazy (slot dibuat tapi proses baru jalan saat tab dibuka/prompt pertama), idle-reap (matikan proses idle >10 menit, sesi bisa `session/load` bila agen mendukung), batas jumlah slot aktif bersamaan (default 3, bisa diubah), peringatan RAM di panel.
- Riwayat chat: ring buffer di core (maks N pesan, output tool dipotong), UI virtual list. Tidak ada library markdown berat.
- Cold start: modul agents/mr dimuat lazy (dynamic import), tidak ada spawn/jaringan saat startup. Setelah tiap fase ukur cold start (budget ≤646 ms; catatan investigasi 571→740 ms di build gabungan, kartu t_c38d1a59) dan ketik ≤17 ms saat mirror.

## 5. Urutan: MR dulu atau Agent dulu?
Rekomendasi: **MR viewer dulu (Track B), Agent panel paralel tapi mulai dengan inti ACP**.
Alasan: (1) MR murni HTTP + UI, bisa diuji penuh di server dengan mock, risikonya rendah, memakai DiffView yang sudah ada; (2) Agent butuh keputusan lebih banyak (izin, intercept edit) dan pengujian di Mac; (3) dua track menyentuh file berbeda sehingga bisa paralel: senior = Agent core (Rust `agent/`), senior2 = MR (Rust `gitlab/` + UI `mr/`). Kalau UQi lebih butuh agent lebih dulu, tukar prioritas tanpa mengubah kartu (independen). Satu-satunya titik temu: `ui/shell` (Rail + registrasi panel) dan `crates/app/src/commands.rs` + `ui/lib/api.ts` (hotspot; lihat 6).

## 6. Pembagian kartu (untuk manajer, dibuat setelah batch2+3 merge)
Ukuran: S=~0.5 hari, M=~1 hari, L=~2 hari (kerja agen).

Track A — Agent (senior):
- A0 (S, senior): ukur/pilih dependensi (tidak ada HTTP di A; hanya serde/tokio sudah ada). Verifikasi `hermes -p <p> acp` model per profil (H1). Output docs/phase5/hermes-detect.md.
- A1 (L, senior): `agent/acp.rs` + `slot.rs` + spawn lazy + agen ACP palsu + tes. Command Tauri: agent_list_slots/agent_start/agent_prompt/agent_cancel/agent_stop + event stream.
- A2 (M, senior): `hermes.rs` deteksi (profil, model, kanban badge) + `team.json` load/save + TeamEditor backend + tes fixture.
- A3 (M, senior): `perm.rs` (4 mode, allowlist) + fs proposal buffer + apply via fsops/local_history.
- A4 (L, senior2 setelah B selesai, atau designer dulu): UI Agents: panel, tab, chat, ProposedEdits (pakai DiffView), TeamEditor, Fix with agent (entry dari Problems dan Logcat), usage meter.
- A5 (M, opsional): adapter OpenAI-compatible (chat-only).
- A6 (S, opsional): riset limit/usage per agen (Claude, Codex).
- D5a (designer, sebelum A4): spec UI panel Agents + MR (tab, tim, review edit, MR detail, empty state, mode read_api).

Track B — MR (senior2):
- G0 (S): pilih HTTP client, ukur delta binary, mock server skeleton + fixture.
- G1 (M): `gitlab/client.rs` (auth via git credential, paginasi, ETag cache, 429), endpoint baca (list, detail, pipeline, diffs/changes, discussions), tes mock.
- G2 (M): endpoint tulis (note, inline discussion, resolve, approve/unapprove, merge dengan sha, MWPS cancel), checkout MR lewat git ops, tes mock.
- G3 (L): UI `mr/` (list+filter, detail, files+DiffView, thread, merge bar).
- G4 (S): `docs/phase5/manual-test.md` untuk UQi (read-only dulu) + laporan.
Kontrak core<->UI ditulis manajer sebelum G3/A4 (pola docs/batch3/contract.md).

Review: techlead review+merge+build Mac (ukur binary, RAM, cold start); reviewer QA independen; designer review visual.

Estimasi total: Track A ~6-7 hari-agen, Track B ~4-5 hari-agen, paralel = sekitar 1,5 minggu kalender + verifikasi Mac.

## 7. Risiko
- Binary >20 MB karena HTTP client (paling mungkin). Mitigasi G0.
- RAM: 3+ agen = 500 MB+ di luar app. Mitigasi: lazy spawn, idle-reap, batas slot.
- Edit yang tidak bisa dicegat (agen menulis lewat tool sendiri). Mitigasi: 1.4, dinyatakan jujur di UI.
- Dukungan ACP tidak seragam (set_model, usage, loadSession). Mitigasi: baca capability saat initialize, matikan fitur yang tidak didukung, jangan asumsi.
- Perilaku `hermes profile list` / `kanban list` berubah antar versi (parse teks). Mitigasi: fixture + degradasi ke folder profil, tandai versi yang teruji (0.21.2).
- Package ACP Claude berubah nama (claude-code-acp deprecated, sekarang @agentclientprotocol/claude-agent-acp). Gunakan yang baru, command bisa di-override.
- Hotspot: `crates/app/src/commands.rs`, `ui/lib/api.ts`, `ui/App.svelte`, `ui/shell/Rail.svelte`. Aturan: tiap track menambah file modul sendiri + satu baris registrasi; senior2 dan senior tidak mengedit registrasi bersamaan (urut lewat link kartu atau manajer yang merge registrasi).
- Keamanan: token tidak boleh ke webview/log; markdown deskripsi MR = input tak tepercaya (XSS); mode `full` agen berbahaya (label + konfirmasi).
- GitLab versi lama tanpa `/diffs` atau `detailed_merge_status`: fallback ke `/changes` dan `merge_status`.
- Aturan uji: tidak ada satu pun test/CI yang mengakses gitlab.com atau code.istar.id.
