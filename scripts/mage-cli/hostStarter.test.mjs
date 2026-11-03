import { describe, expect, it, vi } from 'vitest';
import { ensureHost, headlessLaunch, isNoHostError } from './hostStarter.mjs';

const ENOENT = Object.assign(new Error('no hay'), { code: 'ENOENT' });

function fakeClock() {
  let time = 0;
  return { now: () => time, sleep: vi.fn(async (ms) => { time += ms; }) };
}

function starterDeps(overrides = {}) {
  const clock = fakeClock();
  return { connect: vi.fn(async () => 'link'), launch: vi.fn(), onStarting: vi.fn(), allowStart: true, ...clock, ...overrides };
}

describe('isNoHostError', () => {
  it.each([
    ['ENOENT', { code: 'ENOENT' }, true],
    ['ECONNREFUSED', { code: 'ECONNREFUSED' }, true],
    ['causaENOENT', new Error('No hay…', { cause: { code: 'ENOENT' } }), true],
    ['impostor', new Error('El servidor del pipe no es el de Mage'), false],
    ['codigoJsonRpc', { code: -32002 }, false],
    ['undefined', undefined, false],
  ])('isNoHostError_%s', (_name, error, expected) => {
    expect(isNoHostError(error)).toBe(expected);
  });
});

describe('headlessLaunch', () => {
  const base = { platform: 'win32', execPath: 'C:\\M\\Mage.exe', isElectron: true, env: { ELECTRON_RUN_AS_NODE: '1', PATH: 'p' }, userDataDir: 'C:\\U\\Mage', defaultUserDataDir: 'C:\\U\\Mage' };

  it('headlessLaunch_windows', () => {
    const plan = headlessLaunch(base);

    expect(plan).toEqual({ command: 'C:\\M\\Mage.exe', args: ['--headless'], env: { PATH: 'p' } });
    expect(base.env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('headlessLaunch_linuxConPerfilPropio', () => {
    const plan = headlessLaunch({ ...base, platform: 'linux', userDataDir: '/tmp/p', defaultUserDataDir: '/home/u/.config/Mage' });

    expect(plan.args).toEqual(['--headless', '--ozone-platform=headless', '--user-data-dir=/tmp/p']);
  });

  it('headlessLaunch_appImage_usaLaRutaDelAppImage', () => {
    const plan = headlessLaunch({ ...base, env: { APPIMAGE: '/home/u/Mage.AppImage' } });

    expect(plan.command).toBe('/home/u/Mage.AppImage');
  });

  it('headlessLaunch_noElectron_lanza', () => {
    expect(() => headlessLaunch({ ...base, isElectron: false })).toThrow('No sé arrancar Mage desde aquí');
  });
});

describe('ensureHost', () => {
  it('ensureHost_hostVivo_noArranca', async () => {
    const deps = starterDeps();

    const result = await ensureHost(deps);

    expect(result).toEqual({ link: 'link', started: false });
    expect(deps.launch).not.toHaveBeenCalled();
  });

  it('ensureHost_sinHost_arrancaYEspera', async () => {
    const connect = vi.fn().mockRejectedValueOnce(ENOENT).mockRejectedValueOnce(ENOENT).mockResolvedValue('link');
    const deps = starterDeps({ connect });

    const result = await ensureHost(deps);

    expect(result).toEqual({ link: 'link', started: true });
    expect(deps.launch).toHaveBeenCalledTimes(1);
    expect(deps.onStarting).toHaveBeenCalledTimes(1);
  });

  it('ensureHost_sinHostYSinPermiso_relanzaSinArrancar', async () => {
    const deps = starterDeps({ connect: vi.fn().mockRejectedValue(ENOENT), allowStart: false });

    await expect(ensureHost(deps)).rejects.toBe(ENOENT);
    expect(deps.launch).not.toHaveBeenCalled();
  });

  it('ensureHost_impostor_relanzaSinArrancar', async () => {
    const impostor = new Error('El servidor del pipe no es el de Mage');
    const deps = starterDeps({ connect: vi.fn().mockRejectedValue(impostor) });

    await expect(ensureHost(deps)).rejects.toBe(impostor);
    expect(deps.launch).not.toHaveBeenCalled();
  });

  it('ensureHost_noLlegaNunca_timeoutConDiagnostico', async () => {
    const deps = starterDeps({ connect: vi.fn().mockRejectedValue(ENOENT), timeoutMs: 1000, pollMs: 250 });

    await expect(ensureHost(deps)).rejects.toThrow('Mage no respondió en 1 s');
  });

  it('ensureHost_errorDistintoTrasArrancar_loRelanza', async () => {
    const other = new Error('otro fallo');
    const connect = vi.fn().mockRejectedValueOnce(ENOENT).mockRejectedValue(other);
    const deps = starterDeps({ connect });

    await expect(ensureHost(deps)).rejects.toBe(other);
  });
});
