/**
 * Svelte action to portal an element to document.body (or specified target),
 * breaking out of parent clipping, overflow: hidden, or lower stacking contexts.
 */
export function portal(node: HTMLElement, target: HTMLElement = (typeof document !== 'undefined' ? document.body : null as unknown as HTMLElement)) {
  if (typeof document !== 'undefined' && target) {
    target.appendChild(node);
  }

  return {
    destroy() {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    },
  };
}
