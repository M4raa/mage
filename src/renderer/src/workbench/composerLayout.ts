// Disposicion de la fila del prompt (P-026 3.1, D17): los selectores (modelo, esfuerzo, modo…) van al
// lado del texto mientras cabe en una linea, y bajan a su propia fila en cuanto el texto salta de linea,
// para dejar todo el ancho a la escritura (como Claude y ChatGPT, capturas retoques-alpha-6 y -8).
//
// Con HISTERESIS: apilado solo vuelve a en-linea con el input VACIO. Sin ella oscila: apilado, el editor
// es mas ancho, el texto cabe en una linea, vuelve a en-linea, el editor estrecha, envuelve, apila…
export type ComposerLayout = 'inline' | 'stacked';

export interface ComposerSignals {
  // El contenido ocupa mas de una linea visual (por envolver o por un salto de linea).
  readonly wraps: boolean;
  readonly empty: boolean;
}

export function composerLayout(current: ComposerLayout, { wraps, empty }: ComposerSignals): ComposerLayout {
  if (current === 'inline') return wraps ? 'stacked' : 'inline';
  return empty ? 'inline' : 'stacked';
}
