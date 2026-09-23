// Navegacion por teclado en listas de pestañas (patron roving tabindex). PURO: dado el nº de items, el
// indice actual y la tecla, devuelve el indice al que mover el foco. Sin efectos ni DOM (testeable).

// Teclas de navegacion soportadas. Flechas horizontales/verticales mueven ±1 con wrap; Home/End a los
// extremos. Cualquier otra tecla deja el indice actual (el caller no hace nada).
export function nextIndexForArrow(count: number, current: number, key: string): number {
  if (count <= 0) return 0;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return current;
  }
}

// ¿Es `key` una tecla de navegacion que el caller debe interceptar (preventDefault + mover foco)?
export function isArrowNavKey(key: string): boolean {
  return key === 'ArrowRight' || key === 'ArrowLeft' || key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End';
}
