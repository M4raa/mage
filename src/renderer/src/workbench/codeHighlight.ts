import type { ImportedTheme } from '@shared/settings';
import type { VscodeTokenColor } from '@shared/themeMarket';
import type { RawThemeSetting, ThemeRegistrationRaw } from 'shiki/types';

// Logica PURA del resaltado de sintaxis del chat (F4): (a) que gramatica corresponde al lenguaje
// declarado en la valla ```lang y (b) como se convierte un tema importado de VS Code en un tema de
// shiki. Sin DOM, sin red y sin cargar shiki -> testeable en Vitest. El resaltador real (WASM de
// oniguruma + gramaticas, todo en diferido) vive en highlighter.ts.

// Gramaticas registrables. Lista ACOTADA a proposito y cargada DE UNA EN UNA (highlighter.ts): cada
// gramatica TextMate pesa lo suyo (medido en node_modules: typescript 190 KB, tsx 186 KB, python 77 KB,
// markdown 65 KB, html 62 KB, css 52 KB, shellscript 45 KB, sql 25 KB, yaml 12 KB, json/diff ~3 KB) y
// Claude Code midio 100-200 ms y ~50 MB por registrar las 190+ de highlight.js de golpe ("several× that
// on Windows"). Medido aqui: registrar las 11 cuesta 8 ms en total y ninguna se registra hasta que
// aparece el primer bloque de ese lenguaje (ver highlighter.ts para el desglose por gramatica).
// ponytail: 11 gramaticas cubren lo que escribe un agente de codigo en este proyecto; el techo es que
// cualquier otro lenguaje sale en texto plano. Subirlo = una entrada en LANG_LOADERS (highlighter.ts)
// mas sus alias en LANG_ALIASES.
export const HIGHLIGHT_LANGS = [
  'typescript',
  'tsx',
  'json',
  'shellscript',
  'python',
  'html',
  'css',
  'markdown',
  'yaml',
  'sql',
  'diff',
] as const;

export type HighlightLang = (typeof HIGHLIGHT_LANGS)[number];

// Alias -> gramatica. `js`/`mjs`/`cjs` usan la gramatica de TypeScript (es un superconjunto de
// JavaScript) para no cargar dos gramaticas casi identicas de ~185 KB cada una; `jsx` usa `tsx` por lo
// mismo. Lo que no este aqui (ni sea el nombre de una gramatica de HIGHLIGHT_LANGS) cae a texto plano.
const LANG_ALIASES: Readonly<Record<string, HighlightLang>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'typescript',
  mjs: 'typescript',
  cjs: 'typescript',
  javascript: 'typescript',
  node: 'typescript',
  jsx: 'tsx',
  json5: 'json',
  jsonc: 'json',
  sh: 'shellscript',
  bash: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  console: 'shellscript',
  py: 'python',
  python3: 'python',
  htm: 'html',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  patch: 'diff',
};

const LANG_NAMES: ReadonlySet<string> = new Set(HIGHLIGHT_LANGS);

// Resuelve el lenguaje declarado en la valla a una gramatica soportada. Devuelve null (=> texto plano)
// para vacio, null y cualquier lenguaje que no se registre: shiki LANZA con una gramatica no cargada
// (verificado: `ShikiError: Language 'brainfuck' not found`), asi que este filtro es la guarda.
// Tolera la info extra de la valla (```ts title="a.ts" -> 'ts') quedandose con el primer token.
export function resolveHighlightLang(lang: string | null): HighlightLang | null {
  if (lang === null) return null;
  const first = lang.trim().toLowerCase().split(/[\s,{]/)[0] ?? '';
  if (first.length === 0) return null;
  if (LANG_NAMES.has(first)) return first as HighlightLang;
  return LANG_ALIASES[first] ?? null;
}

// Lenguaje deducido de la EXTENSION de una ruta o nombre de fichero. Lo consumen el panel de Ficheros,
// la previsualizacion de lectura del chat y el diff: los tres tenian (o iban a tener) su propia copia.
// Devuelve el texto de la extension tal cual —`resolveHighlightLang` ya traduce los alias y descarta lo
// que no tenga gramatica— y null cuando no hay extension que mirar.
export function langFromPath(path: string | null): string | null {
  if (path === null) return null;
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? null : name.slice(dot + 1);
}

// --- Temas -------------------------------------------------------------------------------------

// Temas de serie de shiki para los dos temas base de Mage. Neutros y de contraste alto, que es lo que
// pega con la paleta gris de Mage (--color-mg-code #141414 en oscuro / #f0f0f2 en claro).
export const SHIKI_THEME_DARK = 'github-dark-default';
export const SHIKI_THEME_LIGHT = 'github-light-default';

// Tema de shiki construido desde un tema importado: como `ThemeRegistrationRaw` pero con `name` seguro.
export type ImportedShikiTheme = ThemeRegistrationRaw & { readonly name: string };

// Tema que usara el resaltador. `registration` es null cuando el tema es uno de serie (basta su nombre,
// highlighter.ts sabe importarlo); si no, lleva el tema de VS Code importado listo para `loadTheme`.
export interface ShikiThemeSpec {
  readonly name: string;
  readonly registration: ImportedShikiTheme | null;
}

// Elige el tema del resaltador: el tema importado activo si aporta `tokenColors` utilizables, y si no el
// tema de serie que corresponda al tema base resuelto (claro/oscuro).
export function resolveShikiTheme(active: ImportedTheme | null, base: 'light' | 'dark'): ShikiThemeSpec {
  const registration = active === null ? null : buildImportedShikiTheme(active);
  if (registration !== null) return { name: registration.name, registration };
  return { name: base === 'light' ? SHIKI_THEME_LIGHT : SHIKI_THEME_DARK, registration: null };
}

// Convierte un tema importado en un tema de shiki. Devuelve null si no queda ni una regla de token
// utilizable: entonces resaltar con el es imposible (saldria todo del color de fondo) y es mejor caer al
// tema de serie. Los `tokenColors` viajan TAL CUAL (asi el resaltado usa los colores reales del tema);
// solo se saneia la forma, porque app-settings.json es editable a mano.
export function buildImportedShikiTheme(imported: ImportedTheme): ImportedShikiTheme | null {
  const settings = toThemeSettings(imported.tokenColors);
  if (settings.length === 0) return null;
  const colors: Record<string, string> = {};
  const foreground = imported.tokens['--color-mg-body'];
  const background = imported.tokens['--color-mg-code'];
  if (foreground !== undefined) colors['editor.foreground'] = foreground;
  if (background !== undefined) colors['editor.background'] = background;
  return {
    name: shikiThemeName(imported, settings.length),
    type: imported.type,
    colors,
    settings,
  };
}

// Nombre con el que shiki registra el tema. Incluye el numero de reglas para que re-importar el MISMO id
// con otro contenido (una version nueva de la extension usa el mismo id "ovsx:<ns>.<name>") no reutilice
// el tema ya cargado en la sesion.
// ponytail: si la version nueva trae EXACTAMENTE el mismo numero de reglas, el codigo sigue con los
// colores anteriores hasta reiniciar. Subir el techo = versionar el id del tema importado.
function shikiThemeName(imported: ImportedTheme, ruleCount: number): string {
  return `mage:${imported.id}:${ruleCount}`;
}

// Saneia las reglas de token a la forma que espera shiki. Descarta las que no aportan estilo o cuyo
// scope no es string/lista de strings: shiki las pasa al Registry de TextMate y una entrada rara ahi
// rompe el tema entero. Devuelve un array NUEVO y mutable (shiki inserta su regla global al frente).
function toThemeSettings(tokenColors: readonly VscodeTokenColor[] | undefined): RawThemeSetting[] {
  if (tokenColors === undefined) return [];
  const out: RawThemeSetting[] = [];
  for (const entry of tokenColors) {
    const style = toTokenStyle(entry);
    if (style === null) continue;
    const scope = toScope(entry?.scope);
    out.push(scope === null ? { settings: style } : { scope, settings: style });
  }
  return out;
}

// Estilo de una regla: solo campos string. null si la regla no dice nada (no pintaria nada).
function toTokenStyle(entry: VscodeTokenColor | null | undefined): RawThemeSetting['settings'] | null {
  const raw: unknown = entry?.settings;
  if (raw === null || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const style: { foreground?: string; background?: string; fontStyle?: string } = {};
  if (typeof source['foreground'] === 'string') style.foreground = source['foreground'];
  if (typeof source['background'] === 'string') style.background = source['background'];
  if (typeof source['fontStyle'] === 'string') style.fontStyle = source['fontStyle'];
  return Object.keys(style).length > 0 ? style : null;
}

// Scope de una regla: string o lista de strings. Ausente/invalido -> null (regla global de shiki).
function toScope(scope: unknown): string | string[] | null {
  if (typeof scope === 'string') return scope;
  if (!Array.isArray(scope)) return null;
  const items = (scope as readonly unknown[]).filter((s): s is string => typeof s === 'string');
  return items.length > 0 ? items : null;
}
