import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedMcpServer, ResolvedRemoteServer } from '../../config/mcpResolved';
import { McpNeedsAuth, McpPool, type McpClientLike } from './mcpPool';
import { createMcpConnector, LoopbackCallback, VaultOAuthProvider } from './mcpSdk';
import { flattenResult, mcpToolName } from './mcpTools';

const FIXTURE = join(__dirname, '__fixtures__', 'fake-mcp-server.mjs');

function stdio(name: string, args: string[] = [], env: Record<string, string> = {}): ResolvedMcpServer {
  return { name, source: 'common', onlyIn: null, extra: {}, secrets: { MAGE_MCP_SECRET_X: 'secreto-1' }, transport: 'stdio', command: process.execPath, args: [FIXTURE, ...args], env, cwd: null };
}

const pools: McpPool[] = [];
afterEach(async () => {
  await Promise.all(pools.map((pool) => pool.close()));
  pools.length = 0;
});

function pool(servers: readonly ResolvedMcpServer[], connect = createMcpConnector({ vault: { get: () => null, set: () => undefined }, openUrl: async () => undefined, baseEnv: () => ({ PATH: process.env.PATH }), cwd: process.cwd() })) {
  const notices: string[] = [];
  const created = new McpPool(servers, { connect, notify: (text) => notices.push(text), onChange: () => undefined, connectTimeoutMs: 10_000 });
  pools.push(created);
  return { pool: created, notices };
}

describe('McpPool con el SDK real (stdio)', () => {
  it('start_fakeServer_listsAndCallsItsTool', async () => {
    const { pool: p } = pool([stdio('falso', [], { MCP_FALSO_MARCA: '${MAGE_MCP_SECRET_X}' })]);

    await p.start();
    const [tool] = p.tools();
    const out = await tool!.run({ texto: 'hola' }, { cwd: process.cwd(), extraDirs: [], signal: new AbortController().signal });

    expect(p.statuses()).toEqual([{ name: 'falso', status: 'connected' }]);
    expect(tool!.name).toBe('mcp__falso__eco');
    expect(tool!.kind).toBe('exec');
    // El secreto viaja por el entorno del servidor, materializado (nunca en el nombre ni en el esquema).
    expect(out).toEqual({ isError: false, output: 'eco: hola (secreto-1)' });
  });

  it('start_serverThatDies_isFailedAndOthersStillConnect', async () => {
    const { pool: p, notices } = pool([stdio('muere', ['--morir']), stdio('vivo')]);

    await p.start();

    expect(p.statuses()).toEqual([
      { name: 'muere', status: 'failed' },
      { name: 'vivo', status: 'connected' },
    ]);
    expect(notices.some((text) => text.includes('muere'))).toBe(true);
  });
});

describe('McpPool (conector falso)', () => {
  const client = (): McpClientLike => ({
    listTools: async () => ({ tools: [{ name: 'buscar', inputSchema: {} }] }),
    callTool: async () => ({ content: [] }),
    close: vi.fn(async () => undefined),
  });

  it('start_needsAuth_thenAuthorized_connectsInBackground', async () => {
    let authorize: () => void = () => undefined;
    const authorized = new Promise<void>((resolve) => (authorize = resolve));
    let attempts = 0;
    const onChange = vi.fn();
    const p = new McpPool([stdio('remoto')], {
      connect: async () => {
        attempts += 1;
        if (attempts === 1) throw new McpNeedsAuth('remoto', authorized);
        return client();
      },
      notify: () => undefined,
      onChange,
    });
    pools.push(p);

    await p.start();
    expect(p.statuses()[0]?.status).toBe('needs-auth');
    authorize();
    await vi.waitFor(() => expect(p.statuses()[0]?.status).toBe('connected'));

    expect(p.tools().map((tool) => tool.name)).toEqual(['mcp__remoto__buscar']);
    expect(onChange).toHaveBeenCalled();
  });

  it('close_closesClientsOnce', async () => {
    const c = client();
    const p = new McpPool([stdio('uno')], { connect: async () => c, notify: () => undefined, onChange: () => undefined });
    await p.start();

    await p.close();
    await p.close();

    expect(c.close).toHaveBeenCalledTimes(1);
  });
});

describe('mcpTools', () => {
  it('name_sanitizesAndCaps', () => {
    expect(mcpToolName('mi servidor', 'leer.fichero')).toBe('mcp__mi_servidor__leer_fichero');
    expect(mcpToolName('s'.repeat(80), 't').length).toBe(64);
  });

  it('flatten_textAndOtherBlocks', () => {
    expect(flattenResult({ content: [{ type: 'text', text: 'a' }, { type: 'image', mimeType: 'image/png' }], isError: true })).toEqual({
      isError: true,
      output: 'a\n[image image/png: el runtime no lo muestra]',
    });
    expect(flattenResult({})).toEqual({ isError: false, output: '(sin contenido)' });
  });
});

describe('OAuth del runtime', () => {
  const remote: ResolvedRemoteServer = {
    name: 'gh',
    source: 'common',
    onlyIn: null,
    extra: {},
    secrets: {},
    transport: 'http',
    url: 'https://mcp.example/mcp',
    headers: {},
    oauth: { clientId: null, clientSecretId: 'mcp-oauth-client-secret:gh', tokenStoreId: 'mcp-oauth-token:gh', scopes: ['repo'], callbackPort: null, resource: null },
  };

  it('provider_tokensAndClientInfo_liveInTheVault', () => {
    const vault = new Map<string, string>();
    const provider = new VaultOAuthProvider(remote, { redirectUrl: 'http://127.0.0.1:1/callback' }, { vault: { get: (id) => vault.get(id) ?? null, set: (id, v) => void vault.set(id, v) }, openUrl: async () => undefined });

    provider.saveTokens({ access_token: 'at', token_type: 'bearer' });
    provider.saveClientInformation({ client_id: 'dyn' });

    expect(provider.tokens()).toEqual({ access_token: 'at', token_type: 'bearer' });
    expect(provider.clientInformation()).toEqual({ client_id: 'dyn' });
    expect([...vault.keys()]).toEqual(['mcp-oauth-token:gh|local|', 'mcp-oauth-token:gh|client|local']);
    expect(provider.clientMetadata).toMatchObject({ token_endpoint_auth_method: 'none', scope: 'repo' });
  });

  it('provider_brokenJsonInVault_meansNoTokens', () => {
    const provider = new VaultOAuthProvider(remote, { redirectUrl: 'x' }, { vault: { get: () => '{roto', set: () => undefined }, openUrl: async () => undefined });

    expect(provider.tokens()).toBeUndefined();
  });

  it('callback_rightState_returnsCode', async () => {
    const callback = await LoopbackCallback.listen(null);
    const code = callback.waitForCode('estado-1', 5_000, new AbortController().signal);

    await fetch(`${callback.redirectUrl}?code=abc&state=estado-1`);

    await expect(code).resolves.toBe('abc');
    callback.close();
  });

  it('callback_wrongState_rejects', async () => {
    const callback = await LoopbackCallback.listen(null);
    const outcome = callback.waitForCode('estado-1', 5_000, new AbortController().signal).catch((err: unknown) => err);

    await fetch(`${callback.redirectUrl}?code=abc&state=otro`);

    expect(String(await outcome)).toMatch(/state/);
    callback.close();
  });
});
