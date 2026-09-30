/**
 * Pure logic for IDE panel exclusivity (B1).
 * Exactly one right panel active (mirror OR devices OR agent). Opening one closes the other.
 * Exactly one left sidebar active (project OR git OR agents). Opening one closes the other.
 */

export type RightPanelId = 'mirror' | 'devices' | 'agent' | null;
export type LeftSidebarId = 'project' | 'git' | 'mr' | 'agents' | 'settings';

export class PanelExclusivityManager {
  private _activeRightPanel: RightPanelId = null;
  private _activeLeftSidebar: LeftSidebarId = 'project';

  constructor(initialRight: RightPanelId = null, initialLeft: LeftSidebarId = 'project') {
    this._activeRightPanel = initialRight;
    this._activeLeftSidebar = initialLeft;
  }

  get activeRightPanel(): RightPanelId {
    return this._activeRightPanel;
  }

  get activeLeftSidebar(): LeftSidebarId {
    return this._activeLeftSidebar;
  }

  /**
   * Open a right panel. Automatically closes whatever other right panel was active.
   */
  openRight(panel: RightPanelId): void {
    this._activeRightPanel = panel;
  }

  /**
   * Close right panel (optionally verifying it matches target).
   */
  closeRight(panel?: RightPanelId): void {
    if (!panel || this._activeRightPanel === panel) {
      this._activeRightPanel = null;
    }
  }

  /**
   * Toggle right panel: if already active, closes it; otherwise opens it (and closes any other).
   */
  toggleRight(panel: Exclude<RightPanelId, null>): void {
    if (this._activeRightPanel === panel) {
      this._activeRightPanel = null;
    } else {
      this._activeRightPanel = panel;
    }
  }

  isRightOpen(panel: RightPanelId): boolean {
    return this._activeRightPanel === panel;
  }

  /**
   * Switch active left sidebar. Opening one automatically deactivates the previous.
   */
  setLeft(tab: LeftSidebarId): void {
    this._activeLeftSidebar = tab;
  }

  isLeftActive(tab: LeftSidebarId): boolean {
    return this._activeLeftSidebar === tab;
  }
}
