import {
  materializeSecrets,
  referencesSecret,
  secretRef,
  type ResolvedMcpServer,
  type ResolvedRemoteServer,
  type ResolvedStdioServer,
} from './mcpResolved';
import { mergeClaudeSettings } from '@shared/externalActionAsk';
import { MAGE_MCP_CALLER_ENV } from '../host/mcpCallers';

// Traduccion del formato neutro (`mcpResolved.ts`) al de cada CLI. PURO. Lo medido que sostiene cada
// traductor esta en `spike/mcp-providers-spike.mjs` (agy 1.2.14, codex-cli 0.144.4) y en
// `spike/init-spike.mjs` (Claude 2.1.28x).

// --- Claude: un fichero para `--mcp-config` (forma de `.mcp.json`) ------------------------------
//
// El fichero lleva ESCRITOS los valores de env y de cabecera, tambien los de la boveda, y NO pone ninguno en
// el entorno del CLI. MEDIDO en 2.1.319 (`spike/mcp-secrets-env-spike.mjs`, servidor falso, sin turno real):
// el CLI hereda su entorno entero a los comandos que lanza el agente con Bash (un `env` lo enseña), mientras
// que el `env` de un servidor del fichero solo le llega a ese servidor. Por eso el fichero vive en la carpeta
// de Mage, solo legible por el usuario (`claudeConfigWriter`, mcpServices.ts).
// Un valor que YA es una referencia a una variable del usuario (`${HOME}`, `Bearer ${TOKEN}`) se deja tal
// cual: el CLI la expande de su entorno (medido en 2.1.286 en `args`, `env` y `headers`).
// Unica referencia que Mage pone a proposito: la credencial de la sesion ante `mage mcp`. Es de CADA sesion y
// el fichero es de la CUENTA (dos sesiones a la vez se lo pisarian), y no debe tocar disco; el adapter ya la
// pone en el entorno del hijo.

export interface ClaudeMcpConfig {
  readonly config: { readonly mcpServers: Record<string, unknown> };
}

export function toClaudeMcpConfig(servers: readonly ResolvedMcpServer[]): ClaudeMcpConfig {
  return { config: { mcpServers: Object.fromEntries(servers.map((server) => [server.name, toClaudeEntry(server)])) } };
}

function toClaudeEntry(server: ResolvedMcpServer): Record<string, unknown> {
  const plain = (text: string): string => materializeSecrets(text, server.secrets);
  if (server.transport === 'stdio') {
    const env = withCallerReference(plainValues(server.env, server.secrets));
    return {
      type: 'stdio',
      command: plain(server.command),
      ...(server.args.length > 0 ? { args: server.args.map(plain) } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(server.cwd === null ? {} : { cwd: plain(server.cwd) }),
      ...server.extra,
    };
  }
  const headers = plainValues(server.headers, server.secrets);
  return { type: server.transport, url: plain(server.url), ...(Object.keys(headers).length > 0 ? { headers } : {}), ...server.extra };
}

function withCallerReference(env: Record<string, string>): Record<string, string> {
  return env[MAGE_MCP_CALLER_ENV] === undefined ? env : { ...env, [MAGE_MCP_CALLER_ENV]: secretRef(MAGE_MCP_CALLER_ENV) };
}

// Flags de Claude a partir de lo compartido. `writeMcpConfig` escribe el fichero (con los valores) y
// devuelve su ruta. El fragmento de `--settings` (hooks y permisos comunes) va en linea: no lleva secretos.
export function toClaudeArgs(
  servers: readonly ResolvedMcpServer[],
  settingsFragment: Readonly<Record<string, unknown>> | null,
  writeMcpConfig: (text: string) => string,
  extraSettings: Readonly<Record<string, unknown>> = {},
): { readonly args: readonly string[] } {
  const args: string[] = [];
  if (servers.length > 0) {
    args.push('--mcp-config', writeMcpConfig(`${JSON.stringify(toClaudeMcpConfig(servers).config, null, 2)}\n`));
  }
  // UN solo `--settings`: el fragmento comun fusionado con los ajustes de arranque de la sesion (p. ej. ultracode o
  // las reglas `ask` de acciones externas). Los `permissions` de los dos se mezclan: no se pierde nada del usuario.
  const settings = mergeClaudeSettings(settingsFragment ?? {}, extraSettings);
  if (settingsFragment !== null || Object.keys(extraSettings).length > 0) args.push('--settings', JSON.stringify(settings));
  return { args };
}

// Escribe el fichero de `--mcp-config` de UNA cuenta y devuelve su ruta (lo inyecta main).
export type ClaudeMcpConfigWriter = (accountDir: string, text: string) => string;

// Lo compartido de un lanzamiento de Claude (el nativo): flags y variables de entorno.
// Medido en 2.1.285: `ENABLE_CLAUDEAI_MCP_SERVERS=false` deja la sesion sin conectores de claude.ai.
export function claudeSharedLaunch(
  shared: { readonly mcpServers: readonly ResolvedMcpServer[]; readonly settingsFragment: Readonly<Record<string, unknown>> | null; readonly claudeAiConnectors: boolean } | undefined,
  accountDir: string,
  writer: ClaudeMcpConfigWriter,
  extraSettings: Readonly<Record<string, unknown>> = {},
): { readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> } {
  if (shared === undefined) {
    return Object.keys(extraSettings).length === 0 ? { args: [], env: {} } : { args: ['--settings', JSON.stringify(extraSettings)], env: {} };
  }
  const { args } = toClaudeArgs(shared.mcpServers, shared.settingsFragment, (text) => writer(accountDir, text), extraSettings);
  return { args, env: shared.claudeAiConnectors ? {} : { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } };
}

// Por defecto (tests, usos sin disco): sin servidores no hace falta; con alguno es un error de cableado.
export const refuseClaudeMcpConfig: ClaudeMcpConfigWriter = (accountDir) => {
  throw new Error(`No hay donde escribir el --mcp-config de ${accountDir}: falta el escritor en el adapter`);
};

// --- Codex: `-c mcp_servers.<n>.<campo>=<TOML>` + variables de entorno para los secretos ----------

export interface CodexOverrides {
  readonly args: readonly string[];
  // Variables que hay que poner en el entorno del proceso codex (valores de env y cabeceras).
  readonly env: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

// Medido: la ruta de `-c` se parte por puntos y no admite claves entre comillas (`mcp_servers."a.b"`
// da «invalid transport»), asi que un nombre fuera de este patron no se puede inyectar.
const CODEX_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const CODEX_ENV_PREFIX = 'MAGE_MCP_';

// Los secretos NUNCA van en `args`:
//  - stdio: `env_vars=["KEY"]` reenvia al servidor la variable KEY del entorno de codex con el MISMO
//    nombre (medido: la forma objeto solo admite `source` local|remote, no renombra). Si dos servidores
//    piden la misma variable con valores distintos, el segundo se omite con aviso.
//  - http: `env_http_headers={"Cabecera"="MAGE_MCP_<N>_<CABECERA>"}` saca cada cabecera de una variable.
export function toCodexOverrides(servers: readonly ResolvedMcpServer[]): CodexOverrides {
  const args: string[] = [];
  const env: Record<string, string> = {};
  const warnings: string[] = [];
  for (const server of servers) {
    const problem = codexProblem(server, env);
    if (problem !== null) {
      warnings.push(problem);
      continue;
    }
    const entry = server.transport === 'stdio' ? codexStdio(server) : codexRemote(server);
    for (const [field, value] of entry.fields) args.push('-c', `mcp_servers.${server.name}.${field}=${value}`);
    Object.assign(env, entry.env);
  }
  return { args, env, warnings };
}

function codexProblem(server: ResolvedMcpServer, env: Readonly<Record<string, string>>): string | null {
  if (!CODEX_NAME_PATTERN.test(server.name)) return `"${server.name}" no se pasa a Codex: su nombre solo puede tener letras, números, - y _.`;
  if (server.transport === 'sse') return `"${server.name}" no se pasa a Codex: no admite servidores SSE.`;
  if (server.transport !== 'stdio') return null;
  // Codex no expande referencias en `-c` (no medido): un valor de la boveda en el comando o en los
  // argumentos acabaria en la linea de comandos.
  if ([server.command, ...server.args, server.cwd ?? ''].some((text) => referencesSecret(text, server.secrets))) {
    return `"${server.name}" no se pasa a Codex: lleva un valor sensible en el comando o en los argumentos.`;
  }
  const clash = Object.entries(plainValues(server.env, server.secrets)).find(([key, value]) => env[key] !== undefined && env[key] !== value);
  return clash === undefined ? null : `"${server.name}" no se pasa a Codex: otro servidor usa la variable ${clash[0]} con otro valor.`;
}

interface CodexEntry {
  readonly fields: readonly (readonly [string, string])[];
  readonly env: Readonly<Record<string, string>>;
}

function codexStdio(server: ResolvedStdioServer): CodexEntry {
  const fields: [string, string][] = [['command', tomlString(server.command)]];
  if (server.args.length > 0) fields.push(['args', tomlArray(server.args)]);
  if (server.cwd !== null) fields.push(['cwd', tomlString(server.cwd)]);
  const keys = Object.keys(server.env);
  if (keys.length > 0) fields.push(['env_vars', tomlArray(keys)]);
  return { fields, env: plainValues(server.env, server.secrets) };
}

// Los valores con las referencias a la boveda ya sustituidas (Codex: al entorno; Claude y agy: a su fichero).
function plainValues(values: Readonly<Record<string, string>>, secrets: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, materializeSecrets(value, secrets)]));
}

function codexRemote(server: ResolvedRemoteServer): CodexEntry {
  const fields: [string, string][] = [['url', tomlString(server.url)]];
  const env: Record<string, string> = {};
  const headerVars: [string, string][] = [];
  for (const [header, value] of Object.entries(plainValues(server.headers, server.secrets))) {
    const variable = codexEnvName(server.name, header);
    env[variable] = value;
    headerVars.push([header, variable]);
  }
  if (headerVars.length > 0) fields.push(['env_http_headers', tomlInlineTable(headerVars)]);
  // Medido con `codex mcp add --oauth-client-id/--oauth-resource`: `oauth.client_id` y `oauth_resource`.
  if (server.oauth.clientId !== null) fields.push(['oauth.client_id', tomlString(server.oauth.clientId)]);
  if (server.oauth.resource !== null) fields.push(['oauth_resource', tomlString(server.oauth.resource)]);
  return { fields, env };
}

// Nombre estable de la variable de una cabecera: MAGE_MCP_<SERVIDOR>_<CABECERA>, en mayusculas y con
// todo lo que no es letra o numero cambiado por `_`.
export function codexEnvName(serverName: string, key: string): string {
  return `${CODEX_ENV_PREFIX}${envSafe(serverName)}_${envSafe(key)}`;
}

function envSafe(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

// Cadena basica de TOML. Las secuencias de escape de JSON (\" \\ \n \t \uXXXX) son validas en TOML
// (medido con rutas de Windows con espacios y comillas en los argumentos).
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(',')}]`;
}

function tomlInlineTable(pairs: readonly (readonly [string, string])[]): string {
  return `{${pairs.map(([key, value]) => `${tomlString(key)}=${tomlString(value)}`).join(',')}}`;
}

// --- agy: entradas de su `mcp_config.json` (no tiene flag de sesion) -----------------------------

// Forma medida de lo que escribe `agy mcp add`: stdio `{command,args,env,disabled}`, http
// `{serverUrl,headers,disabled}`. SSE no existe en agy. Los valores van EN CLARO en su fichero (agy no
// tiene flag de sesion y no se ha podido medir si expande variables): quien llama decide si un servidor
// con valores de la boveda se puede copiar (ver mcpAgySync.ts).
export function toAgyEntry(server: ResolvedMcpServer): Record<string, unknown> | null {
  if (server.transport === 'sse') return null;
  const plain = (text: string): string => materializeSecrets(text, server.secrets);
  if (server.transport === 'stdio') {
    return { command: plain(server.command), args: server.args.map(plain), env: plainValues(server.env, server.secrets), disabled: false };
  }
  return { serverUrl: server.url, headers: plainValues(server.headers, server.secrets), disabled: false };
}

export function hasVaultSecrets(server: ResolvedMcpServer): boolean {
  return Object.keys(server.secrets).length > 0;
}
