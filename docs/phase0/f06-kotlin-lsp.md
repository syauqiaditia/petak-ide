# F0.6 — Kotlin LSP di project Android asli + keputusan

Spike fase 0 bagian 6. Menutup risiko #2 (kotlin-lsp JetBrains tidak kasih diagnostics dalam 5 menit — F03). Tes ulang di project Android/Kotlin asli, plus pembanding fwcd/kotlin-language-server.

## Project yang dipakai

| | Keterangan |
|---|---|
| Nama | [android/architecture-samples](https://github.com/android/architecture-samples) |
| Commit | `ee66e15` (HEAD, shallow `--depth 1`) |
| Ukuran | 4.8 MB |
| File .kt | ~30 (main + test + androidTest), Compose + Hilt + Room |
| Error yang disuntik | `fun typeError(): Int { return "hello" }` di `TodoActivity.kt` |

Env Mac M2: Java 19.0.2, Android SDK (platforms 28/29), Gradle cache 15 GB sudah ada, Node 26.8.2.

## Hasil

| Server | Versi | Diagnostics? | Detik ke diagnostics | Initialize (ms) | RSS puncak (MB) | Install (MB) |
|---|---|---|---|---|---|---|
| kotlin-lsp (JetBrains) | v263.4702.0 | ❌ | timeout 600s | 2,357 | 911.5 | 1,100 |
| fwcd/kotlin-language-server | v1.3.13 | ✅ | 23.7 | 15,193 | 849.2 | 89 |
| fwcd (fixture, tiny project) | v1.3.13 | ✅ | 1.9 | 946 | 210.4 | 89 |

### Detail kotlin-lsp (JetBrains)

- Initialize cepat (2.4 dtk), tapi setelahnya download Gradle 8.11.1 dan mulai indexing.
- Dalam 600 detik (10 menit), hanya kirim 2× `publishDiagnostics` kosong.
- RSS naik sampai 911.5 MB (hampir 1 GB) di project asli, vs 481.8 MB di fixture (F03).
- Sama persis seperti F03: server nyala, tapi diagnostics tidak pernah masuk. Gradle sync / IntelliJ indexing tidak selesai dalam waktu wajar.
- **Kesimpulan: kotlin-lsp (JetBrains) tidak usable untuk diagnostics di project real.**

### Detail fwcd/kotlin-language-server

- Initialize lebih lambat (15.2 dtk) karena mem-bootstrap classpath Kotlin stdlib sendiri.
- **Diagnostics masuk di 23.7 detik** dengan pesan benar: "Type mismatch: inferred type is String but Int was expected" (severity 1 = error).
- RSS 849 MB tinggi tapi functional — di fixture cuma 210 MB.
- Install size 89 MB (12× lebih kecil dari JetBrains).
- Stderr ada "Bus is already disposed" saat shutdown — non-fatal, terjadi setelah diagnostics sudah diterima.
- Di tiny project (fixture): diagnostics masuk dalam 1.9 dtk, RAM 210 MB. Sangat cepat.

## Keputusan

**Fase 1 Kotlin: pakai fwcd/kotlin-language-server v1.3.13 untuk diagnostics.**

Alasan:
1. **Satu-satunya yang jalan.** JetBrains kotlin-lsp gagal total di 2 tes (fixture + real project), 0 diagnostics dalam total 15 menit running.
2. **24 detik reasonable.** Untuk editor code yang bukan IDE real-time, 24 detik cold-start ke diagnostics pertama di project real cukup — user buka file → mulai edit → diagnostics muncul sebelum mereka selesai menulis.
3. **Install kecil.** 89 MB vs 1.1 GB.
4. **Fallback jelas.** Kalau fwcd juga terlalu berat/lambat nanti di project besar (>100 file .kt, RSS bisa >1 GB), downgrade ke tree-sitter-only (highlight + basic error dari grammar, tanpa type checking).

Catatan: fwcd butuh JDK 17+ di mesin user. Di Mac UQi sudah ada (Java 19). Tree-sitter Kotlin tetap diperlukan untuk syntax highlight real-time — fwcd hanya untuk diagnostics.

## Disk

| | GB free |
|---|---|
| Sebelum semua tes | 4.1 |
| Sesudah semua tes | 19.0 |
| Final (setelah cleanup) | 19.0 |

Sisa temp: `/tmp/petak-kotlin-test` (4.8 MB) + `/tmp/f06-kotlin-test.mjs` di Mac — agent tidak bisa hapus (security scanner blok `rm -rf` remote). UQi bisa hapus manual kalau mau, tapi negligible.

## Log mentah

- `logs/f06-jetbrains-real.txt` — kotlin-lsp JetBrains di architecture-samples (FAIL)
- `logs/f06-fwcd.txt` — fwcd di architecture-samples (PASS) + fwcd di fixture (PASS)
