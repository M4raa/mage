import type { FetchThemeParams, FetchedVscodeTheme, ThemeSearchItem, VscodeTokenColor } from '@shared/themeMarket';
import { NOT_A_COLOR_THEME } from '@shared/themeMarket';
import { parseJsonc } from './vsixJson';
import { readZipMemberText } from './vsixZip';

// Registro abierto de extensiones (alternativa legal al Marketplace de Microsoft). Solo se leen datos
// de TEMA (colores declarativos); nunca se ejecuta codigo de la extension.
const OPEN_VSX_BASE = 'https://open-vsx.org';
// Resultados por peticion. Open VSX acepta hasta 100 (medido el 2026-09-18 contra el registro real:
// `size=100` devuelve 100 de los 1886 temas). Se pide la pagina GRANDE de una vez —es una sola
// respuesta JSON, sin .vsix— y la rejilla la revela por trozos: asi se puede EXPLORAR sin encadenar
// peticiones y sin descargar nada que no se vaya a ver.
const SEARCH_PAGE_SIZE = 100;
const FETCH_TIMEOUT_MS = 15_000;

// Dependencias inyectables (la red va SIEMPRE en main; el renderer habla por IPC). `fetch` es el
// global de Node, igual que en UsageService/StatusService.
export interface ThemeMarketDeps {
  readonly fetch: typeof globalThis.fetch;
}

// Servicio de temas Open VSX: busca temas y resuelve un tema concreto (manifest + fichero del tema)
// SIN descargar el .vsix (usa los ficheros individuales del endpoint /file/).
export class ThemeMarketService {
  constructor(private readonly deps: ThemeMarketDeps) {}

  // Busca temas (category=Themes). Devuelve un subconjunto seguro para la UI. Una query VACIA no es un
  // error: devuelve los temas MAS DESCARGADOS (asi la pantalla de Apariencia no arranca en blanco).
  // `offset` salta las N primeras coincidencias (paginacion del propio Open VSX) para poder seguir
  // explorando mas alla de la primera pagina.
  async search(query: string, offset = 0): Promise<readonly ThemeSearchItem[]> {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`El offset de busqueda debe ser un entero >= 0; recibido: ${String(offset)}`);
    }
    const clean = query.trim();
    const queryParam = clean.length === 0 ? '' : `query=${encodeURIComponent(clean)}&`;
    const offsetParam = offset === 0 ? '' : `offset=${offset}&`;
    const url = `${OPEN_VSX_BASE}/api/-/search?${queryParam}${offsetParam}category=Themes&size=${SEARCH_PAGE_SIZE}&sortBy=downloadCount&sortOrder=desc`;
    const data = await this.fetchJson(url);
    const extensions = asArray((data as { extensions?: unknown }).extensions);
    return extensions.map(toSearchItem).filter((item): item is ThemeSearchItem => item !== null);
  }

  // Resuelve un tema descargando el `.vsix` (que es un ZIP) y leyendo de dentro el fichero del tema
  // que declara el manifest. Es la via FIABLE: el endpoint `/file/<ruta>` de Open VSX solo sirve
  // ficheros REGISTRADOS (package.json, README…) y da 404 para los anidados como `theme/dracula.json`
  // (verificado con Dracula). Resuelve `include` (un nivel) leyendo otro miembro del mismo ZIP.
  async fetchTheme(params: FetchThemeParams): Promise<FetchedVscodeTheme> {
    const metaUrl = `${OPEN_VSX_BASE}/api/${params.namespace}/${params.name}/${params.version}`;
    const meta = await this.fetchJson(metaUrl);
    const files = (meta as { files?: Record<string, unknown> }).files ?? {};
    const manifestUrl = typeof files['manifest'] === 'string' ? files['manifest'] : `${metaUrl}/file/package.json`;
    const downloadUrl = typeof files['download'] === 'string' ? files['download'] : null;
    if (downloadUrl === null) {
      throw new Error(`Open VSX no expone la descarga del .vsix para ${params.namespace}.${params.name}@${params.version}`);
    }
    const manifest = parseJsonc(await this.fetchText(manifestUrl));
    const contribution = pickThemeContribution(manifest);
    if (contribution === null) {
      throw new Error(`${NOT_A_COLOR_THEME}: la extension ${params.namespace}.${params.name} no contribuye ningun tema de color (Open VSX clasifica los icon themes en la misma categoria)`);
    }
    const vsix = await this.fetchBuffer(downloadUrl);
    const themeJson = parseJsonc(readZipMemberText(vsix, contribution.path));
    const base = readIncludedTheme(themeJson, contribution.path, vsix);
    return {
      label: resolveNlsLabel(contribution.label, vsix),
      uiTheme: contribution.uiTheme,
      type: readType(themeJson) ?? readType(base),
      // Los colores propios pisan a los del `include`; las reglas de token se CONCATENAN (base primero:
      // en TextMate gana la ultima regla que casa, igual que hace VS Code al resolver un include).
      colors: { ...readColors(base), ...readColors(themeJson) },
      tokenColors: [...readTokenColors(base), ...readTokenColors(themeJson)],
    };
  }

  private async fetchJson(url: string): Promise<unknown> {
    return JSON.parse(await this.fetchText(url));
  }

  // GET con timeout y comprobacion de estado; devuelve el cuerpo como texto.
  private async fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.deps.fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Open VSX respondio ${response.status} para ${url}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  // GET binario (el .vsix) con timeout y comprobacion de estado.
  private async fetchBuffer(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.deps.fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Open VSX respondio ${response.status} para ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
}

// Resuelve un label de la forma `%clave%` contra el `package.nls.json` del propio .vsix.
//
// POR QUE: un manifest puede declarar el nombre del tema como clave de traduccion en vez de como
// texto. Medido el 2026-09-17 sobre el registro real: `vscode.theme-defaults` —los temas por defecto
// de VS Code, Dark+ y compañia— declara sus OCHO contribuciones asi, y sin esto la tienda de Mage
// mostraba literalmente "%darkPlusColorThemeLabel%" como nombre del tema.
//
// Tolerante a proposito: si no hay fichero de traducciones, o no esta la clave, o el ZIP no se deja
// leer, se devuelve el label TAL CUAL. Un nombre feo es mucho mejor que un tema que no se puede
// importar, y este camino corre por cada tarjeta de la tienda.
export function resolveNlsLabel(label: string, vsix: Buffer): string {
  const match = /^%(.+)%$/.exec(label.trim());
  if (match === null) return label;
  const key = match[1] ?? '';
  try {
    const strings = parseJsonc(readZipMemberText(vsix, 'package.nls.json'));
    const value = (strings as Record<string, unknown>)?.[key];
    // VS Code admite tanto `"clave": "texto"` como `"clave": { "message": "texto" }`.
    if (typeof value === 'string' && value.length > 0) return value;
    const message = (value as { message?: unknown })?.message;
    return typeof message === 'string' && message.length > 0 ? message : label;
  } catch {
    return label;
  }
}

// Lee el tema al que apunta `include` (si lo hay) del MISMO ZIP. El include es RELATIVO al fichero del
// tema. Devuelve null si no hay include o si esta roto: un include ilegible no debe tumbar el tema
// (se usa solo lo propio, que es mejor que fallar).
function readIncludedTheme(themeJson: unknown, themePath: string, vsix: Buffer): unknown {
  const includePath = readInclude(themeJson);
  if (includePath === null) return null;
  try {
    return parseJsonc(readZipMemberText(vsix, resolveRelative(themePath, includePath)));
  } catch {
    return null;
  }
}

// Resuelve una ruta relativa (posix) respecto al directorio de `from`. Maneja `./` y `../`.
function resolveRelative(from: string, relative: string): string {
  const fromDir = from.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  const segments = `${fromDir}/${relative.replace(/\\/g, '/')}`.split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

// --- Helpers de lectura tolerante (frontera con JSON externo) -----------------------------------

interface ThemeContribution {
  readonly label: string;
  readonly uiTheme: string;
  readonly path: string;
}

// Elige la primera contribucion de tema con `path`. `contributes.themes` puede faltar o venir mal.
function pickThemeContribution(manifest: unknown): ThemeContribution | null {
  const themes = asArray((manifest as { contributes?: { themes?: unknown } })?.contributes?.themes);
  for (const entry of themes) {
    if (entry === null || typeof entry !== 'object') continue;
    const { label, uiTheme, path } = entry as Record<string, unknown>;
    if (typeof path === 'string' && path.length > 0) {
      return {
        label: typeof label === 'string' ? label : 'Tema',
        uiTheme: typeof uiTheme === 'string' ? uiTheme : 'vs-dark',
        path,
      };
    }
  }
  return null;
}

// Extrae `colors` (mapa clave->color string). Ignora entradas no-string.
function readColors(themeJson: unknown): Record<string, string> {
  const raw = (themeJson as { colors?: unknown })?.colors;
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

// Extrae `tokenColors` saneado: solo entradas con `settings` objeto y algun campo de estilo string.
// Es la FRONTERA con JSON externo (F4): lo que salga de aqui viaja por IPC, se persiste y se le pasa a
// shiki, asi que una entrada rara se descarta en vez de propagarse.
function readTokenColors(themeJson: unknown): readonly VscodeTokenColor[] {
  const raw = (themeJson as { tokenColors?: unknown })?.tokenColors;
  const out: VscodeTokenColor[] = [];
  for (const entry of asArray(raw)) {
    if (entry === null || typeof entry !== 'object') continue;
    const { scope, settings } = entry as Record<string, unknown>;
    if (settings === null || typeof settings !== 'object') continue;
    const style = readTokenStyle(settings as Record<string, unknown>);
    if (style === null) continue;
    const cleanScope = readScope(scope);
    out.push(cleanScope === null ? { settings: style } : { scope: cleanScope, settings: style });
  }
  return out;
}

// Estilo de una regla de token: solo campos string. null si la regla no dice NADA util (seria ruido).
function readTokenStyle(settings: Record<string, unknown>): VscodeTokenColor['settings'] | null {
  const style: { foreground?: string; background?: string; fontStyle?: string } = {};
  if (typeof settings['foreground'] === 'string') style.foreground = settings['foreground'];
  if (typeof settings['background'] === 'string') style.background = settings['background'];
  if (typeof settings['fontStyle'] === 'string') style.fontStyle = settings['fontStyle'];
  return Object.keys(style).length > 0 ? style : null;
}

// Scope de una regla: string o lista de strings (VS Code admite ambos). Ausente/invalido -> null.
function readScope(scope: unknown): string | readonly string[] | null {
  if (typeof scope === 'string') return scope;
  if (!Array.isArray(scope)) return null;
  const items = scope.filter((s): s is string => typeof s === 'string');
  return items.length > 0 ? items : null;
}

function readType(themeJson: unknown): string | null {
  const type = (themeJson as { type?: unknown })?.type;
  return type === 'light' || type === 'dark' ? type : null;
}

function readInclude(themeJson: unknown): string | null {
  const include = (themeJson as { include?: unknown })?.include;
  return typeof include === 'string' && include.length > 0 ? include : null;
}

function toSearchItem(raw: unknown): ThemeSearchItem | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['namespace'] !== 'string' || typeof r['name'] !== 'string' || typeof r['version'] !== 'string') {
    return null;
  }
  const files = (r['files'] ?? {}) as Record<string, unknown>;
  return {
    namespace: r['namespace'],
    name: r['name'],
    version: r['version'],
    displayName: typeof r['displayName'] === 'string' ? r['displayName'] : r['name'],
    description: typeof r['description'] === 'string' ? r['description'] : '',
    downloadCount: typeof r['downloadCount'] === 'number' ? r['downloadCount'] : 0,
    iconUrl: typeof files['icon'] === 'string' ? files['icon'] : null,
  };
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
