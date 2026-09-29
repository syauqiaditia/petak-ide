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
