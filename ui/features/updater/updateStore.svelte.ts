import { api, type UpdateCheckResult } from '../../lib/api';

class UpdateStore {
  updateAvailable = $state(false);
  currentVersion = $state('0.8.2');
  latestVersion = $state('');
  releaseNotes = $state('');
  releaseUrl = $state('');
  downloadUrl = $state<string | null>(null);

  isChecking = $state(false);
  isUpdating = $state(false);
  updateStatus = $state('');
  errorMessage = $state<string | null>(null);

  async checkUpdate(silent = false) {
    if (this.isChecking || this.isUpdating) return;
    this.isChecking = true;
    this.errorMessage = null;

    try {
      const res: UpdateCheckResult = await api.appCheckUpdate();
      this.updateAvailable = res.updateAvailable;
      this.currentVersion = res.currentVersion;
      this.latestVersion = res.latestVersion;
      this.releaseNotes = res.releaseNotes;
      this.releaseUrl = res.releaseUrl;
      this.downloadUrl = res.downloadUrl ?? null;
    } catch (e: any) {
      if (!silent) {
        this.errorMessage = e?.message || String(e);
      }
      console.warn('Update check failed:', e);
    } finally {
      this.isChecking = false;
    }
  }

  async applyUpdate() {
    if (!this.downloadUrl || this.isUpdating) return;
    this.isUpdating = true;
    this.updateStatus = 'Mengunduh & Memasang…';
    this.errorMessage = null;

    try {
      await api.appApplyUpdate(this.downloadUrl);
      this.updateStatus = 'Membuka ulang aplikasi…';
    } catch (e: any) {
      this.isUpdating = false;
      this.errorMessage = `Gagal memperbarui: ${e?.message || e}`;
      this.updateStatus = '';
    }
  }
}

export const updateStore = new UpdateStore();
