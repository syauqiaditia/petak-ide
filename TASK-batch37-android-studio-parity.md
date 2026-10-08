# Petak — TASK Batch 37: Android Studio Parity, Search & Replace Redesign, ACP Approval Fix & Editor Polish

## Daftar Kebutuhan & Masalah Pengguna (UQi)

### 1. Search & Replace Toolbar Redesign (100% Mirip Android Studio)
- **Struktur Toolbar 2 Baris**:
  - Baris 1 (Search): Input Search, tombol toggle `Cc` (Match Case), `W` (Words), `.*` (Regex), label match count (contoh `1/8` atau `0 results`), panah navigasi Up/Down (▲/▼), Filter icon, Close `✕`.
  - Baris 2 (Replace): Input Replace, tombol `Replace`, `Replace All`, `Exclude`.
- **Masking Selection ke Search**: Jika ada teks yang sedang diblok di editor saat ⌘F ditekan, otomatis jadikan teks tersebut query pencarian.
- **Navigasi Search Reliable**: Tekan Enter / ⌘G / panah harus selalu lompat ke hasil berikutnya secara konsisten tanpa error 0/0.
- **Editor Tetap Interaktif**: Saat search bar aktif, user tetap bisa memblok/menyeleksi teks di editor tanpa terganggu.
- **Warna Highlight Mencolok**: Highlight hasil pencarian diberi warna tegas + border putih tipis (`outline: 1.5px solid #ffffff`) agar sangat jelas.
- **Warna Selection / Block Text**: Warna highlight seleksi teks biasa dipertegas kontrasnya agar tidak pudar/samar.

### 2. ACP Approval Dialog Fix
- Investigasi penyebab request tool ACP langsung ter-decline otomatis.
- Pastikan RPC event `session/request_permission` atau asking tool call langsung memunculkan modal persetujuan (Allow / Deny) di UI Petak Agent tanpa auto-reject.

### 3. Spacing Tombol Stop Petak Agent
- Pastikan tombol Stop di composer chat tidak menembus batas border atau keluar kotak di segala ukuran panel.

### 4. ⌘+Click (Go to Definition & Usages) Cerdas
- **⌘+Click pada pemanggilan fungsi**: Lompat ke definisi fungsi dan posisikan baris tepat di tengah layar (`scrollIntoView({ block: 'center' })`).
- **⌘+Click pada deklarasi fungsi**:
  - Jika private & dipakai di beberapa tempat: Tampilkan dropdown list usages.
  - Jika public: Tampilkan dropdown usages dengan preview 2-3 baris kode.
  - Jika hanya dipakai 1 tempat: Langsung lompat ke lokasi pemakaian tersebut (center).
  - Jika tidak dipakai: Tampilkan indikator/tooltip "tidak terpakai" (0 usages).

### 5. Retensi Posisi Scroll per Tab
- Simpan `scrollTop` dan cursor state per file path di `tabsManager`.
- Saat berpindah tab dan kembali lagi, posisi scroll tidak boleh reset ke atas, harus tetap di posisi terakhir.

### 6. LSP Smoothness & Latency
- Optimalkan komunikasi Dart/Kotlin/Swift LSP: kurangi debounce berlebih, buat diagnostics dan autocompletion responsif dan instan.

### 7. Persistensi Chat & Referensi
- Pastikan riwayat percakapan beserta referensi berkas (`fileReferences`) tetap tersimpan utuh saat aplikasi dibuka kembali (reopen).

### 8. Tema Android Studio Dark (Darcula / New UI)
- Tambahkan preset tema editor baru yang warnanya identik dengan tema gelap Android Studio (lebih kalem, slate gray, kontras pas).

### 9. VCS Gutter Markers & Git Blame
- Berikan penanda warna perubahan Git di gutter editor (hijau: tambah, biru: modifikasi, kuning/merah: hapus) seperti di Android Studio.
- Berikan fitur Git Blame inline pada baris kode (siapa yang mengubah & kapan).

### 10. Indent Guides & Bracket Matching Lines
- Tampilkan garis vertikal pemandu indentasi dan garis penghubung kurung kurawal `{ }` / `( )` yang jelas seperti di Android Studio.
