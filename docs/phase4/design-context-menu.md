# Petak — UI/UX Design Specification: Context Menu System
**Target:** File Tree, Editor Tabs, Git Integration, Local History & Compare Dialogs  
**Status:** Ready for Implementation  
**Author:** @designer (UI/UX Designer)  
**Date:** 29 September 2026  
**Parent Task / Ref:** `t_2db7b761`, `t_65bc37a4`  
**Design Tokens Reference:** `/home/uqi/vault/Projects/Petak/design.md`, `design/Git.html`, `design/Rebase.html`, `design/Diff.html`

---

## 1. Executive Summary & Problem Analysis

### 1.1 Problem Statement (Bug Analysis)
Pada antarmuka Petak saat ini (dapat dilihat pada tangkapan layar `/home/uqi/.hermes/cache/images/img_37b4cc38b10b.png`), ketika pengguna melakukan klik kanan (*right click*) pada node file tree di sidebar:
1. **WebView Default Fallback:** Karena elemen tree belum mengimplementasikan *event listener* `oncontextmenu` dengan `e.preventDefault()`, aplikasi menampilkan context menu bawaan runtime WebView/WebKit sistem yang hanya berisi satu item: **"Reload"**.
2. **Posisi Menutupi Konten:** Popup menu "Reload" muncul tepat di atas label direktori, menutupi teks node yang sedang diklik.
3. **Ketiadaan Fitur Manajemen Berkas:** Pengguna tidak dapat membuat file/folder baru, melakukan rename, delete, copy path, maupun mengakses integrasi Git dan Local History.

### 1.2 Design Goals
Menyediakan spesifikasi desain lengkap berstandar **Android Studio / JetBrains New UI** untuk Petak:
- **File & Folder Context Menu:** Hierarki menu lengkap untuk single-item dan multi-selection, shortcut keyboard macOS resmi JetBrains, sub-menu cascading, dan proteksi aksi berbahaya.
- **Empty Area Context Menu:** Menu konteks saat klik kanan di area kosong file tree.
- **Editor Tab Context Menu:** Menu konteks untuk tab editor (Close, Close Others, Split, Git, Local History).
- **Aturan Posisi Cerdas (Menu Positioning Engine):** Menghindari overlap dengan baris yang diklik, deteksi boundary viewport (flip horizontal & vertikal), dan handling multi-level submenu.
- **Interaksi Inline & Dialog Konfirmasi:**
  - *Inline Rename* dengan seleksi pintar (nama tanpa ekstensi).
  - *New File/Folder Dialog* dengan dukungan auto-create parent directories (mis. `a/b/c.dart`) dan scaffolding template (Dart, Kotlin, Swift).
  - *Delete Confirmation Modal* terintegrasi macOS Trash (bukan *hard delete*).
  - *Rollback Confirmation Modal* dengan snapshot otomatis Local History.
- **Dialog Khusus:**
  - *Compare with Branch / Revision Picker* dengan *instant fuzzy filter*.
  - *Local History Dialog* (layout 2-kolom: riwayat versi + embedded DiffView + recovery file terhapus).
  - *Editor Blame Gutter (Annotate)* di editor kode.
- **Token Compliance:** 100% menggunakan token `design.md`, tanpa warna hex acak baru. Seluruh teks UI menggunakan bahasa Inggris.

---

## 2. Token Desain & Fondasi Visual

Seluruh komponen menu konteks dan dialog mengacu pada token resmi Petak (`design.md`):

| Token | Nilai Hex | Peran & Penggunaan |
|---|---|---|
| `bg-titlebar` | `#111215` | Window controls, status bar, rail |
| `bg-panel` | `#141518` | File tree background, modal input field background |
| `bg-app` | `#16171a` | Main background |
| `bg-editor` | `#1a1b1f` | Modal surface, editor background, cards |
| `bg-menu` | `#22242a` | Context menu popup, dropdown popover (`design/Git.html:106`) |
| `bg-raised` | `#23252b` | Hover state tombol standar, inactive pill |
| `bg-menu-hover` | `#2a3a55` | Context menu item hover / active selection (`Git.html:108`) |
| `bg-danger-hover` | `#3a2022` | Hover state untuk aksi destruktif / danger item |
| `border-subtle` | `#26282d` | Garis pemisah panel |
| `border-normal` | `#2c2e34` | Border input, tab border |
| `border-menu` | `#34363d` | Border context menu, border modal dialog |
| `border-focus` | `#3a4f75` | Border input / item saat aktif atau fokus |
| `text-primary` | `#d8d9dc` | Teks judul, label menu utama |
| `text-active` | `#e6efff` | Teks label menu saat hover (`Git.html:108`) |
| `text-muted` | `#8b8f98` | Shortcut keyboard, label kategori, counter |
| `text-dim` | `#5b5f68` | Placeholder, line number, disabled indicator |
| `accent` | `#6ea8ff` | Fokus kursor, tombol aksi primer, tab aktif |
| `accent-light` | `#9cc3ff` | Shortcut hover color, git modified text |
| `success` | `#7fc98f` | Git added color, status OK, dot live |
| `warning` | `#e8b45a` | Agent action, modified conflict, warning badge |
| `danger` | `#f07a74` | Teks tombol danger, status error, git deleted |
| `danger-light` | `#f0a6a2` | Teks item Drop / Delete pada context menu |

### Dimensi & Radius
- **Context Menu Width:** Single selection `240px` (min `220px`, max `280px`). Submenu width: `220px`.
- **Menu Item Height:** `26px` (baris menu), vertical padding: `6px` top/bottom container menu.
- **Menu Border Radius:** `10px`, `box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55)`.
- **Item Padding:** Horizontal `10px`, vertical `0` (flex center).
- **Separator:** Height `1px`, background `#34363d`, margin `4px 6px`.
- **Z-Index System:**
  - Standard panels: `1..10`
  - Floating gutter / overlays: `50`
  - Context Menu & Submenus: `1000`
  - Modal Backdrops & Dialogs: `1100`
  - Tooltips / Error Popovers: `1200`

---

## 3. Struktur Menu Konteks

### 3.1 Menu Klik Kanan File & Folder (Single Selection)

Struktur menu saat satu file atau folder diklik kanan di File Tree:

```
┌────────────────────────────────────────────────────────┐
│ New                                                  ▸ │ ⌘N
├────────────────────────────────────────────────────────┤
│ Cut                                                    │ ⌘X
│ Copy                                                   │ ⌘C
│ Paste                                                  │ ⌘V
│ Duplicate                                              │ ⌘D
│ Rename…                                                │ ⇧F6
│ Delete…                                                │ ⌘⌫
├────────────────────────────────────────────────────────┤
│ Copy Path/Reference                                  ▸ │
│ Open in                                              ▸ │
├────────────────────────────────────────────────────────┤
│ Find in Folder…                                        │ ⇧⌘F
│ Replace in Folder…                                     │ ⇧⌘R
├────────────────────────────────────────────────────────┤
│ Compare With…                                          │
│ Compare with Clipboard                                 │
├────────────────────────────────────────────────────────┤
│ Reload from Disk                                       │
│ Select Opened File                                     │
├────────────────────────────────────────────────────────┤
│ Git                                                  ▸ │
│ Local History                                        ▸ │
└────────────────────────────────────────────────────────┘
```

#### Tabel Rincian Item Single Selection:
| Item Label | Shortcut (macOS) | Icon (14×14) | Target | Perilaku & Kondisi |
|---|---|---|---|---|
| **New ▸** | `⌘N` | File/Folder plus | File & Folder | Membuka Submenu New (lihat 3.1.1). |
| **Cut** | `⌘X` | Scissor | File & Folder | Menyalin path ke clipboard internal Petak dengan mode 'move'. |
| **Copy** | `⌘C` | Copy dual rect | File & Folder | Menyalin file/folder ke clipboard sistem & internal. |
| **Paste** | `⌘V` | Clipboard | Folder only | **Disabled** jika target file; **Enabled** jika target folder & clipboard memuat file/folder. |
| **Duplicate** | `⌘D` | Duplicate rects | File only | Membuat salinan dengan suffix ` copy` atau `_copy`. |
| **Rename…** | `⇧F6` | Edit pencil | File & Folder | Mengaktifkan **Inline Rename** di baris tree. |
| **Delete…** | `⌘⌫` | Trash | File & Folder | Membuka dialog konfirmasi **Move to Trash** (danger color). |
| *(Separator)* | — | — | — | — |
| **Copy Path/Reference ▸** | — | Link / text | File & Folder | Membuka Submenu Copy Path (lihat 3.1.2). |
| **Open in ▸** | — | External arrow | File & Folder | Membuka Submenu Open in (lihat 3.1.3). |
| *(Separator)* | — | — | — | — |
| **Find in Folder…** | `⇧⌘F` | Search | Folder only | Membuka Find in Project dengan scope folder tersebut. **Disabled** pada file. |
| **Replace in Folder…** | `⇧⌘R` | Search-replace | Folder only | Membuka Replace in Project dengan scope folder tersebut. **Disabled** pada file. |
| *(Separator)* | — | — | — | — |
| **Compare With…** | — | Diff dual pane | File only | Membuka modal picker untuk memilih file pembanding (lihat 6.1). |
| **Compare with Clipboard** | — | Diff clipboard | File only | Membuka DiffView: isi file vs isi clipboard saat ini. |
| *(Separator)* | — | — | — | — |
| **Reload from Disk** | — | Refresh | File & Folder | Memaksa re-read direktori/file dari disk & sinkronisasi watcher. |
| **Select Opened File** | `⌥F1, 1` | Target / locate | File only | Scroll tree dan sorot node file yang sedang aktif di tab editor. |
| *(Separator)* | — | — | — | — |
| **Git ▸** | — | Git branch | File & Folder | **Hidden** jika project bukan git repository. Membuka Submenu Git (lihat 3.1.4). |
| **Local History ▸** | — | History clock | File & Folder | Membuka Submenu Local History (lihat 3.1.5). |

---

### 3.1.1 Submenu "New"
Lebar: `200px`. Dibuka dengan hover atau menekan tombol `ArrowRight` pada item "New".

| Item | Shortcut | Keterangan Template / Aksi |
|---|---|---|
| **File** | `⌘N` | Membuka dialog New File umum. |
| **Folder** | — | Membuka dialog New Folder. |
| *(Separator)* | — | — |
| **Dart File** | — | Scaffold file `.dart` baru (clean header). |
| **Kotlin Class** | — | Scaffold file `.kt` dengan `package <dir>` dan deklarasi class. |
| **Swift File** | — | Scaffold file `.swift` dengan `import Foundation`. |

*Catatan:* Jika pengguna memilih salah satu template spesifik, ekstensi otomatis diisi pada dialog pembuatan.

---

### 3.1.2 Submenu "Copy Path / Reference"
Lebar: `260px`.

| Item | Shortcut | Hasil yang Disalin ke Clipboard |
|---|---|---|
| **Absolute Path** | `⌥⇧⌘C` | `/Users/uqi/Projects/petak/lib/main.dart` |
| **Path from Content Root** | — | `lib/main.dart` (path relatif dari root project) |
| **File Name** | — | `main.dart` |
| **File Name without Extension** | — | `main` |
| **Path with Line Number** | — | `lib/main.dart:42` (tersedia jika file aktif di editor dan kursor di baris 42; jika dari tree: line diabaikan) |
| **Copy as 'package:' Import** | — | `import 'package:petak/main.dart';` (hanya aktif untuk file Dart dalam folder `lib/`) |

---

### 3.1.3 Submenu "Open in"
Lebar: `200px`.

| Item | Shortcut | Aksi |
|---|---|---|
| **Reveal in Finder** | `⌥F1, 8` | Membuka jendela Finder macOS dan menyorot file/folder tersebut. |
| **Open in Terminal** | — | Membuka tab Terminal di panel bawah Petak dengan `cwd` folder tersebut (atau parent folder jika file). |
| **Open with Default App** | — | Membuka file dengan aplikasi asosiasi default macOS (mis. Preview untuk PNG/PDF). |

---

### 3.1.4 Submenu "Git"
Lebar: `260px`. Hanya ditampilkan jika project berada di dalam git repository.

| Item | Shortcut | Kondisi & Aksi |
|---|---|---|
| **Show Diff** | `⌘D` | Membuka DiffView file tersebut terhadap `HEAD` / Staged. |
| **Compare with Branch…** | — | Membuka picker branch untuk membandingkan file/folder vs branch lain. |
| **Compare with Revision…** | — | Membuka picker commit untuk membandingkan file/folder vs commit hash. |
| **Show History** | — | Membuka tab Git Log terfilter: `git log --follow` untuk file, atau path log untuk folder. |
| **Annotate / Blame** | — | Menampilkan/menyembunyikan baris Gutter Blame di editor (hanya aktif untuk file). |
| *(Separator)* | — | — |
| **Add to VCS** | `⌥⌘A` | Menjalankan `git add <path>` (menjadikan staged). |
| **Commit File…** | `⌘K` | Membuka Commit panel dengan file tersebut tercentang. |
| **Rollback Changes…** | — | Membuka dialog konfirmasi Rollback (menghapus uncommitted edit, diawali snapshot Local History). Teks warna danger `#f0a6a2`. |
| *(Separator)* | — | — |
| **Add to .gitignore** | — | Menambahkan baris path relatif file/folder ke `.gitignore` project. |

---

### 3.1.5 Submenu "Local History"
Lebar: `200px`.

| Item | Shortcut | Aksi |
|---|---|---|
| **Show History** | — | Membuka dialog **Local History** lengkap (lihat Bagian 6.2). |
| **Put Label…** | — | Menampilkan popover input untuk menyematkan label custom pada snapshot saat ini. |

---

### 3.2 Menu Klik Kanan Multi-Selection
Ketika pengguna memilih lebih dari satu file/folder (menggunakan `⌘ + Click` atau `⇧ + Click`), context menu mengadaptasi opsinya:

```
┌────────────────────────────────────────────────────────┐
│ 3 items selected                                       │
├────────────────────────────────────────────────────────┤
│ Cut                                                    │ ⌘X
│ Copy                                                   │ ⌘C
│ Delete…                                                │ ⌘⌫
├────────────────────────────────────────────────────────┤
│ Copy Paths                                           ▸ │
│ Open in Terminal                                       │
├────────────────────────────────────────────────────────┤
│ Find in Selected Files…                                │ ⇧⌘F
├────────────────────────────────────────────────────────┤
│ Compare 2 Files… (jika tepat 2 file)                   │
├────────────────────────────────────────────────────────┤
│ Git                                                  ▸ │
└────────────────────────────────────────────────────────┘
```

#### Aturan Khusus Multi-Selection:
1. **Header Info:** Menampilkan baris judul non-klik bertuliskan `{N} items selected` dengan warna `#8b8f98`, font size `11px` (mengikuti pola `design/Git.html:107`).
2. **Rename Disabled:** Item Rename berada dalam kondisi `disabled` (opacity `0.35`, cursor `not-allowed`) disertai tooltip: *"Cannot rename multiple items at once"*.
3. **Compare Behavior:**
   - Jika terpilih **tepat 2 file**: Item menjadi **"Compare 2 Files…"** (`enabled`), klik langsung membuka DiffView antara file A dan file B.
   - Jika terpilih **> 2 item**: Item Compare disembunyikan (*hidden*).
4. **Delete Support:** Menjalankan modal konfirmasi multi-delete: *"Move 3 items to Trash?"*.
5. **Git Submenu on Multi-Select:** Memuat aksi batch: `Add to VCS`, `Rollback Changes…`, `Commit {N} Files…`. Aksi single-file seperti `Annotate` dinonaktifkan.

---

### 3.3 Menu Klik Kanan Area Kosong File Tree (Empty Area)
Ketika klik kanan dilakukan pada background kosong di bawah daftar file/folder:

```
┌────────────────────────────────────────────────────────┐
│ New File…                                              │ ⌘N
│ New Folder…                                            │
├────────────────────────────────────────────────────────┤
│ Paste                                                  │ ⌘V
├────────────────────────────────────────────────────────┤
│ Open in Terminal                                       │
│ Find in Files…                                         │ ⇧⌘F
├────────────────────────────────────────────────────────┤
│ Reload from Disk                                       │
└────────────────────────────────────────────────────────┘
```
- **Lokasi Pembuatan:** Seluruh file/folder yang dibuat melalui menu area kosong akan langsung ditempatkan di **root direktori project**.
- **Paste:** Melakukan paste file dari clipboard langsung ke root project.

---

### 3.4 Menu Klik Kanan Tab Editor
Ketika klik kanan dilakukan pada tab file di baris tab editor (`.tabs-bar`):

```
┌────────────────────────────────────────────────────────┐
│ Close                                                  │ ⌘W
│ Close Others                                           │
│ Close All                                              │
│ Close to the Right                                     │
├────────────────────────────────────────────────────────┤
│ Copy Path/Reference                                  ▸ │
│ Reveal in Finder                                       │ ⌥F1
│ Select in Project Tree                                 │
├────────────────────────────────────────────────────────┤
│ Git                                                  ▸ │
│ Local History                                        ▸ │
└────────────────────────────────────────────────────────┘
```

#### Aturan Khusus Tab Context Menu:
- **Close to the Right:** `disabled` jika tab tersebut berada di urutan paling kanan.
- **Close Others:** `disabled` jika hanya ada 1 tab yang terbuka.
- **Select in Project Tree:** Melakukan sinkronisasi scroll pada sidebar File Tree, membuka parent folder yang relevan, dan memberikan highlight seleksi pada node file tersebut.

---

## 4. Aturan Posisi & Interaksi (Menu Positioning Engine)

Untuk mencegah bug pada screenshot (menu menutupi teks folder dan keluar dari layar), implementasi harus mengikuti kalkulasi murni berikut:

### 4.1 Koordinat Jangkar (Cursor Anchor & Offset)
- Menu dibuka pada koordinat kursor mouse `(clientX, clientY)`.
- **Offset Perlindungan:** Berikan offset sebesar `+2px` horizontal dan `+2px` vertikal agar pointer mouse berada tepat di sudut kiri-atas menu tanpa menimpa baris teks direktori yang baru saja diklik.
  ```typescript
  let targetX = mouseX + 2;
  let targetY = mouseY + 2;
  ```

### 4.2 Boundary Detection & Auto-Flipping
Menu tidak boleh terpotong tepi layar (*viewport clipping*):
1. **Horizontal Flipping (X-Axis):**
   - Ukuran menu: `menuWidth` (mis. `240px`).
   - Lebar viewport: `window.innerWidth`.
   - **Aturan:** Jika `targetX + menuWidth > window.innerWidth - 8`:
     - Balik arah menu ke kiri: `finalX = mouseX - menuWidth - 2`.
     - Jika `finalX < 8`, clamp ke `8px`.
2. **Vertical Flipping (Y-Axis):**
   - Tinggi menu: `menuHeight` (dihitung dinamis atau estimasi item).
   - Tinggi viewport: `window.innerHeight`.
   - **Aturan:** Jika `targetY + menuHeight > window.innerHeight - 8`:
     - Balik arah menu ke atas: `finalY = mouseY - menuHeight - 2`.
     - Jika `finalY < 8`, clamp ke `8px`.

### 4.3 Submenu Cascading & Flip
- **Arah Default:** Submenu muncul di sisi kanan menu induk: `subX = parentX + parentWidth - 4px`. Posisi vertikal sejajar dengan item pemicu: `subY = parentItemTop - 4px`.
- **Horizontal Overflow:** Jika `subX + subMenuWidth > window.innerWidth`:
  - Balik ke sisi kiri menu induk: `subX = parentX - subMenuWidth + 4px`.
- **Vertical Overflow:** Jika `subY + subMenuHeight > window.innerHeight`:
  - Geser ke atas sehingga tepi bawah submenu sejajar dengan tepi bawah menu induk, atau balik ke atas.
- **Hover Delay & Triangle Safety:**
  - Buka submenu setelah `120ms` hover pada item.
  - Jangan langsung tutup submenu jika kursor bergerak sedikit diagonal menuju submenu (berikan grace period `180ms`).

### 4.4 Max-Height & Scrolling
- Jika context menu memiliki item sangat banyak dan viewport terbatas:
  - `max-height: calc(100vh - 32px)`.
  - `overflow-y: auto`.
  - Gunakan custom scrollbar tipis (`4px`, thumb `#34363d`, hover `#5b5f68`).

### 4.5 Siklus Hidup Penutupan (Dismissal Lifecycle)
Context menu wajib tertutup secara bersih jika terjadi salah satu dari kondisi berikut:
1. Pengguna klik di luar menu (tangani via backdrop transparan `z-index: 999` atau listener `pointerdown` global).
2. Pengguna menekan tombol `Escape`.
3. Pengguna melakukan scroll pada list tree atau editor (`wheel` / `scroll` event pada container).
4. Jendela aplikasi kehilangan fokus (`window.onblur`) atau di-resize (`window.onresize`).
5. Salah satu aksi menu diklik.

### 4.6 Navigasi Keyboard di Dalam Menu
Mengadopsi standar aksesibilitas desktop:
- `ArrowDown` / `ArrowUp`: Pindah fokus ke item berikutnya / sebelumnya (melewati separator dan item `disabled`, wrap around di akhir daftar).
- `ArrowRight` / `Enter`: Pada item yang memiliki submenu, membuka submenu dan memindahkan fokus ke item pertama submenu.
- `ArrowLeft` / `Escape`: Pada submenu, menutup submenu dan mengembalikan fokus ke item induk di menu sebelumnya.
- `Enter` / `Space`: Menjalankan aksi dari item yang sedang terfokus.
- `First-Letter Mnemonic`: Menekan huruf (mis. 'r') langsung memindahkan fokus ke item berikutnya yang diawali huruf tersebut (mis. "Rename").

---

## 5. Spesifikasi Interaksi Inline & Modal Konfirmasi

### 5.1 Inline Rename di Tree (Shift+F6)

Interaksi penggantian nama berkas/folder dilakukan langsung di tempat (*inline*), bukan melalui popup modal besar, untuk menjaga alur kerja pengguna tetap cepat.

```
[▾] [📁 lib]
    [📄] [TransferCard          ] .dart
          └───────┬────────────┘
                  └─ Seleksi hanya nama stem (tanpa .dart)
```

#### Aturan Interaksi:
1. **Aktivasi:**
   - Tekan `⇧F6` saat node terpilih.
   - Pilih "Rename…" pada context menu.
   - Klik satu kali pada label file yang sudah dalam kondisi terpilih (setelah jeda `500ms`, bukan double-click pembuka file).
2. **Seleksi Karakter Otomatis:**
   - **Untuk File:** Seleksi teks otomatis hanya mencakup **nama tanpa ekstensi** (contoh: pada `receipt_view.dart`, teks yang tersorot biru adalah `receipt_view`; karakter `.dart` tidak tersorot).
   - **Untuk Folder:** Seleksi mencakup seluruh nama folder.
3. **Komponen Input:**
   - Menggantikan label teks dengan elemen `<input type="text" />` berdimensi tinggi `22px`.
   - Font: `Geist` 13px (identik dengan font tree).
   - Style: Background `#141518`, border `1px solid #6ea8ff`, border-radius `4px`, padding `0 4px`, color `#d8d9dc`.
4. **Validasi Real-time & Error Tooltip:**
   - Periksa validitas setiap perubahan karakter:
     - Karakter ilegal (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`).
     - Nama kosong / hanya spasi.
     - Nama sudah ada di direktori yang sama (konflik nama).
   - Jika terjadi error: Border input berubah menjadi `#f07a74` dan popover merah kecil muncul tepat di bawah input:
     - Background `#2c1d1f`, border `1px solid #f07a74`, color `#f0a6a2`, font size `11px`, padding `4px 8px`, border-radius `4px`.
     - Pesan: *"A file with this name already exists"* atau *"File name cannot contain slashes"*.
5. **Konfirmasi & Pembatalan:**
   - Tekan `Enter`: Jika input valid, simpan perubahan nama ke disk melalui backend. Jika ada error, tahan input dan goyangkan sedikit (*shake animation* 150ms).
   - Tekan `Escape`: Batalkan pengeditan dan kembalikan teks asli tanpa perubahan disk.
   - `Blur` (klik di tempat lain): Jika input valid dan berubah, commit rename. Jika tidak valid, batalkan (*revert*).
6. **Integrasi Refactoring Dart (Bonus `willRenameFiles`):**
   - Jika file yang di-rename adalah berkas `.dart`, kirim permintaan ke Dart LSP (`workspace/willRenameFiles`). Jika ada referensi `import` di file lain yang terpengaruh, munculkan snackbar/toast notifikasi: *"Updated 4 imports across project"*.

---

### 5.2 Dialog "New File / Folder / Template" (Cmd+N)

Digunakan saat pengguna memilih "New File…" atau menekan `⌘N`.

```
┌────────────────────────────────────────────────────────┐
│ New File                                           [✕] │
├────────────────────────────────────────────────────────┤
│ Type: [ File ▾ ]                                       │
│                                                        │
│ Enter file path:                                       │
│ ┌────────────────────────────────────────────────────┐ │
│ │ features/auth/login_controller.dart                 │ │
│ └────────────────────────────────────────────────────┘ │
│ ℹ Folders 'features/auth' will be created automatically│
│                                                        │
├────────────────────────────────────────────────────────┤
│                                  [ Cancel ] [ Create ] │
└────────────────────────────────────────────────────────┘
```

#### Spesifikasi Modal:
- **Dimensi:** Lebar `440px`, backdrop blur `rgba(0,0,0,0.65)`.
- **Path Resolution:** Mendukung pembuatan folder bertingkat sekaligus. Jika pengguna mengetik `src/controllers/user_controller.dart`, backend secara otomatis membuat folder `src/controllers/` jika belum tersedia.
- **Pilihan Template (Dropdown / Segmented):**
  - `File` (kosong).
  - `Folder` (membuat direktori).
  - `Dart File` (ekstensi otomatis `.dart`).
  - `Kotlin Class` (ekstensi otomatis `.kt`).
  - `Swift File` (ekstensi otomatis `.swift`).
- **Template Boilerplate Otomatis:**
  - *Kotlin:* Menghasilkan deklarasi package yang sesuai dengan struktur folder:
    ```kotlin
    package com.petak.features.auth

    class LoginController {
        
    }
    ```
  - *Swift:*
    ```swift
    import Foundation

    struct LoginController {
        
    }
    ```
- **Post-Creation Action:**
  - Langsung buka file yang baru dibuat di tab editor aktif.
  - Fokus kursor langsung ditempatkan di dalam editor pada baris pertama.

---

### 5.3 Dialog Konfirmasi "Delete to Trash" (Cmd+Backspace)

Operasi penghapusan file di Petak **tidak boleh melakukan permanent delete langsung**. Semua penghapusan diarahkan ke **macOS Trash** menggunakan crate Rust `trash`.

```
┌────────────────────────────────────────────────────────┐
│ Move 3 Items to Trash?                             [✕] │
├────────────────────────────────────────────────────────┤
│ Are you sure you want to move the following items to   │
│ the macOS Trash?                                       │
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 📄 lib/old_payment.dart                            │ │
│ │ 📄 lib/legacy_model.dart                           │ │
│ │ 📁 lib/temp_cache/                                 │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ Items can be restored from macOS Trash if needed.      │
├────────────────────────────────────────────────────────┤
│                           [ Cancel ] [ Move to Trash ] │
└────────────────────────────────────────────────────────┘
```

#### Spesifikasi Desain:
- **Judul Modal:** *"Move to Trash?"* (single) atau *"Move {N} items to Trash?"* (multi).
- **Pratinjau Berkas:** Kotak berlatar `#141518`, border `#26282d`, padding `8px 12px`, max-height `120px`, overflow-y auto. Menampilkan ikon dan path file. Jika > 4 item, tampilkan 3 item teratas dan teks `... and {N - 3} more items`.
- **Teks Penenang (Reassurance Copy):** *"Items will be moved to macOS Trash and can be restored if needed."* (warna `#8b8f98`, font size `12px`).
- **Tombol Aksi:**
  - `Cancel` (Secondary): border `#2c2e34`, text `#b9bcc3`. Shortcut: `Escape`.
  - `Move to Trash` (Danger Primary): background `#6d2424`, hover `#7f2b2b`, text `#ffe6e6`, font-weight `500`. Shortcut: `Enter`.

---

### 5.4 Dialog Konfirmasi "Rollback Changes"

Peringatan keamanan saat pengguna membatalkan modifikasi file/folder di Git working tree.

```
┌────────────────────────────────────────────────────────┐
│ Rollback Changes?                                  [✕] │
├────────────────────────────────────────────────────────┤
│ ⚠ Discard all uncommitted changes in:                  │
│    lib/features/checkout/CheckoutScreen.kt             │
│                                                        │
│ This operation will revert the file to HEAD.           │
│                                                        │
│ ℹ A Local History snapshot will be created             │
│   automatically before rollback so you can undo.       │
├────────────────────────────────────────────────────────┤
│                               [ Cancel ] [ Rollback ]  │
└────────────────────────────────────────────────────────┘
```

#### Spesifikasi Desain:
- **Teks Proteksi Safety:** *"A Local History snapshot will be created automatically before rollback so you can undo if necessary."*
- **Aksi Internal Backend:** Sebelum `git checkout -- <path>` dijalankan, Petak wajib memicu snapshot Local History dari konten file saat ini dengan label `"Before Rollback"`.
- **Tombol Aksi:** Tombol primer `Rollback` berwarna danger (`#6d2424` / `#ffe6e6`).

---

## 6. Spesifikasi Dialog & Fitur Khusus

### 6.1 Picker "Compare with Branch / Revision"

Memungkinkan pengguna membandingkan satu berkas spesifik terhadap branch atau commit git lain tanpa harus berpindah branch.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Compare 'transfer_cubit.dart' with…                                [✕] │
├────────────────────────────────────────────────────────────────────────┤
│ [ 🔍 Type branch name or commit hash…                                ] │
├────────────────────────────────────────────────────────────────────────┤
│ TABS: [ Branches (12) ]  [ Revisions / Commits (45) ]                  │
├────────────────────────────────────────────────────────────────────────┤
│  BRANCHES LIST:                                                        │
│   main                   origin/main · 2 hours ago by Dimas           │
│   feature/checkout       HEAD · 4 min ago by Claude Code              │
│   feature/auth           Yesterday by Rina                            │
│   release/v2.14          Sep 20 by Dimas                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                   [ Cancel ] [ Compare ]│
└────────────────────────────────────────────────────────────────────────┘
```

#### Spesifikasi:
- **Dimensi Modal:** Lebar `560px`, tinggi `480px`.
- **Filter Input:** Input pencarian di posisi paling atas dengan auto-focus. Melakukan fuzzy filtering seketika terhadap daftar branch/commit.
- **Tampilan Row:**
  - Branch: Ikon branch Git, nama branch (`text-primary`, font `Geist` 13px), badge tracking (`origin/main`), waktu relatif & author (`text-muted` 12px).
  - Revision: Commit hash (font `JetBrains Mono` 12px, warna `#8b8f98`), subject pesan commit (font `Geist` 13px), author & relative time.
- **Keyboard Navigation:** `ArrowUp` / `ArrowDown` memilih baris; menekan `Enter` langsung mengeksekusi perbandingan.
- **Hasil Aksi:** Membuka tab `DiffView` Petak yang membandingkan versi lokal file vs versi pada branch/commit yang dipilih.

---

### 6.2 Dialog "Local History" (Show History)

Fitur proteksi berkas independen dari Git. Mengambil inspirasi penuh dari Local History Android Studio. Menggunakan tata letak 2 kolom standar (`960px × 620px`, mengikuti dimensi `design/Rebase.html`).

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Local History — transfer_cubit.dart                                                          [✕] │
├────────────────────────────────┬─────────────────────────────────────────────────────────────────┤
│ VERSIONS LIST (320px)          │ DIFF VIEW vs WORKING TREE (Flexible ~640px)                     │
│ [ 🔍 Filter history…         ] │ Side-by-side · Selected version (Left) vs Current Local (Right)  │
│                                │                                                                 │
│ Today                          │ ┌──────────────────────────────┬──────────────────────────────┐ │
│ ◉ 14:32 (Current Working Tree) │ │ 1  class TransferCubit {     │ 1  class TransferCubit {     │ │
│   • 12 lines changed           │ │ 2    // old implementation   │ │ 2    final Repo _repo;     │ │
│                                │ │ 3  }                         │ │ 3  }                       │ │
│ ○ 14:15 External Change        │ └──────────────────────────────┴──────────────────────────────┘ │
│   • Auto-saved before sync     │                                                                 │
│                                │                                                                 │
│ ○ 13:40 User Save              │                                                                 │
│   • 🏷 label: "before refactor" │                                                                 │
│                                │                                                                 │
│ ○ 11:05 Before Rollback        │                                                                 │
│   • System snapshot            │                                                                 │
├────────────────────────────────┴─────────────────────────────────────────────────────────────────┤
│ [🏷 Put Label… ]                         Snapshot: sha-8f2a1c · 14:15     [ Revert ] [ Close ]   │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Komponen & Tata Letak:
1. **Header (Tinggi 52px):** Judul `"Local History — {filename}"`, path relatif file di pojok kanan, tombol Close `[✕]`.
2. **Kolom Kiri — Daftar Riwayat (Lebar 320px, border-right `1px solid #2a2c32`):**
   - Kolom pencarian kecil di bagian atas untuk memfilter riwayat berdasarkan tanggal atau label teks.
   - Pengelompokan tanggal: *Today*, *Yesterday*, *Older*.
   - Item Versi:
     - Waktu relatif / absolut (`14:15`, `10 minutes ago`).
     - Tipe pemicu (*Trigger Badge*):
       - `User Save` (simpan biasa di editor).
       - `External Change` (file dimodifikasi dari luar aplikasi, mis. build script / git / agent CLI).
       - `Before Rollback` (dibuat otomatis sebelum git rollback).
       - `User Label` (label custom buatan pengguna, teks warna `#e8b45a`).
     - Metrik perubahan (`+14 −3`).
3. **Kolom Kanan — Diff Viewer (Flexible):**
   - Menggunakan komponen `DiffView` yang sudah ada di Petak (`design/Diff.html`).
   - Sisi kiri: Isi file pada snapshot versi terpilih.
   - Sisi kanan: Isi file pada kondisi saat ini (*Current Working Tree*).
   - Menampilkan penanda baris modifikasi (warna `#1b2b20` untuk tambah, `#2c1d1f` untuk hapus).
4. **Dukungan History untuk Folder:**
   - Jika dialog dibuka pada sebuah **folder**, kolom kanan menampilkan daftar berkas di dalam folder yang berubah pada snapshot tersebut.
   - Terdapat toggle checkbox: `[x] Show deleted files`.
   - File yang telah dihapus di disk dapat dipilih dan di-restore secara individual.
5. **Footer Toolbar (Tinggi 60px):**
   - Tombol **"Put Label…"**: Membuka dialog input satu baris untuk memberi nama penanda pada versi terpilih.
   - Tombol **"Revert"** (Primary Action, background `#2a3a55`, text `#cfe0ff`, font-weight `500`): Mengembalikan berkas saat ini ke konten snapshot yang dipilih. Menampilkan konfirmasi ringkas sebelum menimpa working tree.

---

### 6.3 Gutter Blame di Editor (Annotate)

Menampilkan anotasi riwayat baris (*git blame*) langsung di samping nomor baris editor kode tanpa mengganggu keterbacaan teks.

```
┌──────┬───────┬──────┬────────────────────────────────────────────────────────┐
│ Gutter Blame │ Line │ Editor Code Area                                       │
├──────┴───────┴──────┼────────────────────────────────────────────────────────┤
│ Dimas · 2d   │  41  │ class TransferRepository {                             │
│ Dimas · 2d   │  42  │   Future<TransferResult> executeTransfer(...) async {  │
│ UQi   · 1h   │  43  │     if (amount > dailyLimit) {                         │
│ UQi   · 1h   │  44  │       throw LimitExceededException();                  │
│ Dimas · 2d   │  45  │     }                                                  │
└──────────────┴──────┴────────────────────────────────────────────────────────┘
```

#### Spesifikasi Desain:
- **Lokasi:** Terletak di sebelah kiri kolom nomor baris (*line numbers gutter*).
- **Lebar Kolom:** `110px`, background `#17181c`, border-right `1px solid #26282d`.
- **Tinggi Baris (Line Pitch):** Persis `22px` per baris (mengikuti `design.md`: tinggi baris kode 22px).
- **Format Teks:** Font `Geist` 11px, warna `#8b8f98`. Format: `{Author_Singkat} · {Waktu_Relatif}` (contoh: `UQi · 1h`, `Dimas · Sep 24`).
- **Grouping Visual:** Baris-baris berurutan yang berasal dari commit hash yang sama diberikan indikator strip border kiri tipis (`2px`) berwarna senada atau selang-seling halus untuk membedakan blok perubahan.
- **Interaksi Hover (Popover Detail):**
  - Hover pada baris blame memunculkan tooltip popover informatif (delay `200ms`):
    - Commit Hash (`#8b8f98`, font `JetBrains Mono` 11px): `a91f3c2`
    - Author: `Dimas Tri <dimas@company.id>`
    - Tanggal & Jam: `27 Sep 2026, 14:22:10`
    - Pesan Commit: *"fix(transfer): validate daily limit before dispatching network request"*
    - Tautan Cepat: `Open Commit in Git Log` | `View Full Diff`
- **Interaksi Klik:**
  - Klik baris blame akan membuka panel Git Log, memilih commit bersangkutan di log graph, dan menampilkan rincian commit di Commit Detail.
- **Penutupan Gutter:**
  - Klik kanan pada area gutter blame memunculkan menu konteks mini:
    - `Copy Revision Number`
    - `Show Commit in Git Log`
    - `Close Annotations` (menutup gutter blame).

---

## 7. Penanganan Seluruh Kondisi UI (UI States & Edge Cases)

### 7.1 State Matrix (4 UI States)

| Komponen | Normal / Idle | Loading State | Empty State | Error State |
|---|---|---|---|---|
| **Context Menu** | Menu terbuka rapi dengan hover aktif `#2a3a55`. | — (render sinkron instan). | — | Item invalid otomatis `disabled` (opacity `0.35`). |
| **New Dialog** | Form input siap ketik, kursor aktif di nama file. | Tombol "Create" spinner halus saat menulis ke disk. | — | Input border `#f07a74`, pesan error inline merah muda di bawah field. |
| **Compare Picker** | List branch & commit muncul lengkap. | Skeleton loader 3 baris saat git membaca refs. | Teks *"No branches or revisions match filter"*. | Banner peringatan *"Failed to load git revisions"*. |
| **Local History** | Kolom versi terisi riwayat, kanan menampilkan DiffView. | Indikator shimmer loading saat mengekstrak blob sha256. | *"No local history recorded for this file yet"*. | *"Corrupted local history index — snapshot skipped"*. |
| **Blame Gutter** | Teks author & tanggal tampil di samping line number. | Baris redup dengan placeholder `...` saat `git blame` jalan. | Kolom kosong jika file belum pernah di-commit (*untracked*). | Label *"Blame unavailable for untracked file"*. |

---

### 7.2 Standar Copywriting & Bahasa
Semua teks UI wajib menggunakan **Bahasa Inggris** yang konsisten dengan terminologi JetBrains:
- File Actions: `New…`, `Cut`, `Copy`, `Paste`, `Duplicate`, `Rename…`, `Delete…`.
- Paths: `Copy Path/Reference`, `Absolute Path`, `Path from Content Root`.
- Confirmation Dialogs:
  - Delete: `Move to Trash`, `Cancel`, `Move {N} items to Trash?`.
  - Rollback: `Rollback Changes`, `Discard uncommitted changes in {path}`.
- Local History: `Local History`, `Show History`, `Put Label…`, `Revert`, `User Save`, `External Change`, `Before Rollback`.
- Git: `Show Diff`, `Compare with Branch…`, `Compare with Revision…`, `Show History`, `Annotate`, `Add to VCS`, `Rollback Changes…`.

---

## 8. Panduan Teknis untuk Implementasi Senior Engineer

Berikut checklist panduan implementasi untuk card-card downstream (`t_05d96eaa`, `t_879cdfb5`, `t_b22a42e5`):

1. **Mencegah Reload Bawaan WebView (Root Cause):**
   - Tambahkan event handler pada container `FileTree.svelte`:
     ```svelte
     <div class="tree-container" oncontextmenu={(e) => handleTreeContextMenu(e)}>
     ```
   - Di setiap node item (file & directory):
     ```svelte
     <button class="item" oncontextmenu={(e) => handleItemContextMenu(e, entry)}>
     ```
   - Pastikan selalu memanggil `e.preventDefault()` dan `e.stopPropagation()`.
2. **Komponen Reusable `ContextMenu.svelte`:**
   - Gunakan komponen context menu modular dengan props:
     - `x`: number, `y`: number
     - `items`: MenuItem[]
     - `onclose`: () => void
   - Manfaatkan kalkulasi posisi dari helper terpisah `menuPos.ts` untuk memastikan fungsi murni dapat diuji secara unit test tanpa DOM browser.
3. **Keamanan Path & Operasi File:**
   - Semua operasi (New, Rename, Delete, Paste) **harus divalidasi** tidak keluar dari root project (tolak path traversal `..` atau symlink liar).
   - Gunakan crate Rust `trash` untuk fungsi delete.
   - Pemicu snapshot Local History dilakukan secara asynchronous tanpa memblokir thread UI maupun thread file watcher.
4. **Dart WillRenameFiles:**
   - Hubungkan ke client LSP jika server LSP aktif, kirimkan notifikasi `workspace/willRenameFiles` sebelum rename disk dilakukan.

---

## 9. Visual Reference Companion

File referensi visual HTML mandiri tersedia pada:  
`docs/phase4/design/ContextMenu.html`  
*(Dapat dibuka langsung di browser untuk melihat proporsi visual, token warna, bayangan popover, serta layout dialog Local History & Compare Picker).*
