/**
 * Pure logic for IDE popup exclusivity, z-index and dismissal (Bug 4).
 * Enforces exactly ONE active popup at any time:
 * opening any popup (device dropdown, runner, branch, project, context menu)
 * immediately closes any other popup.
 */

export type PopupId =
  | 'device'
  | 'runner'
  | 'branch'
  | 'project'
  | 'contextMenu'
  | (string & {});

export class PopupManager {
  private _activePopup: PopupId | null = null;

  constructor(initial: PopupId | null = null) {
    this._activePopup = initial;
  }

  get activePopup(): PopupId | null {
    return this._activePopup;
  }

  /**
   * Opens popup with specified id, closing any other active popup.
   */
  open(id: PopupId): void {
    this._activePopup = id;
  }

  /**
   * Closes active popup (optionally verifying it matches target id).
   */
  close(id?: PopupId): void {
    if (!id || this._activePopup === id) {
      this._activePopup = null;
    }
  }

  /**
   * Toggles popup: if open, closes it; if closed, opens it and closes others.
   */
  toggle(id: PopupId): void {
    if (this._activePopup === id) {
      this._activePopup = null;
    } else {
      this._activePopup = id;
    }
  }

  /**
   * Checks whether popup with specified id is currently active.
   */
  isOpen(id: PopupId): boolean {
    return this._activePopup === id;
  }

  /**
   * Handle Escape key: closes any open popup. Returns true if a popup was closed.
   */
  handleEscape(): boolean {
    if (this._activePopup !== null) {
      this._activePopup = null;
      return true;
    }
    return false;
  }

  /**
   * Handle click outside: closes target popup if click occurred outside.
   */
  handleClickOutside(activeId: PopupId, isInside: boolean): boolean {
    if (this._activePopup === activeId && !isInside) {
      this._activePopup = null;
      return true;
    }
    return false;
  }
}
