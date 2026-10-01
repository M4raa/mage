import { join } from 'node:path';
import { z } from 'zod';
import type { McpScope, McpUserConfigField, McpUserConfigType, McpUserConfigValue } from '@shared/mcp';
import { secretRef, secretVarName, type ResolvedStdioServer } from './mcpResolved';

// Extensiones `.mcpb`/`.dxt` de Mage (decision C3-a: Mage las descomprime y las pasa como un servidor
// mas). PURO: manifest, ajustes y resolucion de variables. El FS vive en `mcpExtensionService.ts`.
//
// Formato medido en la extension HuginnDB de Claude Desktop 2.16120.0 (`manifest_version` 0.3) y en el
// esquema publico MCPB: `server.mcp_config` con `${__dirname}`, `${/}`, `${HOME}` y `${user_config.*}`,
// `platform_overrides` por `process.platform` y `user_config` con campos `sensitive`. Esquema propio y
// tolerante: se exige lo que Mage necesita para lanzarla y el resto pasa.

const USER_CONFIG_TYPES = ['string', 'number', 'boolean', 'directory', 'file'] as const;

const USER_CONFIG_FIELD = z
  .object({
    type: z.enum(USER_CONFIG_TYPES).catch('string'),
    title: z.string().catch(''),
    description: z.string().catch(''),
    required: z.boolean().catch(false),
    sensitive: z.boolean().catch(false),
    multiple: z.boolean().catch(false),
    default: z.unknown().optional(),
  })
  .passthrough();

const OVERRIDE = z
  .object({ command: z.string().min(1).optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional() })
  .passthrough();

const MCP_CONFIG = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).catch([]),
    env: z.record(z.string(), z.string()).catch({}),
    platform_overrides: z.record(z.string(), OVERRIDE).catch({}),
  })
  .passthrough();

const MANIFEST = z
  .object({
    manifest_version: z.string().optional(),
    dxt_version: z.string().optional(),
    name: z.string().min(1),
    display_name: z.string().optional().catch(undefined),
    version: z.string().min(1),
    description: z.string().catch(''),
    author: z.object({ name: z.string().catch('') }).passthrough().optional().catch(undefined),
    server: z.object({ type: z.string().catch('binary'), mcp_config: MCP_CONFIG }).passthrough(),
    compatibility: z.object({ platforms: z.array(z.string()).optional().catch(undefined) }).passthrough().optional().catch(undefined),
    user_config: z.record(z.string(), USER_CONFIG_FIELD).catch({}),
  })
  .passthrough();

export type McpbManifest = z.infer<typeof MANIFEST>;
type UserConfigSpec = z.infer<typeof USER_CONFIG_FIELD>;

// Manifest desde su texto. LANZA con que falta (sin el contenido): un manifest que no se entiende no
// se instala, porque el CLI tampoco lo diria (medido: solo `mcpb-invalid-manifest` en el log).
export function parseMcpbManifest(text: string): McpbManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(`manifest.json no es JSON válido: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = MANIFEST.safeParse(parsed);
  if (!result.success) {
    throw new Error(`manifest.json no es un manifest MCPB: ${result.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}`);
  }
  if (result.data.manifest_version === undefined && result.data.dxt_version === undefined) {
    throw new Error('manifest.json no declara manifest_version ni dxt_version');
  }
  return result.data;
}

// Id estable (carpeta y nombre del servidor en las sesiones): el `name` del manifest en minusculas y
// sin nada que no valga en un nombre de fichero ni en `-c mcp_servers.<id>` de codex.
export function extensionIdOf(manifest: McpbManifest): string {
  const id = manifest.name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (id.length === 0) throw new Error(`El nombre de la extensión no sirve como id: ${JSON.stringify(manifest.name)}`);
  return id;
}

export function platformProblem(manifest: McpbManifest, platform: NodeJS.Platform): string | null {
  const platforms = manifest.compatibility?.platforms;
  if (platforms === undefined || platforms.length === 0 || platforms.includes(platform)) return null;
  return `Solo funciona en ${platforms.join(', ')}.`;
}

// --- Ajustes de una extension (extensions-settings/<id>.json) -----------------------------------

const USER_VALUE = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

const SETTINGS = z.object({
  isEnabled: z.boolean().catch(true),
  // SOLO los no sensibles; los sensibles viven en la boveda (`extensionSecretId`).
  userConfig: z.record(z.string(), USER_VALUE).catch({}),
  onlyIn: z.array(z.string()).nullable().catch(null),
});

export type ExtensionSettings = z.infer<typeof SETTINGS>;
export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = { isEnabled: true, userConfig: {}, onlyIn: null };

// Ausente -> por defecto (activa, sin valores). Ilegible -> LANZA: reescribirlo como vacio borraria la
// configuracion del usuario.
export function parseExtensionSettings(text: string | null): ExtensionSettings {
  if (text === null) return DEFAULT_EXTENSION_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Ajustes de extensión ilegibles (${text.length} caracteres): ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = SETTINGS.safeParse(parsed);
  if (!result.success) throw new Error(`Ajustes de extensión con forma inesperada: ${result.error.message}`);
  return result.data;
}

export function extensionSecretId(id: string, key: string): string {
  return `mcp-extension:${id}:${key}`;
}

// --- Formulario de user_config (sin valores sensibles) ------------------------------------------

export function buildUserConfigFields(manifest: McpbManifest, settings: ExtensionSettings, hasSecret: (key: string) => boolean): readonly McpUserConfigField[] {
  return Object.entries(manifest.user_config).map(([key, spec]) => {
    const value = spec.sensitive ? null : (settings.userConfig[key] ?? defaultOf(spec));
    return {
      key,
      type: spec.type as McpUserConfigType,
      title: spec.title.length > 0 ? spec.title : key,
      description: spec.description,
      required: spec.required,
      sensitive: spec.sensitive,
      multiple: spec.multiple,
      value,
      hasValue: spec.sensitive ? hasSecret(key) : isFilled(value),
    };
  });
}

export function missingRequiredFields(fields: readonly McpUserConfigField[]): readonly string[] {
  return fields.filter((field) => field.required && !field.hasValue).map((field) => field.key);
}

// Aplica un guardado del formulario. Devuelve los ajustes nuevos y que hacer con cada sensible (valor
// nuevo o borrarlo). LANZA con una clave que el manifest no declara o un tipo que no casa: la frontera
// es el IPC.
export function applyUserConfigValues(
  manifest: McpbManifest,
  settings: ExtensionSettings,
  values: Readonly<Record<string, McpUserConfigValue>>,
): { readonly settings: ExtensionSettings; readonly secrets: ReadonlyMap<string, string | null> } {
  const userConfig = { ...settings.userConfig };
  const secrets = new Map<string, string | null>();
  for (const [key, value] of Object.entries(values)) {
    const spec = manifest.user_config[key];
    if (spec === undefined) throw new Error(`La extensión no tiene el ajuste "${key}"`);
    if (value !== null && !valueMatches(spec, value)) throw new Error(`El ajuste "${key}" no admite ese tipo de valor (${typeof value})`);
    if (spec.sensitive) {
      secrets.set(key, value === null || value === '' ? null : String(value));
      continue;
    }
    if (value === null || value === '') delete userConfig[key];
    else userConfig[key] = typeof value === 'object' ? [...value] : value;
  }
  return { settings: { ...settings, userConfig }, secrets };
}

function valueMatches(spec: UserConfigSpec, value: Exclude<McpUserConfigValue, null>): boolean {
  if (Array.isArray(value)) return spec.multiple && value.every((item) => typeof item === 'string');
  if (spec.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (spec.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
}

function defaultOf(spec: UserConfigSpec): McpUserConfigValue {
  const parsed = USER_VALUE.safeParse(spec.default);
  return parsed.success ? parsed.data : null;
}

function isFilled(value: McpUserConfigValue): boolean {
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value !== '';
}

// --- Resolucion a un servidor que se puede lanzar -----------------------------------------------

export interface ExtensionResolveContext {
  readonly id: string;
  readonly dir: string;
  readonly manifest: McpbManifest;
  readonly settings: ExtensionSettings;
  readonly secret: (key: string) => string | null;
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly pathSeparator: string;
}

const TOKEN_PATTERN = /\$\{([^}]*)\}/g;
const USER_CONFIG_PREFIX = 'user_config.';

// Servidor stdio con todas las variables resueltas. LANZA si queda una que Mage no sabe resolver o si
// falta un obligatorio: el CLI callaria (medido: sin `user_config` el servidor ni sale en `mcp_status`).
// Un valor SENSIBLE (de la boveda) no se escribe en ningun campo: queda como referencia
// `${MAGE_MCP_SECRET_<ID>_<CLAVE>}` y su valor va en `secrets`.
export function resolveExtensionServer(ctx: ExtensionResolveContext, onlyIn: McpScope): ResolvedStdioServer {
  const base = ctx.manifest.server.mcp_config;
  const override = base.platform_overrides[ctx.platform] ?? {};
  const secrets: Record<string, string> = {};
  const values = userValues(ctx, secrets);
  const substitute = (text: string): string => text.replace(TOKEN_PATTERN, (_token, name: string) => joinValue(resolveToken(name, ctx, values)));
  const args = (override.args ?? base.args).flatMap((arg) => expandArg(arg, ctx, values, substitute));
  const env = Object.fromEntries(Object.entries({ ...base.env, ...(override.env ?? {}) }).map(([key, value]) => [key, substitute(value)]));
  return {
    name: ctx.id,
    source: 'extension',
    onlyIn,
    extra: {},
    secrets,
    transport: 'stdio',
    command: substitute(override.command ?? base.command),
    args,
    env,
    cwd: null,
  };
}

// Valor de cada `user_config`: lo guardado, el sensible de la boveda o el `default`. Un obligatorio sin
// ninguno LANZA.
function userValues(ctx: ExtensionResolveContext, secrets: Record<string, string>): ReadonlyMap<string, McpUserConfigValue> {
  const values = new Map<string, McpUserConfigValue>();
  for (const [key, spec] of Object.entries(ctx.manifest.user_config)) {
    const value = spec.sensitive ? ctx.secret(key) : (ctx.settings.userConfig[key] ?? defaultOf(spec));
    if (spec.required && !isFilled(value)) throw new Error(`Falta configurar «${spec.title.length > 0 ? spec.title : key}».`);
    values.set(key, spec.sensitive && isFilled(value) ? secretReference(ctx.id, key, String(value), secrets) : value);
  }
  return values;
}

function secretReference(id: string, key: string, value: string, secrets: Record<string, string>): string {
  const name = secretVarName(id, key);
  secrets[name] = value;
  return secretRef(name);
}

// Un argumento que es EXACTAMENTE `${user_config.x}` de un campo multiple se expande a varios.
function expandArg(arg: string, ctx: ExtensionResolveContext, values: ReadonlyMap<string, McpUserConfigValue>, substitute: (text: string) => string): readonly string[] {
  const whole = /^\$\{([^}]*)\}$/.exec(arg);
  if (whole === null) return [substitute(arg)];
  const value = resolveToken(whole[1]!, ctx, values);
  return Array.isArray(value) ? value : [joinValue(value)];
}

function resolveToken(name: string, ctx: ExtensionResolveContext, values: ReadonlyMap<string, McpUserConfigValue>): McpUserConfigValue {
  if (name.startsWith(USER_CONFIG_PREFIX)) {
    const key = name.slice(USER_CONFIG_PREFIX.length);
    if (!values.has(key)) throw new Error(`Usa \${${name}}, que el manifest no declara.`);
    return values.get(key) ?? '';
  }
  const fixed = fixedVariables(ctx)[name];
  if (fixed === undefined) throw new Error(`Usa \${${name}}, que Mage no sabe resolver.`);
  return fixed;
}

function fixedVariables(ctx: ExtensionResolveContext): Readonly<Record<string, string>> {
  return {
    __dirname: ctx.dir,
    '/': ctx.pathSeparator,
    pathSeparator: ctx.pathSeparator,
    HOME: ctx.homedir,
    DESKTOP: join(ctx.homedir, 'Desktop'),
    DOCUMENTS: join(ctx.homedir, 'Documents'),
    DOWNLOADS: join(ctx.homedir, 'Downloads'),
  };
}

function joinValue(value: McpUserConfigValue): string {
  if (value === null) return '';
  return Array.isArray(value) ? value.join(' ') : String(value);
}

// Comando que se busca en el PATH (node, python, uv…): solo si no es una ruta. Las `binary` ya salen
// con `${__dirname}` resuelto.
export function bareCommand(command: string): string | null {
  return /[\\/]/.test(command) ? null : command;
}
