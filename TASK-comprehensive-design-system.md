# Petak Comprehensive UI/UX Redesign & Design System V2

## 1. Permintaan UQi
UQi menginginkan desain lengkap dan menyeluruh dari 2 varian (Varian A & Varian B), bukan sekadar mockup parsial:
1. **Dua Tampilan Utama Penuh**:
   - **Standalone Welcome Dashboard**: Halaman awal saat belum ada project dibuka.
   - **Full IDE Workspace**: Tampilan koding lengkap dengan file tree, editor, terminal, AI agents, dan device mirror.
2. **Kelengkapan Menu Bar**:
   - Menu atas standar IDE kelas profesional (File, Edit, View, Navigate, Code, Refactor, Build, Run, Git, Tools, Window, Help) lengkap dengan shortcut keyboard dan dropdown menu realistis.
3. **Redesign Settings (Pengaturan) Menarik & Elegan**:
   - Tampilan modal/window settings lama kurang menarik. Desain ulang ala Linear / Raycast / macOS System Settings: sidebar kategori (General, Editor, Keymap, AI Agents, Toolchains, Accounts, Appearance) dan panel kontrol interaktif (toggle, input, selector, badges).
4. **Perombakan Icon System & Design Patterns**:
   - UQi tidak suka ikon yang sekarang. Eksplorasi sistem ikon baru yang konsisten, tajam, dan developer-grade (gaya Lucide / Phosphor, stroke 1.5px seragam, optik seimbang).
   - Susun Design System dan Design Pattern lengkap: token warna 4-layer depth, tipografi, radius sudut, elevation shadows, state hover/active/focus.

## 2. Tugas untuk Manager & Designer
Manager menugaskan `designer` untuk:
1. Menyusun dokumen spesifikasi Design System & Design Patterns di `docs/redesign/design-system-v2.md`:
   - Token warna (Base, Surface, Workspace, Elevated, Borders, Semantic accents).
   - Skala tipografi (UI & Code) dan spacing scale (4px grid).
   - Sistem ikon SVG baru (katalog ikon esensial).
   - Pola interaksi menu bar, settings, tabs, dan dialog.
2. Membangun prototype interaktif mandiri di `docs/redesign/comprehensive-design-system.html`:
   - Switcher Varian A (Cursor / Linear / Modern) vs Varian B (Zed / Fleet / Zen).
   - Switcher Layar:
     * 🏁 **Standalone Dashboard**
     * 💻 **Full IDE Workspace**
     * ⚙️ **Settings Center**
   - Menu bar atas yang interaktif: klik File / Edit / View dll membuka menu dropdown yang realistis.
   - Ikon-ikon baru terpasang di seluruh antarmuka.
3. Mengambil screenshot visual berkualitas tinggi untuk ketiga layar di kedua varian dan simpan di `docs/redesign/screens/`.
4. Melaporkan perbandingan menyeluruh dan rekomendasi ke UQi.

## 3. Batasan Keras
- Seluruh pekerjaan desain hanya pada dokumentasi dan prototype HTML/CSS/JS (`docs/redesign/`).
- DILARANG menyentuh kode produksi `ui/` atau `crates/` sebelum disetujui UQi.
