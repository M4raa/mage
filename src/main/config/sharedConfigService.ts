import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  describeStaleWrite,
  writeAtomicIfUnchanged,
  type AtomicWriteDeps,
  type FileSnapshot,
} from '../os/atomicFile';
import type { McpScope } from '@shared/mcp';
import { ONLY_IN_SERVERS_KEY, scopeOf } from './mcpInventory';
import { mergeServerLists, resolveCommonServers, type ResolvedMcpList } from './mcpResolved';

// Configuracion COMUN a todas las cuentas (D1 Fase 1): dos ficheros propiedad exclusiva de Mage,
// FUERA de cualquier CLAUDE_CONFIG_DIR (viven en app.getPath('userData')/shared-config/). El CLI
// nunca los toca ni los conoce; se leen frescos en cada lanzamiento y se inyectan por flag
// (--mcp-config/--settings), nunca enlazando ni escribiendo nada dentro del config dir de una
// cuenta. Ver PLAN-D1-CONFIGURACION.md para el diseno completo (Diseno A). Fase 2 anade lectura del
// texto crudo + guardado (editor de Configuracion), sobre el mismo servicio.

// mcp-common.json: forma { mcpServers: {...} }, igual que .mcp.json. Sin restriccion de forma para
// el contenido de cada servidor (el CLI ya lo valida al arrancar); solo se exige el nivel superior.
export interface McpCommonConfig {
  readonly path: string;
  readonly mcpServers: Record<string, unknown>;
  // «Solo en…» de cada comun (clave propia de Mage `mageOnlyIn`). Ausente = en todos.
  readonly onlyIn: Readonly<Record<string, McpScope>>;
}

// settings-common.json: restringido POR FORMA a solo hooks y permissions.allow/deny (validado aqui,
// nunca por convencion). Es la invariante que sostiene "nada se pisa": estas dos claves se
// CONCATENAN entre fuentes en vez de sustituirse; cualquier otra clave de settings.json (model,
// statusLine, permissions.defaultMode...) se comportaria como override si se compartiera asi.
export interface SettingsCommonConfig {
  readonly hooks?: Record<string, unknown>;
  readonly permissions?: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
}

export type SharedConfigLogFn = (level: 'warn', message: string) => void;

// Resultado de guardar el texto de uno de los dos ficheros comunes. `stale` NO es un error de
// programacion (no lanza): es el caso normal de que alguien mas tocara el fichero, y el llamante
// necesita el mensaje para decirselo al usuario.
export type SaveTextOutcome =
  | { readonly status: 'saved'; readonly warnings: readonly string[] }
  | { readonly status: 'stale'; readonly message: string };

// Dependencias inyectables (FS) -> testable sin disco real, mismo patron que LinkService/SettingsStore.
// Las de escritura (AtomicWriteDeps) + ensureDir solo las usa el guardado del editor (Fase 2); los
// loaders de solo-lectura (Fase 1) no las tocan.
export interface SharedConfigDeps extends AtomicWriteDeps {
  readonly ensureDir: (path: string) => void;
  readonly log: SharedConfigLogFn;
}

const HOOKS_FIELD_SCHEMA = z.record(z.string(), z.unknown());
const PERMISSIONS_RULE_LIST_SCHEMA = z.array(z.string());

// Texto con el que arranca el editor cuando el fichero todavia no existe: JSON valido y vacio, para
// que "Guardar" sin tocar nada no falle por JSON invalido.
const EMPTY_JSON_TEXT = '{}';
// mcp-common.json exige la forma {mcpServers:{...}} incluso vacio: "{}" a secas dispararia el aviso
// de forma invalida ya en el primer render, antes de que el usuario toque nada.
const EMPTY_MCP_COMMON_TEXT = '{"mcpServers": {}}';

// --- Parseo puro (sin FS): reutilizado por los loaders de disco Y por el editor de Configuracion --

export interface McpCommonParseResult {
  readonly value: { readonly mcpServers: Record<string, unknown>; readonly onlyIn: Readonly<Record<string, McpScope>> } | null;
  readonly warnings: readonly string[];
}

// Interpreta el TEXTO crudo de mcp-common.json. `value === null` significa "inservible" (JSON
// invalido o sin la forma esperada); en ese caso `warnings` explica por que.
export function parseMcpCommonJson(raw: string): McpCommonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { value: null, warnings: [`JSON invalido: ${describeError(error)}`] };
  }
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    return { value: null, warnings: ['No tiene la forma {"mcpServers": {...}}; se ignora entero'] };
  }
  const onlyIn = isRecord(parsed[ONLY_IN_SERVERS_KEY]) ? parsed[ONLY_IN_SERVERS_KEY] : {};
  return { value: { mcpServers: parsed.mcpServers, onlyIn: Object.fromEntries(Object.entries(onlyIn).map(([name, raw]) => [name, scopeOf(raw)])) }, warnings: [] };
}

export interface SettingsCommonParseResult {
  readonly value: SettingsCommonConfig | null;
  readonly warnings: readonly string[];
}

// Interpreta el TEXTO crudo de settings-common.json. `value === null` solo si el JSON es invalido o
// no es un objeto (fallo total); las claves rechazadas por FORMA (fuera de hooks/permissions.allow/
// deny) se descartan una a una sin invalidar el resto, cada descarte con su propio warning.
export function parseSettingsCommonJson(raw: string): SettingsCommonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { value: null, warnings: [`JSON invalido: ${describeError(error)}`] };
  }
  if (!isRecord(parsed)) {
    return { value: null, warnings: ['No es un objeto JSON; se ignora entero'] };
  }

  const warnings: string[] = [];
  const result: { hooks?: Record<string, unknown>; permissions?: SettingsCommonConfig['permissions'] } = {};
  for (const key of Object.keys(parsed)) {
    if (key === 'hooks') {
      const hooks = parseHooksField(parsed.hooks, warnings);
      if (hooks !== undefined) result.hooks = hooks;
      continue;
    }
    if (key === 'permissions') {
      const permissions = parsePermissionsField(parsed.permissions, warnings);
      if (permissions !== undefined) result.permissions = permissions;
      continue;
    }
    warnings.push(
      `Clave "${key}" descartada: solo se admiten "hooks" y "permissions.allow/deny" ` +
        '(cualquier otra se comportaria como override sobre lo propio de la cuenta)',
    );
  }
  return { value: result, warnings };
}

function parseHooksField(value: unknown, warnings: string[]): Record<string, unknown> | undefined {
  const result = HOOKS_FIELD_SCHEMA.safeParse(value);
  if (!result.success) {
    warnings.push(`Clave "hooks" invalida; se descarta: ${result.error.message}`);
    return undefined;
  }
  return result.data;
}

function parsePermissionsField(value: unknown, warnings: string[]): SettingsCommonConfig['permissions'] | undefined {
  if (!isRecord(value)) {
    warnings.push('Clave "permissions" invalida; se descarta (debe ser un objeto)');
    return undefined;
  }
  const permissions: { allow?: readonly string[]; deny?: readonly string[] } = {};
  for (const subKey of Object.keys(value)) {
    if (subKey === 'allow' || subKey === 'deny') {
      const rules = PERMISSIONS_RULE_LIST_SCHEMA.safeParse(value[subKey]);
      if (rules.success) permissions[subKey] = rules.data;
      else warnings.push(`"permissions.${subKey}" invalido; se descarta: ${rules.error.message}`);
      continue;
    }
    warnings.push(
      `Clave "permissions.${subKey}" descartada: solo se admite allow/deny ` +
        '(otras claves de permissions, como defaultMode, se comportarian como override)',
    );
  }
  return Object.keys(permissions).length > 0 ? permissions : undefined;
}

// Nombres de servidor que aporta mcp-common.json (para marcar "comun" vs "propio" en el Inspector,
// Fase 2). [] si no hay fichero comun o no tiene ningun servidor. Acepta tanto el resultado de
// loadMcpCommon (con `path`) como el de parseMcpCommonJson (sin `path`): solo mira `mcpServers`.
export function mcpCommonServerNames(mcpCommon: { readonly mcpServers: Record<string, unknown> } | null): readonly string[] {
  return mcpCommon === null ? [] : Object.keys(mcpCommon.mcpServers);
}

// --- Importacion inicial de mcp-common.json (P-026 2.5, D10) ------------------------------------

// Mage es la fuente de verdad de los MCP compartidos. La primera vez (sin mcp-common.json) se importa
// lo que el usuario ya tenia: `~/.claude/mcp-shared.json` —que hasta ahora regeneraba su script de
// PowerShell con la union de las cuentas— y los `mcpServers` de ambito usuario del `.claude.json` de
// cada cuenta. De `.claude.json` se lee SOLO `mcpServers`: `oauthAccount`, `userID` y demas no salen
// nunca de esta funcion. En colision de nombre con configuracion distinta gana `mcp-shared.json` (y
// entre cuentas, la primera: la principal va delante), y cada colision deja su nota.
export interface McpImportSource {
  readonly label: string; // para las notas: 'mcp-shared.json', '.claude-p'…
  readonly text: string | null; // null = el fichero no existe
}

export interface McpImportResult {
  readonly mcpServers: Record<string, unknown>;
  readonly notes: readonly string[];
}

// El script de PowerShell escribe `mcp-shared.json` con BOM (medido en la maquina del usuario), y
// `JSON.parse` no lo acepta.
const UTF8_BOM = /^﻿/;

export function buildMcpCommonImport(shared: McpImportSource, accounts: readonly McpImportSource[]): McpImportResult {
  const servers: Record<string, unknown> = {};
  const origin = new Map<string, string>();
  const notes: string[] = [];
  for (const source of [shared, ...accounts]) {
    for (const [name, config] of Object.entries(mcpServersOf(source))) {
      const previous = origin.get(name);
      if (previous === undefined) {
        servers[name] = config;
        origin.set(name, source.label);
      } else if (JSON.stringify(servers[name]) !== JSON.stringify(config)) {
        notes.push(`«${name}» está en ${previous} y en ${source.label} con otra configuración: se queda la de ${previous}.`);
      }
    }
  }
  return { mcpServers: servers, notes };
}

// `mcpServers` de una fuente. Ausente o sin ese campo -> ninguno. JSON invalido o `mcpServers` que no es
// un objeto -> LANZA con la fuente y su tamaño (nunca el texto: lleva los `env` de los servidores).
function mcpServersOf(source: McpImportSource): Record<string, unknown> {
  if (source.text === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.text.replace(UTF8_BOM, ''));
  } catch (error) {
    throw new Error(`${source.label} no es JSON valido (${describeError(error)}): ${source.text.length} caracteres`);
  }
  if (!isRecord(parsed) || parsed.mcpServers === undefined) return {};
  if (!isRecord(parsed.mcpServers)) {
    throw new Error(`${source.label}: "mcpServers" no es un objeto (${typeof parsed.mcpServers})`);
  }
  return parsed.mcpServers;
}

// --- Servicio con FS inyectado ------------------------------------------------------------------

export class SharedConfigService {
  constructor(private readonly deps: SharedConfigDeps) {}

  // Tolerante por diseno: fichero ausente, JSON invalido o forma equivocada -> null, NUNCA lanza (D1
  // Fase 1 §5.1). Un fichero comun mal escrito no puede tirar abajo el arranque de una sesion.
  loadMcpCommon(path: string): McpCommonConfig | null {
    if (!this.deps.exists(path)) return null;
    const raw = this.readFileTolerant(path);
    if (raw === null) return null;

    const { value, warnings } = parseMcpCommonJson(raw);
    for (const warning of warnings) this.deps.log('warn', `mcp-common.json en "${path}": ${warning}`);
    return value === null ? null : { path, ...value };
  }

  // Zod acepta SOLO hooks/permissions.allow/permissions.deny; cualquier otra clave (top-level o
  // dentro de permissions) se descarta con un warn explicito de que y por que, nunca en silencio.
  loadSettingsCommon(path: string): SettingsCommonConfig | null {
    if (!this.deps.exists(path)) return null;
    const raw = this.readFileTolerant(path);
    if (raw === null) return null;

    const { value, warnings } = parseSettingsCommonJson(raw);
    for (const warning of warnings) this.deps.log('warn', `settings-common.json en "${path}": ${warning}`);
    return value;
  }

  // Texto crudo para el editor de Configuracion (Fase 2): ausente/illegible -> un JSON valido POR
  // FICHERO (no una cadena vacia, que fallaria el JSON.parse; ni "{}" a secas para mcp-common, que
  // dispararia el aviso de forma invalida ya en el primer render sin que el usuario tocara nada).
  readMcpCommonText(path: string): string {
    return this.readRawTextOrDefault(path, EMPTY_MCP_COMMON_TEXT);
  }

  readSettingsCommonText(path: string): string {
    return this.readRawTextOrDefault(path, EMPTY_JSON_TEXT);
  }

  // Bytes EXACTOS en disco (null = ausente), que es lo que hay que pasarle luego a save*Text como
  // `expected`. No se puede reutilizar read*Text para esto: ese devuelve un JSON de arranque cuando el
  // fichero no existe, y entonces el compare-and-swap creeria que el fichero contenia ese texto.
  // Ilegible (permisos, disco) -> null con un warn: el guardado posterior se rechazara, que es el
  // resultado correcto cuando no podemos saber contra que estamos comparando.
  readBaseline(path: string): FileSnapshot {
    if (!this.deps.exists(path)) return null;
    try {
      return this.deps.readFile(path);
    } catch (error) {
      this.deps.log('warn', `No se pudo leer "${path}" para comparar antes de guardar: ${describeError(error)}`);
      return null;
    }
  }

  // Guarda mcp-common.json TAL CUAL lo escribio el usuario (nunca se reescribe/filtra el JSON): solo
  // se rechaza si es inservible (JSON invalido o sin la forma esperada), porque ESE fichero lo lee
  // CUALQUIER lanzamiento de CUALQUIER cuenta -- una escritura invalida rompe D1 para todos, no solo
  // para quien edito. Devuelve los avisos (formas descartadas) para que la UI los muestre igual.
  saveMcpCommonText(path: string, text: string, expected: FileSnapshot): SaveTextOutcome {
    const { value, warnings } = parseMcpCommonJson(text);
    if (value === null) {
      // El TEXTO no viaja en el mensaje (B10): estos ficheros llevan los `env` de los servidores
      // MCP (GITHUB_TOKEN y compania) y el mensaje sale por stdout del main Y cruza el IPC hasta
      // pintarse en Configuracion. `redact.ts` enmascara por nombre de campo dentro de `data`,
      // nunca dentro de `message`. Se reporta la FORMA, que es lo unico que ayuda a arreglarlo.
      throw new Error(`mcp-common.json invalido, no se guarda (${warnings.join('; ')}): ${text.length} caracteres`);
    }
    return this.writeGuarded(path, text, expected, warnings);
  }

  saveSettingsCommonText(path: string, text: string, expected: FileSnapshot): SaveTextOutcome {
    const { value, warnings } = parseSettingsCommonJson(text);
    if (value === null) {
      // El TEXTO no viaja en el mensaje (B10): estos ficheros llevan los `env` de los servidores
      // MCP (GITHUB_TOKEN y compania) y el mensaje sale por stdout del main Y cruza el IPC hasta
      // pintarse en Configuracion. `redact.ts` enmascara por nombre de campo dentro de `data`,
      // nunca dentro de `message`. Se reporta la FORMA, que es lo unico que ayuda a arreglarlo.
      throw new Error(`settings-common.json invalido, no se guarda (${warnings.join('; ')}): ${text.length} caracteres`);
    }
    return this.writeGuarded(path, text, expected, warnings);
  }

  // Crea mcp-common.json con la importacion (D10) SOLO si no existe: una vez que existe, aunque este
  // vacio, es del usuario y no se vuelve a importar. Devuelve las notas, o null si no importo nada.
  importMcpCommonIfMissing(path: string, shared: McpImportSource, accounts: readonly McpImportSource[]): readonly string[] | null {
    if (this.deps.exists(path)) return null;
    const { mcpServers, notes } = buildMcpCommonImport(shared, accounts);
    const outcome = this.writeGuarded(path, JSON.stringify({ mcpServers }, null, 2), null, []);
    if (outcome.status === 'stale') throw new Error(outcome.message);
    return notes;
  }

  // Lectura+parseo tolerante compartida por los dos loaders: I/O -> warn + null (JSON invalido lo
  // decide el parser puro, que necesita el texto completo para explicar el motivo).
  private readFileTolerant(path: string): string | null {
    try {
      return this.deps.readFile(path);
    } catch (error) {
      this.deps.log('warn', `No se pudo leer "${path}": ${describeError(error)}`);
      return null;
    }
  }

  private readRawTextOrDefault(path: string, defaultText: string): string {
    if (!this.deps.exists(path)) return defaultText;
    try {
      return this.deps.readFile(path);
    } catch (error) {
      this.deps.log('warn', `No se pudo leer "${path}" para el editor: ${describeError(error)}`);
      return defaultText;
    }
  }

  // Escritura atomica CONDICIONAL: un fichero a medias no puede quedar nunca en el sitio real (lo lee
  // cualquier lanzamiento de cualquier cuenta), y ademas no se pisa lo que haya cambiado en disco desde
  // que el editor cargo el fichero. Crea shared-config/ si es la primera vez que se guarda algo.
  //
  // A diferencia de los stores propiedad exclusiva de Mage (settings/workspace/panels), estos DOS
  // ficheros los edita tambien el usuario a mano y puede tocarlos otra instancia de Mage, asi que aqui
  // "el ultimo que escribe gana" significa perder trabajo ajeno en silencio.
  private writeGuarded(
    path: string,
    text: string,
    expected: FileSnapshot,
    warnings: readonly string[],
  ): SaveTextOutcome {
    this.deps.ensureDir(dirname(path));
    let result;
    try {
      result = writeAtomicIfUnchanged(this.deps, path, text, expected);
    } catch (error) {
      // No se pudo ni comprobar el estado actual (permisos, disco). Fail-closed: no se escribe.
      const message = `No se pudo comprobar si "${path}" habia cambiado, no se ha guardado nada: ${describeError(error)}`;
      this.deps.log('warn', message);
      return { status: 'stale', message };
    }
    if (result.status === 'stale') {
      // Se dice lo que pasa DESPUES a proposito: tras este rechazo el editor recarga la base, asi que
      // un segundo "Guardar" si sobrescribiria el cambio ajeno. Avisar una vez y dejar decidir al
      // usuario es el contrato; que vuelva a pulsar sin saberlo, no.
      const message =
        `${describeStaleWrite(path, expected, result.actual)} Tu texto sigue en el editor sin guardar: ` +
        'revisa el contenido nuevo antes de volver a pulsar Guardar, porque el segundo intento SI lo sobrescribira.';
      this.deps.log('warn', message);
      return { status: 'stale', message };
    }
    return { status: 'saved', warnings };
  }
}

// Lo compartido de MCP en formato neutro (lo traduce cada adapter): los comunes activos con su «Solo
// en…» mas las extensiones activas. PURA (los loaders ya leyeron y validaron).
export function resolveSharedMcp(mcpCommon: McpCommonConfig | null, extensions: ResolvedMcpList): ResolvedMcpList {
  const common = mcpCommon === null ? { servers: [], warnings: [] } : resolveCommonServers(mcpCommon.mcpServers, mcpCommon.onlyIn);
  return mergeServerLists(common, extensions);
}

// Fragmento de `--settings` (hooks y permisos comunes) solo si sobrevive >=1 clave. Es de Claude: los
// demas CLI no tienen un equivalente medido.
export function buildSettingsFragment(settingsCommon: SettingsCommonConfig | null): Record<string, unknown> | null {
  if (settingsCommon === null) return null;
  const fragment: Record<string, unknown> = {};
  if (settingsCommon.hooks !== undefined && Object.keys(settingsCommon.hooks).length > 0) {
    fragment.hooks = settingsCommon.hooks;
  }
  const permissions = buildPermissionsFragment(settingsCommon.permissions);
  if (permissions !== null) fragment.permissions = permissions;
  return Object.keys(fragment).length > 0 ? fragment : null;
}

function buildPermissionsFragment(permissions: SettingsCommonConfig['permissions']): Record<string, unknown> | null {
  if (permissions === undefined) return null;
  const result: Record<string, unknown> = {};
  if (permissions.allow !== undefined && permissions.allow.length > 0) result.allow = permissions.allow;
  if (permissions.deny !== undefined && permissions.deny.length > 0) result.deny = permissions.deny;
  return Object.keys(result).length > 0 ? result : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Deps con el FS real. El log se INYECTA (sin default silencioso): el llamador decide por donde sale
// un descarte (en la app, el LogBus), mismo patron que defaultLinkDeps.
export function defaultSharedConfigDeps(log: SharedConfigLogFn): SharedConfigDeps {
  return {
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf-8'),
    writeFile: (path, data) => writeFileSync(path, data, 'utf-8'),
    rename: renameSync,
    // Necesario para el compare-and-swap: si el guardado se rechaza por cambio ajeno, el temporal ya
    // escrito hay que borrarlo o quedaria un `.tmp` huerfano en shared-config/.
    removeFile: (path) => rmSync(path, { force: true }),
    ensureDir: (path) => mkdirSync(path, { recursive: true }),
    tempSuffix: () => randomUUID(),
    log,
  };
}
