import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { McpTunnelHandle } from '../host/hostConnection';
import type { BrowserToolsPort } from './browserTools';
import { createMcpConnector, type McpConnectorDeps } from './mcpConnector';
import { MemoryIdempotencyStore } from './idempotencyStore';
import { MemorySessionsPort } from './memorySessionsPort';

const NOW = '2026-11-03T12:00:00.000Z';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL = 'ab'.repeat(32);
const TOOLS = ['mage_ask_creator', 'mage_cancel', 'mage_create_session', 'mage_get_status', 'mage_list_sessions', 'mage_read_result', 'mage_send'];

// El lado cliente: lo que el cliente envía entra por `receive` del túnel y lo que el túnel emite llega al cliente.
class BridgeTransport implements Transport {
  onmessage?: Transport['onmessage'];
  onclose?: () => void;
  handle: McpTunnelHandle | null = null;
  start(): Promise<void> { return Promise.resolve(); }
  send(message: JSONRPCMessage): Promise<void> {
    this.handle?.receive(message as unknown as Record<string, unknown>);
    return Promise.resolve();
  }
  close(): Promise<void> { return Promise.resolve(); }
}

function makeDeps(overrides: Partial<McpConnectorDeps> = {}): McpConnectorDeps {
  const port = new MemorySessionsPort({ targets: [{ projectId: 'p', accountId: 'a', provider: 'claude', cwd: '/synthetic' }], now: () => NOW, newConversationId: () => 'created-1' });
  return {
    resolveCaller: (credential) => (credential === CREDENTIAL ? 'session-1' : null),
    createPort: () => ({ port, conversationId: 'C' }),
    creatorChainOf: () => [],
    accountIds: () => ['a'],
    maxDepth: () => 3,
    store: new MemoryIdempotencyStore(),
    now: () => NOW,
    log: vi.fn(),
    ...overrides,
  };
}

const opened: { client: Client; handle: McpTunnelHandle }[] = [];
async function connect(deps: McpConnectorDeps, credential: string | null) {
  const bridge = new BridgeTransport();
  const handle = createMcpConnector(deps).open({ callerCredential: credential, send: (message) => bridge.onmessage?.(message as unknown as JSONRPCMessage) });
  bridge.handle = handle;
  const client = new Client({ name: 'mage-test', version: '1' });
  opened.push({ client, handle });
  await client.connect(bridge);
  return client;
}
afterEach(async () => {
  for (const { client, handle } of opened.splice(0)) {
    handle.close();
    await client.close();
  }
});

describe('createMcpConnector', () => {
  it('open_knownCaller_listsSixTools', async () => {
    const client = await connect(makeDeps(), CREDENTIAL);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS);
  });

  it('open_unknownCaller_toolsRejectExternal', async () => {
    const deps = makeDeps();
    const client = await connect(deps, 'ff'.repeat(32));

    const result = await client.callTool({ name: 'mage_list_sessions', arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('mage_external_caller');
  });

  it('open_noCredential_external', async () => {
    const deps = makeDeps();
    const client = await connect(deps, null);

    const result = await client.callTool({ name: 'mage_list_sessions', arguments: {} });

    expect(JSON.stringify(result)).toContain('mage_external_caller');
    expect(deps.log).toHaveBeenCalledWith('info', expect.stringContaining('sin sesión de Mage'));
    expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain(CREDENTIAL);
  });

  it('open_knownCaller_scopeHasCallerChain', async () => {
    const createPort = vi.fn(() => ({ port: makeDeps().createPort('x')!.port, conversationId: 'C' }));
    const creatorChainOf = vi.fn(() => ['A', 'B']);
    const client = await connect(makeDeps({ createPort, creatorChainOf }), CREDENTIAL);

    const result = await client.callTool({ name: 'mage_create_session', arguments: { requestId: REQUEST, provider: 'claude', cwd: '/synthetic', prompt: 'p' } });

    expect(createPort).toHaveBeenCalledWith('session-1');
    expect(creatorChainOf).toHaveBeenCalledWith('C');
    expect(JSON.stringify(result)).toContain('delegation_depth_exceeded');
  });

  // P-038: las `mage_browser_*` vuelven (en la 0.1.4 estaban apagadas: la vista aparcada no se pintaba y ni el clic, ni
  // la escritura ni la captura llegaban; lo arregla `backgroundThrottling: false`, medido con spike/browser-agent-e2e.mjs).
  it('open_knownCallerWithBrowser_sessionAndBrowserTools', async () => {
    const browserFor = vi.fn(() => ({}) as BrowserToolsPort);
    const client = await connect(makeDeps({ browserFor }), CREDENTIAL);

    const { tools } = await client.listTools();

    const names = tools.map((tool) => tool.name);
    expect(names.filter((name) => !name.startsWith('mage_browser_')).sort()).toEqual(TOOLS);
    expect(names.filter((name) => name.startsWith('mage_browser_'))).toHaveLength(7);
    expect(browserFor).toHaveBeenCalledTimes(1);
  });

  it('open_unknownCallerWithBrowser_sevenToolsNoBrowserFor', async () => {
    const browserFor = vi.fn(() => ({}) as BrowserToolsPort);
    const client = await connect(makeDeps({ browserFor }), 'ff'.repeat(32));

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS);
    expect(browserFor).not.toHaveBeenCalled();
  });

  it('close_beforeServerStarts_noThrow', () => {
    const handle = createMcpConnector(makeDeps()).open({ callerCredential: null, send: vi.fn() });

    expect(() => handle.close()).not.toThrow();
  });
});
