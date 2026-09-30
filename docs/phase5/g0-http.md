# Petak Fase 5 — Laporan Keputusan HTTP Client & Ukuran Binary (G0)

**Tanggal:** 30 September 2026  
**Penulis:** senior2  
**Worktree:** wt/p5-p5-g0 (Task t_982288a6)  
**Tujuan:** Evaluasi dan putuskan HTTP client untuk `crates/core`, ukur delta binary A/B terhadap baseline 19.48 MB (budget < 20 MB, delta <= +0.6 MB), serta bangun mock server GitLab lokal dan fixtures.

---

## 1. Ringkasan Eksekutif & Keputusan

1. **Keputusan Final:** Memilih **`ureq` dengan `native-tls`** (`ureq = { version = "2.10", default-features = false, features = ["native-tls", "json"] }`).
2. **Hasil Ukuran Binary:**
   - Baseline stripped: **349,984 bytes** (~0.33 MB)
   - `ureq` (native-tls) stripped: **824,464 bytes** (delta: **+474,480 bytes / +0.45 MB**)
   - `ureq` (native-tls) dengan LTO + opt-level="z": **608,120 bytes** (delta: **+316,320 bytes / +0.30 MB**)
   - Proyeksi ukuran aplikasi: **19.48 MB + 0.45 MB = 19.93 MB** (atau **19.78 MB** dengan LTO), **LOLOS budget < 20 MB** (headroom tersisa ~70–220 KB, delta di bawah batas +0.6 MB).
3. **Mengapa bukan `ureq + rustls` (default)?**
   - `ureq` default mengaktifkan `rustls` + `ring` + `webpki-roots`.
   - Stripped size mencapai **2,467,496 bytes** (delta: **+2,117,512 bytes / +2.02 MB**).
   - Proyeksi aplikasi: **19.48 MB + 2.02 MB = 21.50 MB** -> **MELANGGAR batas keras 20 MB**.
4. **Mengapa bukan `shell-out curl`?**
   - Meskipun delta curl sangat kecil (+0.047 MB), shell-out menimbulkan overhead spawn child process pada setiap panggilan API GitLab (list, detail, pipeline, diff, diskusi), tidak memiliki connection keep-alive / connection pooling, dan parsing header (ETag, X-Next-Page, Retry-After) serta status code rentan rapuh dibanding typed client Rust.
   - `ureq` native-tls memenuhi syarat budget binary sekaligus memberikan performa dan keandalan kode yang jauh lebih baik.
5. **Mock Server & Fixtures:**
   - Server mock lokal dibangun di `crates/core/tests/gitlab_mock/mod.rs` menggunakan `tiny_http` (`dev-dependencies`).
   - 19 file fixture anonim manual tersimpan di `fixtures/gitlab/*.json` (symlinked ke `crates/core/fixtures/gitlab/`).
   - Seluruh 7 skenario pengujian (auth 401, scope 403, paginasi X-Next-Page, ETag 304, rate limit 429+Retry-After, merge 405/406, diffs 404 fallback ke changes) telah lolos 100% pada `crates/core/tests/gitlab_mock_test.rs`.

---

## 2. Tabel Perbandingan Ukuran Binary (A/B Test)

Pengukuran dilakukan pada release build stripped (`cargo build --release` + `strip`):

| Opsi HTTP Client | Ukuran Stripped (Default Profile) | Delta vs Baseline | Ukuran Stripped (LTO + opt-level="z") | Delta (LTO) | Proyeksi Ukuran App (dari 19.48 MB) | Status Budget (< 20 MB, delta <= +0.6 MB) |
|---|---|---|---|---|---|---|
| **Baseline** (tanpa HTTP) | 349,984 bytes (0.33 MB) | - | 291,800 bytes (0.28 MB) | - | 19.48 MB | Acuan |
| **`shell-out curl`** (`Command::new("curl")`) | 399,512 bytes (0.38 MB) | +49,528 bytes (+0.047 MB) | 334,296 bytes (0.32 MB) | +42,496 bytes (+0.040 MB) | 19.53 MB | **LOLOS** |
| **`ureq + native-tls`** (DIPILIH) | 824,464 bytes (0.79 MB) | **+474,480 bytes (+0.45 MB)** | 608,120 bytes (0.58 MB) | **+316,320 bytes (+0.30 MB)** | **19.93 MB** (19.78 MB LTO) | **LOLOS** |
| **`ureq + rustls`** (default ureq) | 2,467,496 bytes (2.35 MB) | +2,117,512 bytes (+2.02 MB) | 1,637,872 bytes (1.56 MB) | +1,346,072 bytes (+1.28 MB) | 21.50 MB (20.76 MB LTO) | **GAGAL (OVER BUDGET)** |

### Catatan Teknis Delta `rustls` vs `native-tls`:
- `rustls` membundel implementasi kriptografi statis (`ring` assembly untuk AES, SHA, ECDSA, RSA) dan embedded root certificate store Mozilla (`webpki-roots`). Hal ini menambah ~1.3–2.0 MB ke binary.
- `native-tls` mendelegasikan TLS ke sistem operasi:
  - Pada **macOS**: menggunakan `Security.framework` bawaan OS tanpa dependensi C eksternal atau cert bundle statis.
  - Pada **Linux**: menggunakan `libssl`/`libcrypto` sistem yang sudah tersedia.
- Panggilan mock server lokal (`http://127.0.0.1:<port>`) berjalan di atas plain HTTP tanpa overhead TLS sama sekali.

---

## 3. Mock Server GitLab & Fixture Selesai Dibuat

### 3.1 Lokasi File
- Modul server mock: `crates/core/tests/gitlab_mock/mod.rs`
- Test suite lokal: `crates/core/tests/gitlab_mock_test.rs`
- Fixture data anonim (19 file): `fixtures/gitlab/*.json`

### 3.2 Fitur Mock Server yang Terverifikasi
1. **Paginasi Header:**
   - `X-Page`, `X-Per-Page`, `X-Next-Page`, `X-Total-Pages`, `X-Total`.
   - Halaman terakhir secara otomatis tidak menyertakan `X-Next-Page`.
2. **ETag & 304 Not Modified:**
   - Server mengembalikan header `ETag`.
   - Client mengirim `If-None-Match` yang cocok -> server mengembalikan HTTP 304 tanpa body.
3. **Rate Limiting (429 + Retry-After):**
   - Mendukung rute `/api/v4/rate-limited` serta trigger header `X-Test-Rate-Limit: 1` pada endpoint manapun.
   - Mengembalikan HTTP 429, header `Retry-After: 5`, `RateLimit-Remaining: 0`, dan body JSON error.
4. **Validasi Autentikasi & Scope Token:**
   - Tanpa token / token `invalid-token` -> HTTP 401 Unauthorized.
   - Token dengan scope `read_api` (`read-token`) berhasil pada request GET, namun ditolak dengan HTTP 403 Forbidden pada mutasi tulis (`POST`, `PUT`, `DELETE`).
   - Token dengan scope `api` berhasil pada operasi tulis (HTTP 201 / 200).
5. **Kegagalan Merge:**
   - HTTP 405 Method Not Allowed untuk MR berstatus draft atau bila terdapat konflik.
   - HTTP 406 Not Acceptable untuk mismatch SHA atau MR yang telah dimerge.
   - HTTP 200 OK untuk merge sukses dengan `merge_commit_sha`.
6. **Fallback Diff:**
   - Endpoint `/diffs` pada proyek legacy mengembalikan HTTP 404.
   - Client dapat melakukan fallback ke `/changes` yang mengembalikan daftar file perubahan.

---

## 4. Hasil Verifikasi Otentik

- **`cargo test -p petak-core`**: 100% HIJAU (177 unit tests + 7 fsops + 9 git conflict + 1 git log + 6 git ops + 10 git path + 16 git rebase + 3 git remote + 7 gitlab mock + 4 local history + 9 lsp integration + 3 lsp dart + 1 lsp kotlin + 1 lsp swift + 12 review nakal + 6 suggest index + 4 toolchain resolver = **267 passing tests**).
- **Clippy**: 0 warning baru pada kode yang ditambahkan.
- **Mock Server Tests**: 7 passing tests di `crates/core/tests/gitlab_mock_test.rs` dalam 1.34 detik.
