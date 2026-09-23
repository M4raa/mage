import { describe, expect, it, vi } from 'vitest';
import { isHttpsUrl, OpenWithService, type OpenWithDeps } from './openWithService';

function deps(overrides: Partial<OpenWithDeps> = {}): OpenWithDeps {
  return {
    reveal: vi.fn(),
    showSaveDialog: vi.fn(async () => '/dest/copia.txt'),
    copyFile: vi.fn(),
    fileExists: () => true,
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined),
    platform: 'win32',
    spawnDetached: vi.fn(),
    isCommandAvailable: () => false,
    env: { ProgramFiles: 'C:\\Program Files' },
    ...overrides,
  };
}

describe('isHttpsUrl', () => {
  it('isHttpsUrl_https_true', () => {
    expect(isHttpsUrl('https://status.claude.com')).toBe(true);
  });

  it('isHttpsUrl_esquemasPeligrososOLocales_false', () => {
    expect(isHttpsUrl('http://status.claude.com')).toBe(false);
    expect(isHttpsUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('ms-msdt:/id')).toBe(false);
  });

  it('isHttpsUrl_cadenaQueNoEsUrl_false', () => {
    expect(isHttpsUrl('')).toBe(false);
    expect(isHttpsUrl('status.claude.com')).toBe(false);
  });

  it('isHttpsUrl_esquemaEnMayusculas_true', () => {
    // El parser de URL normaliza el protocolo a minusculas: HTTPS sigue siendo https.
    expect(isHttpsUrl('HTTPS://status.claude.com')).toBe(true);
  });
});

describe('OpenWithService', () => {
  it('openExternal_urlHttps_laAbre', async () => {
    const d = deps();
    await new OpenWithService(d).openExternal('https://status.claude.com');

    expect(d.openExternal).toHaveBeenCalledWith('https://status.claude.com');
  });

  it('openExternal_esquemaNoHttps_lanzaYNoLlamaAlSo', async () => {
    const d = deps();

    await expect(new OpenWithService(d).openExternal('file:///C:/x.exe')).rejects.toThrow(/file:/);
    expect(d.openExternal).not.toHaveBeenCalled();
  });

  it('reveal_existingFile_callsReveal', () => {
    const d = deps();
    new OpenWithService(d).reveal('/tmp/a.txt');

    expect(d.reveal).toHaveBeenCalledWith('/tmp/a.txt');
  });

  it('reveal_missingFile_throwsWithPath', () => {
    const d = deps({ fileExists: () => false });

    expect(() => new OpenWithService(d).reveal('/tmp/x.txt')).toThrow(/\/tmp\/x\.txt/);
  });

  it('saveAs_userChoosesPath_copiesAndReturnsTrue', async () => {
    const d = deps({ showSaveDialog: vi.fn(async () => '/dest/copia.txt') });

    const saved = await new OpenWithService(d).saveAs('/tmp/a.txt');

    expect(saved).toBe(true);
    expect(d.copyFile).toHaveBeenCalledWith('/tmp/a.txt', '/dest/copia.txt');
  });

  it('saveAs_userCancels_returnsFalseAndDoesNotCopy', async () => {
    const d = deps({ showSaveDialog: vi.fn(async () => null) });

    const saved = await new OpenWithService(d).saveAs('/tmp/a.txt');

    expect(saved).toBe(false);
    expect(d.copyFile).not.toHaveBeenCalled();
  });

  it('saveAs_missingFile_throws', async () => {
    const d = deps({ fileExists: () => false });

    await expect(new OpenWithService(d).saveAs('/tmp/x.txt')).rejects.toThrow(/no existe/);
  });

  it('openPath_ok_llamaAOpenPathConLaRuta', async () => {
    const d = deps({ openPath: vi.fn(async () => '') });

    await new OpenWithService(d).openPath('/proj');

    expect(d.openPath).toHaveBeenCalledWith('/proj');
  });

  it('openPath_rutaVacia_lanza', async () => {
    await expect(new OpenWithService(deps()).openPath('  ')).rejects.toThrow(/vacia/i);
  });

  it('openPath_errorDelSO_lanzaConElMensaje', async () => {
    const d = deps({ openPath: vi.fn(async () => 'no such directory') });

    await expect(new OpenWithService(d).openPath('/no/existe')).rejects.toThrow(/no such directory/);
  });

  it('openTerminal_spawneaElComandoDelSOConElCwd', () => {
    const spawnDetached = vi.fn();
    const d = deps({ platform: 'darwin', spawnDetached });

    new OpenWithService(d).openTerminal('/proj');

    expect(spawnDetached).toHaveBeenCalledWith('open', ['-a', 'Terminal', '/proj'], '/proj');
  });

  it('openTerminal_cwdVacio_lanza', () => {
    expect(() => new OpenWithService(deps()).openTerminal('  ')).toThrow(/cwd/i);
  });

  it('listAvailableEditors_ningunoEnPath_devuelveVacio', () => {
    const d = deps({ isCommandAvailable: () => false });

    expect(new OpenWithService(d).listAvailableEditors()).toEqual([]);
  });

  it('listAvailableEditors_filtraPorDisponibilidad', () => {
    const d = deps({ isCommandAvailable: (bin) => bin === 'code' || bin === 'cursor' });

    const editors = new OpenWithService(d).listAvailableEditors();

    expect(editors.map((e) => e.bin)).toEqual(['code', 'cursor']);
  });

  it('openEditor_win32_lanzaViaCmdSlashCConElCwd', () => {
    const spawnDetached = vi.fn();
    const d = deps({ platform: 'win32', spawnDetached });

    new OpenWithService(d).openEditor('code', 'C:\\proj');

    expect(spawnDetached).toHaveBeenCalledWith('cmd', ['/c', 'code', 'C:\\proj'], 'C:\\proj');
  });

  it('openEditor_posix_lanzaElBinDirecto', () => {
    const spawnDetached = vi.fn();
    const d = deps({ platform: 'linux', spawnDetached });

    new OpenWithService(d).openEditor('cursor', '/proj');

    expect(spawnDetached).toHaveBeenCalledWith('cursor', ['/proj'], '/proj');
  });

  it('openEditor_cwdVacio_lanza', () => {
    expect(() => new OpenWithService(deps()).openEditor('code', ' ')).toThrow(/cwd/i);
  });

  it('openEditor_binVacio_lanza', () => {
    expect(() => new OpenWithService(deps()).openEditor('', '/proj')).toThrow(/bin/i);
  });

  it("openEditor_binFueraDelWhitelist_lanzaYNoLanzaProceso", () => {
    // B3: el bin llega del renderer y en Windows acaba en `cmd /c`, donde `&` encadena comandos.
    // Lo que se comprueba no es solo que lance: es que NO se haya spawneado nada.
    const spawned: string[] = [];
    const service = new OpenWithService({ ...deps(), spawnDetached: (command: string) => { spawned.push(command); } });

    expect(() => service.openEditor("code&calc", "/proj")).toThrow(/no permitido/i);
    expect(spawned).toEqual([]);
  });
});

// Fase 9.2: el alta de cuenta abre el login en ventana PRIVADA. Si no la hay, se abre igual en el
// navegador por defecto y se DEVUELVE 'normal' para que la UI avise: en un navegador con sesion ya
// iniciada, autorizar da de alta la cuenta equivocada sin que nadie se entere.
describe('OpenWithService.openPrivate', () => {
  const URL_LOGIN = 'https://claude.com/cai/oauth/authorize?code=true&state=abc';

  it('openPrivate_esquemaNoHttps_lanza', async () => {
    await expect(new OpenWithService(deps()).openPrivate('file:///etc/passwd')).rejects.toThrow(/https/i);
  });

  it('openPrivate_chromeInstaladoEnWindows_lanzaConIncognitoYLaUrlComoArgumentoSuelto', async () => {
    const spawnDetached = vi.fn();
    const service = new OpenWithService(
      deps({
        platform: 'win32',
        env: { ProgramFiles: 'C:\\Program Files' },
        fileExists: (path) => path.endsWith('chrome.exe'),
        spawnDetached,
      }),
    );

    const how = await service.openPrivate(URL_LOGIN);

    expect(how).toBe('private');
    expect(spawnDetached).toHaveBeenCalledWith(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      ['--incognito', URL_LOGIN],
      expect.any(String),
    );
  });

  it('openPrivate_soloEdge_usaInprivateQueEsSuBanderaPropia', async () => {
    const spawnDetached = vi.fn();
    const service = new OpenWithService(
      deps({
        platform: 'win32',
        env: { ProgramFiles: 'C:\\Program Files' },
        fileExists: (path) => path.endsWith('msedge.exe'),
        spawnDetached,
      }),
    );

    await service.openPrivate(URL_LOGIN);

    expect(spawnDetached.mock.calls[0]?.[1]).toEqual(['--inprivate', URL_LOGIN]);
  });

  it('openPrivate_firefoxEnLinux_seBuscaEnElPathNoEnDisco', async () => {
    const spawnDetached = vi.fn();
    const service = new OpenWithService(
      deps({
        platform: 'linux',
        env: {},
        fileExists: () => false, // en Linux el candidato es un COMANDO, no una ruta
        isCommandAvailable: (bin) => bin === 'firefox',
        spawnDetached,
      }),
    );

    const how = await service.openPrivate(URL_LOGIN);

    expect(how).toBe('private');
    expect(spawnDetached).toHaveBeenCalledWith('firefox', ['-private-window', URL_LOGIN], expect.any(String));
  });

  it('openPrivate_sinNingunNavegadorConocido_abreElPorDefectoYAvisa', async () => {
    const openExternal = vi.fn(async () => undefined);
    const spawnDetached = vi.fn();
    const service = new OpenWithService(
      deps({ platform: 'darwin', env: {}, fileExists: () => false, isCommandAvailable: () => false, openExternal, spawnDetached }),
    );

    const how = await service.openPrivate(URL_LOGIN);

    expect(how).toBe('normal'); // nunca se falla el login por esto
    expect(openExternal).toHaveBeenCalledWith(URL_LOGIN);
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('openPrivate_elNavegadorExistePeroNoArranca_caeAlPorDefectoYAvisa', async () => {
    const openExternal = vi.fn(async () => undefined);
    const service = new OpenWithService(
      deps({
        platform: 'darwin',
        env: {},
        fileExists: () => true,
        spawnDetached: vi.fn(() => {
          throw new Error('EACCES');
        }),
        openExternal,
      }),
    );

    expect(await service.openPrivate(URL_LOGIN)).toBe('normal');
    expect(openExternal).toHaveBeenCalledWith(URL_LOGIN);
  });
});
