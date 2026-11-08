// Escenario `approval` del app-server falso de Codex: por stdin/stdout, sin red.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SERVER = fileURLToPath(new URL('./fake-codex-app-server.mjs', import.meta.url));
let child = null;

// Arranca el falso; `send` escribe una linea y `next` espera la siguiente linea que escribe el servidor.
function start(scenario) {
  const env = { ...process.env, ...(scenario === undefined ? {} : { MAGE_FAKE_CODEX_SCENARIO: scenario }) };
  child = spawn(process.execPath, [SERVER], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  const waiting = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const resolve = waiting.shift();
    if (resolve === undefined) lines.push(message);
    else resolve(message);
  });
  return {
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    next: () => (lines.length > 0 ? Promise.resolve(lines.shift()) : new Promise((resolve) => waiting.push(resolve))),
  };
}

afterEach(async () => {
  if (child === null) return;
  child.kill();
  await once(child, 'exit');
  child = null;
});

describe('fake-codex-app-server escenario approval', () => {
  it('turn/start_conEscenario_respondeYPideUnPermisoPorTurno', async () => {
    const server = start('approval');
    server.send({ jsonrpc: '2.0', id: 1, method: 'thread/start', params: { model: 'm' } });
    const thread = await server.next();
    server.send({ jsonrpc: '2.0', id: 2, method: 'turn/start', params: {} });

    const turn = await server.next();
    const approval = await server.next();
    server.send({ jsonrpc: '2.0', id: approval.id, result: { decision: 'accept' } });
    const resolved = await server.next();
    const completed = await server.next();
    server.send({ jsonrpc: '2.0', id: 3, method: 'turn/start', params: {} });
    await server.next();
    const second = await server.next();

    expect(thread.result.thread.id).toMatch(/^fake-thread-/);
    expect(turn.result.turn.id).toBe('fake-turn-1');
    expect(approval).toMatchObject({ method: 'item/commandExecution/requestApproval', params: { command: 'echo mage-host-tab' } });
    expect(resolved.method).toBe('serverRequest/resolved');
    expect(completed).toMatchObject({ method: 'turn/completed', params: { turn: { id: 'fake-turn-1', status: 'completed' } } });
    expect(second.id).not.toBe(approval.id);
  });

  it('thread/start_sinEscenario_noSoportado', async () => {
    const server = start();
    server.send({ jsonrpc: '2.0', id: 1, method: 'thread/start', params: {} });

    const reply = await server.next();

    expect(reply.error.code).toBe(-32601);
  });
});
