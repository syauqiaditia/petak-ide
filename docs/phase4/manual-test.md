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

---

## 4. Panduan Pengujian Device Mirror (Fase 4.5)

Fitur Device Mirror menampilkan layar perangkat secara live di panel samping kanan Petak dengan arsitektur full-tinggi (dock paling luar kanan), menyempitkan area editor tanpa memotong atau tertutup panel bawah (Terminal/Run/Logcat), serta menyediakan slot panel AI Agent Fase 5 di sebelah kirinya.

### Langkah 1: Membuka Panel Device Mirror
1. Buka panel mirror melalui salah satu cara berikut:
   - Klik ikon ponsel (Device Mirror) di sisi kanan TitleBar Petak.
   - Gunakan shortcut keyboard: **`Cmd+Shift+D`** (macOS) atau **`Ctrl+Shift+D`** (Linux/Windows).
   - Jalankan aplikasi ke perangkat (tombol **Run**): panel otomatis terbuka jika opsi auto-show aktif.
2. Perhatikan layout:
   - Panel muncul di dock paling kanan dengan tinggi penuh (dari bawah TitleBar hingga atas StatusBar).
   - Area editor dan panel bawah (Run/Logcat) menyempit secara mulus.
   - Slot kosong panel AI Agent Fase 5 berada di sebelah kiri panel mirror (tersembunyi secara default).

### Langkah 2: Mengubah Ukuran Panel (Resize)
1. Arahkan kursor mouse ke border sebelah kiri panel Device Mirror hingga kursor berubah menjadi `col-resize`.
2. Klik dan geser (drag) ke kiri atau kanan:
   - Ukuran panel dapat diubah dinamis antara **300 px** hingga **600 px**.
   - Rasio aspek tampilan layar perangkat tetap terjaga rapi dengan bezel gelap token Petak (`#111215`) dan kamera punch-hole 8px di bagian atas.

### Langkah 3: Interaksi Perangkat Android (Emulator & HP Fisik USB)
1. Pilih device Android di dropdown TitleBar atau Devices sidebar.
2. Saat koneksi terhubung (*status badge hijau `Live`*):
   - **Touch & Gesture:** Klik pada sembarang tombol atau widget di layar mirror, drag untuk scroll list view. Reticle sentuhan muncul memberi umpan balik visual instan.
   - **Ketik Teks:** Klik pada kolom input teks di dalam aplikasi Android, ketik teks melalui keyboard laptop/Mac. Teks langsung terketik di perangkat.
   - **Hardware Navigation Bar:** Di toolbar bawah layar mirror, klik tombol navigasi hardware:
     - **Back** (segitiga kiri)
     - **Home** (lingkaran tengah)
     - **Recents** (kotak kanan)
     - **Vol-** dan **Vol+**
     - **Power** (mengunci/membuka layar)
   - **Rotate:** Klik tombol Rotate di toolbar atas untuk memutar orientasi layar perangkat.
   - **Screenshot:** Klik ikon kamera di toolbar atas. Tangkapan layar tersimpan dan notifikasi toast konfirmasi muncul.

### Langkah 4: Membaca Telemetri Nyata (HUD FPS & Latency)
1. Perhatikan pill HUD di pojok kanan bawah area layar perangkat.
2. HUD menampilkan data telemetri aktual (bukan angka dummy):
   - **FPS:** Dihitung dari frame buffer nyata yang diterima dan dirender (target 30–60 FPS).
   - **Latency:** Selisih waktu nyata antara pengiriman input event hingga frame layar ter-render (target < 150 ms).

### Langkah 5: Pengujian iOS Simulator (Khusus macOS)
1. Di TitleBar, pilih target **iPhone 17 Pro Simulator** lalu klik **Run** (atau buka panel mirror).
2. Petak otomatis mem-boot simulator dan membuka window Simulator.app via `xcrun simctl`.
3. **Izin Screen Recording:**
   - Jika pertama kali dijalankan, macOS akan menampilkan dialog izin Screen Recording untuk Petak. Izinkan di *System Settings → Privacy & Security → Screen Recording*.
   - Stream ScreenCaptureKit hardware-accelerated 60 fps langsung aktif di canvas Petak.
4. **Slow Fallback Test:**
   - Jika izin belum diberikan atau window simulator diminimize, badge `slow-fallback` muncul dan stream beralih ke screenshot polling 5–10 fps secara aman.
5. **Input Best-Effort:**
   - Coba klik di area layar simulator: jika Facebook `idb` terpasang atau izin Accessibility aktif, tap akan dieksekusi. Jika tidak tersedia, UI menampilkan alasan transparan (view-only mode).

### Langkah 6: Pengujian iPhone Fisik (View-Only via USB di macOS)
1. Colokkan iPhone fisik ke Mac via kabel USB.
2. Pastikan iPhone dalam keadaan tidak terkunci (*unlocked*) dan konfirmasi dialog *"Trust This Computer"*.
3. Buka mirror untuk perangkat iPhone fisik tersebut:
   - Layar iPhone ditangkap secara hardware via CoreMediaIO / AVFoundation.
   - Toolbar bawah Android otomatis disembunyikan.
   - Badge amber **`VIEW ONLY`** muncul di toolbar atas dengan pesan transparan bahwa remote touch via USB tidak didukung resmi oleh Apple.

### Langkah 7: Pengujian Siklus Re-entry & Pembersihan Proses (App Quit)
1. **Re-entry Flow:** Tekan `Cmd+Shift+D` untuk menutup panel, lalu tekan lagi untuk membuka. Ulangi 3 kali. Pastikan tidak ada lag, frame macet, atau memory leak.
2. **Zero Orphan Process Test:**
   - Dengan mirror Android sedang aktif, tutup aplikasi Petak secara langsung (`Cmd+Q` atau tutup window).
   - Buka terminal di host dan jalankan:
     ```bash
     pgrep -il scrcpy
     adb forward --list
     ```
   - **Hasil yang diharapkan:** Seluruh proses `scrcpy-server` mati dan forward port TCP dibersihkan seketika. Tidak ada proses yatim tertinggal di perangkat maupun sistem.
