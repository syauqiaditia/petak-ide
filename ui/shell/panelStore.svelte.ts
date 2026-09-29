/**
 * Reactive store for IDE panel exclusivity (B1).
 * Single store activeRightPanel (mirror OR Devices/other) + left sidebar exclusivity.
 */

import {
  PanelExclusivityManager,
  type RightPanelId,
  type LeftSidebarId,
} from './panelExclusivity';

export type { RightPanelId, LeftSidebarId };

class PanelStore {
  activeRightPanel = $state<RightPanelId>(null);
  activeLeftSidebar = $state<LeftSidebarId>('project');

  private manager = new PanelExclusivityManager();

  openRightPanel(panel: RightPanelId) {
    this.manager.openRight(panel);
    this.activeRightPanel = this.manager.activeRightPanel;
  }

  closeRightPanel(panel?: RightPanelId) {
    this.manager.closeRight(panel);
    this.activeRightPanel = this.manager.activeRightPanel;
  }

  toggleRightPanel(panel: Exclude<RightPanelId, null>) {
    this.manager.toggleRight(panel);
    this.activeRightPanel = this.manager.activeRightPanel;
  }

  isRightOpen(panel: RightPanelId): boolean {
    return this.activeRightPanel === panel;
  }

  setLeftSidebar(tab: LeftSidebarId) {
    this.manager.setLeft(tab);
    this.activeLeftSidebar = this.manager.activeLeftSidebar;
  }

  isLeftActive(tab: LeftSidebarId): boolean {
    return this.activeLeftSidebar === tab;
  }
}

export const panelStore = new PanelStore();
