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
