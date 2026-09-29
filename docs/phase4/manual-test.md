# Panduan Pengujian Manual Petak Fase 4 (Run, Device, & Logcat)

Panduan santai buat UQi buat nyobain fitur eksekusi aplikasi, device management, dan Logcat di Petak secara langsung.  
Semua pengujian bisa dijalankan aman menggunakan project Flutter sample tanpa menyentuh repo kerja JConnect.

---

## 1. Persiapan Project Sample

Kalau belum ada project Flutter sample di Mac/server, buka terminal dan buat satu project dummy cepat:

```bash
flutter create --org id.petak /tmp/petak-sample
cd /tmp/petak-sample
# Buat file target dev
cp lib/main.dart lib/main_dev.dart
```

Buka Petak, lalu buka folder tersebut via menu **File → Open Folder** (`/tmp/petak-sample`).

---

## 2. 8 Langkah Uji Coba Fitur Run & Device

### Langkah 1: Cek TitleBar (Run Config & Device Picker)
- Lihat bagian tengah atas jendela Petak (TitleBar).
- Di sebelah kiri ada dropdown **Target Run**: Petak otomatis mendeteksi `main.dart` dan `main_dev.dart`. Coba klik dan pilih `main_dev.dart`.
- Di sebelahnya ada dropdown **Device Picker**: menampilkan daftar perangkat yang sedang online atau emulator yang tersedia.
- Di sebelah kanan terdapat deretan tombol aksi: **Sync**, **Run** (segitiga hijau), **Hot Reload** (petir oranye), **Hot Restart** (panah melingkar), **Debug/DevTools** (kumbang), dan **Stop** (kotak merah).

---

### Langkah 2: Eksplorasi Rail Devices di Sidebar
1. Di sidebar paling kiri (Activity Rail), klik ikon **Devices** (ikon ponsel pintar di bawah ikon Git).
2. Panel samping akan membuka daftar perangkat:
   - **Connected Devices:** Menampilkan perangkat fisik yang dicolok atau emulator yang sedang berjalan.
   - **Available Emulators / AVDs:** Menampilkan daftar virtual device (misal `jatim_dev` atau simulator iOS).
3. Jika belum ada emulator yang menyala, klik tombol **Start** di samping nama emulator untuk menyalakannya langsung dari Petak.

---

### Langkah 3: Jalankan Aplikasi (Tombol Run)
1. Pastikan target (`main_dev.dart`) dan device tujuan sudah terpilih di TitleBar.
2. Klik tombol **Run** (ikon segitiga hijau).
3. Panel bawah akan otomatis terbuka ke tab **Run**:
   - Kamu bisa melihat log output dari Flutter daemon secara real-time.
   - Perhatikan Status Bar di pojok kiri bawah: status berubah dari `Idle` → `Building` → `Running`.
   - Tunggu beberapa saat sampai aplikasi terbuka di emulator/layar perangkat.

---

### Langkah 4: Coba Hot Reload & Hot Restart
1. Buka file `lib/main_dev.dart` di editor Petak.
2. Ubah salah satu teks tampilan, misalnya teks AppBar atau judul widget (contoh: ubah jadi `'Halo dari Petak!'`).
3. Tekan shortcut **`Cmd+S`** (atau klik tombol **Hot Reload** bergambar petir di TitleBar).
4. Perhatikan layar emulator: tampilan aplikasi langsung berubah seketika tanpa restart!
5. Lihat Status Bar bawah: muncul durasi reload, misalnya `Reloaded in 120ms`.
6. Coba klik tombol **Hot Restart** (ikon putar balik) jika ingin mereset state aplikasi dari awal secara cepat.

---

### Langkah 5: Eksplorasi Tab Logcat Berperforma Tinggi
1. Di panel dock bawah, klik tab **Logcat** di samping tab Run.
2. Logcat otomatis mengalirkan log sistem Android dari proses aplikasi kamu (`package:mine` aktif secara default):
   - **Pewarnaan Level:** Perhatikan warna teks log yang rapi dan nyaman di mata: Info (`#7fc98f` hijau), Warning (`#e8b45a` kuning), Error (`#f07a74` merah muda dengan background merah gelap `#2a1d1e`), Debug (`#8b8f98` abu-abu).
   - **Filter Minimum Level:** Coba ubah dropdown level dari `Verbose` ke `Warning` atau `Error` untuk menyaring pesan penting saja.
   - **Pencarian Real-Time:** Ketik kata kunci di kolom search atau filter Tag (pencarian responsif dengan debounce 100ms).
   - **Pause & Clear:** Klik tombol **Pause** untuk menghentikan scroll saat membaca baris log panjang, atau **Clear** untuk membersihkan layar.

---

### Langkah 6: Klik Stack Trace Link
1. Di dalam Logcat, jika ada error atau exception yang memuat file proyek (misal `package:petak_sample/main_dev.dart:25:5` atau `at MainActivity.kt:42`), baris tersebut akan bergaris bawah (*clickable link*).
2. Klik tautan teks tersebut.
3. Petak akan langsung membuka file yang bersangkutan di editor dan menempatkan kursor tepat di nomor baris error tersebut!

---

### Langkah 7: Buka Dart DevTools di Browser
1. Saat aplikasi sedang berjalan, klik tombol **Debug / DevTools** (ikon kumbang) di TitleBar, atau klik link DevTools yang muncul di tab Run.
2. Petak akan otomatis membuka antarmuka resmi Dart DevTools di browser default kamu (berguna buat Flutter Inspector, profiling CPU/memory, dan network tab).

---

### Langkah 8: Menghentikan Aplikasi (Tombol Stop)
1. Setelah selesai mencoba, klik tombol **Stop** (ikon kotak merah) di TitleBar.
2. Petak akan mengirim sinyal penghentian ke daemon dan mematikan proses aplikasi secara bersih.
3. Status Bar kembali menunjukkan status `Stopped`. Tab Logcat otomatis menghentikan streaming.

---

## 3. Panduan Pengujian Context Menu (File Tree & Tab Editor)

### Langkah 1: Bebas WebView Reload Menu (Root Cause Solved)
1. Klik kanan pada sembarang file di File Tree sidebar, pada baris folder, pada tab editor, maupun pada area kosong di bawah file tree.
2. **Hasil yang diharapkan:** Menu bawaan sistem WebView dengan satu tulisan "Reload" **tidak pernah muncul lagi**. Seluruh area menampilkan context menu kustom Petak yang rapi dan sesuai desain token.

### Langkah 2: Single File / Folder Context Menu
1. Klik kanan pada sebuah file Dart (misal `lib/main.dart`):
   - Muncul menu: **New ▸**, **Cut**, **Copy**, **Paste** (disabled), **Duplicate**, **Rename…**, **Delete…**, **Copy Path/Reference ▸**, **Open in ▸**, **Find in Folder…** (disabled pada file), **Compare With…**, **Compare with Clipboard**, **Reload from Disk**, **Select Opened File**, **Git ▸**, **Local History ▸**.
2. Tes **Copy Path/Reference ▸**:
   - Klik **Path from Content Root**: tersalin `lib/main.dart`.
   - Klik **Copy as 'package:' Import**: tersalin `import 'package:<pubspec>/main.dart';`.
3. Tes **Open in ▸**:
   - Klik **Reveal in Finder** (`⌥F1`): Finder macOS membuka dan menyorot file tersebut.
   - Klik **Open in Terminal**: panel terminal bawah terbuka dengan direktori aktif file/folder tersebut.

### Langkah 3: Inline Rename (Shift+F6)
1. Pilih file `lib/main.dart`, lalu tekan **`Shift+F6`** (atau klik menu **Rename…**).
2. Label file langsung berubah menjadi input text field inline:
   - Karakter stem `main` otomatis terseleksi; ekstensi `.dart` berada di samping kanan tanpa terseleksi.
   - Ketik nama baru, misalnya `main_app`, lalu tekan **`Enter`**.
   - Nama file di disk ter-rename aman, dan tab editor yang sedang membuka file tersebut otomatis terupdate path & namanya!
3. Coba ketik nama file yang sudah ada: muncul tooltip merah peringatan *"A file with this name already exists"*.
4. Tekan **`Escape`** untuk membatalkan inline rename.

### Langkah 4: Dialog New File / Folder (Cmd+N)
1. Tekan **`Cmd+N`** pada direktori yang dipilih (atau klik kanan **New ▸ File / Folder / Dart / Kotlin / Swift**).
2. Muncul modal dialog New File:
   - Coba ketik nested path, misal: `features/auth/login_screen.dart`.
   - Klik **Create** (atau tekan **`Enter`**).
   - Folder `features/auth/` otomatis terbuat jika belum ada, file baru langsung dibuka di tab editor aktif dan kursor siap mengetik!

### Langkah 5: Multi-Selection di File Tree
1. Gunakan **`Cmd+Click`** atau **`Shift+Click`** untuk memilih 2 file berbeda.
2. Klik kanan salah satu file yang terseleksi:
   - Header menu menampilkan: `2 items selected`.
   - Item **Rename…** otomatis tidak aktif (*disabled*).
   - Muncul item **Compare 2 Files…**: klik item ini, DiffView modal langsung terbuka membandingkan file A vs file B secara side-by-side!
3. Tes **Delete…** (`Cmd+Backspace`):
   - Muncul modal konfirmasi *"Move 2 items to Trash?"*.
   - File dipindahkan ke Trash sistem operasi secara aman tanpa permanent deletion.

### Langkah 6: Git Submenu & Rollback dengan Local History Snapshot
1. Pada file yang memiliki uncommitted changes, klik kanan **Git ▸ Show Diff**:
   - Modal DiffView menampilkan perubahan terhadap HEAD secara side-by-side.
2. Klik kanan **Git ▸ Rollback Changes…**:
   - Muncul modal konfirmasi proteksi keamanan: *"A Local History snapshot will be created automatically before rollback so you can undo"*.
   - Saat dikonfirmasi, snapshot Local History dibuat terlebih dahulu, lalu perubahan di-revert ke HEAD.

### Langkah 7: Dialog Local History (Show History)
1. Klik kanan sembarang file, pilih **Local History ▸ Show History**:
   - Jendela 2 kolom terbuka:
     - **Kolom Kiri:** Daftar snapshot (User Save, External Change, Before Rollback, User Label) dengan timestamp dan badge warna.
     - **Kolom Kanan:** DiffView side-by-side membandingkan snapshot terpilih vs kondisi file terkini di working tree.
2. Klik tombol **Put Label…**: sematkan label custom (misal `sebelum refactor payment`), label langsung muncul dengan badge kuning `🏷`.
3. Klik tombol **Revert**: file lokal dikembalikan ke isi snapshot tersebut.

### Langkah 8: Blame Gutter di Editor (Annotate)
1. Di tab editor, klik kanan tab file lalu pilih **Git ▸ Annotate** (atau via Git submenu).
2. Di sebelah kiri nomor baris kode, muncul kolom **Gutter Blame** (lebar 110px) menampilkan nama author dan waktu relatif (misal `UQi · 2h`).
3. Hover pada baris blame menampilkan tooltip lengkap (commit hash, email, tanggal, commit message).
4. Klik baris blame: otomatis membuka tab Git Log dan menyorot commit tersebut di graph.
5. Klik kanan pada baris blame: muncul menu mini untuk **Copy Revision Number** atau **Close Annotations**.

### Langkah 9: Tab Editor Context Menu
1. Buka 3 file di editor.
2. Klik kanan tab di tengah:
   - **Close Others**: menutup semua tab kecuali tab tersebut.
   - **Close to the Right**: menutup tab-tab di sebelah kanan.
   - **Close All**: menutup seluruh tab.
   - **Select in Project Tree**: menyorot dan scroll otomatis ke posisi file tersebut di File Tree sidebar.
