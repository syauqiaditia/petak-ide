# Petak UI/UX Redesign & Visual Exploration

## 1. Konteks & Keluhan UQi
UQi merasa bingung dan kurang menyukai tampilan antarmuka Petak IDE saat ini:
- Terlalu padat (cluttered), kaku, border berat, dan visual hierarchy kurang terarah.
- Panel AI Agents di sisi kanan terasa asing dan membingungkan (banyak tombol status/izin/tag tanpa alur penggunaan yang intuitif).
- Tampilan GitLab MR viewer dan panel editor bercampur tanpa ruang "bernapas" (spacing/typography kurang refined).

## 2. Tugas untuk Manager & Designer
Manager menugaskan `designer` untuk melakukan audit visual mendalam dan menyusun konsep desain baru yang fresh dan modern:
1. **Audit Desain Sekarang**:
   - Identifikasi titik-titik yang membuat bingung dan lelah di mata (density, warna border, ikon, hierarchy).
2. **Kompilasi Referensi IDE Developer Modern**:
   - **Cursor & Windsurf**: Bagaimana AI chat, context pills, dan diff action disajikan secara seamless dan menyatu dengan editor tanpa terasa seperti form kaku.
   - **Zed**: Filosofi minimalis, typography-first, borderless / low-contrast divider, zero clutter.
   - **JetBrains Fleet**: Toolbar melayang (floating), navigasi terfokus, status bar yang sangat clean.
   - **Linear Web/Desktop**: Dark theme tokens berkelas, micro-interactions, badge monospaced yang halus, rounded geometry yang ergonomis.
3. **Deliverables dari Designer**:
   - Dokumen analisis referensi dan arah visual baru di `docs/redesign/references-and-audit.md`.
   - Mockup visual interaktif / HTML preview di `docs/redesign/mockup-v2.html` (menampilkan 2 varian layout: Varian A ala Cursor/Minimalis & Varian B ala Zed/Fleet).
   - Rekomendasi konkret perombakan UI Petak untuk diajukan ke UQi.

## 3. Batasan
- Fokus pada eksplorasi desain, visual mockup HTML/PNG, dan layout spec.
- Jangan merombak kode aplikasi sebelum UQi menyetujui arah desain yang dipilih.
