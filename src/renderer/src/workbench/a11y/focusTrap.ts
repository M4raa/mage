// Logica PURA del focus trap de un modal: dado el nº de elementos focusables del panel, el indice del
// que tiene el foco y si se pulsa Shift, decide a que indice saltar para que el Tab no escape del panel.
// Devuelve null si no hay que interceptar (dejar el comportamiento por defecto del navegador). La parte
// DOM (localizar los focusables y aplicar .focus()) vive en el hook useDialogA11y; esto es testeable.

export function resolveTrapTarget(count: number, activeIndex: number, shiftKey: boolean): number | null {
  // Sin focusables (o uno solo) no hay adonde tabular: mantener el foco en el panel.
  if (count <= 1) return count === 1 ? 0 : null;

  // Foco fuera de la lista (activeIndex < 0): al entrar con Tab, ir al primero; con Shift+Tab, al ultimo.
  if (activeIndex < 0) return shiftKey ? count - 1 : 0;

  // Shift+Tab en el primero -> envolver al ultimo. Tab en el ultimo -> envolver al primero.
  if (shiftKey && activeIndex === 0) return count - 1;
  if (!shiftKey && activeIndex === count - 1) return 0;

  // En medio: dejar que el navegador mueva el foco normalmente.
  return null;
}

// ¿Debe un panel que se cierra devolver el foco a quien lo abrio? Solo si el foco sigue siendo "suyo":
// dentro del panel o perdido (null, <body>, <html>: lo normal cuando se desmonta el control enfocado).
// Si otro dialogo ya lo ha tomado —«Añadir cuenta › Abrir Proveedores y modelos» cierra un modal y abre
// Configuracion en el mismo gesto, y el montaje de Configuracion enfoca antes de que corra la limpieza
// del alta—, devolverlo lo SACA del modal nuevo, que se queda sin Escape (medido con verify:gui, punto 41).
export function shouldRestoreFocus<T>(focused: T | null, lostTargets: readonly T[], isInsidePanel: (node: T) => boolean): boolean {
  if (focused === null || lostTargets.includes(focused)) return true;
  return isInsidePanel(focused);
}
