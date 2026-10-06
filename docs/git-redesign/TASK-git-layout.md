# Task Brief: Implementasi Arsitektur Git & VCS Ala Android Studio

## Referensi & Keputusan UQi
UQi mengirim screenshot Android Studio dan menetapkan 6 aturan wajib implementasi Git di Petak IDE:

1. **Panel Bawah Full Width (Ujung Kiri ke Kanan)**:
   - Panel bawah (Terminal/Git Dock) harus melebar penuh 100% dari ujung kiri (menembus bawah file tree / sidebar kiri) sampai ke kanan, persis tata letak Android Studio.

2. **Tab Git Urutan Pertama di Bawah**:
   - Tab `Git` di baris tab dock bawah ditaruh di urutan paling pertama (sebelum `Terminal`, `Run`, `Logcat`, `Build`, `Problems`), dengan shortcut `⌘9`.

3. **Current Branch Paling Atas di Branch Tree**:
   - Current active branch selalu berada di urutan paling atas.
   - Jika branch berada di dalam folder (misal `canary/dev/1.9.0`), maka folder induk (`canary`) berada paling atas, dan di dalam folder tersebut branch aktif berada paling atas.
   - Paling atas area tree terdapat label/header jelas Current Branch aktif.

4. **Context Menu Klik Kanan Lengkap pada Branch**:
   - Menu aksi klik kanan branch:
     - `Checkout`
     - `Push...`
     - `Delete` (bisa delete branch lokal jika bukan branch aktif)
     - `New Branch from Selected...`
     - `Rebase onto Current...`
     - `Compare with Current...`
     - `Show Diff with Working Tree`
     - `Update`

5. **Panel Kiri: Commit & Stash Kompak**:
   - Panel kiri menampung tab switcher `Changes` dan `Stashes`.
   - Tab `Changes`: Daftar perubahan berkas aktif (`Changes`, `Unversioned`) + Textarea pesan commit lapang + Tombol Commit.
   - Tab `Stashes`: Tampilan list kompak berisi entri `stash@{0}`, `stash@{1}` beserta daftar berkas di dalam masing-masing stash.

6. **Diff Berkas Stash di Editor Tengah**:
   - Mengklik berkas di dalam stash langsung membuka Diff perbandingan di area editor tengah (membandingkan working tree dengan versi stash tersebut, seperti pada screenshot Android Studio).

## Deliverables
- `ui/features/terminal/TerminalPanel.svelte` (atau Bottom Dock): Integrasi tab Git di urutan pertama, integrasi `LogView`, `BranchPanel`, `CommitDetail`.
- `ui/App.svelte`: Penyesuaian layout agar panel bawah melebar penuh ke kiri bawah, dan integrasi tab Commit/Stash di sidebar kiri.
- `ui/features/git/BranchPanel.svelte`: Urutan current branch paling atas (termasuk di dalam folder), header current branch, context menu lengkap.
- `ui/features/git/StashView.svelte` & `ui/features/git/CommitPanel.svelte`: Panel samping kompak, klik berkas stash membuka diff di editor tengah.
- Verifikasi build `npm run check`, `npm test`, dan deploy ke Petak macOS.
