import { usePanelLayoutStore } from './panelLayoutStore';

// Enfoca el buscador del lateral. Si el panel se acaba de abrir, el campo aún no está en el DOM: se reintenta unos
// fotogramas antes de rendirse (el atajo `sidebar.focusSearch` abre el panel y enfoca en la misma pulsación).
const SEARCH_SELECTOR = '[data-sidebar-search]';
const MAX_FRAMES = 10;

export function focusSidebarSearch(framesLeft: number = MAX_FRAMES): void {
  const input = document.querySelector<HTMLInputElement>(SEARCH_SELECTOR);
  if (input !== null) {
    input.focus();
    input.select();
    return;
  }
  if (framesLeft > 0) requestAnimationFrame(() => focusSidebarSearch(framesLeft - 1));
}

// Abre el panel de conversaciones si no está visible (la acción compartida por el atajo y por «N en segundo plano»).
export function revealSidebarPanel(): void {
  const panels = usePanelLayoutStore.getState();
  if (!panels.isPanelOpen('conversations')) panels.togglePanelById('conversations');
}
