# P2.6 — Design Review UI LSP (Fase 2)

_Reviewer: designer. Screenshot asli: `docs/phase2/screens/*.png` (1440×900) vs `vault/Projects/Petak/design.md`, `design/Main.html`, `design/Suggest.html`._

## Catatan metodologi (penting)
Dari 6 screenshot, **3 berhasil dibaca ulang via vision di sesi ini** (diagnostics-problems, hover, goto-def) — temuan di bawah berbasis piksel nyata. **3 lainnya (completion.png, alt-enter-before.png, alt-enter-after.png) gagal di-render ulang** — gambar itu sudah "dimuat" di context dari attempt sebelumnya (run 134, sebelum di-reclaim karena limit Gemini) dan sistem vision men-dedupe sehingga tidak menampilkan ulang isi piksel ke saya di run ini. Saya tidak fabrikasi isi 3 gambar itu. Rekomendasi: manager minta task terpisah (fresh session) khusus re-render completion.png + alt-enter-before/after.png kalau butuh verdict lengkap untuk komponen completion popup & quick-fix menu.

---

## 1. Diagnostics / Problems panel — `diagnostics-problems.png`

**Diverifikasi nyata (screenshot).**

Yang match dengan design:
- Tab bar bawah (Run, Logcat, Terminal, Problems, Build) sesuai `Main.html` baris 180-187.
- Ada underline wavy merah di kode (`"broken_type_error"`) — sesuai konsep `.warn{text-decoration:underline wavy #e8b45a}` di desain, meski warna di real screenshot terlihat merah (danger `#f07a74`) bukan amber warning `#e8b45a`. **Cek**: error type-mismatch memang harusnya pakai warna danger (merah) sesuai token error di design.md (`danger #f07a74 — error, stop, drop`), jadi ini SESUAI — bukan bug, karena severity-nya error bukan warning.
- Breadcrumb, file tree, tab aktif — layout dasar konsisten gaya JetBrains.
- Isi Problems panel: 2 baris nyata dengan lokasi `lib/main.dart:4:7` dan `lib/main.dart:1:8` — **tidak ada data palsu/hardcode**, ini diagnostics asli dari Dart LSP.

**Beda dari design — minor:**
- Badge count di tab "Problems" di real screenshot berupa **pill merah solid berisi "2"**. Design `Main.html` baris 185 speknya: `<button>Problems <span style="color: #e8b45a">2</span></button>` — teks angka warna amber (`#e8b45a`), TANPA background pill, tanpa border-radius badge.
  → **Severity: minor.** Fix: hapus background pill merah, ganti jadi teks angka biasa warna sesuai severity tertinggi yang ada (kalau ada error → bisa pakai danger `#f07a74` teks polos, bukan warning kalau isinya campur error+warning — tapi tetap flat text, bukan pill filled).
- Screenshot ini **tidak menampilkan popup lint mengambang** (icon+pesan+tombol Remove variable/Suppress/Ask agent seperti `Main.html` baris 160-176). Ini mungkin memang di luar scope screenshot (fokusnya ke underline+Problems panel), tapi popup quick-fix-nya sendiri ada di `alt-enter-after.png` yang tidak bisa saya baca ulang — **lihat catatan metodologi di atas**.

## 2. Hover tooltip — `hover.png`

**Diverifikasi nyata (screenshot).**

- Tooltip muncul saat hover simbol `Text`: header bold "class Text extends StatelessWidget", deskripsi 2 baris, blok signature kode `const Text(String data, {Key? key, TextStyle? style, TextAlign? textAlign})`.
- Card gelap, rounded corner, shadow — gaya konsisten dengan popup lint di desain (card `#22242a`/border `#34363d` di Main.html baris 161). Warna card di screenshot terlihat sangat dekat dengan token itu.
- **Tidak ada mockup hover eksplisit** di design.md/Main.html/Suggest.html (hover bukan salah satu dari 7 layar yang dispek), jadi tidak ada baseline 1:1 buat dibandingkan persis — style-nya masuk akal & konsisten sama family popup lint.
- **Verdict: SESUAI** (tidak ada blocker; tidak ada baseline detail buat dicek presisi warna/spacing, tapi tidak menyimpang dari bahasa desain).

## 3. Go to definition — `goto-def.png`

**Diverifikasi nyata (screenshot).**

- Breadcrumb pindah ke `lib > main.dart > class Widget`, baris 21 (`abstract class Widget`) di-highlight full-width dengan warna biru gelap — konsisten dengan token `selection-bg #1f2a3d/#243552` di design.md.
- Tidak ada UI navigasi tambahan (popup/picker) — wajar untuk single-target jump.
- **Verdict: SESUAI.**

## 4. Completion popup — `completion.png`

**Diverifikasi nyata (screenshot, sesi fresh — re-render berhasil).**

Per desain (`Suggest.html` baris 33-36): header bar "LSP COMPLETION" + nama file+language-server di atas list, tiap row completion punya leading icon badge (huruf `m`/`f` di kotak rounded kecil, warna beda per kind — method biru `#2b2f45`/`#56a8f5`, field ungu `#2e2440`/`#c77dbb`), nama item, tipe/signature rata kanan abu-abu, footer shortcut "⏎ insert · ⇥ replace · ⌃Space docs".

Yang match:
- 4 row completion untuk simbol `Text(...)`: `Text — Widget`, `TextAlign — enum`, `TextStyle — class`, `textScaleFactor — double`. Icon badge huruf kecil di kotak rounded (`c` untuk class/type, `f` untuk field) — bahasa visual sama dengan spek (badge huruf di kotak).
- Nama item kiri, tipe/signature rata kanan abu-abu — **persis** sesuai spek.
- Footer shortcut baris bawah ada dan isinya cocok makna: "⏎ insert · ⇥ replace · ⌃Space docs" (glyph render sedikit beda tapi teksnya sepadan — bukan masalah desain, kemungkinan font fallback).
- Row pertama (`Text`) di-highlight biru sebagai item aktif — konsisten pola selection state popup lain di app.

**Beda dari design — nyata:**
- **Header bar "LSP COMPLETION" + nama file/language-server hilang total.** Popup di screenshot langsung mulai dari row completion, tidak ada strip header 30px di atasnya seperti `Suggest.html` baris 33 (`<span class="h">LSP COMPLETION</span><span>transfer_cubit.dart · dart language-server</span>`). Ini bukan beda warna/spacing kecil — elemennya tidak ada.
  → **Severity: minor-medium.** Fix: tambah header strip di atas popup completion (reuse token spacing/border yang sama dengan popup lint `Main.html` baris 161, tinggi ±30px, teks label kiri + info file kanan, border-bottom).
- Warna icon badge berbeda dari spek: di screenshot `c` (class/type) pakai warna biru, `f` (field) pakai warna amber/emas — spek aslinya method=biru, field=ungu. Karena kind yang muncul di screenshot ini (`class`, `field`) beda dari contoh di spek (`method`, `field`), tidak apple-to-apple 100%, tapi field warnanya jelas beda (amber vs ungu di spek).
  → **Severity: minor.** Fix: field pakai token ungu `#2e2440`/`#c77dbb` sesuai spek, bukan amber (amber sebaiknya dicadangkan buat kind lain kalau ada, biar tidak bentrok makna dengan warning/lint amber di tempat lain).

**Verdict: PERLU REVISI (minor)** — struktur & footer sudah sesuai, tapi header popup hilang dan warna badge field salah token.

## 5. Quick fix / Alt-Enter — `alt-enter-before.png` & `alt-enter-after.png`

**Diverifikasi nyata (screenshot, sesi fresh — re-render berhasil).**

Per desain (`Main.html` popup lint baris 160-176): card popup icon warning (segitiga outline amber `#e8b45a`), pesan diagnostic + nama variabel monospace, sub-teks sumber lint (format "Bahasa · KODE_LINT · tool"), baris tombol: tombol quick-fix primer (biru terang, teks putih/terang), "Suppress" (teks netral), "Ask agent" (ikon bintang + teks warna amber `#e8b45a`, didorong ke kanan via margin-left:auto).

**alt-enter-before.png** — popup lint aktual:
- Icon warning segitiga, pesan "The import 'dart:math' is unused", sub-teks "Dart · unused_import · dart language-server" — format sub-teks **persis** pola spek ("Bahasa · KODE · sumber").
- Tombol: "Remove unused import" (biru terang, mirip token "Remove variable" di spek — **SESUAI**), "Ignore line" (netral, padanan "Suppress" — **SESUAI**), lalu ikon+"Ask agent" di paling kanan — posisi kanan **SESUAI** (margin-left:auto), tapi:
  → **Beda nyata**: teks & icon "Ask agent" berwarna **abu-abu redup** (terlihat seperti state disabled), bukan amber `#e8b45a` seperti spek. Icon-nya juga outline bintang/diamond pucat, bukan bintang solid amber.
  → **Severity: minor.** Fix: ganti warna teks+icon "Ask agent" ke amber token `#e8b45a` supaya konsisten sebagai CTA aktif (kalau memang state-nya disabled by design, perlu ada penjelasan/tooltip kenapa — kalau tidak, ini kemungkinan bug styling bukan keputusan desain).

**alt-enter-after.png** — popup yang muncul:
- Ini **BUKAN** state "sesudah klik salah satu tombol di popup lint yang sama". Ini popup lain sama sekali: "QUICK FIXES & REFACTORINGS" menu untuk `Text("Hello")` — list "Wrap with widget…", "Wrap with Padding", "Wrap with Center", "Wrap with Column" (semua badge "Flutter"), "Extract Method" (badge "Refactor"), footer "↵ apply · ↑↓ navigate · Esc close".
- Popup ini **tidak ada speknya sama sekali** di `Main.html`/`Suggest.html`/design.md — bukan pelanggaran, tapi juga tidak bisa dinilai 1:1 terhadap baseline manapun. Secara bahasa visual (card gelap `#22242a`-ish, border, radius, footer shortcut abu-abu kecil) konsisten dengan popup lint & completion lainnya, jadi tidak ada blocker konsistensi.
- **Catatan penting buat manager**: nama file `alt-enter-before.png`/`alt-enter-after.png` menyiratkan ini before/after dari SATU interaksi (misal: tekan Alt+Enter di baris import → popup lint tampil → klik salah satu aksi → hasilnya). Tapi isi dua gambar ini menunjukkan **dua target kode yang beda** (import `dart:math` di satu sisi, `Text("Hello")` di sisi lain) dan **dua jenis popup yang beda** (lint popup vs quick-fix/refactor menu). Kemungkinan capture-nya salah pairing atau memang dua demo terpisah yang namanya kebetulan mirip. Perlu dikonfirmasi ke yang capture screenshot — kalau maksudnya memang dua demo berbeda, sebaiknya di-rename biar tidak menyesatkan reviewer berikutnya.

**Verdict: PERLU REVISI (minor)** untuk `alt-enter-before.png` (warna tombol "Ask agent" salah token). `alt-enter-after.png` tidak punya baseline pembanding jadi tidak divonis SESUAI/PERLU REVISI — cuma dicatat sebagai gap dokumentasi (naming/pairing).

---

## Ringkasan verdict (update — semua 6 screenshot sudah tervalidasi piksel nyata)

| Komponen | Status | Severity |
|---|---|---|
| Diagnostics underline + Problems panel | SESUAI (minor gap di badge) | Minor |
| Problems tab badge (pill merah vs teks amber) | BEDA | Minor |
| Hover tooltip | SESUAI | - |
| Go to definition | SESUAI | - |
| Completion popup | PERLU REVISI (header hilang, warna badge field salah) | Minor-Medium |
| Quick fix / Alt-Enter — before (lint popup) | PERLU REVISI (warna "Ask agent" salah token) | Minor |
| Quick fix / Alt-Enter — after (quick-fix menu) | TIDAK ADA BASELINE — dicatat sbg gap naming/pairing, bukan blocker visual | - |

**Tidak ada blocker rilis.** Semua temuan severity minor–minor/medium, tidak menghalangi ship; cukup untuk backlog kecil kalau mau presisi 1:1 dengan desain:
1. Tambah header strip "LSP COMPLETION" + file/language-server di popup completion.
2. Field completion icon pakai token ungu, bukan amber.
3. Tombol "Ask agent" di popup lint pakai warna amber `#e8b45a`, bukan abu-abu redup.
4. Klarifikasi ke tim capture: apakah `alt-enter-before/after.png` memang pasangan before/after yang sama, karena isinya menunjukkan dua target berbeda.

Dengan ini, seluruh 6/6 screenshot fase 2 LSP sudah direview dengan bukti piksel nyata — tidak ada lagi gap "tidak terverifikasi".
