import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { materializeSecrets, mcpOAuthTokenId, type ResolvedMcpServer, type ResolvedRemoteServer, type ResolvedStdioServer } from '../../config/mcpResolved';
import type { McpLogins } from './mcpLogins';
import { McpNeedsAuth, type McpClientLike, type McpConnector } from './mcpPool';
import type { McpElicitationResult } from './elicitationBroker';
import type { Translate } from '@shared/i18n/translator';
import { localized, UserFacingError } from '@shared/i18n/localizedText';

// Conector real del runtime propio con el SDK oficial de MCP (ficha D10): stdio, streamable HTTP y SSE,
// y OAuth para los remotos (§8.1 D10, C3-l) con los tokens en la BOVEDA de main, nunca en un fichero.

export const MCP_OAUTH_TIMEOUT_MS = 5 * 60_000;
const CLIENT_INFO = { name: 'mage', version: '0.1.2' };
// El destino a efectos de tokens: los del runtime propio son de la familia `local`, sin cuenta.
const RUNTIME_TARGET = { family: 'local' as const, accountId: null };

export interface McpVault {
  readonly get: (id: string) => string | null;
  readonly set: (id: string, value: string) => void;
}

export interface McpSdkDeps {
  readonly vault: McpVault;
  // Logins pendientes a nivel de app (D3 de P-033): el navegador lo abre el usuario desde el aviso.
  readonly logins: McpLogins;
  // Entorno base de los servidores stdio, YA saneado con `scrubAgentEnv`.
  readonly baseEnv: () => Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly elicit: (server: string, params: unknown, signal?: AbortSignal) => Promise<McpElicitationResult>;
  // Traductor del idioma de la interfaz: la página que el navegador enseña al volver del login (F3.3b).
  readonly translate: Translate;
}

function elicitingClient(server: string, deps: McpSdkDeps): Client {
  const client = new Client(CLIENT_INFO, { capabilities: { elicitation: { form: {}, url: {} } } });
  client.setRequestHandler(ElicitRequestSchema, (request, extra) => deps.elicit(server, request.params, extra.signal));
  return client;
}

export function createMcpConnector(deps: McpSdkDeps): McpConnector {
  // El login de un remoto es de la APP, no de la sesion: cerrar la pestaña no lo aborta (lo puede estar
  // esperando otra). Por eso la señal de la sesion no le llega.
  return (server) => (server.transport === 'stdio' ? connectStdio(server, deps) : connectRemote(server, deps));
}

async function connectStdio(server: ResolvedStdioServer, deps: McpSdkDeps): Promise<McpClientLike> {
  const own = Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, materializeSecrets(value, server.secrets)]));
  const base = Object.fromEntries(Object.entries(deps.baseEnv()).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args.map((arg) => materializeSecrets(arg, server.secrets)),
    env: { ...base, ...own },
    cwd: server.cwd ?? deps.cwd,
    stderr: 'ignore',
  });
  const client = elicitingClient(server.name, deps);
  await client.connect(transport);
  return client as unknown as McpClientLike;
}

async function connectRemote(server: ResolvedRemoteServer, deps: McpSdkDeps): Promise<McpClientLike> {
  // Ya hay un login de este servidor esperando al usuario: esta sesion se une a el.
  const pending = deps.logins.pendingFor(server.oauth.tokenStoreId);
  if (pending !== null) throw new McpNeedsAuth(server.name, pending.id, pending.authorized);
  const state = randomUUID();
  const callback = await LoopbackCallback.listen(server.oauth.callbackPort, state, deps.translate);
  const provider = new VaultOAuthProvider(server, callback, deps, state);
  const headers = Object.fromEntries(Object.entries(server.headers).map(([key, value]) => [key, materializeSecrets(value, server.secrets)]));
  const url = new URL(server.url);
  const options = { requestInit: { headers }, authProvider: provider };
  const transport = server.transport === 'sse' ? new SSEClientTransport(url, options) : new StreamableHTTPClientTransport(url, options);
  const client = elicitingClient(server.name, deps);
  try {
    await client.connect(transport);
    callback.close();
    return client as unknown as McpClientLike;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      callback.close();
      throw err;
    }
    const url = provider.authorizationUrl;
    if (url === null) {
      callback.close();
      throw err;
    }
    // El SDK ha pedido la autorizacion y Mage la guarda; el codigo se espera cuando el usuario abra el login.
    const login = deps.logins.register(server.oauth.tokenStoreId, url, () =>
      callback
        .waitForCode(MCP_OAUTH_TIMEOUT_MS)
        .then((code) => transport.finishAuth(code))
        .finally(() => callback.close()),
    );
    if (!login.created) callback.close();
    throw new McpNeedsAuth(server.name, login.id, login.authorized);
  }
}

// Proveedor OAuth del SDK con lo persistente en la boveda: el registro del cliente (dinamico o el
// `clientId`/secreto que declare el comun) y los tokens, por servidor y destino (`mcpOAuthTokenId`).
export class VaultOAuthProvider implements OAuthClientProvider {
  private verifier = '';
  // La URL de autorizacion que pidio el SDK. Mage NO la abre: la abre el usuario desde el aviso (M2).
  authorizationUrl: string | null = null;

  constructor(
    private readonly server: ResolvedRemoteServer,
    private readonly callback: { readonly redirectUrl: string },
    private readonly deps: Pick<McpSdkDeps, 'vault'>,
    readonly expectedState: string = randomUUID(),
  ) {}

  get redirectUrl(): string {
    return this.callback.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    const secret = this.clientSecret();
    return {
      client_name: 'Mage',
      redirect_uris: [this.callback.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: secret === null ? 'none' : 'client_secret_post',
      ...(this.server.oauth.scopes.length === 0 ? {} : { scope: this.server.oauth.scopes.join(' ') }),
    };
  }

  state(): string {
    return this.expectedState;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const { clientId } = this.server.oauth;
    if (clientId !== null) {
      const secret = this.clientSecret();
      return { client_id: clientId, ...(secret === null ? {} : { client_secret: secret }) };
    }
    return readJson<OAuthClientInformationMixed>(this.deps.vault.get(this.clientInfoId()));
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.deps.vault.set(this.clientInfoId(), JSON.stringify(info));
  }

  tokens(): OAuthTokens | undefined {
    return readJson<OAuthTokens>(this.deps.vault.get(this.tokenId()));
  }

  saveTokens(tokens: OAuthTokens): void {
    this.deps.vault.set(this.tokenId(), JSON.stringify(tokens));
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl.toString();
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (this.verifier.length === 0) throw new Error(`Falta el code verifier de PKCE de ${this.server.name}`);
    return this.verifier;
  }

  private tokenId(): string {
    return mcpOAuthTokenId(this.server.oauth.tokenStoreId, RUNTIME_TARGET);
  }

  private clientInfoId(): string {
    return `${this.server.oauth.tokenStoreId}|client|${RUNTIME_TARGET.family}`;
  }

  private clientSecret(): string | null {
    return this.deps.vault.get(this.server.oauth.clientSecretId);
  }
}

// Lo guardado en la boveda es nuestro, pero un JSON roto (version vieja, mano humana) no puede tumbar la
// conexion: se trata como «no hay» y el SDK vuelve a pedir el login.
function readJson<T>(text: string | null): T | undefined {
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof SyntaxError) return undefined;
    throw err;
  }
}

// Servidor local del redirect de OAuth (RFC 8252: loopback por IP). Escucha en el puerto que declare el
// servidor (`oauth.callbackPort`) o en uno libre. Solo cuenta el golpe con el `state` de ESTE login:
// cualquier web puede pedir `http://127.0.0.1:<puerto>/callback`, y antes eso abortaba el login (M2).
export class LoopbackCallback {
  private resolveCode: ((query: URLSearchParams) => void) | null = null;
  private readonly received: Promise<URLSearchParams>;

  private constructor(
    private readonly server: Server,
    expectedState: string,
    translate: Translate,
  ) {
    this.received = new Promise((resolve) => (this.resolveCode = resolve));
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      if (url.searchParams.get('state') !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(translate('mcp.main.oauthPageBadState'));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(oauthPage(translate('mcp.main.oauthPageDone')));
      this.resolveCode?.(url.searchParams);
    });
  }

  // A13: un puerto efímero puede caer en la lista de puertos bloqueados del navegador (en Windows el rango
  // dinámico empieza en 1024, medido por dirección) y el redirect fallaría con «bad port». Se suelta y se
  // pide otro, con intentos acotados. Un `callbackPort` explícito nunca se sustituye: error claro.
  static async listen(port: number | null, expectedState: string, translate: Translate, listen: LoopbackListen = listenLoopback): Promise<LoopbackCallback> {
    if (port !== null && FETCH_BLOCKED_PORTS.has(port)) {
      throw new UserFacingError(localized('errors.runtime.mcpCallbackPortBlocked', { port: String(port) }));
    }
    if (port !== null) return new LoopbackCallback(await listen(port), expectedState, translate);
    for (let attempt = 0; attempt < MAX_CALLBACK_LISTEN_ATTEMPTS; attempt++) {
      const server = await listen(EPHEMERAL_PORT);
      if (!FETCH_BLOCKED_PORTS.has((server.address() as AddressInfo).port)) return new LoopbackCallback(server, expectedState, translate);
      await closeServer(server);
    }
    throw new UserFacingError(localized('errors.runtime.mcpCallbackNoPort', { attempts: String(MAX_CALLBACK_LISTEN_ATTEMPTS) }));
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/callback`;
  }

  async waitForCode(timeoutMs: number): Promise<string> {
    let timer: NodeJS.Timeout | null = null;
    const stop = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new UserFacingError(localized('errors.runtime.mcpLoginTimeout', { minutes: String(Math.round(timeoutMs / 60_000)) }))), timeoutMs);
    });
    try {
      const query = await Promise.race([this.received, stop]);
      const error = query.get('error');
      if (error !== null) throw new UserFacingError(localized('errors.runtime.mcpAuthServerResponded', { error }));
      const code = query.get('code');
      if (code === null || code.length === 0) throw new UserFacingError(localized('errors.runtime.mcpCallbackNoCode'));
      return code;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  close(): void {
    this.server.close();
  }
}

// La página que ve el usuario en el navegador al volver del login: el texto ya traducido, escapado.
function oauthPage(text: string): string {
  return '<!doctype html><meta charset="utf-8"><title>Mage</title><p>' + escapeHtml(text) + '</p>';
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Puertos que Fetch/Chromium rechazan («bad port»). Fetch Standard, «port blocking», consultado el
// 24-10-2026: https://fetch.spec.whatwg.org/#port-blocking
export const FETCH_BLOCKED_PORTS: ReadonlySet<number> = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109,
  110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060,
  5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);
// Intentos acotados: con ~80 puertos bloqueados entre ~64 000 efímeros, dos seguidos ya es improbable.
const MAX_CALLBACK_LISTEN_ATTEMPTS = 8;
const EPHEMERAL_PORT = 0;

export type LoopbackListen = (port: number) => Promise<Server>;

function listenLoopback(port: number): Promise<Server> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.close();
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
}
