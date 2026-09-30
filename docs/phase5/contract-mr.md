# Kontrak Teknis Core <-> UI: GitLab MR Viewer (Phase 5 Track B)

Dokumen ini mendefinisikan kontrak TypeScript, payload Tauri command, event, dan aturan status untuk integrasi GitLab MR Viewer di Petak IDE.

Referensi:
- Backend Tauri commands: `crates/app/src/mr_commands.rs`
- Rust GitLab models: `crates/core/src/gitlab/model.rs`
- UI/UX spec: `docs/phase5/ui-spec.md` §4, §5.2
- Core spec: `docs/phase5/spec.md` §2.1–§2.4

---

## 1. Definisi Tipe Data TypeScript (`ui/features/mr/types.ts`)

```typescript
export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  state?: string | null;
  avatarUrl?: string | null;
  webUrl?: string | null;
}

export interface DiffRefs {
  baseSha?: string | null;
  headSha: string;
  startSha?: string | null;
}

export interface PipelineInfo {
  id: number;
  iid?: number | null;
  projectId?: number | null;
  sha: string;
  ref: string; // refName di Rust diserialisasi menjadi ref atau refName
  status: 'running' | 'pending' | 'success' | 'failed' | 'canceled' | 'skipped' | string;
  source?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  webUrl?: string | null;
}

export interface JobInfo {
  id: number;
  name: string;
  stage: string;
  status: string;
  duration?: number | null;
  createdAt?: string | null;
  finishedAt?: string | null;
}

export interface MergeRequest {
  id: number;
  iid: number;
  projectId: number;
  title: string;
  description?: string | null;
  state: 'opened' | 'closed' | 'merged' | 'locked' | string;
  createdAt: string;
  updatedAt: string;
  targetBranch: string;
  sourceBranch: string;
  author: GitLabUser;
  assignees: GitLabUser[];
  reviewers: GitLabUser[];
  sourceProjectId?: number | null;
  targetProjectId?: number | null;
  draft: boolean;
  workInProgress: boolean;
  mergeStatus?: string | null;
  detailedMergeStatus?: string | null;
  sha: string;
  hasConflicts: boolean;
  webUrl: string;
  diffRefs?: DiffRefs | null;
  blockingDiscussionsResolved?: boolean | null;
  shouldRemoveSourceBranch?: boolean | null;
  forceRemoveSourceBranch?: boolean | null;
  headPipeline?: PipelineInfo | null;
  mergeCommitSha?: string | null;
}

export interface NotePosition {
  baseSha?: string | null;
  startSha?: string | null;
  headSha?: string | null;
  oldPath?: string | null;
  newPath?: string | null;
  positionType?: string | null;
  oldLine?: number | null;
  newLine?: number | null;
}

export interface Note {
  id: number;
  type?: string | null;
  body: string;
  attachment?: string | null;
  author: GitLabUser;
  createdAt: string;
  updatedAt: string;
  system: boolean;
  resolvable: boolean;
  resolved?: boolean | null;
  position?: NotePosition | null;
}

export interface Discussion {
  id: string;
  individualNote: boolean;
  notes: Note[];
}

export type TokenScopeMode = 'readOnly' | 'full' | 'none';

export interface PageInfo {
  page: number;
  perPage: number;
  nextPage?: number | null;
  totalPages?: number | null;
  total?: number | null;
}

export interface PaginatedList<T> {
  items: T[];
  pagination: PageInfo;
}

export interface MrListQuery {
  state?: string | null;
  scope?: string | null;
  reviewerId?: number | null;
  search?: string | null;
  page?: number | null;
  perPage?: number | null;
}

export interface InlinePositionParams {
  baseSha: string;
  startSha: string;
  headSha: string;
  oldPath: string;
  newPath: string;
  positionType?: string;
  oldLine?: number | null;
  newLine?: number | null;
}

export interface MergeRequestParams {
  sha: string;
  squash?: boolean | null;
  shouldRemoveSourceBranch?: boolean | null;
  mergeWhenPipelineSucceeds?: boolean | null;
  squashCommitMessage?: string | null;
  mergeCommitMessage?: string | null;
}

export interface MergeStatusEvaluation {
  mergeable: boolean;
  canMwps: boolean;
  reason?: string | null;
}
```

---

## 2. Panggilan Tauri Command (`invoke`)

| Command | Parameter | Kembalian | Keterangan |
|---|---|---|---|
| `mr_get_token_scope` | `{ root?: string }` | `TokenScopeMode` | Mengembalikan `'readOnly'` (`read_api`), `'full'` (`api`), atau `'none'` |
| `mr_current_user` | `{ root?: string }` | `GitLabUser` | Pengguna yang terautentikasi (untuk filter reviewer/mine) |
| `mr_list` | `{ root?: string, query: MrListQuery }` | `PaginatedList<MergeRequest>` | Mengambil daftar MR dengan filter dan paginasi |
| `mr_detail` | `{ root?: string, iid: number }` | `MergeRequest` | Detail lengkap satu MR |
| `mr_pipelines` | `{ root?: string, iid: number }` | `PipelineInfo[]` | Daftar pipeline CI pada MR |
| `mr_pipeline_jobs` | `{ root?: string, pipelineId: number }` | `JobInfo[]` | Daftar job pada satu pipeline |
| `mr_diffs` | `{ root?: string, iid: number, headSha?: string }` | `GitDiffFile[]` | Perubahan diff dikonversi langsung ke struktur diff Petak |
| `mr_discussions` | `{ root?: string, iid: number }` | `Discussion[]` | Seluruh thread diskusi dan komentar |
| `mr_create_note` | `{ root?: string, iid: number, body: string }` | `Note` | Tambah komentar umum baru |
| `mr_create_inline_discussion` | `{ root?: string, iid: number, body: string, position: InlinePositionParams }` | `Discussion` | Mulai thread diskusi baru pada baris diff tertentu |
| `mr_reply_discussion` | `{ root?: string, iid: number, discussionId: string, body: string }` | `Note` | Balas diskusi yang ada |
| `mr_resolve_discussion` | `{ root?: string, iid: number, discussionId: string, resolved: boolean }` | `Discussion` | Ubah status resolve/unresolve thread diskusi |
| `mr_approve` | `{ root?: string, iid: number, sha?: string }` | `any` | Berikan persetujuan MR |
| `mr_unapprove` | `{ root?: string, iid: number }` | `any` | Batalkan persetujuan MR |
| `mr_merge` | `{ root?: string, iid: number, params: MergeRequestParams }` | `MergeRequest` | Eksekusi merge MR dengan verifikasi SHA wajib |
| `mr_cancel_mwps` | `{ root?: string, iid: number }` | `MergeRequest` | Batalkan merge when pipeline succeeds |
| `mr_checkout` | `{ root?: string, iid: number, remote?: string }` | `string` | Checkout branch lokal lewat refspec `merge-requests/:iid/head` |
| `mr_evaluate_merge_status` | `{ status?: string }` | `MergeStatusEvaluation` | Evaluasi `detailed_merge_status` lokal / utilitas |

---

## 3. Aturan State & Akses UI

1. **Tab Kategori Filter:**
   - `Open`: `state = 'opened'`, `scope = 'all'`
   - `Mine`: `state = 'opened'`, `scope = 'created_by_me'`
   - `Assigned`: `state = 'opened'`, `scope = 'assigned_to_me'`
   - `Review requested`: `state = 'opened'`, `reviewerId = currentUser.id` (fallback filter client-side bila reviewerId query tidak didukung server).

2. **Enforce Scope PAT (`read_api` vs `api`):**
   - Mode `readOnly`: seluruh aksi tulis (tambah komentar, balas diskusi, resolve thread, approve, unapprove, merge) dinonaktifkan (`disabled`) dengan tooltip `"Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab."`
   - Mode `full`: seluruh tombol aktif.

3. **Verifikasi SHA Merge Bar:**
   - Tombol Merge membuka modal konfirmasi yang menampilkan commit SHA lengkap (`headSha` dari MR).
   - Eksekusi merge menyertakan `sha: headSha` agar GitLab menolak merge jika terjadi race condition pembaruan branch oleh pihak ketiga.

4. **Sanitasi Markdown & XSS Guardrail:**
   - Markdown deskripsi dan komentar diparsing minimal tanpa library eksternal berat (ponytail).
   - Tag HTML mentah seperti `<script>`, `<iframe>`, `<style>`, `<img>` dibersihkan/dihindari.
   - Skema URL dibatasi hanya `http`, `https`, `mailto`. Gambar eksternal otomatis dicegah agar tidak membocorkan IP / token.

5. **Efisiensi & Nol Background Polling:**
   - Panel MR dimuat secara lazy (dynamic import).
   - Saat panel tertutup: 0 network request dan 0 timer polling.
   - Saat detail MR terbuka dengan pipeline berstatus `running` atau `pending`: interval polling 15 detik dijalankan khusus untuk pipeline head MR tersebut dan langsung dihentikan begitu status pipeline selesai atau panel/detail ditutup.
