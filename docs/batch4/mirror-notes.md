# Catatan Teknis Mirror iPhone Fisik & Screen Recording (Batch 4)

Dokumentasi investigasi dan persyaratan teknis untuk Screen Recording permission dan mirror iPhone fisik di Petak.

---

## 1. Masalah Screen Recording Permission pada iOS Simulator (Bug 8)

### Root Cause
1. **Perbedaan Jalur Simulator vs iPhone Fisik**:
   - iOS Simulator di-mirror via **ScreenCaptureKit** (atau fallback polling tangkapan layar `simctl io screenshot`).
   - ScreenCaptureKit dan `CGPreflightScreenCaptureAccess()` memeriksa izin **Screen & System Audio Recording** (TCC category `kTCCServiceScreenCapture`).
2. **Ad-Hoc Code Signing Invalidation**:
   - Pada development build di macOS, setiap kali Petak di-build ulang tanpa sertifikat Apple Developer resmi (ad-hoc signed), signature/hash executable berubah.
   - macOS TCC menganggap binary yang baru di-build sebagai aplikasi berbeda, meskipun namanya sama di System Settings. Izin lama menjadi tidak berlaku.
3. **App Restart Requirement**:
   - Setelah pengguna mengaktifkan toggle di macOS *System Settings > Privacy & Security > Screen Recording*, macOS memerlukan **restart aplikasi** (Quit & Re-open) agar permission token baru dimuat ke dalam runtime proses.

### Solusi di Petak Core
- `mirror_permission_status`: Memanggil `CGPreflightScreenCaptureAccess()` di macOS.
- Deteksi `restartNeeded`: Jika preflight bernilai `false`, tetapi user telah membuka settings / mengklaim izin aktif (disimpan di flag `<data_dir>/Petak/mirror_permission_claimed.flag`), status mengembalikan `restartNeeded: true` sehingga UI menampilkan: *"Izin sudah diaktifkan? Silakan restart Petak agar macOS menerapkan izin baru."*
- `open_screen_recording_settings`: Membuka langsung pane `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`.

---

## 2. Persyaratan & Arsitektur Mirror iPhone Fisik (View-Only)

Tidak ada API resmi Apple untuk screen mirror real-time iPhone fisik via USB tanpa perantara. Di Petak, iPhone fisik ditangani melalui pipeline tangkapan video USB:

### Persyaratan Mutlak iPhone Fisik:
1. **Koneksi Kabel USB**:
   - iPhone fisik harus terhubung langsung via kabel data USB (Lighting atau USB-C) ke Mac. Wireless/WiFi sync tidak stabil untuk streaming video raw.
2. **Device Unlocked**:
   - Layar iPhone harus dalam keadaan aktif (tidak terkunci / passcode sudah dimasukkan).
3. **Trust This Computer (Pairing Trust)**:
   - Pengguna wajib menekan *"Trust"* / *"Percayai Komputer Ini"* pada prompt pop-up di iPhone dan memasukkan passcode.
4. **CoreMediaIO DAL Plugin / AVFoundation (QuickTime Screen Capture)**:
   - macOS memiliki capture device internal `AVCaptureDevice` dengan model ID `"iOS Screen Capture"` melalui CoreMediaIO DAL.
   - Perangkat ini muncul hanya saat iPhone terhubung via USB dan dipercayai (sebagaimana fitur Movie Recording di QuickTime Player).
   - Mode operasi ini adalah **view-only** (tidak mendukung injeksi touch/keyboard tanpa daemon tambahan seperti WebDriverAgent/idb).

### Status Implementasi:
- **Simulator**: Didukung penuh via ScreenCaptureKit window capture + fallback `xcrun simctl io <udid> screenshot`. Input didukung via CGEvent / idb jika diizinkan di Accessibility.
- **iPhone Fisik**: Didukung sebagai **view-only** melalui tangkapan screenshot/video frame USB devicectl & AVFoundation capture device. Jika perangkat tidak terdeteksi via USB atau belum 'Trust', Petak menampilkan petunjuk jelas ke pengguna.
