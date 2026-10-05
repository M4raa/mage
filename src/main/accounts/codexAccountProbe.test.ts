import { describe, expect, it, vi } from 'vitest';
import { probeCodexAccount } from './codexAccountProbe';

function setup(includeApps = true) {
  let stdout: (chunk: string) => void = () => undefined;
  let exit: () => void = () => undefined;
  const written: { id: string; method: string; params?: unknown }[] = [];
  const killTree = vi.fn();
  const done = probeCodexAccount({ timeoutMs: 1_000, spawnProbe: () => ({
    onStdout: (listener) => { stdout = listener; }, onExit: (listener) => { exit = listener; },
    writeLine: (line) => { written.push(JSON.parse(line)); }, endInput: () => undefined, killTree,
  }) }, { home: '/isolated', includeApps });
  const reply = (result: unknown) => stdout(JSON.stringify({ id: written.at(-1)?.id, result }) + '\n');
  return { done, written, reply, stdout: (line: string) => stdout(line), exit: () => exit(), killTree };
}

describe('probeCodexAccount', () => {
  it('probe_cuentaValidaYAppsPaginadas_devuelveSoloMetadataSinTurnos', async () => {
    const probe = setup();
    probe.reply({});
    probe.reply({ account: { type: 'chatgpt', email: 'private@example.test', token: 'secret' } });
    probe.reply({ data: [{ id: 'one', name: 'Uno', isEnabled: true, isAccessible: true, secret: 'secret' }], nextCursor: 'next' });
    probe.reply({ data: [{ id: 'two', name: 'Dos', isEnabled: false, isAccessible: true }], nextCursor: null });
    const result = await probe.done;
    expect(result.authenticated).toBe(true);
    expect(result.apps?.map((app) => app.name)).toEqual(['Uno', 'Dos']);
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
    expect(probe.written.map((request) => request.method)).toEqual(['initialize', 'initialized', 'account/read', 'app/list', 'app/list']);
    expect(probe.killTree).toHaveBeenCalledOnce();
  });

  it('probe_appsFallanAutenticado_noInventaListaVaciaNiExponeErrorCrudo', async () => {
    const probe = setup();
    probe.reply({});
    probe.reply({ account: { type: 'chatgpt' } });
    probe.stdout(JSON.stringify({ id: 'mage-codex-apps', error: { code: -32603, message: 'Bearer secret' } }) + '\n');
    expect(await probe.done).toEqual({ authenticated: true, apps: null, error: 'Codex rechazó la consulta de Apps (código -32603).' });
  });

  it('probe_sinCuenta_noConsultaApps', async () => {
    const probe = setup();
    probe.reply({});
    probe.reply({ account: null });
    expect(await probe.done).toEqual({ authenticated: false, apps: [], error: null });
    expect(probe.written.some((request) => request.method === 'app/list')).toBe(false);
  });

  it('probe_soloLogin_noConsultaApps', async () => {
    const probe = setup(false);
    probe.reply({});
    probe.reply({ account: { type: 'chatgpt' } });
    expect((await probe.done).authenticated).toBe(true);
    expect(probe.written.some((request) => request.method === 'app/list')).toBe(false);
  });

  it('probe_jsonRotoYSalidaPrematura_errorSinContenido', async () => {
    const probe = setup();
    probe.stdout('aviso no JSON\n');
    probe.exit();
    expect((await probe.done).authenticated).toBeNull();
    expect(probe.killTree).toHaveBeenCalledOnce();
  });

  it('probe_cursorRepetido_terminaSinBucle', async () => {
    const probe = setup();
    probe.reply({});
    probe.reply({ account: { type: 'chatgpt' } });
    probe.reply({ data: [], nextCursor: 'same' });
    probe.reply({ data: [], nextCursor: 'same' });
    expect((await probe.done).error).toContain('cursor');
  });
});
