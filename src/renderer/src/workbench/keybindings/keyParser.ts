// Parseo/formato/matching de combinaciones de teclado (D5, PLAN-D5-KEYBINDINGS.md §5). Modulo PURO: sin
// DOM. El matching real usa `event.code` (posicion fisica): portable entre distribuciones de teclado
// (en un teclado espanol, la tecla que hace "[" en US no produce "[" con `key` sin AltGr). La etiqueta
// que se guarda/muestra viene de una tabla estatica code -> etiqueta (asuncion de distribucion US, igual
// que VS Code/Electron): es solo para que un humano lea el fichero, nunca decide si un atajo dispara.

export interface ParsedKeyCombo {
  readonly cmdOrCtrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly code: string; // valor de KeyboardEvent.code, p.ej. "KeyN", "Tab", "Digit1", "BracketLeft"
}

// Forma minima de un KeyboardEvent real que necesita el matching (facil de construir en tests sin DOM).
export interface KeyEventLike {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

// Tabla estable code -> etiqueta canonica. Letras y digitos primero (los mas comunes en atajos).
const LETTER_CODES: readonly (readonly [string, string])[] = Array.from({ length: 26 }, (_, i) => {
  const letter = String.fromCharCode(65 + i);
  return [`Key${letter}`, letter] as const;
});
const DIGIT_CODES: readonly (readonly [string, string])[] = Array.from({ length: 10 }, (_, i) => [`Digit${i}`, String(i)] as const);
const FUNCTION_CODES: readonly (readonly [string, string])[] = Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`] as const);

const OTHER_CODES: readonly (readonly [string, string])[] = [
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backslash', '\\'],
  ['Minus', '-'],
  ['Equal', '='],
  ['Backquote', '`'],
  ['Tab', 'Tab'],
  ['Enter', 'Enter'],
  ['Space', 'Space'],
  ['Escape', 'Escape'],
  ['Backspace', 'Backspace'],
  ['Delete', 'Delete'],
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'PageUp'],
  ['PageDown', 'PageDown'],
  ['ArrowUp', 'ArrowUp'],
  ['ArrowDown', 'ArrowDown'],
  ['ArrowLeft', 'ArrowLeft'],
  ['ArrowRight', 'ArrowRight'],
];

const CODE_TO_LABEL = new Map<string, string>([...LETTER_CODES, ...DIGIT_CODES, ...FUNCTION_CODES, ...OTHER_CODES]);
const LABEL_TO_CODE = new Map<string, string>([...CODE_TO_LABEL].map(([code, label]) => [label, code]));

// Nombres de modificador reconocidos en el formato canonico (orden fijo al formatear: CmdOrCtrl, Alt, Shift).
const MODIFIER_TOKENS = ['CmdOrCtrl', 'Alt', 'Shift'] as const;
type ModifierToken = (typeof MODIFIER_TOKENS)[number];

function isModifierToken(token: string): token is ModifierToken {
  return (MODIFIER_TOKENS as readonly string[]).includes(token);
}

// Parsea un texto en formato canonico ("CmdOrCtrl+Shift+K") a su forma estructurada. null si el texto
// esta vacio, tiene un modificador desconocido/duplicado o la tecla final no esta en la tabla: una
// combinacion invalida en el fichero de settings cae a "sin override" (ver resolver.ts), nunca revienta.
export function parseKeyCombo(text: string): ParsedKeyCombo | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const tokens = trimmed.split('+').map((t) => t.trim());
  if (tokens.some((t) => t.length === 0)) return null;

  const keyToken = tokens[tokens.length - 1]!;
  const modifierTokens = tokens.slice(0, -1);
  const code = LABEL_TO_CODE.get(keyToken);
  if (code === undefined) return null;

  const seen = new Set<ModifierToken>();
  for (const token of modifierTokens) {
    if (!isModifierToken(token) || seen.has(token)) return null;
    seen.add(token);
  }
  return { cmdOrCtrl: seen.has('CmdOrCtrl'), alt: seen.has('Alt'), shift: seen.has('Shift'), code };
}

// Formatea una combinacion estructurada al formato canonico, orden fijo de modificadores. Devuelve null
// si el code no tiene etiqueta conocida (no deberia ocurrir con combos que vinieron de parseKeyCombo).
export function formatKeyCombo(combo: ParsedKeyCombo): string | null {
  const label = CODE_TO_LABEL.get(combo.code);
  if (label === undefined) return null;
  const parts: string[] = [];
  if (combo.cmdOrCtrl) parts.push('CmdOrCtrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  parts.push(label);
  return parts.join('+');
}

// Construye la combinacion tal cual la produjo un KeyboardEvent real (captura en la UI de Configuracion).
// null si el code pulsado no esta en la tabla soportada (p.ej. una tecla de medios).
export function comboFromEvent(event: KeyEventLike, isMac: boolean): ParsedKeyCombo | null {
  if (!CODE_TO_LABEL.has(event.code)) return null;
  return {
    cmdOrCtrl: isMac ? event.metaKey : event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    code: event.code,
  };
}

// ¿El evento real coincide con la combinacion guardada? Compara por `code` (posicion fisica) + el
// estado exacto de los 3 modificadores que maneja el catalogo (CmdOrCtrl resuelto por plataforma).
export function matchesKeyboardEvent(combo: ParsedKeyCombo, event: KeyEventLike, isMac: boolean): boolean {
  const cmdOrCtrlPressed = isMac ? event.metaKey : event.ctrlKey;
  return event.code === combo.code && cmdOrCtrlPressed === combo.cmdOrCtrl && event.altKey === combo.alt && event.shiftKey === combo.shift;
}

// Etiqueta legible para la UI (CmdOrCtrl resuelto por plataforma: ⌘ en macOS, "Ctrl" en Windows/Linux).
export function displayKeyCombo(combo: ParsedKeyCombo, isMac: boolean): string {
  const label = CODE_TO_LABEL.get(combo.code) ?? combo.code;
  const parts: string[] = [];
  if (combo.cmdOrCtrl) parts.push(isMac ? '⌘' : 'Ctrl');
  if (combo.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (combo.shift) parts.push(isMac ? '⇧' : 'Shift');
  parts.push(label);
  return parts.join('+');
}

// ¿Es una combinacion "letra/digito suelto sin modificador"? Regla general de §3.2: estas nunca se
// resuelven mientras el foco esta en un campo de texto editable (si no, escribir en el prompt con un
// atajo de una tecla pendiente seria imposible). Tab/Enter/Escape/flechas NO entran aqui: deben seguir
// funcionando dentro de un campo de texto.
export function isBareAlphanumeric(combo: ParsedKeyCombo): boolean {
  if (combo.cmdOrCtrl || combo.alt || combo.shift) return false;
  return combo.code.startsWith('Key') || combo.code.startsWith('Digit');
}
