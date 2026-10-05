import { api, type Skill, type SkillSummary } from '../../lib/api.ts';
import {
  isValidSkillName,
  parseSkillFrontmatter,
  formatSkillsForPrompt,
  SkillsStoreLogic,
} from './skillsLogic.ts';

export class SkillsStore {
  skills = $state<SkillSummary[]>([]);
  activeCustomSkills = $state<string[]>([]);
  isLoading = $state<boolean>(false);
  selectedSkill = $state<Skill | null>(null);
  isFormOpen = $state<boolean>(false);
  editingSkill = $state<Skill | null>(null);
  currentRoot = $state<string>('');

  constructor() {
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

  private persistActiveSkills() {
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

export const skillsStore = new SkillsStore();
