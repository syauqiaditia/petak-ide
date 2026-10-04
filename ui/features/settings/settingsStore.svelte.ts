// ponytail: lazy import — only call api when actually changing, not on init
let apiModule: any = null;
async function getApi() {
  if (!apiModule) {
    apiModule = await import('../../lib/api');
  }
  return apiModule.api;
}

/** Persist variant/theme to backend config.json via toolchainSaveConfig. */
async function persistToBackend(field: 'variant' | 'theme', value: string) {
  try {
    const a = await getApi();
    const cfg = await a.toolchainGetConfig();
    (cfg as any)[field] = value;
    await a.toolchainSaveConfig(cfg);
  } catch { /* backend unavailable (tests, SSR) — localStorage still works */ }
}

/** On init, sync variant/theme from backend config if localStorage is empty. */
async function syncFromBackendIfEmpty() {
  try {
    const a = await getApi();
    const cfg = await a.toolchainGetConfig();
    if (typeof localStorage !== 'undefined') {
      if (!localStorage.getItem('petak.variant') && (cfg as any).variant) {
        const v = (cfg as any).variant;
        if (v === 'a' || v === 'b') {
          settingsStore.variant = v;
          localStorage.setItem('petak.variant', v);
          settingsStore['applyVariant'](v);
        }
      }
      if (!localStorage.getItem('petak.theme') && (cfg as any).theme) {
        const t = (cfg as any).theme;
        if (t === 'dark' || t === 'light') {
          settingsStore.theme = t;
          localStorage.setItem('petak.theme', t);
          settingsStore['applyTheme'](t);
        }
      }
    }
  } catch { /* ignore */ }
}

class SettingsStore {
  isOpen = $state(false);
  activeCategory = $state<
    'general' | 'editor' | 'keymap' | 'agents' | 'toolchains' | 'git' | 'accounts' | 'devices' | 'appearance' | 'about'
  >('general');
  theme = $state<'dark' | 'light'>(
    typeof localStorage !== 'undefined' && localStorage.getItem('petak.theme') === 'light'
      ? 'light'
      : 'dark'
  );
  variant = $state<'a' | 'b'>(
    typeof localStorage !== 'undefined' && localStorage.getItem('petak.variant') === 'b'
      ? 'b'
      : 'a'
  );
  reopenLastProjectOnLaunch = $state<boolean>(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('petak.general.reopen_last') === 'true'
      : false // Default is OFF
  );
  language = $state<'id' | 'en'>(
    typeof localStorage !== 'undefined' && localStorage.getItem('petak.language') === 'en'
      ? 'en'
      : 'id' // Default is 'id'
  );

  constructor() {
    this.applyTheme(this.theme);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = this.language;
      if (document.body) {
        this.applyVariant(this.variant);
      } else if (typeof window !== 'undefined') {
        window.addEventListener('DOMContentLoaded', () => this.applyVariant(this.variant));
      }
    }
  }

  setVariant(newVariant: 'a' | 'b') {
    this.variant = newVariant;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.variant', newVariant);
    }
    this.applyVariant(newVariant);
    persistToBackend('variant', newVariant);
  }

  private applyVariant(v: 'a' | 'b') {
    if (typeof document !== 'undefined' && document.body) {
      if (v === 'b') {
        document.body.classList.remove('variant-a');
        document.body.classList.add('variant-b');
      } else {
        document.body.classList.remove('variant-b');
        document.body.classList.add('variant-a');
      }
    }
  }

  setLanguage(newLang: 'id' | 'en') {
    this.language = newLang;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.language', newLang);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = newLang;
    }
  }

  toggleTheme() {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  setTheme(newTheme: 'dark' | 'light') {
    this.theme = newTheme;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.theme', newTheme);
    }
    this.applyTheme(newTheme);
    persistToBackend('theme', newTheme);
  }

  private applyTheme(t: 'dark' | 'light') {
    if (typeof document !== 'undefined') {
      if (t === 'light') {
        document.documentElement.classList.add('light-theme');
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.classList.remove('light-theme');
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    }
  }

  setReopenLastProjectOnLaunch(value: boolean) {
    this.reopenLastProjectOnLaunch = value;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.general.reopen_last', String(value));
    }
  }

  open(
    category?:
      | 'general'
      | 'editor'
      | 'keymap'
      | 'agents'
      | 'toolchains'
      | 'git'
      | 'accounts'
      | 'devices'
      | 'appearance'
      | 'about'
  ) {
    if (category) {
      this.activeCategory = category;
    }
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
  }
}

export const settingsStore = new SettingsStore();

// Sync from backend config on startup if localStorage is empty
if (typeof window !== 'undefined') {
  syncFromBackendIfEmpty();
}
