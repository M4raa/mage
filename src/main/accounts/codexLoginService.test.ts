import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { CodexLoginService } from './codexLoginService';

// Proceso de mentira del app-server: registra lo que se le escribe y deja contestar por stdout.
function fakeAppServer(): { child: ChildProcessWithoutNullStreams; written: unknown[]; reply: (message: unknown) => void } {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: () => void };
  stdout.setEncoding = () => undefined;
  const written: unknown[] = [];
  Object.assign(child, { stdout, stdin: { write: (line: string) => written.push(JSON.parse(line)) } });
  return { child, written, reply: (message) => stdout.emit('data', `${JSON.stringify(message)}\n`) };
}

function setup(): { service: CodexLoginService; server: ReturnType<typeof fakeAppServer>; openUrl: ReturnType<typeof vi.fn>; killTree: ReturnType<typeof vi.fn> } {
  const server = fakeAppServer();
  const openUrl = vi.fn(() => Promise.resolve());
  const killTree = vi.fn();
  const service = new CodexLoginService({ spawnAppServer: () => server.child, openUrl, killTree, timeoutMs: 60_000 });
  return { service, server, openUrl, killTree };
}

// Forma del esquema de `codex app-server generate-json-schema` 0.144.4 (sin verificar con cuenta).
describe('CodexLoginService', () => {
  it('login_flujoCompleto_abreLaUrlYTerminaConOk', async () => {
    const { service, server, openUrl, killTree } = setup();
    const done = service.login('C:\\Users\\u\\.codex-chatgpt');

    server.reply({ id: 1, result: {} });
    expect(server.written.map((m) => (m as { method?: string }).method)).toEqual(['initialize', 'initialized', 'account/login/start']);
    server.reply({ id: 2, result: { type: 'chatgpt', authUrl: 'https://auth.openai.com/x', loginId: 'l1' } });
    server.reply({ method: 'account/login/completed', params: { success: true, loginId: 'l1' } });

    expect(await done).toEqual({ status: 'ok' });
    expect(openUrl).toHaveBeenCalledWith('https://auth.openai.com/x');
    expect(killTree).toHaveBeenCalledTimes(1);
  });

  it('login_fallido_errorConElMotivo', async () => {
    const { service, server } = setup();
    const done = service.login('h');
    server.reply({ method: 'account/login/completed', params: { success: false, error: 'denied' } });

    expect(await done).toEqual({ status: 'error', reason: 'login_failed_denied' });
  });

  it('cancel_conLoginEnCurso_cancelled', async () => {
    const { service } = setup();
    const done = service.login('h');

    service.cancel();

    expect(await done).toEqual({ status: 'cancelled', reason: 'login_cancelled' });
  });

  it('login_respuestaSinAuthUrl_error', async () => {
    const { service, server } = setup();
    const done = service.login('h');
    server.reply({ id: 2, result: { type: 'chatgpt' } });

    expect(await done).toMatchObject({ status: 'error', reason: 'login_without_auth_url' });
  });
});
