export function isTitleBarInteractive(target: HTMLElement | null): boolean {
  if (!target) return false;
  let curr: HTMLElement | null = target;
  while (curr && !curr.classList?.contains('titlebar')) {
    const tagName = curr.tagName ? curr.tagName.toLowerCase() : '';
    if (
      tagName === 'button' ||
      tagName === 'input' ||
      tagName === 'select' ||
      tagName === 'textarea' ||
      tagName === 'a'
    ) {
      return true;
    }
    const role = curr.getAttribute ? curr.getAttribute('role') : null;
    if (role === 'button' || role === 'menuitem' || role === 'combobox' || role === 'menu') {
      return true;
    }
    if (curr.classList) {
      if (
        curr.classList.contains('project-btn') ||
        curr.classList.contains('project-popup-menu') ||
        curr.classList.contains('run-btn') ||
        curr.classList.contains('config-btn') ||
        curr.classList.contains('device-btn') ||
        curr.classList.contains('tool-btn') ||
        curr.classList.contains('run-action-btn') ||
        curr.classList.contains('reload-btn') ||
        curr.classList.contains('more-btn') ||
        curr.classList.contains('interactive')
      ) {
        return true;
      }
    }
    curr = curr.parentElement;
  }
  return false;
}
