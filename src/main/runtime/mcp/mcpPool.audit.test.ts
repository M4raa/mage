import { expect, it } from 'vitest';
import { McpPool, type McpClientLike } from './mcpPool';

it('A11_listToolsRechazaTrasCerrar_noDuplicaCierreNiAnunciaConexion', async () => {
  let rejectListing: (error: Error) => void = () => undefined;
  let entered: () => void = () => undefined;
  const listingStarted = new Promise<void>(resolve => { entered = resolve; });
  const listing = new Promise<{ tools: [] }>((_resolve, reject) => { rejectListing = reject; });
  let closes = 0, changes = 0;
  const client: McpClientLike = { listTools: () => { entered(); return listing; },
    callTool: async () => ({ content: [] }), close: async () => { closes++; } };
  const pool = new McpPool([{ name: 'fixture', source: 'common', onlyIn: null, extra: {}, secrets: {},
    transport: 'stdio', command: 'fake', args: [], env: {}, cwd: null }], {
    connect: async () => client, notify: () => { throw new Error('No avisar tras cerrar'); },
    loginRequired: () => undefined, onChange: () => { changes++; },
  });
  const ready = pool.start();
  await listingStarted; await pool.close();
  expect(closes).toBe(1);
  rejectListing(new Error('listing failed'));
  await ready; await pool.close();
  expect(closes).toBe(1);
  expect(changes).toBe(0);
  expect(pool.tools()).toEqual([]);
});

it('A11_cerrarDuranteListTools_cierraElClienteYaConectado', async () => {
    let finishListing: (value: { tools: [] }) => void = () => undefined;
    let enteredListing: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => { enteredListing = resolve; });
    const listing = new Promise<{ tools: [] }>((resolve) => { finishListing = resolve; });
    let closes = 0;
    const client: McpClientLike = {
      listTools: () => { enteredListing(); return listing; },
      callTool: async () => ({ content: [] }), close: async () => { closes++; },
    };
    const pool = new McpPool([{ name: 'fixture', source: 'common', onlyIn: null, extra: {}, secrets: {},
      transport: 'stdio', command: 'fake', args: [], env: {}, cwd: null }], {
      connect: async () => client, notify: () => undefined, loginRequired: () => undefined, onChange: () => undefined,
    });
    const ready = pool.start();
    await entered; await pool.close();
    expect(closes).toBe(1);
    finishListing({ tools: [] }); await ready;
    await pool.close();
    expect(closes).toBe(1);
  });
