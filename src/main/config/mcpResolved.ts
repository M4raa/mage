import {
  familiesForTransport,
  isInMcpScope,
  transportOf,
  type McpScope,
  type McpTarget,
} from '@shared/mcp';

// Formato NEUTRO de los servidores MCP que Mage reparte (comunes de `mcp-common.json` y extensiones
// `.mcpb` ya resueltas). Vive SOLO en main: lleva los valores de `env`/`headers` (secretos). Cada
// adapter lo traduce a su CLI (`mcpProviderTranslate.ts`: Claude, Codex, agy) y el runtime propio lo
// consume tal cual. Modulo PURO.

export type McpServerSource = 'common' | 'extension';

// Datos de OAuth del propio servidor MCP que necesitara quien haga el flujo sin CLI (el runtime
// propio). Los CLI hacen su OAuth por su cuenta (Claude con `mcp_authenticate`, codex con
// `mcpServer/oauth/login`); a ellos solo les llega `clientId`/`resource` si el comun los declara.
export interface McpOAuthSettings {
  readonly clientId: string | null;
  // Id en la boveda (`SecretStore`) del client secret, si el usuario lo guarda. Puede no existir.
  readonly clientSecretId: string;
  // Prefijo de ids en la boveda para los tokens que obtenga el runtime (por destino: ver
  // `mcpOAuthTokenId`). Los tokens nunca van a un fichero en claro.
  readonly tokenStoreId: string;
  readonly scopes: readonly string[];
  readonly callbackPort: number | null;
  readonly resource: string | null;
}

interface ResolvedBase {
  readonly name: string;
  readonly source: McpServerSource;
  readonly onlyIn: McpScope;
  // Campos de la declaracion que Mage no interpreta (`timeout`, `oauth` crudo…): Claude los recibe
  // tal cual; el resto de traductores los ignora.
  readonly extra: Readonly<Record<string, unknown>>;
  // Valores que vienen de la BOVEDA (los `sensitive` de una extension). En los campos de arriba solo
  // aparecen como referencia `${MAGE_MCP_SECRET_…}`; el valor viaja aqui y cada traductor decide como
  // entregarlo sin escribirlo en un fichero (Claude: entorno del hijo, que el CLI expande).
  readonly secrets: Readonly<Record<string, string>>;
}

export interface ResolvedStdioServer extends ResolvedBase {
  readonly transport: 'stdio';
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string | null;
}

export interface ResolvedRemoteServer extends ResolvedBase {
  readonly transport: 'http' | 'sse';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly oauth: McpOAuthSettings;
}

export type ResolvedMcpServer = ResolvedStdioServer | ResolvedRemoteServer;

export interface ResolvedMcpList {
  readonly servers: readonly ResolvedMcpServer[];
  readonly warnings: readonly string[];
}

const MANAGED_KEYS: ReadonlySet<string> = new Set(['type', 'command', 'args', 'env', 'cwd', 'url', 'headers']);
const OAUTH_SECRET_PREFIX = 'mcp-oauth-client-secret:';
const OAUTH_TOKEN_PREFIX = 'mcp-oauth-token:';

// Prefijo de las variables con las que viajan los valores sensibles (de la boveda o de los env/headers
// de un comun) hacia el CLI de Claude.
export const MCP_SECRET_VAR_PREFIX = 'MAGE_MCP_SECRET_';

export function secretVarName(...parts: readonly string[]): string {
  return `${MCP_SECRET_VAR_PREFIX}${parts.map((part) => part.toUpperCase().replace(/[^A-Z0-9]/g, '_')).join('_')}`;
}

// Sustituye las referencias `${VAR}` de `secrets` por su valor (para quien NO puede expandirlas:
// el entorno de codex, el fichero de agy).
export function materializeSecrets(text: string, secrets: Readonly<Record<string, string>>): string {
  return text.replace(/\$\{([A-Z0-9_]+)\}/g, (token, name: string) => secrets[name] ?? token);
}

export function referencesSecret(text: string, secrets: Readonly<Record<string, string>>): boolean {
  return Object.keys(secrets).some((name) => text.includes(secretRef(name)));
}

// `${NOMBRE}`: la forma en que el CLI de Claude expande una variable de entorno en un --mcp-config.
export function secretRef(name: string): string {
  return '${' + name + '}';
}

export function mcpOAuthTokenId(tokenStoreId: string, target: McpTarget): string {
  return `${tokenStoreId}|${target.family}|${target.accountId ?? ''}`;
}

// Una declaracion cruda (forma de `.mcp.json`) al formato neutro. Lanza con el nombre y el campo que
// falta (nunca con valores): quien llama decide si es un aviso o un error.
export function resolveServerConfig(name: string, raw: unknown, source: McpServerSource, onlyIn: McpScope): ResolvedMcpServer {
  if (!isRecord(raw)) throw new Error(`El servidor "${name}" no es un objeto (${typeof raw})`);
  const extra = Object.fromEntries(Object.entries(raw).filter(([key]) => !MANAGED_KEYS.has(key)));
  const transport = transportOf(raw);
  const base = { name, source, onlyIn, extra, secrets: {} };
  if (transport === 'stdio') {
    if (typeof raw.command !== 'string' || raw.command.trim().length === 0) throw new Error(`El servidor "${name}" no tiene comando`);
    const cwd = typeof raw.cwd === 'string' && raw.cwd.length > 0 ? raw.cwd : null;
    return { ...base, transport, command: raw.command, args: stringList(raw.args), env: stringRecord(raw.env), cwd };
  }
  if (typeof raw.url !== 'string' || raw.url.trim().length === 0) throw new Error(`El servidor "${name}" no tiene URL`);
  return { ...base, transport, url: raw.url, headers: stringRecord(raw.headers), oauth: oauthOf(name, raw.oauth) };
}

// `oauth` tal como lo declara Claude Code (`clientId`, `callbackPort`) mas lo que usa codex
// (`resource`) y los `scopes`. Todo opcional y tolerante: un campo con otro tipo se ignora.
function oauthOf(name: string, raw: unknown): McpOAuthSettings {
  const record = isRecord(raw) ? raw : {};
  const port = record.callbackPort;
  return {
    clientId: typeof record.clientId === 'string' && record.clientId.length > 0 ? record.clientId : null,
    clientSecretId: `${OAUTH_SECRET_PREFIX}${name}`,
    tokenStoreId: `${OAUTH_TOKEN_PREFIX}${name}`,
    scopes: stringList(record.scopes),
    callbackPort: typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65_536 ? port : null,
    resource: typeof record.resource === 'string' && record.resource.length > 0 ? record.resource : null,
  };
}

// Los comunes ACTIVOS (`mcpServers`; los desactivados viven en otra clave y no llegan aqui), con su
// «Solo en…». Uno mal declarado se salta con aviso: no puede tumbar el lanzamiento de los demas.
export function resolveCommonServers(
  mcpServers: Readonly<Record<string, unknown>>,
  onlyIn: Readonly<Record<string, McpScope>>,
): ResolvedMcpList {
  const servers: ResolvedMcpServer[] = [];
  const warnings: string[] = [];
  for (const [name, raw] of Object.entries(mcpServers)) {
    try {
      servers.push(resolveServerConfig(name, raw, 'common', onlyIn[name] ?? null));
    } catch (error) {
      warnings.push(`Común omitido: ${describeError(error)}`);
    }
  }
  return { servers, warnings };
}

// Comunes y extensiones juntos. Con el mismo nombre gana el comun (la misma regla que la importacion:
// gana lo que existe) y la extension se omite con aviso.
export function mergeServerLists(common: ResolvedMcpList, extensions: ResolvedMcpList): ResolvedMcpList {
  const taken = new Set(common.servers.map((server) => server.name));
  const warnings = [...common.warnings, ...extensions.warnings];
  const servers = [...common.servers];
  for (const server of extensions.servers) {
    if (taken.has(server.name)) {
      warnings.push(`La extensión "${server.name}" se llama igual que un común: se carga el común.`);
      continue;
    }
    taken.add(server.name);
    servers.push(server);
  }
  return { servers, warnings };
}

// Lo que carga UN destino (familia + cuenta): su «Solo en…» y que el transporte le sirva.
export function selectForTarget(servers: readonly ResolvedMcpServer[], target: McpTarget): readonly ResolvedMcpServer[] {
  return servers.filter((server) => isInMcpScope(server.onlyIn, target) && familiesForTransport(server.transport).includes(target.family));
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
