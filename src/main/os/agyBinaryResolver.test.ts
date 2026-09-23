import { describe, expect, it } from 'vitest';
import { agyCommandName, findAgyBinary, resolveAgyBinary, type AgyResolverDeps } from './agyBinaryResolver';

// Ruta MEDIDA en Windows el 2026-08-11: %LOCALAPPDATA%\agy\bin\agy.exe.
const WINDOWS_PATH = 'C:\\Users\\u\\AppData\\Local\\agy\\bin\\agy.exe';

function deps(overrides: Partial<AgyResolverDeps> = {}): AgyResolverDeps {
  return {
    platform: 'win32',
    homedir: 'C:\\Users\\u',
    fileExists: () => false,
    commandInPath: () => false,
    ...overrides,
  };
}

describe('agyBinaryResolver', () => {
  it('agyCommandName_porPlataforma_devuelveElNombreDelBinario', () => {
    expect(agyCommandName('win32')).toBe('agy.exe');
    expect(agyCommandName('darwin')).toBe('agy');
    expect(agyCommandName('linux')).toBe('agy');
  });

  it('findAgyBinary_conOverride_ganaSobreTodoLoDemas', () => {
    const found = findAgyBinary(deps({ binOverride: 'D:\\mio\\agy.exe', fileExists: () => true, commandInPath: () => true }));

    expect(found).toBe('D:\\mio\\agy.exe');
  });

  it('findAgyBinary_overrideVacio_seIgnora', () => {
    const found = findAgyBinary(deps({ binOverride: '', commandInPath: () => true }));

    expect(found).toBe('agy.exe');
  });

  it('findAgyBinary_windowsConLocalAppData_devuelveEsaRuta', () => {
    const found = findAgyBinary(
      deps({ localAppData: 'C:\\Users\\u\\AppData\\Local', fileExists: (path) => path === WINDOWS_PATH }),
    );

    expect(found).toBe(WINDOWS_PATH);
  });

  // Sin %LOCALAPPDATA% en el entorno todavia se prueba su ubicacion convencional bajo HOME.
  it('findAgyBinary_windowsSinLocalAppData_caeAlCandidatoBajoHome', () => {
    const found = findAgyBinary(deps({ fileExists: (path) => path === WINDOWS_PATH }));

    expect(found).toBe(WINDOWS_PATH);
  });

  it('findAgyBinary_sinCandidatoPeroEnElPath_devuelveElNombreDelComando', () => {
    const found = findAgyBinary(deps({ platform: 'linux', homedir: '/home/u', commandInPath: () => true }));

    expect(found).toBe('agy');
  });

  // En POSIX no hay ninguna ruta de instalacion medida: NO se inventa ninguna, se resuelve por PATH.
  it('findAgyBinary_posix_noPruebaRutasNoMedidas', () => {
    const probed: string[] = [];
    findAgyBinary(
      deps({
        platform: 'darwin',
        homedir: '/Users/u',
        fileExists: (path) => {
          probed.push(path);
          return false;
        },
      }),
    );

    expect(probed).toEqual([]);
  });

  it('findAgyBinary_noInstalado_devuelveNull', () => {
    expect(findAgyBinary(deps())).toBeNull();
  });

  it('resolveAgyBinary_instalado_devuelveLaRuta', () => {
    expect(resolveAgyBinary(deps({ commandInPath: () => true }))).toBe('agy.exe');
  });

  // Un `spawn ENOENT` a secas no explica que hay que instalar `agy`: el error dice que hacer.
  it('resolveAgyBinary_noInstalado_lanzaDiciendoComoArreglarlo', () => {
    expect(() => resolveAgyBinary(deps())).toThrow(/MAGE_AGY_BIN/);
    expect(() => resolveAgyBinary(deps())).toThrow(/agy\.exe/);
  });
});
