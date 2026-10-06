# Task Brief: Polish Git Layout & VCS Ala Android Studio (Batch 2)

## Feedback & Keputusan UQi (5 Poin Wajib)

### 1. Menu Git di Activity Rail Kiri
- Ketika tombol ikon Git di Left Rail diklik, fungsinya harus **membuka/menutup Bottom Panel (Dock Bawah) pada tab Git**, bukan membuka tab full-screen.
- Membuka Bottom Dock dan mengaktifkan section `git` (`⌘9`). Jika dock bawah sudah terbuka dan di tab `git`, klik lagi akan me-minimize/toggle dock.

### 2. Bottom Panel: Full Width ke Kiri, Selaras Menu Kanan
- Layout Bottom Dock di `ui/App.svelte`:
  - Melebar penuh 100% ke kiri (menembus bawah file tree / sidebar kiri).
  - Di sebelah kanan: **berhenti di batas Right Dock / Right Rail** (tidak menembus atau menimpa panel kanan / mirror / devices / agent). Right Dock tetap memiliki tinggi penuh dari atas ke bawah.

### 3. Stash Index di Panel Kiri: Foldering / Directory Tree
- Di dalam tab `Stashes` pada `ui/features/git/CommitPanel.svelte`:
  - Daftar berkas di dalam stash yang dipilih tidak boleh flat list panjang.
  - Kelompokkan berkas berdasarkan foldernya (foldering / directory tree) dengan folder yang bisa di-expand/collapse, sehingga pengguna mudah menelusuri berkas bersarang (nested directories).

### 4. Diff View: Clean, Responsive & Tombol Pensil (Go to File)
- Di `ui/features/git/DiffView.svelte`:
  - Sederhanakan toolbar diff yang keramaian: tata letak clean, proporsional, dan minimalis.
  - Responsif: saat ukuran editor mengecil, toolbar tidak boleh bertumpuk atau overflow jelek (gunakan flex wrapping yang rapi dan tombol kompak).
  - Tambahkan tombol **Pensil (✏️)** di samping nama berkas dengan tooltip "Buka berkas di editor" (Jump to Source). Saat diklik, langsung buka berkas tersebut di tab editor biasa menggunakan `tabsManager.openTab(activePath, ...)`.

### 5. Panel Git Bawah (Git Tool Window):
- **Hapus tab Commit dan Stash di panel Git bawah**:
  - Di `ui/features/git/BranchPanel.svelte`, hapus tombol tab `Commit` dan `Stash` di header. Panel bawah murni hanya untuk Git Log / History (Branches, Graph, Filter, Detail Commit).
- **Changes pada Detail Commit Bisa Dilihat Diff-nya**:
  - Di `ui/features/git/CommitDetail.svelte`, ketika pengguna mengklik salah satu berkas di daftar `CHANGES (N FILES)`:
    - Buka preview Diff berkas tersebut langsung di editor tengah (menggunakan `gitStore.centerDiff` atau tab diff editor tengah), membandingkan revisi commit tersebut dengan parent-nya.

## Quality Gates
- `npm run check` lulus 0 error.
- `npm test` seluruh suite (280+ tests) lulus 100%.
- Deploy release ke Mac M2 `/Applications/Petak.app`.
