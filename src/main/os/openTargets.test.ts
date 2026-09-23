import { describe, expect, it } from 'vitest';
import { buildOpenEditorCommand, buildOpenTerminalCommand, EDITOR_CANDIDATES } from './openTargets';

describe('buildOpenTerminalCommand', () => {
  it('win32_abreNuevaVentanaDeCmd', () => {
    expect(buildOpenTerminalCommand('win32', 'C:\\proj')).toEqual({ command: 'cmd', args: ['/c', 'start', '', 'cmd'] });
  });

  it('darwin_abreTerminalConElPathComoArgumento', () => {
    expect(buildOpenTerminalCommand('darwin', '/proj')).toEqual({ command: 'open', args: ['-a', 'Terminal', '/proj'] });
  });

  it('linux_usaEmuladorEstandar', () => {
    expect(buildOpenTerminalCommand('linux', '/proj')).toEqual({ command: 'x-terminal-emulator', args: [] });
  });

  it('cwdVacio_lanza', () => {
    expect(() => buildOpenTerminalCommand('win32', '  ')).toThrow(/cwd/i);
  });
});

describe('buildOpenEditorCommand', () => {
  it('win32_lanzaElShimViaCmdSlashC', () => {
    expect(buildOpenEditorCommand('win32', 'code', 'C:\\proj')).toEqual({
      command: 'cmd',
      args: ['/c', 'code', 'C:\\proj'],
    });
  });

  it('darwin_lanzaElBinConElCwdComoArgumento', () => {
    expect(buildOpenEditorCommand('darwin', 'code', '/proj')).toEqual({ command: 'code', args: ['/proj'] });
  });

  it('linux_lanzaElBinConElCwdComoArgumento', () => {
    expect(buildOpenEditorCommand('linux', 'cursor', '/proj')).toEqual({ command: 'cursor', args: ['/proj'] });
  });

  it('binVacio_lanza', () => {
    expect(() => buildOpenEditorCommand('win32', ' ', 'C:\\proj')).toThrow(/bin/i);
  });

  it('cwdVacio_lanza', () => {
    expect(() => buildOpenEditorCommand('linux', 'code', '')).toThrow(/cwd/i);
  });
});

describe('EDITOR_CANDIDATES', () => {
  it('catalogo_binsUnicosYLabelsNoVacios', () => {
    const bins = EDITOR_CANDIDATES.map((c) => c.bin);
    expect(new Set(bins).size).toBe(bins.length);
    expect(EDITOR_CANDIDATES.every((c) => c.label.trim().length > 0)).toBe(true);
  });
});
