import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { AgyLoginService, type AgyLoginDeps } from './agyLoginService';

const URL_LINE = 'Authentication required. Please visit the URL to log in:\n  https://accounts.google.com/o/oauth2/auth?client_id=x&state=y\n\nWaiting for authentication (timeout 60s)...\nOr, paste the authorization code here and press Enter:';

function fakeChild() {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & { stdout: EventEmitter; stderr: EventEmitter };
  Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { write: vi.fn() }, exitCode: null });
  return child;
}

function setup(over: Partial<AgyLoginDeps> = {}) {
  const child = fakeChild();
  let token = false;
  const deps: AgyLoginDeps = {
    spawnLogin: () => child,
    openUrl: vi.fn().mockResolvedValue(undefined),
    killTree: vi.fn(),
    sendCode: vi.fn().mockResolvedValue(undefined),
    tokenExists: () => token,
    urlTimeoutMs: 1000,
    authTimeoutMs: 1000,
    pollMs: 5,
    settleMs: 5,
    exitWaitMs: 20,
    ...over,
  };
  return { service: new AgyLoginService(deps), child, deps, writeToken: () => { token = true; } };
}

describe('AgyLoginService', () => {
  it('start_agyImprimeLaUrl_laAbreYLaDevuelve', async () => {
    const { service, child, deps } = setup();
    const started = service.start('C:\perfil');

    child.stdout.emit('data', Buffer.from(URL_LINE));

    await expect(started).resolves.toMatchObject({ status: 'url', url: 'https://accounts.google.com/o/oauth2/auth?client_id=x&state=y', timeoutMs: 1000 });
    expect(deps.openUrl).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?client_id=x&state=y');
    await service.cancel();
  });

  it('submitCode_codigoValidoYTokenEscrito_devuelveOkYEntregaElCodigoALaConsola', async () => {
    const { service, child, writeToken, deps } = setup();
    const started = service.start('C:\perfil');
    child.stdout.emit('data', Buffer.from(URL_LINE));
    await started;

    const pending = service.submitCode('  4/0AbCdEfGh-ijkLmn_12345  ');
    writeToken();

    await expect(pending).resolves.toEqual({ status: 'ok' });
    expect(deps.sendCode).toHaveBeenCalledWith(child, '4/0AbCdEfGh-ijkLmn_12345');
  });

  it('submitCode_formatoInvalido_noEntregaNada', async () => {
    const { service, child, deps } = setup();
    const started = service.start('C:\perfil');
    child.stdout.emit('data', Buffer.from(URL_LINE));
    await started;

    await expect(service.submitCode('dos palabras')).resolves.toEqual({ status: 'error', reason: 'invalid_code_format' });
    await expect(service.submitCode('')).resolves.toEqual({ status: 'error', reason: 'invalid_code_format' });

    expect(deps.sendCode).not.toHaveBeenCalled();
    await service.cancel();
  });

  it('submitCode_sinLoginEnCurso_error', async () => {
    await expect(setup().service.submitCode('4/0AbCdEfGh')).resolves.toEqual({ status: 'error', reason: 'no_login_in_progress' });
  });

  it('submitCode_agySeCierraSinToken_errorAgyExit', async () => {
    const { service, child } = setup();
    const started = service.start('C:\perfil');
    child.stdout.emit('data', Buffer.from(URL_LINE));
    await started;

    const pending = service.submitCode('4/0AbCdEfGh');
    child.emit('exit', 1);

    await expect(pending).resolves.toEqual({ status: 'error', reason: 'agy_exit' });
  });

  it('start_agyNoImprimeLaUrl_timeoutDeUrl', async () => {
    const { service } = setup({ urlTimeoutMs: 20 });

    await expect(service.start('C:\perfil')).resolves.toEqual({ status: 'error', reason: 'url_timeout' });
  });

  it('start_pasanLos60SinCodigo_elProcesoSeCortaPorTiempo', async () => {
    const { service, child, deps } = setup({ authTimeoutMs: 20 });
    const started = service.start('C:\perfil');
    child.stdout.emit('data', Buffer.from(URL_LINE));
    await started;

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(deps.killTree).toHaveBeenCalledTimes(1);
    await expect(service.submitCode('4/0AbCdEfGh')).resolves.toEqual({ status: 'error', reason: 'no_login_in_progress' });
  });

  it('submitCode_googleRechazaElCodigo_agyLoDiceAlInstanteYSeDevuelveCodeRejected', async () => {
    const { service, child } = setup();
    const started = service.start('C:\perfil');
    child.stdout.emit('data', Buffer.from(URL_LINE));
    await started;

    const pending = service.submitCode('4/0AbCdEfGh');
    child.stderr.emit('data', Buffer.from('Error: authentication failed: token exchange failed: oauth2: "invalid_grant" "Bad Request"'));

    await expect(pending).resolves.toEqual({ status: 'error', reason: 'code_rejected' });
  });

  it('submitCode_noSePuedeEscribirEnLaConsola_errorConsoleInputFailed', async () => {
    const { service, child, deps } = setup();
    vi.mocked(deps.sendCode).mockRejectedValueOnce(new Error('AttachConsole fallo: 5'));
    const started = service.start('C:\perfil');
    child.stdout.emit('data', Buffer.from(URL_LINE));
    await started;

    await expect(service.submitCode('4/0AbCdEfGh')).resolves.toEqual({ status: 'error', reason: 'console_input_failed' });
  });

  it('cancel_loginEnCurso_esperaALaSalidaDeAgy', async () => {
    const { service, child } = setup();
    const started = service.start('C:\perfil');
    child.stdout.emit('data', Buffer.from(URL_LINE));
    await started;
    let resolved = false;

    const cancelling = service.cancel().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    child.emit('exit', 1);
    await cancelling;

    expect(resolved).toBe(true);
  });

  it('cancel_loginEnCurso_matasuArbol', async () => {
    const { service, child, deps } = setup();
    const started = service.start('C:\perfil');
    child.stdout.emit('data', Buffer.from(URL_LINE));
    await started;

    await service.cancel();

    expect(deps.killTree).toHaveBeenCalledTimes(1);
  });

  it('start_noSePuedeLanzar_errorSpawnFailed', async () => {
    const { service, child } = setup();
    const started = service.start('C:\perfil');

    child.emit('error', new Error('ENOENT'));

    await expect(started).resolves.toEqual({ status: 'error', reason: 'spawn_failed' });
  });
});
