import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { materializeSecrets, mcpOAuthTokenId, type ResolvedMcpServer, type ResolvedRemoteServer, type ResolvedStdioServer } from '../../config/mcpResolved';
import { McpNeedsAuth, type McpClientLike, type McpConnector } from './mcpPool';

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
  readonly openUrl: (url: string) => Promise<void>;
  // Entorno base de los servidores stdio, YA saneado con `scrubAgentEnv`.
  readonly baseEnv: () => Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}

export function createMcpConnector(deps: McpSdkDeps): McpConnector {
  return (server, signal) => (server.transport === 'stdio' ? connectStdio(server, deps) : connectRemote(server, deps, signal));
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
  const client = new Client(CLIENT_INFO);
  await client.connect(transport);
  return client as unknown as McpClientLike;
}

async function connectRemote(server: ResolvedRemoteServer, deps: McpSdkDeps, signal: AbortSignal): Promise<McpClientLike> {
  const callback = await LoopbackCallback.listen(server.oauth.callbackPort);
  const provider = new VaultOAuthProvider(server, callback, deps);
  const headers = Object.fromEntries(Object.entries(server.headers).map(([key, value]) => [key, materializeSecrets(value, server.secrets)]));
  const url = new URL(server.url);
  const options = { requestInit: { headers }, authProvider: provider };
  const transport = server.transport === 'sse' ? new SSEClientTransport(url, options) : new StreamableHTTPClientTransport(url, options);
  const client = new Client(CLIENT_INFO);
  try {
    await client.connect(transport);
    callback.close();
    return client as unknown as McpClientLike;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      callback.close();
      throw err;
    }
    // El SDK ya pidio abrir el navegador (`redirectToAuthorization`): se espera al codigo en el callback.
    const authorized = callback
      .waitForCode(provider.expectedState, MCP_OAUTH_TIMEOUT_MS, signal)
      .then((code) => transport.finishAuth(code))
      .finally(() => callback.close());
    throw new McpNeedsAuth(server.name, authorized);
  }
}

// Proveedor OAuth del SDK con lo persistente en la boveda: el registro del cliente (dinamico o el
// `clientId`/secreto que declare el comun) y los tokens, por servidor y destino (`mcpOAuthTokenId`).
export class VaultOAuthProvider implements OAuthClientProvider {
  private verifier = '';
  readonly expectedState = randomUUID();

  constructor(
    private readonly server: ResolvedRemoteServer,
    private readonly callback: { readonly redirectUrl: string },
    private readonly deps: Pick<McpSdkDeps, 'vault' | 'openUrl'>,
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

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.deps.openUrl(authorizationUrl.toString());
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
// servidor (`oauth.callbackPort`) o en uno libre.
export class LoopbackCallback {
  private resolveCode: ((query: URLSearchParams) => void) | null = null;
  private readonly received: Promise<URLSearchParams>;

  private constructor(private readonly server: Server) {
    this.received = new Promise((resolve) => (this.resolveCode = resolve));
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>Mage</title><p>Listo: puedes cerrar esta ventana y volver a Mage.</p>');
      this.resolveCode?.(url.searchParams);
    });
  }

  static listen(port: number | null): Promise<LoopbackCallback> {
    const server = createServer();
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port ?? 0, '127.0.0.1', () => resolve(new LoopbackCallback(server)));
    });
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/callback`;
  }

  async waitForCode(expectedState: string, timeoutMs: number, signal: AbortSignal): Promise<string> {
    let timer: NodeJS.Timeout | null = null;
    const stop = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`no se completó en ${Math.round(timeoutMs / 60_000)} min`)), timeoutMs);
      signal.addEventListener('abort', () => reject(new Error('sesión cerrada')), { once: true });
    });
    try {
      const query = await Promise.race([this.received, stop]);
      const error = query.get('error');
      if (error !== null) throw new Error(`el servidor de autorización respondió ${error}`);
      if (query.get('state') !== expectedState) throw new Error('el «state» del callback no coincide');
      const code = query.get('code');
      if (code === null || code.length === 0) throw new Error('el callback no trae código');
      return code;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  close(): void {
    this.server.close();
  }
}
