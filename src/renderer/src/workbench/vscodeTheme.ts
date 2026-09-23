import type { FetchedVscodeTheme, VscodeTokenColor } from '@shared/themeMarket';

// Mapeo PURO de un tema de color de VS Code (colores de su fichero) a los tokens de Mage
// (--color-mg-*). VS Code tiene cientos de claves de UI que Mage no usa; se mapea un SUBCONJUNTO
// estructural con fallbacks encadenados y el resto cae al tema base (data-theme = type). Sin efectos.

export interface MappedTheme {
  readonly type: 'light' | 'dark';
  readonly tokens: Readonly<Record<string, string>>;
}

// Cada token de Mage se resuelve al primer color de VS Code disponible de su lista de candidatos.
// Las cadenas son LARGAS a proposito (Ronda 3, item 3): muchos temas de Open VSX declaran un `colors`
// muy escueto, y con cadenas cortas la mayoria de tokens quedaban sin resolver -> la miniatura caia en
// el mismo color de respaldo para varias barras ("dos o tres barras genericas sin relacion con el tema").
const TOKEN_MAP: readonly (readonly [string, readonly string[]])[] = [
  // Fondos
  ['--color-mg-window', ['editor.background', 'sideBar.background', 'panel.background']],
  ['--color-mg-rail', ['activityBar.background', 'sideBar.background', 'panel.background', 'editor.background']],
  ['--color-mg-panel', ['sideBar.background', 'panel.background', 'editorWidget.background', 'editor.background']],
  ['--color-mg-block', ['editorWidget.background', 'sideBar.background', 'panel.background', 'editor.background']],
  ['--color-mg-tool', ['textCodeBlock.background', 'editorWidget.background', 'sideBar.background', 'editor.background']],
  ['--color-mg-code', ['textCodeBlock.background', 'editorWidget.background', 'editor.background']],
  ['--color-mg-popover', ['editorWidget.background', 'dropdown.background', 'menu.background', 'quickInput.background', 'editor.background']],
  ['--color-mg-sel', ['list.activeSelectionBackground', 'list.inactiveSelectionBackground', 'quickInputList.focusBackground', 'menu.selectionBackground', 'editor.selectionBackground', 'editor.lineHighlightBackground']],
  ['--color-mg-hover', ['list.hoverBackground', 'toolbar.hoverBackground', 'menubar.selectionBackground', 'list.inactiveSelectionBackground', 'editor.lineHighlightBackground']],
  // Bordes
  ['--color-mg-border', ['panel.border', 'editorGroup.border', 'sideBar.border', 'editorGroupHeader.tabsBorder', 'tab.border', 'contrastBorder', 'input.border']],
  ['--color-mg-border-subtle', ['panel.border', 'editorGroup.border', 'editorGroupHeader.tabsBorder', 'tab.border', 'input.border', 'contrastBorder']],
  ['--color-mg-border-ctrl', ['input.border', 'dropdown.border', 'panel.border', 'editorGroup.border', 'contrastBorder']],
  ['--color-mg-border-emph', ['focusBorder', 'input.border', 'panel.border', 'contrastBorder']],
  ['--color-mg-border-pop', ['editorWidget.border', 'menu.border', 'dropdown.border', 'panel.border', 'contrastBorder']],
  // Texto
  ['--color-mg-text', ['foreground', 'editor.foreground', 'sideBar.foreground']],
  ['--color-mg-body', ['editor.foreground', 'foreground', 'sideBar.foreground']],
  ['--color-mg-body2', ['foreground', 'editor.foreground', 'sideBar.foreground']],
  ['--color-mg-sec', ['descriptionForeground', 'editorLineNumber.foreground', 'foreground', 'editor.foreground']],
  ['--color-mg-sec2', ['foreground', 'editor.foreground']],
  ['--color-mg-ter', ['descriptionForeground', 'disabledForeground', 'editorLineNumber.foreground', 'foreground']],
  ['--color-mg-muted', ['disabledForeground', 'descriptionForeground', 'editorLineNumber.foreground']],
  ['--color-mg-disabled', ['disabledForeground', 'editorLineNumber.foreground', 'descriptionForeground']],
  // Neutros funcionales / acento
  ['--color-mg-activity', ['foreground', 'editor.foreground', 'activityBar.foreground']],
  ['--color-mg-focus', ['focusBorder', 'button.background', 'textLink.foreground', 'activityBarBadge.background', 'progressBar.background', 'editorCursor.foreground']],
  ['--color-mg-fill', ['progressBar.background', 'button.background', 'activityBarBadge.background', 'focusBorder']],
  ['--color-mg-primary', ['button.background', 'textLink.foreground', 'activityBarBadge.background', 'focusBorder']],
  ['--color-mg-primary-ink', ['button.foreground', 'activityBarBadge.foreground', 'editor.background']],
  ['--color-mg-icon', ['icon.foreground', 'activityBar.foreground', 'descriptionForeground', 'foreground']],
  // Error
  ['--color-mg-danger', ['errorForeground', 'editorError.foreground', 'list.errorForeground', 'inputValidation.errorBorder']],
  ['--color-mg-danger-emph', ['inputValidation.errorBorder', 'errorForeground', 'editorError.foreground']],
];

// Tokens que pinta la vista previa de la tienda de temas (ThemePreviewMock). Si no se resuelven los dos
// ESTRUCTURALES (fondo y texto) o quedan demasiado pocos, la maqueta sale casi entera de colores de
// respaldo: no representa al tema y engaña mas que ayuda -> se muestra "sin vista previa".
const THUMBNAIL_TOKENS: readonly string[] = [
  '--color-mg-window',
  '--color-mg-panel',
  '--color-mg-body',
  '--color-mg-sec',
  '--color-mg-sel',
  '--color-mg-focus',
  '--color-mg-code',
  '--color-mg-border',
  '--color-mg-border-subtle',
];
const THUMBNAIL_ESSENTIAL_TOKENS: readonly string[] = ['--color-mg-window', '--color-mg-body'];
const MIN_RESOLVED_THUMBNAIL_TOKENS = 4;

export function hasReliableThumbnail(tokens: Readonly<Record<string, string>>): boolean {
  if (!THUMBNAIL_ESSENTIAL_TOKENS.every((token) => tokens[token] !== undefined)) return false;
  return THUMBNAIL_TOKENS.filter((token) => tokens[token] !== undefined).length >= MIN_RESOLVED_THUMBNAIL_TOKENS;
}

// Mapea un tema resuelto a { type, tokens }. Solo emite los tokens con color valido de origen.
export function mapVscodeTheme(theme: FetchedVscodeTheme): MappedTheme {
  const tokens: Record<string, string> = {};
  for (const [token, candidates] of TOKEN_MAP) {
    const value = firstColor(theme.colors, candidates);
    if (value !== null) tokens[token] = value;
  }
  return { type: resolveType(theme), tokens };
}

// Tipo del tema: el declarado en el fichero manda; si no, se deduce del uiTheme del manifest.
function resolveType(theme: FetchedVscodeTheme): 'light' | 'dark' {
  if (theme.type === 'light' || theme.type === 'dark') return theme.type;
  return theme.uiTheme === 'vs' || theme.uiTheme === 'hc-light' ? 'light' : 'dark';
}

// Primer candidato presente y con color normalizable; null si ninguno.
function firstColor(colors: Readonly<Record<string, string>>, candidates: readonly string[]): string | null {
  for (const key of candidates) {
    const raw = colors[key];
    if (raw === undefined) continue;
    const normalized = normalizeColor(raw);
    if (normalized !== null) return normalized;
  }
  return null;
}

// Normaliza un color hex de VS Code a #rrggbb OPACO. Acepta #rgb, #rgba, #rrggbb, #rrggbbaa; expande
// las formas cortas y DESCARTA el alpha (los tokens de Mage se usan como colores solidos). Cualquier
// otra cosa (nombres, funciones) -> null: no se inyecta (evita romper/inyectar en el <style>).
export function normalizeColor(value: string): string | null {
  const match = /^#([0-9a-fA-F]{3,8})$/.exec(value.trim());
  if (match === null) return null;
  const hex = match[1] ?? '';
  if (hex.length === 3 || hex.length === 4) {
    const r = hex[0], g = hex[1], b = hex[2];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (hex.length === 6 || hex.length === 8) {
    return `#${hex.slice(0, 6)}`.toLowerCase();
  }
  return null; // longitudes 5 o 7 no son colores hex validos
}

// --- Colores de sintaxis para la vista previa ----------------------------------------------------

// Tres colores representativos del resaltado del tema, para que el bloque de codigo de la vista previa
// se parezca al que vera el usuario en el chat en vez de ser una barra de color plano.
export interface PreviewSyntaxColors {
  readonly keyword: string | null;
  readonly string: string | null;
  readonly comment: string | null;
}

// Scope TextMate que se busca para cada hueco. Se queda con la PRIMERA regla cuyo scope empiece por el
// prefijo (en TextMate `keyword.control` es un `keyword`), que es lo que hace un tema tipico.
const PREVIEW_SCOPES: readonly (readonly [keyof PreviewSyntaxColors, string])[] = [
  ['keyword', 'keyword'],
  ['string', 'string'],
  ['comment', 'comment'],
];

// Extrae los colores de sintaxis de las reglas `tokenColors` del tema. PURO. Un tema sin reglas (o sin
// esa familia de scopes) devuelve null en el hueco correspondiente: el llamante pinta ese trozo con un
// color de UI del propio tema en vez de inventarse uno.
export function pickPreviewSyntaxColors(tokenColors: readonly VscodeTokenColor[] | undefined): PreviewSyntaxColors {
  const rules = tokenColors ?? [];
  const out: Record<keyof PreviewSyntaxColors, string | null> = { keyword: null, string: null, comment: null };
  for (const [slot, prefix] of PREVIEW_SCOPES) {
    out[slot] = findScopeColor(rules, prefix);
  }
  return out;
}

// Primer foreground valido de una regla cuyo scope case con el prefijo (string o lista de strings).
function findScopeColor(rules: readonly VscodeTokenColor[], prefix: string): string | null {
  for (const rule of rules) {
    const foreground = rule.settings.foreground;
    if (foreground === undefined) continue;
    const scopes = typeof rule.scope === 'string' ? rule.scope.split(',') : (rule.scope ?? []);
    if (!scopes.some((scope) => scope.trim().startsWith(prefix))) continue;
    const normalized = normalizeColor(foreground);
    if (normalized !== null) return normalized;
  }
  return null;
}
