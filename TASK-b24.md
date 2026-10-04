# Petak Batch 24: Android Studio Commit Model, In-IDE Image Preview & Run Configuration Draft System

## Latar Belakang & Keluhan UQi (Testing Lapangan)
1. **Commit Panel & VCS Changes Model**:
   - "pada commit ketika udah ke centang ga bisa lihat changesnya":
     Di `CommitPanel.svelte`, pemilihan file mengirim `kind: isChecked ? 'staged' : 'worktree'`. Jika checkbox dicentang padahal file belum di-stage di Git index (`git add`), `api.gitDiff` meminta diff `--cached` yang kosong, sehingga DiffView menampilkan "No file selected".
   - "yang ga di add vcs ga bakal ada di changes, bisa ga ya?":
     Sesuai Android Studio (referensi `img_27e4c4d8b0ff.png`), file yang belum masuk Git harus dipisah ke grup collapsible **"Unversioned Files"**, BUKAN dicampur ke dalam "Changes". Hanya file terlacak (modified, deleted, staged) yang masuk grup "Changes".
2. **In-IDE Image Preview**:
   - "Terus kasih priview image dong, aku juga pengen bisa priview image di dalam petak":
     Petak saat ini belum memiliki Image Viewer bawaan. Membuka file gambar (`.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`, `.gif`, `.ico`) menampilkan error binary / editor kosong. Perlu komponen viewer gambar dengan dark checkered background (transparansi), info dimensi (WxH), ukuran file, dan kontrol zoom.
3. **Run Configuration Dialog Draft System**:
   - "pada run config aku mau edit di dalam file terkait bisa, tapi buat ganti menu misal ke main itu ga bisa, terus hapus, tambah, duplicate ga bisa juga":
     Di `RunConfigDialog.svelte`, seleksi config menggunakan pencarian referensi objek `c === cfg` yang gagal pada Svelte 5 derived proxies. Harus di-key berdasarkan `cfg.name`.
   - "jika ga sengaja kehapus dan batal maka ga jadi terhapus atau teredit atau apapun itu. jika diterapkan maka langsung berubah":
     Operasi edit/tambah/hapus harus bekerja pada isolated in-memory draft (`localConfigs`).
     * `Batal` (Cancel): Batalkan semua perubahan draft, tutup dialog tanpa mengubah `.petak/run.json` maupun `runStore`.
     * `Terapkan` (Apply): Simpan draft ke `.petak/run.json`, update `runStore.configs`, tampilkan status sukses "✓ Diterapkan", biarkan dialog tetap terbuka.
     * `OK`: Simpan draft ke disk & store, set konfigurasi aktif, dan tutup dialog.
   - Tambahkan dukungan `additionalArgs` (contoh: `--flavor dev --dart-define=ENV=dev`) pada Rust core dan TypeScript agar semua flag CLI diteruskan ke `flutter run`.

## Rincian Perubahan per Komponen

### 1. Commit Panel & Git Status Model (`ui/features/git/`)
- Di `CommitPanel.svelte`:
  * Pisahkan tampilan file menjadi 2 grup collapsible ala Android Studio:
    1. **`Changes ({N} file{s})`**: File terlacak yang berubah (`staged` atau `modified` / `deleted` / `renamed`).
    2. **`Unversioned Files ({M} file{s})`**: File baru yang belum di-add ke VCS (`untracked`).
  * Pada baris file `onclick`:
    * Gunakan fungsi murni `isEntryStaged(entry) ? 'staged' : 'worktree'` untuk menentukan kind diff. DILARANG mengikat kind ke status checkbox `isChecked`!
  * Di `git.svelte.ts::loadDiff()`:
    * Tambahkan fallback otomatis: jika diff yang diminta mengembalikan 0 file (misal file ternyata ada di working tree bukan di index atau sebaliknya), coba otomatis kind lawannya sehingga diff SELALU tampil.
  * Tambahkan context menu pada Unversioned Files: "Add to VCS" (memanggil `gitStore.stageFiles([path])`).

### 2. In-IDE Image Preview (`ui/features/editor/` & `crates/app/`)
- Di Rust core (`crates/app/src/commands.rs` & `crates/core/src/fs/mod.rs`):
  * Tambahkan command Tauri `read_file_base64(path: String) -> Result<String, String>` yang membaca file biner dan mengembalikan Base64 string.
  * Register command di `crates/app/src/lib.rs`.
- Di `ui/lib/api.ts`:
  * Tambahkan binding `readFileBase64(path: string): Promise<string>`.
- Di `ui/features/editor/`:
  * Buat komponen `ImagePreview.svelte`:
    - Menampilkan gambar di tengah layar dengan background catur transparan (*checkerboard*).
    - Status bar info di bawah: Dimensi pixel (`width x height`), ukuran file (KB/MB), format (`PNG`, `SVG`, dll).
    - Toolbar mini: Zoom In (+), Zoom Out (-), 100% (1:1), Fit to Screen.
  * Di `Editor.svelte`:
    - Deteksi ekstensi file gambar (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`).
    - Jika file adalah gambar, tampilkan `<ImagePreview filePath={active.path} />` alih-alih CodeMirror editor.

### 3. Run Configuration Dialog Draft System (`ui/features/run/`)
- Di `crates/core/src/run/config.rs` & `crates/core/src/run/flutter.rs`:
  * Tambahkan field `pub additional_args: Option<String>` pada struct `RunConfig`.
  * Pada `flutter.rs`: teruskan argumen tambahan dari `additional_args` ke command `flutter run`.
- Di `ui/lib/api.ts`:
  * Tambahkan `additionalArgs?: string | null` pada interface `RunConfig`.
- Di `ui/features/run/RunConfigDialog.svelte`:
  * Simpan seleksi aktif menggunakan string `selectedConfigName` (bukan indeks/referensi objek).
  * Tombol Tambah (`+`), Hapus (`−`), Duplikasi (`📋`) bekerja mulus pada `localConfigs`.
  * Form editor:
    - Input `Name`
    - Input `Dart Entrypoint Target` dengan dropdown / auto-suggest entrypoint yang ditemukan di workspace (seperti `lib/main.dart`, `lib/main_dev.dart`).
    - Input `Additional Run Arguments` yang mengikat langsung ke `currentSelectedConfig.additionalArgs` (menjaga seluruh argumen teks seperti `--flavor dev --dart-define=ENV=dev`).
    - Input `Build Flavor`.
  * Tombol Footer:
    - `Batal`: Tutup dialog, buang semua perubahan draft tanpa menyimpan.
    - `Terapkan`: Persist ke `.petak/run.json`, update `runStore.configs`, tampilkan indikator "✓ Diterapkan", dialog tetap terbuka.
    - `OK`: Persist ke disk & store, set runner active config, tutup dialog.

## Kriteria Selesai & Verifikasi
1. Commit panel memisahkan `Changes` dan `Unversioned Files` ala Android Studio.
2. Centang checkbox tidak lagi merusak diff viewer; diff selalu tampil saat file diklik.
3. File gambar yang dibuka di tab editor menampilkan Image Preview yang interaktif dan informatif.
4. Run Configuration dialog bisa berganti menu, tambah, hapus, duplikasi, simpan dengan `Terapkan` / `OK`, dan membatalkan dengan `Batal`.
5. Seluruh automated test suite (Rust & UI) PASS 100%.
6. Build dan deploy Petak.app di Mac M2.
