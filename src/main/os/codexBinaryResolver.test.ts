import { describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@shared/i18n/localizedText';
import { codexCommandName, codexSpawnCommand, findCodexBinary, resolveCodexBinary, type CodexResolverDeps } from './codexBinaryResolver';

// Mismo contrato que los resolutores de Claude y `agy`: override -> candidato por SO -> PATH -> null.
// El `null` importa tanto como el hallazgo: es lo que decide que Proveedores NO liste Codex.

const WIN: CodexResolverDeps = {
  platform: 'win32',
  homedir: 'C:\\Users\\quien',
  fileExists: () => false,
  commandInPath: () => false,
  localAppData: 'C:\\Users\\quien\\AppData\\Local',
};

const POSIX: CodexResolverDeps = { ...WIN, platform: 'linux', homedir: '/home/quien', localAppData: undefined };

describe('codexCommandName', () => {
  it('win32_devuelveElExe', () => {
    expect(codexCommandName('win32')).toBe('codex.exe');
  });

  it('posix_devuelveElNombreDesnudo', () => {
    expect(codexCommandName('linux')).toBe('codex');
    expect(codexCommandName('darwin')).toBe('codex');
  });
});

describe('resolveCodexBinary', () => {
  it('resolveCodexBinary_noEstaInstalado_lanzaLaClaveConElNombreDelEjecutable', () => {
    expect(() => resolveCodexBinary(WIN)).toThrow(UserFacingError);
    try {
      resolveCodexBinary(WIN);
    } catch (err) {
      expect((err as UserFacingError).localized).toEqual({ key: 'errors.os.codexNotFound', values: { command: 'codex.exe' } });
    }
  });
});

describe('findCodexBinary', () => {
  it('conOverride_loDevuelveSinMirarNada', () => {
    const fileExists = vi.fn(() => true);
    const commandInPath = vi.fn(() => true);

    const found = findCodexBinary({ ...WIN, fileExists, commandInPath, binOverride: 'D:\\otro\\codex.exe' });

    expect(found).toBe('D:\\otro\\codex.exe');
    expect(fileExists).not.toHaveBeenCalled();
    expect(commandInPath).not.toHaveBeenCalled();
  });

  it('overrideVacio_seIgnora', () => {
    // Una variable de entorno definida pero vacia es "no configurada", no "usa la cadena vacia".
    const found = findCodexBinary({ ...WIN, binOverride: '', commandInPath: () => true });

    expect(found).toBe('codex.exe');
  });

  it('windows_conLocalAppData_encuentraLaRutaMedida', () => {
    // Ruta medida en la maquina del usuario el 2026-09-18 con codex-cli 0.144.4.
    const esperada = 'C:\\Users\\quien\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe';

    const found = findCodexBinary({ ...WIN, fileExists: (path) => path === esperada });

    expect(found).toBe(esperada);
  });

  it('windows_sinLocalAppData_caeAlEquivalenteBajoHome', () => {
    const esperada = 'C:\\Users\\quien\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe';

    const found = findCodexBinary({ ...WIN, localAppData: undefined, fileExists: (path) => path === esperada });

    expect(found).toBe(esperada);
  });

  it('sinCandidatos_peroEnElPath_devuelveElNombreDelComando', () => {
    const found = findCodexBinary({ ...POSIX, commandInPath: (bin) => bin === 'codex' });

    expect(found).toBe('codex');
  });

  it('niCandidatosNiPath_devuelveNull', () => {
    // El caso que de verdad importa: es lo que hace que Proveedores no liste a Codex.
    expect(findCodexBinary(POSIX)).toBeNull();
    expect(findCodexBinary(WIN)).toBeNull();
  });
});

const SCRIPT = 'C:\\repo\\scripts\\fake-codex-app-server.mjs';
const ELECTRON = 'C:\\repo\\node_modules\\electron\\dist\\electron.exe';
const INSTALLED = 'C:\\Users\\quien\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe';

describe('codexSpawnCommand', () => {
  it('codexSpawnCommand_scriptSinEmpaquetar_usaElNodeDeElectron', () => {
    const log = vi.fn();

    const result = codexSpawnCommand(['app-server'], { resolver: { ...WIN, binOverride: SCRIPT }, isPackaged: false, execPath: ELECTRON, log });

    expect(result).toEqual({ command: ELECTRON, args: [SCRIPT, 'app-server'], env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(log).not.toHaveBeenCalled();
  });

  it('codexSpawnCommand_scriptEmpaquetado_seIgnoraConAviso', () => {
    const log = vi.fn();

    const result = codexSpawnCommand(['app-server'], { resolver: { ...WIN, binOverride: SCRIPT, fileExists: (p) => p === INSTALLED }, isPackaged: true, execPath: ELECTRON, log });

    expect(result).toEqual({ command: INSTALLED, args: ['app-server'], env: {} });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('se ignora'), { binOverride: SCRIPT });
  });

  it('codexSpawnCommand_scriptEmpaquetadoSinCodex_lanzaElErrorDeSiempre', () => {
    expect(() => codexSpawnCommand(['app-server'], { resolver: { ...WIN, binOverride: SCRIPT }, isPackaged: true, execPath: ELECTRON, log: vi.fn() })).toThrow('No se encontro el CLI de Codex');
  });

  it('codexSpawnCommand_exe_igualQueHoy', () => {
    const result = codexSpawnCommand(['app-server'], { resolver: { ...WIN, binOverride: 'C:\\bin\\codex.exe' }, isPackaged: false, execPath: ELECTRON, log: vi.fn() });

    expect(result).toEqual({ command: 'C:\\bin\\codex.exe', args: ['app-server'], env: {} });
  });

  it('codexSpawnCommand_overrideVacio_igualQueHoy', () => {
    const result = codexSpawnCommand(['app-server'], { resolver: { ...POSIX, binOverride: '', commandInPath: () => true }, isPackaged: false, execPath: ELECTRON, log: vi.fn() });

    expect(result).toEqual({ command: 'codex', args: ['app-server'], env: {} });
  });

  it('codexSpawnCommand_extensionEnMayusculas_esScript', () => {
    const result = codexSpawnCommand(['app-server'], { resolver: { ...WIN, binOverride: 'C:\\x\\FAKE.JS' }, isPackaged: false, execPath: ELECTRON, log: vi.fn() });

    expect(result.command).toBe(ELECTRON);
    expect(result.args[0]).toBe('C:\\x\\FAKE.JS');
  });
});
