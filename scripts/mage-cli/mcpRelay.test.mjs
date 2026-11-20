import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { MAGE_MCP_CALLER_ENV as MAIN_ENV } from '../../src/main/host/mcpCallers.ts';
import { createMessages } from './messages.mjs';
import { MAGE_MCP_CALLER_ENV, runMcpRelay } from './mcpRelay.mjs';

const messages = createMessages('es');
const CALLER = 'ab'.repeat(32);
const tick = () => new Promise((resolve) => setImmediate(resolve));

function collector() {
  const chunks = [];
  return { write: (text) => { chunks.push(text); return true; }, text: () => chunks.join('') };
}

async function start({ env = {}, connect, access = 'tunnel' } = {}) {
  const socket = new EventEmitter();
  let notify = () => undefined;
  const rpc = { notify: vi.fn(), close: vi.fn(), onNotification: (listener) => { notify = listener; } };
  const stdin = new PassThrough();
  const stdout = collector();
  const stderr = collector();
  const exit = vi.fn();
  const connectFn = connect ?? vi.fn(async () => ({ rpc, socket, hello: { protocol: '1.8', access } }));
  await runMcpRelay({ connect: connectFn, stdin, stdout, stderr, env, messages, exit });
  return { rpc, socket, stdin, stdout, stderr, exit, connect: connectFn, hostSays: (method, params) => notify(method, params) };
}

describe('runMcpRelay — acceso (host 1.8)', () => {
  it('relay_hostSoloDaLectura_saleConMotivoSinReenviarNada', async () => {
    const h = await start({ access: 'read' });

    h.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    await tick();

    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.stderr.text()).toContain(messages.mcpNotMageSession());
    expect(h.rpc.close).toHaveBeenCalledTimes(1);
    expect(h.rpc.notify).not.toHaveBeenCalled();
  });

  it.each(['tunnel', 'full'])('relay_acceso_%s_reenvia', async (access) => {
    const h = await start({ access });

    h.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    await tick();

    expect(h.exit).not.toHaveBeenCalled();
    expect(h.rpc.notify).toHaveBeenCalledTimes(1);
  });

  it('relay_hostAnteriorSinAccess_reenvia', async () => {
    const rpc = { notify: vi.fn(), close: vi.fn(), onNotification: () => undefined };
    const h = await start({ connect: async () => ({ rpc, socket: new EventEmitter(), hello: { protocol: '1.7' } }) });

    h.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    await tick();

    expect(h.exit).not.toHaveBeenCalled();
    expect(rpc.notify).toHaveBeenCalledTimes(1);
  });
});

describe('runMcpRelay', () => {
  it('relay_stdinLine_notifiesHost', async () => {
    const h = await start();

    h.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    await tick();

    expect(h.rpc.notify).toHaveBeenCalledWith('mcp.message', { message: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  });

  it('relay_hostNotification_writesLineToStdout', async () => {
    const h = await start();

    h.hostSays('mcp.message', { message: { jsonrpc: '2.0', id: 1, result: {} } });
    h.hostSays('event', { x: 1 });

    expect(h.stdout.text()).toBe('{"jsonrpc":"2.0","id":1,"result":{}}\n');
  });

  it('relay_badJsonLine_stderrAndContinues', async () => {
    const h = await start();

    h.stdin.write('esto no es json SECRET_SENTINEL\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    await tick();

    expect(h.stderr.text()).toContain(messages.mcpBadLine());
    expect(h.stderr.text()).not.toContain('SECRET_SENTINEL');
    expect(h.stdout.text()).toBe('');
    expect(h.rpc.notify).toHaveBeenCalledTimes(1);
  });

  it('relay_stdinEnd_closesAndExit0', async () => {
    const h = await start();

    h.stdin.end();
    await tick();

    expect(h.rpc.close).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.exit).toHaveBeenCalledTimes(1);
  });

  it('relay_noHost_stderrExit1NeverStarts', async () => {
    const connect = vi.fn(async () => { throw Object.assign(new Error('No hay un Mage escuchando'), { cause: { code: 'ENOENT' } }); });

    const h = await start({ connect });

    expect(h.stderr.text()).toBe(`${messages.mcpNoHost()}\n`);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.stdout.text()).toBe('');
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('relay_otherConnectError_stderrExit1', async () => {
    const connect = vi.fn(async () => { throw new Error('El servidor del pipe no es el de Mage'); });

    const h = await start({ connect });

    expect(h.stderr.text()).toBe(`${messages.mcpConnectFailed('El servidor del pipe no es el de Mage')}\n`);
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it('relay_hostCloses_exit1', async () => {
    const h = await start();

    h.socket.emit('close');

    expect(h.stderr.text()).toContain(messages.mcpHostClosed());
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it('relay_callerFromEnv_passedToConnect', async () => {
    const h = await start({ env: { [MAGE_MCP_CALLER_ENV]: CALLER } });

    expect(h.connect).toHaveBeenCalledWith({ kind: 'mcp', caller: CALLER });
    expect(h.stderr.text()).not.toContain(CALLER);
  });

  it('relay_callerEnvName_matchesMain', () => {
    expect(MAGE_MCP_CALLER_ENV).toBe(MAIN_ENV);
  });
});
