// Disposicion de la fila del prompt (P-026 3.1, D17; P-028 10): los selectores (modelo, esfuerzo, modo…)
// van al lado del texto mientras cabe en una linea, y bajan a su propia fila en cuanto el texto salta de
// linea, para dejar todo el ancho a la escritura (como Claude y ChatGPT, capturas retoques-alpha-6 y -8).
//
// Con HISTERESIS: apilado solo vuelve a en-linea con el input vacio o cuando el texto (en una linea) cabe
// en el ancho en-linea con un margen de sobra. Sin ella oscila: apilado, el editor es mas ancho, el texto
// cabe en una linea, vuelve a en-linea, el editor estrecha, envuelve, apila…
export type ComposerLayout = 'inline' | 'stacked';

// Margen (px) que tiene que sobrar para volver a en-linea: evita el parpadeo justo en el borde.
export const INLINE_RETURN_MARGIN_PX = 24;
// Ancho minimo del editor en-linea (el `flex-basis` de `PromptEditor`): por debajo, los controles bajarian
// a la fila siguiente igualmente, asi que volver a en-linea no ganaria nada.
export const MIN_INLINE_EDITOR_PX = 160;

export interface ComposerSignals {
  // El contenido ocupa mas de una linea visual (por envolver o por un salto de linea).
  readonly wraps: boolean;
  readonly empty: boolean;
  // Ancho del texto si cabe en una sola linea; null si envuelve, tiene saltos o esta vacio.
  readonly textWidth?: number | null;
  // Ancho que tendria el editor con los selectores en linea; null si no se ha podido medir.
  readonly inlineWidth?: number | null;
}

function fitsInline({ textWidth, inlineWidth }: ComposerSignals): boolean {
  if (textWidth === null || textWidth === undefined) return false;
  if (inlineWidth === null || inlineWidth === undefined || inlineWidth < MIN_INLINE_EDITOR_PX) return false;
  return textWidth + INLINE_RETURN_MARGIN_PX <= inlineWidth;
}

export function composerLayout(current: ComposerLayout, signals: ComposerSignals): ComposerLayout {
  if (current === 'inline') return signals.wraps ? 'stacked' : 'inline';
  if (signals.empty) return 'inline';
  return !signals.wraps && fitsInline(signals) ? 'inline' : 'stacked';
}
