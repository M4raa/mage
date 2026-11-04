import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BrowserControlError } from '../browser/browserRegistry';
import { BROWSER_TOOL_DESCRIPTIONS, type BrowserToolsPort } from './browserTools';
import { MemoryIdempotencyStore } from './idempotencyStore';
import { MemorySessionsPort } from './memorySessionsPort';
import { startMageMcpServer } from './server';

const NOW = '2026-11-04T12:00:00.000Z';
const URL = 'http://localhost:4000/';
const PNG = Buffer.from('png').toString('base64');
const SEVEN = ['mage_ask_creator', 'mage_cancel', 'mage_create_session', 'mage_get_status', 'mage_list_sessions', 'mage_read_result', 'mage_send'];
const BROWSER_TOOLS = ['mage_browser_back', 'mage_browser_click', 'mage_browser_close', 'mage_browser_navigate', 'mage_browser_read_dom', 'mage_browser_screenshot', 'mage_browser_type'];

function fakeBrowser() {
  return {
    navigate: vi.fn(async (_url: string) => ({ url: URL, title: 'Prueba' })),
    screenshot: vi.fn(async (annotate: boolean) => ({ png: PNG, url: URL, elementsText: annotate ? '1: button "Enviar" (10,20,30,40)' : '', annotated: annotate })),
    readDom: vi.fn(async () => ({ url: URL, elements: [{ id: 1, role: 'button', name: 'Enviar', rectDip: [10, 20, 30, 40] as [number, number, number, number] }] })),
    click: vi.fn(async () => ({ url: URL })),
    type: vi.fn(async () => ({ url: URL })),
    back: vi.fn(async () => ({ navigated: true })),
    close: vi.fn(async () => ({ closed: true })),
  };
}

const connections: { client: Client; server: McpServer }[] = [];
async function connect(browser: ReturnType<typeof fakeBrowser> = fakeBrowser()) {
  const port = new MemorySessionsPort({ targets: [], now: () => NOW, newConversationId: () => 'created-1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = await startMageMcpServer({
    port, scope: { accountIds: ['a'] }, store: new MemoryIdempotencyStore(), now: () => NOW,
    transport: serverTransport, browser: browser as BrowserToolsPort,
  });
  const client = new Client({ name: 'mage-test', version: '1' });
  connections.push({ client, server });
  await client.connect(clientTransport);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name: `mage_browser_${name}`, arguments: args });
  return { browser, client, call };
}
afterEach(async () => {
  for (const { client, server } of connections.splice(0)) {
    await client.close();
    await server.close();
  }
});

function textOf(result: Awaited<ReturnType<Client['callTool']>>, index = 0): string {
  return (result.content as { text: string }[])[index]!.text;
}

describe('mage_browser_* tools', () => {
  it('listTools_withBrowser_fourteenToolsBrowserStrict', async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([...SEVEN, ...BROWSER_TOOLS].sort());
    for (const tool of tools.filter((candidate) => candidate.name.startsWith('mage_browser_'))) {
      const key = tool.name.replace('mage_browser_', '') as keyof typeof BROWSER_TOOL_DESCRIPTIONS;
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description).toBe(BROWSER_TOOL_DESCRIPTIONS[key]);
    }
  });

  it('navigate_callsPortWithUrl_structured', async () => {
    const { call, browser } = await connect();

    const result = await call('navigate', { url: 'localhost:4000' });

    expect(browser.navigate).toHaveBeenCalledWith('localhost:4000');
    expect(result.structuredContent).toEqual({ url: URL, title: 'Prueba' });
  });

  it('screenshot_annotated_imageThenText', async () => {
    const { call, browser } = await connect();

    const result = await call('screenshot', { annotate: true });

    expect(browser.screenshot).toHaveBeenCalledWith(true);
    expect((result.content as unknown[])[0]).toEqual({ type: 'image', mimeType: 'image/png', data: PNG });
    expect(textOf(result, 1)).toContain(URL);
    expect(textOf(result, 1)).toContain('Elementos:');
  });

  it('screenshot_notAnnotated_noElementsLine', async () => {
    const { call, browser } = await connect();

    const result = await call('screenshot');

    expect(browser.screenshot).toHaveBeenCalledWith(false);
    expect(textOf(result, 1)).toBe(`URL: ${URL}`);
  });

  it('click_bothTargets_invalidInput', async () => {
    const { call, browser } = await connect();

    const result = await call('click', { elementId: 1, x: 5, y: 5 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('invalid_input');
    expect(browser.click).not.toHaveBeenCalled();
  });

  it('click_noTarget_invalidInput', async () => {
    const { call } = await connect();

    const result = await call('click', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('invalid_input');
  });

  it('click_xy_passesPoint', async () => {
    const { call, browser } = await connect();

    const result = await call('click', { x: 5, y: 7 });

    expect(browser.click).toHaveBeenCalledWith({ x: 5, y: 7 });
    expect(result.structuredContent).toEqual({ url: URL });
  });

  it('readDom_maxNodesOver200_isError', async () => {
    const { call, browser } = await connect();

    const result = await call('read_dom', { maxNodes: 201 });

    expect(result.isError).toBe(true);
    expect(browser.readDom).not.toHaveBeenCalled();
  });

  it('type_emptyText_isError', async () => {
    const { call, browser } = await connect();

    const result = await call('type', { elementId: 1, text: '' });

    expect(result.isError).toBe(true);
    expect(browser.type).not.toHaveBeenCalled();
  });

  it('port_controlError_codeReachesAgent', async () => {
    const browser = fakeBrowser();
    browser.back.mockRejectedValueOnce(new BrowserControlError('browser_user_in_control', 'El usuario ha tomado el control del navegador: espera a que lo devuelva'));
    const { call } = await connect(browser);

    const result = await call('back');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^browser_user_in_control:/);
  });

  it('port_plainError_browserFailed', async () => {
    const browser = fakeBrowser();
    browser.click.mockRejectedValueOnce(new Error('El elemento 5 no existe'));
    const { call } = await connect(browser);

    const result = await call('click', { elementId: 5 });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('browser_failed: El elemento 5 no existe');
  });
});
