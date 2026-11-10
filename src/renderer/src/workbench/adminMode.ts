// Modo admin (P-039 D5): enseña las métricas de actividad, proyectos y herramientas y picos de ventana de «Cuentas y
// consumo». A propósito NO está en el catálogo de atajos ni en la documentación de usuario: no es secreto (el código es
// público), solo no se anuncia. Ctrl+Shift+F12, o ⌘+⇧+F12 en macOS. Se compara por `code`: F12 no cambia con la
// distribución del teclado.
const ADMIN_TOGGLE_CODE = 'F12';

export interface KeyLike {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function isAdminToggle(event: KeyLike, isMac: boolean): boolean {
  const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return primary && event.shiftKey && !event.altKey && event.code === ADMIN_TOGGLE_CODE;
}
