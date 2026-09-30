/**
 * Pure logic for Settings > Accounts (GitLab URL + PAT Management).
 *
 * Security Rules:
 * - Token is NEVER read back into the UI (only hasToken boolean).
 * - Input field must be type="password".
 * - Token is NEVER stored in plain localStorage or logged.
 * - Input token field is cleared immediately after save.
 */

import type { AccountInfo, AccountTestResult } from '../../lib/api.ts';

export interface AccountsApiClient {
  accountsGet(): Promise<AccountInfo>;
  accountsSave(url: string, token: string): Promise<void>;
  accountsTest(url?: string, token?: string): Promise<AccountTestResult>;
  accountsClear(): Promise<void>;
}

export function validateAccountInputs(url: string, token: string): { valid: boolean; error?: string } {
  const trimmedUrl = (url || '').trim();
  const trimmedToken = (token || '').trim();

  if (!trimmedUrl) {
    return { valid: false, error: 'GitLab URL tidak boleh kosong' };
  }
  if (!/^https?:\/\//i.test(trimmedUrl)) {
    return { valid: false, error: 'URL harus diawali dengan http:// atau https://' };
  }
  if (!trimmedToken) {
    return { valid: false, error: 'Personal Access Token (PAT) tidak boleh kosong' };
  }

  return { valid: true };
}

export class AccountsManager {
  url: string = '';
  hasToken: boolean = false;
  inputToken: string = '';
  statusMessage: string | null = null;
  statusKind: 'idle' | 'success' | 'error' | 'testing' = 'idle';

  async load(apiClient: AccountsApiClient): Promise<void> {
    try {
      const info = await apiClient.accountsGet();
      this.url = info.url || '';
      this.hasToken = !!info.hasToken;
    } catch {
      this.url = '';
      this.hasToken = false;
    }
  }

  async save(apiClient: AccountsApiClient): Promise<boolean> {
    const val = validateAccountInputs(this.url, this.inputToken);
    if (!val.valid) {
      this.statusKind = 'error';
      this.statusMessage = val.error || 'Input tidak valid';
      return false;
    }

    try {
      await apiClient.accountsSave(this.url.trim(), this.inputToken.trim());
      // Mandatory security rule: Clear token input immediately after save!
      this.inputToken = '';
      this.hasToken = true;
      this.statusKind = 'success';
      this.statusMessage = 'Akun GitLab berhasil disimpan ke Keychain';
      return true;
    } catch (err: any) {
      this.statusKind = 'error';
      this.statusMessage = `Gagal menyimpan: ${err?.message || err}`;
      return false;
    }
  }

  async test(apiClient: AccountsApiClient): Promise<AccountTestResult> {
    this.statusKind = 'testing';
    this.statusMessage = 'Menguji koneksi ke GitLab…';

    try {
      const res = await apiClient.accountsTest(
        this.url.trim() || undefined,
        this.inputToken.trim() || undefined
      );
      if (res.ok) {
        this.statusKind = 'success';
        this.statusMessage = res.user ? `Terhubung sebagai @${res.user}` : 'Koneksi berhasil';
      } else {
        this.statusKind = 'error';
        this.statusMessage = res.error || 'Koneksi gagal atau token tidak valid';
      }
      return res;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      this.statusKind = 'error';
      this.statusMessage = `Tes koneksi gagal: ${errorMsg}`;
      return { ok: false, error: errorMsg };
    }
  }

  async clear(apiClient: AccountsApiClient): Promise<void> {
    try {
      await apiClient.accountsClear();
    } catch {}
    this.url = '';
    this.hasToken = false;
    this.inputToken = '';
    this.statusKind = 'idle';
    this.statusMessage = 'Akun GitLab telah dihapus';
  }
}
