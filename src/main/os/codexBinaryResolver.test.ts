import { describe, expect, it, vi } from 'vitest';
import { codexCommandName, findCodexBinary, type CodexResolverDeps } from './codexBinaryResolver';

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
