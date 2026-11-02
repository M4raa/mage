import { describe, expect, it, vi } from 'vitest';
import { readInstallerLanguage } from './installerLanguage';

const FILE = 'C:/userData/installer-language';

function run(content: string | null) {
  const log = vi.fn();
  const readFile = vi.fn(() => content);
  const result = readInstallerLanguage({ filePath: FILE, readFile, log });
  return { result, log, readFile };
}

describe('readInstallerLanguage', () => {
  it('readInstallerLanguage_sinFichero_undefinedSinLog', () => {
    const { result, log } = run(null);

    expect(result).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ['es', 'es'],
    ['en\r\n', 'en'],
    [' es ', 'es'],
  ])('readInstallerLanguage_%j', (content, expected) => {
    const { result, log } = run(content);

    expect(result).toBe(expected);
    expect(log).not.toHaveBeenCalled();
  });

  it('readInstallerLanguage_valorRaro_undefinedYAvisa', () => {
    const { result, log } = run('fr');

    expect(result).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('warn', expect.any(String), expect.anything());
  });

  it('readInstallerLanguage_system_noSeAceptaDelInstalador', () => {
    const { result, log } = run('system');

    expect(result).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('readInstallerLanguage_leeLaRutaIndicada', () => {
    const { readFile } = run('es');

    expect(readFile).toHaveBeenCalledWith(FILE);
  });
});
