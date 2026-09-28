# Panduan Pengujian Manual Petak Fase 3 (Git)

Panduan santai buat UQi buat nyobain semua fitur Git di Petak langsung pakai repo demo dummy.  
Semua pengujian aman dijalankan di folder temporary, tanpa menyentuh repo kerja asli atau remote server.

---

## 1. Persiapan Repo Demo

Buka terminal dan jalankan skrip pembuat repo contoh:

```bash
bash scripts/phase3-demo-repo.sh
```

Skrip ini otomatis membuat repo dummy lengkap di folder:
- **Mac:** `/tmp/petak-phase3-demo` (atau `$TMPDIR/petak-phase3-demo`)
- **Server:** `/mnt/storage/uqi-cache/tmp/petak-phase3-demo`

Buka Petak, lalu buka folder tersebut via menu **File → Open Folder**.

---

## 2. 12 Langkah Uji Coba Fitur Git

### Langkah 1: Buka Tampilan Git
- Di sidebar paling kiri (Activity Rail), klik ikon **Git** (ikon percabangan cabang).
- Sidebar akan berganti menjadi panel Git dengan dua tab utama di atas: **Commit** dan **Log**.

---

### Langkah 2: Cek Ahead / Behind di Status Bar
- Lihat pojok kanan bawah jendela Petak (Status Bar).
- Kamu akan melihat teks cabang: `main ↑3` (atau ada ikon panah ke atas dengan angka 3).
- **Artinya:** Petak mendeteksi bahwa cabang `main` kamu punya 3 commit lokal yang belum di-push ke remote `origin`.

---

### Langkah 3: Stage Per-Hunk & Commit
1. Masuk ke tab **Commit** di Git view.
2. Di bagian **Changes**, kamu akan melihat file `README.md`. Klik file tersebut.
3. Di sisi kanan (DiffView), muncul tampilan diff warna hijau/merah. File ini punya 2 blok perubahan (*hunk*).
4. Di header blok atas, klik tombol **Stage Hunk**.
   - Perhatikan: blok tersebut pindah ke kelompok **Staged Changes**, sementara blok kedua tetap di **Changes**.
5. Di panel input commit di kiri bawah:
   - Ketik pesan commit: `docs: update top header notes`.
   - Perhatikan angka counter karakter (misal `31/50`). Jika melebihi 50 karakter, angka akan berubah warna mengingatkan subject line.
6. Klik tombol **Commit** (atau tekan shortcut `Cmd+Enter` / `Ctrl+Enter`).
   - File yang ter-stage berhasil di-commit dan daftar staged kembali kosong.

---

### Langkah 4: Eksplorasi Tab Log & Grafik Garis Warna
1. Klik sub-tab **Log** di bagian atas Git view.
2. Kamu akan melihat tabel riwayat commit dengan garis grafik bercabang warna-warni (*lane graph*).
3. Perhatikan badge ref di samping pesan commit:
   - Badge biru untuk cabang lokal (`main`, `feature/voucher`).
   - Badge ungu/oranye untuk tag (`v0.1.0`, `v0.2.0`).
   - Badge abu-abu untuk remote tracking (`origin/main`).
4. Coba scroll daftar ini — rendering sangat ringan karena menggunakan virtualisasi baris.
5. Coba ketik di kolom filter pencarian (misal ketik `auth` atau nama author) untuk melihat filter reaktif.

---

### Langkah 5: Squash 2 Commit & Batalkan Lewat Undo
1. Di panel kiri **Branches**, double-click cabang `feature/voucher` untuk beralih ke cabang tersebut.
2. Di tabel Log, kamu akan melihat 2 commit kerja sementara berturut-turut:
   - `wip checkout: adjust voucher layout and padding`
   - `wip: voucher validation logic`
3. Klik kanan pada commit `wip checkout`, lalu pilih menu **Squash into previous**.
4. Muncul dialog konfirmasi pesan squash. Klik **Apply**.
5. Kedua commit kini menyatu menjadi satu commit rapi!
6. **Mencoba Fitur Undo / Restore Backup:**
   - Di panel kiri Git, buka accordion **Backups** (ikon jam riwayat).
   - Di situ tercatat otomatis backup snapshot bertuliskan `squash`.
   - Klik tombol **Restore** di samping backup tersebut.
   - Seketika riwayat kembali pulih seperti sebelum di-squash (2 commit terpisah kembali utuh, tanpa kehilangan data).

---

### Langkah 6: Edit Pesan Commit (Reword)
1. Klik kanan pada commit `wip: voucher validation logic`.
2. Pilih menu **Edit Message...** (Reword).
3. Masukkan pesan baru yang lebih deskriptif: `feat(voucher): implement core voucher validation rules`.
4. Klik **Save**.
5. Pesan commit di tabel Log langsung berganti seketika, dan Petak otomatis mencatat snapshot backup baru sebelum perubahan terjadi.

---

### Langkah 7: Dialog Interactive Rebase (Drag Urutan & Drop)
1. Kembali ke cabang `main`.
2. Klik kanan commit `feat(cart): implement shopping cart calculation`, pilih **Interactively Rebase from Here...**.
3. Dialog Interactive Rebase (960×620 px) akan terbuka:
   - Di kolom Action, kamu bisa memilih dropdown: `pick`, `reword`, `squash`, `fixup`, `drop`, atau `edit`.
   - Di sisi kiri tiap baris terdapat ikon drag `⋮⋮`. Coba tarik (*drag*) salah satu commit ke atas atau ke bawah untuk menukar urutan eksekusi.
   - Coba ubah aksi salah satu commit menjadi `drop` (baris akan tercoret redup).
   - Perhatikan teks ringkasan di kiri bawah dialog: *"N commits will become M commits"*.
   - Pastikan opsi centang *"Create backup ref"* tetap aktif.
4. Klik **Start Rebase**. Operasi rebase akan selesai dan riwayat cabang kamu tersusun sesuai rencana baru.

---

### Langkah 8: Reset Hard & Kembalikan 100% via Backup
1. Di tabel Log, klik kanan salah satu commit lama (misal commit `feat(profile)...`).
2. Pilih menu **Reset Current Branch to Here...**.
3. Pada dialog pilihan mode reset:
   - Pilih opsi **Hard (discard all changes)**.
   - Muncul dialog konfirmasi bahaya. Klik konfirmasi reset.
4. Cabang `main` kini melompat mundur dan commit-commit terbaru tampak hilang dari riwayat.
5. **Jangan panik! Kembalikan via Backup:**
   - Buka panel **Backups** di sidebar kiri Git.
   - Snapshot dengan label `reset` tercatat paling atas.
   - Klik tombol **Restore**.
   - Cabang `main` langsung kembali pulih ke posisi HEAD semula sebelum reset hard!

---

### Langkah 9: Simulasi Konflik Merge & Editor 3 Kolom
1. Di panel **Branches**, cari branch `feature/conflict-branch`.
2. Klik kanan pada branch tersebut, lalu pilih **Merge into current**.
3. Karena cabang ini mengubah baris konfigurasi yang sama dengan `main` pada `src/config.json`, Git akan mendeteksi konflik:
   - Muncul banner peringatan oranye di bagian atas: *"Merging in progress — 1 conflicting file"*.
   - Sub-tab otomatis beralih ke **Conflict**.
4. Klik file `src/config.json` pada daftar file berkonflik.
5. Tampilan editor 3 kolom akan terbuka:
   - **Kolom Kiri (Yours / main):** tema `nord-frost-blue`, timeout `8000`.
   - **Kolom Tengah (Result):** editor hasil penggabungan yang bisa diedit langsung.
   - **Kolom Kanan (Theirs / feature/conflict-branch):** tema `dracula-purple`, timeout `3000`.
6. Di blok konflik, kamu bisa memilih tombol aksi cepat:
   - Klik **Accept Yours** jika ingin memakai versi cabang saat ini.
   - Klik **Accept Theirs** jika ingin memakai versi cabang yang digabung.
   - Atau ketik langsung di kolom tengah sesuai kebutuhan (misal menggabungkan nilai keduanya).
7. Setelah tanda konflik `<<<<<<<` dan `>>>>>>>` bersih, klik tombol **Mark as Resolved**.
8. Pada banner oranye di atas, klik tombol **Continue Merge**.
9. Penggabungan selesai dan merge commit otomatis terbentuk!

---

### Langkah 10: Batalkan Operasi yang Macet (Abort)
1. Jika di tengah rebase atau merge kamu berubah pikiran dan tidak ingin melanjutkan, cukup klik tombol **Abort** pada banner status di bagian atas.
2. Petak akan menjalankan `git merge --abort` atau `git rebase --abort` dan mengembalikan posisi kerja kamu persis seperti sebelum operasi dimulai.

---

### Langkah 11: Sinkronisasi Push ke Remote Lokal
1. Di bagian kanan atas toolbar Git view, terdapat tombol aksi remote:
   - Ikon **Fetch** (ambil update remote)
   - Ikon **Pull** (tarik & gabungkan perubahan)
   - Ikon **Push** (kirim commit lokal ke remote)
2. Klik tombol **Push** (panah atas).
3. Modal dialog Push akan terbuka, menampilkan:
   - Pilihan remote: `origin` (menunjuk ke repo bare `file://` di folder temp).
   - Cabang tujuan: `main`.
   - Checkbox *Force with lease* (dinonaktifkan secara aman untuk push biasa).
4. Klik **Push**.
5. Setelah berhasil, perhatikan status bar di pojok kanan bawah: indikator `↑3` hilang dan cabang menjadi bersih karena sudah sejajar dengan remote!

---

### Langkah 12: Buat & Hapus Branch Baru
1. Klik tombol **+** di panel Branches (atau klik kanan cabang mana saja lalu pilih **New Branch from Here...**).
2. Masukkan nama cabang baru: `experiment/coba-fitur`.
3. Cabang baru langsung tercipta.
4. Untuk menghapus, klik kanan cabang `experiment/coba-fitur`, lalu pilih **Delete Branch**. Cabang terhapus dengan aman.

---

## 3. Rangkuman & Jaminan Keamanan
- Seluruh pengujian di atas berjalan 100% lokal di folder sementara.
- Setiap kali operasi penulisan ulang riwayat dijalankan (*squash*, *reword*, *rebase*, *reset*), Petak selalu mengamankan referensi git di bawah `refs/petak/backup/*`, sehingga tidak ada risiko kehilangan commit atau pekerjaan berharga.
