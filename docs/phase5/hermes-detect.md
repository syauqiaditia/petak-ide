# Hasil Verifikasi & Deteksi Hermes ACP (Fase 5 — A0)

Dokumen ini mencatat bukti empiris hasil pengujian nyata Hermes Agent ACP, verifikasi per-profil, status flag CLI (`--json`), dan spesifikasi fixture untuk implementasi Track A (Petak Agent/Orkestrator: A1, A2, A3).

---

## 1. Lingkungan & Versi Hermes

- **Binary PATH:** `/home/uqi/.local/bin/hermes`
- **Versi Hermes:** `Hermes Agent v0.21.2 (2026.9.11) · upstream b6b53c69`
- **Versi ACP (`hermes acp --version`):** `0.21.2`
- **Health Check (`hermes acp --check`):**
  ```text
  Hermes ACP check OK
  ```
  Exit code: `0`

---

## 2. Temuan Kunci A0: Model per Profil di `hermes acp`

### Pertanyaan Evaluasi
> Apakah `hermes -p <profile> acp` memakai model milik profil (dibuktikan lewat `session/new` -> baca `models`), atau apakah butuh `HERMES_HOME=~/.hermes/profiles/<p>`?

### Temuan Nyata & Pembuktian
**`hermes -p <profile> acp` BEKERJA PENUH dan langsung mengadopsi model profil yang bersangkutan.**
Pengujian dilakukan tanpa mengirim `session/prompt` (0 token LLM, 0 biaya, $0.00).

Mekanisme internal Hermes (`hermes_cli/main.py:508-559`):
1. Launcher CLI memiliki helper `_apply_profile_override()` yang melakukan scanning awal terhadap argumen `-p` / `--profile` sebelum argparse utama dijalankan.
2. Flag `-p <name>` di-resolve ke path direktori profil (`resolve_profile_env(profile_name)` -> `~/.hermes/profiles/<name>`).
3. `os.environ["HERMES_HOME"]` diisi dengan path profil tersebut, lalu token `-p <name>` dihapus dari `sys.argv`.
4. Subcommand `acp` dijalankan (`acp_main`), yang memanggil `load_config()`. `load_config()` membaca konfigurasi dari `$HERMES_HOME/config.yaml`.
5. Saat ACP client mengirimkan method `session/new`, `acp_adapter/session.py` membuat session dengan model default dari profil terkait. Response `session/new` menyertakan objek `models` dengan field `currentModelId` yang sesuai.

### Bukti Output Nyata Handshake ACP

| Skenario Pemanggilan | Environment / Env Loaded | `models.currentModelId` di Response `session/new` | Model di `config.yaml` |
|---|---|---|---|
| `hermes acp` (default) | `~/.hermes/.env` | `anthropic:claude-opus-5` | `claude-opus-5` |
| `hermes -p reviewer acp` | `~/.hermes/profiles/reviewer/.env` | `anthropic:claude-sonnet-5` | `claude-sonnet-5` |
| `hermes -p techlead acp` | `~/.hermes/profiles/techlead/.env` | `custom:ag/claude-opus-4-6-thinking` | `ag/claude-opus-4-6-thinking` |
| `hermes -p designer acp` | `~/.hermes/profiles/designer/.env` | `custom:ag/gemini-3.8-flash-high` | `ag/gemini-3.8-flash-high` |
| `HERMES_HOME=.../reviewer hermes acp` | `~/.hermes/profiles/reviewer/.env` | `anthropic:claude-sonnet-5` | `claude-sonnet-5` |
| `HERMES_HOME=.../techlead hermes acp` | `~/.hermes/profiles/techlead/.env` | `custom:ag/claude-opus-4-6-thinking` | `ag/claude-opus-4-6-thinking` |

**Rekomendasi untuk Petak (A1/A2):**
Gunakan langsung perintah `hermes -p <profile> acp` sebagai `command` spawn slot Hermes. Opsional, tetap teruskan `HERMES_HOME=~/.hermes/profiles/<profile>` di environment proses anak sebagai jaring pengaman redundan.

---

## 3. Evaluasi Flag `--json` CLI

### 3.1 `hermes profile list`
- **Flag `--json` TIDAK didukung.**
- Perintah `hermes profile list --json` menghasilkan exit code `2` dan pesan error:
  ```text
  hermes: error: unrecognized arguments: --json
  ```
- Output standar `hermes profile list` adalah format tabel teks (Unicode box):
  ```text
   Profile          Model                        Gateway      Alias        Distribution
   ───────────────    ───────────────────────────    ───────────    ───────────    ────────────────────
    default         claude-opus-5                running      —            —
    designer        ag/gemini-3.8-flash-high     stopped      designer     —
    manager         claude-sonnet-5-5            stopped      manager      —
    reviewer        claude-sonnet-5              stopped      reviewer     —
   ◆senior          ag/gemini-3.8-flash-high     stopped      senior       —
    senior2         ag/gemini-3.8-flash-high     stopped      senior2      —
    techlead        ag/claude-opus-4-6-thinkin   stopped      techlead     —
  ```
- **Karakteristik tabel:**
  - Profil aktif memiliki penanda diamond `◆` di kolom paling kiri, sedangkan profil non-aktif diawali spasi (` `).
  - Kolom dipisahkan oleh spasi dengan lebar tetap (Profile ~17 char, Model ~29 char, Gateway ~13 char, Alias ~13 char).
- **Rekomendasi implementasi parser Petak (A2):**
  1. Parsing output tabel baris demi baris, abaikan baris header dan garis pemisah `───`.
  2. Bersihkan karakter `◆` dan whitespace untuk mendapatkan nama profil.
  3. Sebagai fallback yang lebih murah dan tanpa spawn: baca file direktori `~/.hermes/profiles/<nama>/config.yaml`, ambil key `model.default` atau `model`.

### 3.2 `hermes kanban list`
- **Flag `--json` DIDUKUNG PENUH.**
- Perintah `hermes kanban list --json` menghasilkan JSON array dengan 25 field lengkap per task:
  `id`, `title`, `body`, `assignee`, `status`, `priority`, `tenant`, `workspace_kind`, `workspace_path`, `branch_name`, `project_id`, `created_by`, `created_at`, `started_at`, `completed_at`, `result`, `skills`, `max_retries`, `model_override`, `provider_override`, `session_id`, `workflow_template_id`, `current_step_key`, `completion_contract`, `last_failure_error`.
- Format baris teks default:
  ```text
  <icon> <id>  <status:8>  <assignee:20>  <title>
  ```
  Mapping icon status kanban Hermes:
  - `✓` -> `done`
  - `⊘` -> `blocked`
  - `●` -> `running`
  - `◻` -> `todo`
  - `▶` -> `ready`
  - `⏱` -> `scheduled`
  - `—` -> `archived`
- **Perangkap Lingkungan (Gotcha Penting):**
  Jika environment variabel `HERMES_DELEGATED_CHILD_CONTEXT=1` aktif, perintah `hermes kanban list` akan gagal dengan:
  ```text
  kanban: delegate_task child contexts cannot mutate Kanban tasks or boards
  ```
  Saat Petak mengeksekusi `hermes kanban list`, pastikan environment proses anak menghapus / meng-unset variabel `HERMES_DELEGATED_CHILD_CONTEXT`.

---

## 4. Spesifikasi Respons Protokol ACP (Panduan A1)

### 4.1 Handshake `initialize`
**Request dari Petak:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": { "readTextFile": true, "writeTextFile": true }
    },
    "clientInfo": { "name": "petak", "version": "0.1.0" }
  }
}
```

**Response dari Hermes ACP:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentInfo": {
      "name": "hermes-agent",
      "version": "0.21.2"
    },
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": { "image": true },
      "sessionCapabilities": {
        "fork": {},
        "list": {},
        "resume": {}
      }
    },
    "authMethods": [
      {
        "id": "custom",
        "name": "custom runtime credentials",
        "description": "Authenticate Hermes using the currently configured custom runtime credentials."
      }
    ]
  }
}
```
*Catatan:* Hermes mengiklankan capability `loadSession: true`, `promptCapabilities.image: true`, serta `sessionCapabilities` (`fork`, `list`, `resume`). Hermes tidak memerlukan otentikasi interaktif bila credential sudah tersimpan di `.env` profil.

### 4.2 Pembuatan Sesi `session/new`
**Request dari Petak:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/path/to/project",
    "mcpServers": []
  }
}
```

**Response dari Hermes ACP:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessionId": "df7df874-f067-4c43-896c-72df9298881d",
    "models": {
      "currentModelId": "custom:ag/claude-opus-4-6-thinking",
      "availableModels": [
        {
          "modelId": "custom:antigravity:ag/claude-opus-4-6-thinking",
          "name": "ag/claude-opus-4-6-thinking",
          "description": "Provider: Antigravity"
        }
      ]
    },
    "modes": {
      "currentModeId": "default",
      "availableModes": [
        { "id": "default", "name": "Default", "description": "Ask before edits." },
        { "id": "accept_edits", "name": "Accept Edits", "description": "Auto-allow workspace and /tmp edits; still asks for sensitive paths." },
        { "id": "dont_ask", "name": "Don't Ask", "description": "Auto-allow file edits for this session except sensitive paths." }
      ]
    }
  }
}
```

---

## 5. Ringkasan File Fixture (`crates/core/tests/fixtures/hermes/`)

Seluruh file fixture nyata telah disimpan dan dianonimkan (bebas token/secret/path privat):

1. `crates/core/tests/fixtures/hermes/profile_list.txt`
   Teks asli output tabel `hermes profile list` dari CLI v0.21.2.
2. `crates/core/tests/fixtures/hermes/profile_list_json_err.txt`
   Bukti error output saat mencoba flag `--json` pada `hermes profile list`.
3. `crates/core/tests/fixtures/hermes/kanban_list.txt`
   Baris status teks asli terformat dari `hermes kanban list` mencakup status `done`, `blocked`, `running`, dan `todo`.
4. `crates/core/tests/fixtures/hermes/kanban_list.json`
   Contoh array JSON nyata dari `hermes kanban list --json` (anonymized paths & task bodies).
5. `crates/core/tests/fixtures/hermes/acp_initialize_response.json`
   Payload JSON utuh dari respons RPC `initialize` Hermes ACP v0.21.2.
6. `crates/core/tests/fixtures/hermes/acp_session_new_response.json`
   Payload JSON utuh dari respons RPC `session/new` Hermes ACP v0.21.2 memuat `sessionId`, `models`, dan `modes`.

---

## 6. Rekomendasi Arsitektural untuk A1 & A2/A3

1. **A1 (ACP Client Core):**
   - Spawn lazy: Slot hanya melakukan spawn child process `hermes -p <profile> acp` (atau Claude ACP) saat tab pertama kali dibuka atau prompt pertama dikirim.
   - Handshake: Kirim `initialize` dengan `fs: { readTextFile: true, writeTextFile: true }`.
   - Simpan `sessionId` dari hasil `session/new`.
   - Gunakan `models.currentModelId` dan `models.availableModels` untuk populate dropdown model di UI jika didukung.

2. **A2 (Hermes Detection & Kanban Badge):**
   - Jalankan `which hermes` via resolver `toolchain.rs`.
   - Ambil daftar profil via `hermes profile list` (parse tabel dengan fixture `profile_list.txt` sebagai rujukan unit test), atau langsung scan folder `~/.hermes/profiles/*/config.yaml`.
   - Badge kanban diambil via `hermes kanban list --json` (jangan lupa unset `HERMES_DELEGATED_CHILD_CONTEXT`), hitung count per assignee & status (`running`, `ready`, `blocked`).
   - Refresh badge hanya saat panel Agents aktif/terlihat, jangan ada polling background di luar panel.
