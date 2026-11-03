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
