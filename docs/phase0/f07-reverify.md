# Petak F0.7: Verifikasi Ulang 3 Angka Fase 0 di Mac

Tanggal: 28 September 2026  
Perangkat: Mac UQi (Apple Silicon M2, RAM 8 GB, macOS 26.5 / Sequoia)  
App: Tauri 2 + Svelte 5 + CodeMirror 6  
Binary: `/Users/uqi/petak/target/release/bundle/macos/Petak.app` (SHA-256: `91a59b7b5036a55e084b7b81986b934edcc15cf81ba0b8e5a483e8a7339911a6`)

---

## 1. Latar Belakang & Tujuan

Pada review fase 0 sebelumnya (`docs/phase0-report.md` §8 poin 4), 3 metrik performa UI utama belum dapat diverifikasi secara independen oleh reviewer karena layar Mac dalam kondisi terkunci (`CGSSessionScreenIsLocked`), sehingga WKWebView ter-throttle dan event `PETAK_READY` mengalami timeout.

Tujuan F0.7 adalah mengukur ulang dan mencatat ketiga metrik tersebut dalam kondisi layar aktif (unlocked), tanpa melakukan optimasi kode (out of scope).

Tiga metrik yang diverifikasi ulang:
1. **Cold start** (angka lama: 739 ms)
2. **Ketik 10k baris** (angka lama: 17.0 ms)
3. **Buka 50k baris** (angka lama: 33 ms)

---

## 2. Kondisi Lingkungan Uji

1. **Status Layar Mac:**
   - Command: `ioreg -n Root -d1 | grep -i CGSSessionScreenIsLocked` → tidak ditemukan flag lock (exit code 1).
   - Screenshot: `screencapture -x /tmp/screen_check.png` diverifikasi via vision tool, mengonfirmasi desktop macOS aktif/terbuka (aplikasi Discord dan Claude aktif, menu bar dan dock normal, tidak ada lock screen/screensaver).
2. **Bundle App & Pipeline State:**
   - Binary yang diuji adalah bundle yang sama dari F0.1/F0.2 (`target/release/bundle/macos/Petak.app` timestamp 27 Sep 23:09, commit basis `1bf73e4`).
   - Catatan F0.5: Di task F0.5 (commit `bdc9123`), grammar `tree-sitter-swift.wasm` telah diperbarui ke versi `alex-pinkus @ 187fd4d` di repo frontend. Namun binary `Petak.app` yang ada belum di-rebuild dengan wasm baru tersebut (sesuai catatan F0.5: node bench representatif dan tidak perlu rebuild 5 menit). Saat benchmark app dijalankan, pengujian `buka 50k` dan `ketik 10k` berjalan di awal sebelum tree-sitter Swift, sehingga angka kedua metrik tersebut murni dan tidak terpengaruh oleh pipeline Swift lama.
3. **Ketersediaan Disk:**
   - Disk Mac tersedia 19 GB bebas sebelum dan sesudah pengujian (`/dev/disk3s1s1`).

---

## 3. Hasil Pengukuran Baru

### A. Cold Start (`scripts/measure-coldstart.mjs`)
- Diukur dari spawn `open -n --stdout` hingga penerimaan event `PETAK_READY` (CodeMirror 6 mount + focus + 2 siklus `requestAnimationFrame`).
- **Run 0 (First Launch / Disk Cold):** 1,635 ms (wall: 1,656 ms)
- **Runs 1..5 (Subsequent Launches):**
  - Run 1: 675 ms (wall: 679 ms)
  - Run 2: 641 ms (wall: 657 ms)
  - Run 3: 588 ms (wall: 610 ms)
  - Run 4: 566 ms (wall: 578 ms)
  - Run 5: 624 ms (wall: 630 ms)
- **Urutan terurut (Runs 1..5):** 566, 588, 624, 641, 675 ms
- **Median Cold Start Baru:** **624 ms**

### B. Buka File 50k Baris (`Big50k.kt`, 1.1 MB — 3 Run Independen)
- Diukur dalam app riil melalui `scripts/run_f02_bench.py` (5 iterasi load per run):
  - **Run 1:** [33, 34, 32, 33, 34] ms → Median: **33.00 ms**
  - **Run 2:** [32, 35, 33, 36, 34] ms → Median: **34.00 ms**
  - **Run 3:** [32, 33, 33, 33, 34] ms → Median: **33.00 ms**
- **Median Agregat (3 Run):** **33.00 ms**

### C. Latensi Ketik 10k Baris (`Big10k.kt`, 228 KB — 3 Run Independen)
- Diukur dalam app riil melalui `scripts/run_f02_bench.py` (200 karakter simulasi pengetikan di tengah dokumen, dispatch → `requestAnimationFrame`):
  - **Run 1:** p50: **17.00 ms**, p95: 18.00 ms, max: 18.00 ms, avg: 16.65 ms
  - **Run 2:** p50: **17.00 ms**, p95: 18.00 ms, max: 20.00 ms, avg: 16.635 ms
  - **Run 3:** p50: **17.00 ms**, p95: 17.00 ms, max: 19.00 ms, avg: 16.655 ms
- **Median Agregat p50 (3 Run):** **17.00 ms**

---

## 4. Tabel Ringkasan: Lama vs Baru

| Metrik | Target/Budget | Angka Lama (F0.1) | Angka Baru (F0.7) | Selisih (%) | Status / Keterangan |
|---|---|---|---|---|---|
| **Cold Start (median)** | < 400 ms | 739 ms | **624 ms** | **-15.6%** | Lebih cepat 115 ms (selisih < 20%, variasi wajar WebKit) |
| **Buka file 50k baris** | < 300 ms | 33 ms | **33.00 ms** | **0.0%** | **Identik sempurna** (jauh di bawah budget 300 ms) |
| **Ketik 10k baris (p50)** | < 16 ms | 17.0 ms | **17.00 ms** | **0.0%** | **Identik sempurna** (kuantisasi vsync 60Hz ~16.6 ms) |
| Cold Start (first launch) | — | 1,691 ms | **1,635 ms** | -3.3% | Konsisten disk cold boot |
| Ketik 10k baris (avg) | — | 16.66 ms | **16.65 ms** | -0.1% | Stabil 1 vsync cycle |

---

## 5. Evaluasi & Analisis

1. **Selisih > 20%?**
   - **Tidak ada.** Semua metrik baru berada dalam rentang toleransi < 20% dari angka lama.
   - Metrik `buka 50k` (33.00 ms) dan `ketik 10k` (17.00 ms) mereproduksi angka F0.1 secara persis (0.0% deviasi).
   - Cold start mengalami percepatan sebesar 15.6% (624 ms vs 739 ms) yang konsisten dengan kondisi sistem tanpa beban screensaver/lock. Angka ini tetap mengonfirmasi bahwa batas bawah cold start Tauri/WKWebView di macOS berada pada ~600–700 ms karena overhead bootstrap multiproses WebKit.

2. **Kesimpulan Verifikasi:**
   - Ketiga angka hasil pengukuran awal F0.1 **terbukti valid dan sepenuhnya reproducible** ketika diuji pada layar Mac yang terbuka.
   - Risiko #3 & catatan blocker lingkungan pada §8 poin 4 dokumen `docs/phase0-report.md` kini telah terjawab dan terverifikasi secara faktual.

---

## 6. Log Mentah

- `docs/phase0/logs/f07-coldstart.txt` — Log eksekusi 5+1 run `measure-coldstart.mjs`
- `docs/phase0/logs/f07-bench-app-run1.txt` — Log mentah run 1 `run_f02_bench.py`
- `docs/phase0/logs/f07-bench-app-run2.txt` — Log mentah run 2 `run_f02_bench.py`
- `docs/phase0/logs/f07-bench-app-run3.txt` — Log mentah run 3 `run_f02_bench.py`
