import { PopupManager, type PopupId } from './popupLogic';

export type { PopupId };

class PopupStore {
  activePopup = $state<PopupId | null>(null);
  private manager = new PopupManager();

  open(id: PopupId) {
    this.manager.open(id);
    this.activePopup = this.manager.activePopup;
  }

  close(id?: PopupId) {
    this.manager.close(id);
    this.activePopup = this.manager.activePopup;
  }

  toggle(id: PopupId) {
    this.manager.toggle(id);
    this.activePopup = this.manager.activePopup;
  }

  isOpen(id: PopupId): boolean {
    return this.activePopup === id;
  }

  closeAll() {
    this.close();
  }

  handleEscape(): boolean {
    const closed = this.manager.handleEscape();
    this.activePopup = this.manager.activePopup;
    return closed;
  }
}

export const popupStore = new PopupStore();
