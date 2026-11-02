// Colores de respaldo de los tokens ESTRUCTURALES de un tema importado de VS Code (F5.2). PURO.
// Muchos temas de Open VSX traen bordes, hover o foco que no se distinguen del panel (Nord pinta el foco
// del mismo color que el borde). Para cada token se busca, en orden, el primer color del AUTOR que alcance
// su umbral de contraste WCAG 2.x frente al panel; solo si ninguno llega se deriva mezclando el primer
// plano sobre el panel. Nunca pisa un valor del autor que ya se distingue, y la selección nunca se
// recolorea por parecerse al hover: se pide una marca. Valores medidos con Nord 0.19.0, One Dark Pro
// 3.20.6, Solarized Light 1.95.3 y Dark Modern 1.95.3 (Open VSX, 2026-10-31).

export interface DerivedColor {
  readonly value: string; // #rrggbb opaco
  readonly source: string; // clave de VS Code, color literal o `derived:<n>%`
  readonly ratio: number; // contraste sin redondear frente a su superficie
  readonly derived: boolean;
}

export interface SelectionMark {
  readonly needed: boolean;
  readonly widthPx: typeof SELECTION_MARK_WIDTH_PX;
}

export interface StructuralTokens {
  readonly separatorWeak: DerivedColor;
  readonly controlBorder: DerivedColor;
  readonly hover: DerivedColor;
  readonly selection: DerivedColor;
  readonly focusRing: DerivedColor;
  // Texto sobre la selección: su `ratio` es frente a la selección, no frente al panel.
  readonly selectionInk: DerivedColor;
  readonly selectionMark: SelectionMark;
}

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

interface ContrastRule {
  readonly candidates: readonly string[];
  readonly minRatio: number;
}

type PanelToken = 'separatorWeak' | 'controlBorder' | 'hover' | 'selection' | 'focusRing';

const SELECTION_MARK_WIDTH_PX = 2;
// Por debajo de esta razón entre selección y hover, la fila seleccionada no se distingue de la que
// está bajo el ratón y se pide la marca de 2 px.
const MIN_SELECTION_VS_HOVER = 1.12;
const MAX_MIX_PERCENT = 100;
const CHANNEL_MAX = 255;

const PANEL_KEYS = ['sideBar.background', 'panel.background', 'editorWidget.background', 'editor.background'];
const FOREGROUND_KEYS = ['foreground', 'editor.foreground', 'sideBar.foreground'];

// Orden de candidatos y umbral frente al panel. La selección no mira `menu.selectionBackground` ni
// `editor.selectionBackground` (son de menú y de texto: en Dark Modern el primero es un azul para una
// fila de lista), y el foco no mira `editorCursor.foreground` (es el color del texto, no un acento).
const PANEL_RULES: Readonly<Record<PanelToken, ContrastRule>> = {
  separatorWeak: {
    candidates: ['panel.border', 'editorGroup.border', 'editorGroupHeader.tabsBorder', 'tab.border', 'input.border', 'contrastBorder'],
    minRatio: 1.15,
  },
  controlBorder: {
    candidates: ['input.border', 'dropdown.border', 'panel.border', 'editorGroup.border', 'contrastBorder'],
    minRatio: 1.45,
  },
  hover: {
    candidates: ['list.hoverBackground', 'toolbar.hoverBackground', 'menubar.selectionBackground', 'list.inactiveSelectionBackground', 'editor.lineHighlightBackground'],
    minRatio: 1.05,
  },
  selection: {
    candidates: ['list.activeSelectionBackground', 'list.inactiveSelectionBackground', 'quickInputList.focusBackground', 'editor.lineHighlightBackground'],
    minRatio: 1.25,
  },
  // WCAG 1.4.11: un indicador de foco necesita 3:1.
  focusRing: {
    candidates: ['focusBorder', 'button.background', 'textLink.foreground', 'activityBarBadge.background', 'progressBar.background'],
    minRatio: 3,
  },
};

// WCAG 1.4.3: texto normal a 4,5:1 frente a la selección. Los dos últimos son colores literales: entre
// blanco y negro, uno siempre llega a 4,5:1 sobre cualquier fondo opaco.
const SELECTION_INK_RULE: ContrastRule = {
  candidates: ['list.activeSelectionForeground', 'editor.foreground', 'foreground', '#ffffff', '#000000'],
  minRatio: 4.5,
};

// Verdadero si el tema trae superficie de panel y primer plano: sin ellos no se puede medir nada.
export function canDerive(colors: Readonly<Record<string, string>>): boolean {
  return resolveSurfaces(colors) !== null;
}

// Deriva los tokens estructurales a partir de los colores CRUDOS del tema (no de los ya mapeados).
export function deriveStructuralTokens(colors: Readonly<Record<string, string>>): StructuralTokens {
  const surfaces = resolveSurfaces(colors);
  if (surfaces === null) {
    throw new Error(`tema sin color de superficie o de primer plano; claves recibidas: ${Object.keys(colors).length}`);
  }
  const { panel, foreground } = surfaces;
  const pick = (token: PanelToken): DerivedColor =>
    pickAuthorColor(colors, PANEL_RULES[token], panel) ?? deriveFromForeground(foreground, panel, PANEL_RULES[token].minRatio);
  const hover = pick('hover');
  const selection = pick('selection');
  return {
    separatorWeak: pick('separatorWeak'),
    controlBorder: pick('controlBorder'),
    hover,
    selection,
    focusRing: pick('focusRing'),
    selectionInk: pickSelectionInk(colors, selection),
    selectionMark: { needed: contrastHex(selection.value, hover.value) < MIN_SELECTION_VS_HOVER, widthPx: SELECTION_MARK_WIDTH_PX },
  };
}

// Panel opaco (el alfa se descarta: es lo que Mage pinta como --color-mg-panel) y primer plano
// compuesto sobre él. null si falta cualquiera de los dos.
function resolveSurfaces(colors: Readonly<Record<string, string>>): { readonly panel: Rgba; readonly foreground: Rgba } | null {
  const panelRaw = firstParsed(colors, PANEL_KEYS);
  if (panelRaw === null) return null;
  const panel = { ...panelRaw, a: 1 };
  const foregroundRaw = firstParsed(colors, FOREGROUND_KEYS);
  if (foregroundRaw === null) return null;
  return { panel, foreground: compose(foregroundRaw, panel) };
}

function firstParsed(colors: Readonly<Record<string, string>>, keys: readonly string[]): Rgba | null {
  for (const key of keys) {
    const parsed = parseColor(colors[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

// Primer candidato que, compuesto sobre la superficie, alcanza el umbral. Un candidato que empieza por
// `#` es un color literal, no una clave del tema.
function pickAuthorColor(colors: Readonly<Record<string, string>>, rule: ContrastRule, surface: Rgba): DerivedColor | null {
  for (const key of rule.candidates) {
    const parsed = parseColor(key.startsWith('#') ? key : colors[key]);
    if (parsed === null) continue;
    const composed = compose(parsed, surface);
    const ratio = contrastRatio(composed, surface);
    if (ratio >= rule.minRatio) return { value: toHex(composed), source: key, ratio, derived: false };
  }
  return null;
}

// Menor porcentaje entero de primer plano sobre el panel que alcanza el umbral. Si ni el 100 % llega,
// se queda el primer plano tal cual.
function deriveFromForeground(foreground: Rgba, panel: Rgba, minRatio: number): DerivedColor {
  for (let percent = 1; percent < MAX_MIX_PERCENT; percent += 1) {
    const mixed = mix(foreground, panel, percent);
    const ratio = contrastRatio(mixed, panel);
    if (ratio >= minRatio) return { value: toHex(mixed), source: `derived:${percent}%`, ratio, derived: true };
  }
  const full = mix(foreground, panel, MAX_MIX_PERCENT);
  return { value: toHex(full), source: `derived:${MAX_MIX_PERCENT}%`, ratio: contrastRatio(full, panel), derived: true };
}

function pickSelectionInk(colors: Readonly<Record<string, string>>, selection: DerivedColor): DerivedColor {
  const surface = parseColor(selection.value);
  if (surface === null) throw new Error(`selección sin color válido: ${selection.value}`);
  const ink = pickAuthorColor(colors, SELECTION_INK_RULE, surface);
  // Inalcanzable: blanco o negro siempre dan al menos 4,58:1 sobre un fondo opaco.
  if (ink === null) throw new Error(`sin texto legible sobre la selección ${selection.value}`);
  return ink;
}

// #rgb, #rgba, #rrggbb o #rrggbbaa; cualquier otra cosa (nombres, funciones, ausente) -> null.
function parseColor(value: string | undefined): Rgba | null {
  if (value === undefined) return null;
  const match = /^#([0-9a-fA-F]{3,8})$/.exec(value.trim());
  if (match === null) return null;
  const short = match[1] ?? '';
  const hex = short.length <= 4 ? [...short].map((digit) => digit + digit).join('') : short;
  if (hex.length !== 6 && hex.length !== 8) return null;
  const channel = (offset: number): number => Number.parseInt(hex.slice(offset, offset + 2), 16);
  return { r: channel(0), g: channel(2), b: channel(4), a: hex.length === 8 ? channel(6) / CHANNEL_MAX : 1 };
}

// Composición alfa sobre un fondo opaco; los canales quedan sin redondear para medir.
function compose(color: Rgba, background: Rgba): Rgba {
  const blend = (top: number, bottom: number): number => top * color.a + bottom * (1 - color.a);
  return { r: blend(color.r, background.r), g: blend(color.g, background.g), b: blend(color.b, background.b), a: 1 };
}

// Mezcla sRGB canal a canal, redondeada por canal.
function mix(top: Rgba, bottom: Rgba, percent: number): Rgba {
  const blend = (from: number, to: number): number => Math.round(from + ((to - from) * percent) / MAX_MIX_PERCENT);
  return { r: blend(bottom.r, top.r), g: blend(bottom.g, top.g), b: blend(bottom.b, top.b), a: 1 };
}

function toHex(color: Rgba): string {
  const pair = (channel: number): string => Math.round(channel).toString(16).padStart(2, '0');
  return `#${pair(color.r)}${pair(color.g)}${pair(color.b)}`;
}

// Luminancia relativa y razón de contraste de WCAG 2.x.
function relativeLuminance(color: Rgba): number {
  const linear = (channel: number): number => {
    const srgb = channel / CHANNEL_MAX;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function contrastHex(first: string, second: string): number {
  const a = parseColor(first);
  const b = parseColor(second);
  if (a === null || b === null) throw new Error(`colores no comparables: ${first} y ${second}`);
  return contrastRatio(a, b);
}
