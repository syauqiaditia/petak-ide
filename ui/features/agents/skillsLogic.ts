import { api, type Skill, type SkillSummary } from '../../lib/api.ts';

export interface ParsedSkill {
  metadata: Record<string, string>;
  content: string;
}

/**
 * Validates skill identifier name.
 * Only allows alphanumeric characters, hyphens (-), and underscores (_).
 */
export function isValidSkillName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  return /^[a-zA-Z0-9_-]+$/.test(name.trim());
}

/**
 * Parses SKILL.md frontmatter (YAML delimited by `---`) and extracts metadata and markdown body.
 */
export function parseSkillFrontmatter(rawContent: string): ParsedSkill {
  if (!rawContent || typeof rawContent !== 'string') {
    return { metadata: {}, content: '' };
  }
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith('---')) {
    return { metadata: {}, content: trimmed };
  }

  const lines = rawContent.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim() === '---');
  if (firstIdx === -1) {
    return { metadata: {}, content: trimmed };
  }
  const secondIdx = lines.findIndex((l, idx) => idx > firstIdx && l.trim() === '---');
  if (secondIdx === -1) {
    return { metadata: {}, content: trimmed };
  }

  const metaLines = lines.slice(firstIdx + 1, secondIdx);
  const bodyLines = lines.slice(secondIdx + 1);

  const metadata: Record<string, string> = {};
  for (const line of metaLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) {
        metadata[key] = val;
      }
    }
  }

  return {
    metadata,
    content: bodyLines.join('\n').trim(),
  };
}

/**
 * Formats active skills into a structured prompt injection block.
 * Format:
 * [ACTIVE SKILL: <name>]
 * <content>
 * [/ACTIVE SKILL]
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (!skills || skills.length === 0) return '';
  return skills
    .filter((s) => s && s.name && s.content)
    .map((s) => `[ACTIVE SKILL: ${s.name}]\n${s.content.trim()}\n[/ACTIVE SKILL]`)
    .join('\n\n');
}

/**
 * Pure state and lifecycle logic for Petak Skills Management.
 * Usable both in headless Node.js tests and backing the reactive Svelte 5 store.
 */
export class SkillsStoreLogic {
  skills: SkillSummary[] = [];
  activeCustomSkills: string[] = [];
  isLoading: boolean = false;
  selectedSkill: Skill | null = null;
  isFormOpen: boolean = false;
  editingSkill: Skill | null = null;
  currentRoot: string = '';

  constructor() {
    this.initStorage();
  }

  initStorage() {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('petak.active_custom_skills');
        if (saved) {
          this.activeCustomSkills = JSON.parse(saved);
        }
      } catch {
        // ignore
      }
    }
  }

  persistActiveSkills() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('petak.active_custom_skills', JSON.stringify(this.activeCustomSkills));
      } catch {
        // ignore
      }
    }
  }

  async loadSkills(root?: string, apiInstance = api) {
    if (root !== undefined) this.currentRoot = root;
    this.isLoading = true;
    try {
      this.skills = await apiInstance.agentSkillsList(this.currentRoot || undefined);
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      this.isLoading = false;
    }
  }

  toggleSkill(name: string) {
    if (this.activeCustomSkills.includes(name)) {
      this.activeCustomSkills = this.activeCustomSkills.filter((s) => s !== name);
    } else {
      this.activeCustomSkills = [...this.activeCustomSkills, name];
    }
    this.persistActiveSkills();
  }

  async saveSkill(name: string, description: string, content: string, root?: string, apiInstance = api) {
    if (!isValidSkillName(name)) {
      throw new Error(`Nama skill '${name}' tidak valid. Hanya huruf, angka, minus, dan underscore yang diperbolehkan.`);
    }
    const targetRoot = root !== undefined ? root : this.currentRoot;
    this.isLoading = true;
    try {
      const saved = await apiInstance.agentSkillSave(name, description, content, targetRoot || undefined);
      this.isFormOpen = false;
      this.editingSkill = null;
      await this.loadSkills(targetRoot, apiInstance);
      return saved;
    } catch (err) {
      console.error('Failed to save skill:', err);
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  async deleteSkill(name: string, root?: string, apiInstance = api): Promise<boolean> {
    const existing = this.skills.find((s) => s.name === name);
    if (existing?.isCore || name === 'ponytail' || name === 'caveman') {
      throw new Error(`Skill core '${name}' dilindungi sistem dan tidak boleh dihapus.`);
    }
    const targetRoot = root !== undefined ? root : this.currentRoot;
    this.isLoading = true;
    try {
      const result = await apiInstance.agentSkillDelete(name, targetRoot || undefined);
      if (this.activeCustomSkills.includes(name)) {
        this.activeCustomSkills = this.activeCustomSkills.filter((s) => s !== name);
        this.persistActiveSkills();
      }
      await this.loadSkills(targetRoot, apiInstance);
      return result;
    } catch (err) {
      console.error('Failed to delete skill:', err);
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  async getActiveSkillsContent(root?: string, apiInstance = api): Promise<Skill[]> {
    const targetRoot = root !== undefined ? root : this.currentRoot;
    const results: Skill[] = [];
    for (const name of this.activeCustomSkills) {
      try {
        const skill = await apiInstance.agentSkillGet(name, targetRoot || undefined);
        if (skill) {
          results.push(skill);
        }
      } catch (err) {
        console.warn(`Could not fetch active skill content for ${name}:`, err);
      }
    }
    return results;
  }

  openCreateForm() {
    this.editingSkill = null;
    this.isFormOpen = true;
  }

  async openEditForm(name: string, root?: string, apiInstance = api) {
    const targetRoot = root !== undefined ? root : this.currentRoot;
    try {
      const skill = await apiInstance.agentSkillGet(name, targetRoot || undefined);
      this.editingSkill = skill;
      this.isFormOpen = true;
    } catch (err) {
      console.error(`Failed to load skill for edit: ${name}`, err);
    }
  }

  closeForm() {
    this.isFormOpen = false;
    this.editingSkill = null;
  }
}
