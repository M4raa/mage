import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isTrusted } from './workspaceTrust';
import { describe, expect, it } from 'vitest';
import { localized } from '@shared/i18n/localizedText';
import { join, resolve } from 'node:path';
import { ensureWorkingDirectory, localScratchRoot, scratchWorkspacePaths, workspaceTrusted } from './scratchWorkspace';

describe('R32 / D4', () => {
 it('nuevosBorradores_salenDelTemporalYDelPerfilItinerante', () => {
   const root = localScratchRoot({ platform: 'win32', home: 'C:/Users/u', userData: 'C:/Roaming/mage', temp: 'C:/Temp', env: { LOCALAPPDATA: 'C:/Local' } });
   expect(root.replaceAll('\\', '/')).toMatch(/^C:\/Local\//);
 });
 it('soloRaicesMage_sonDeConfianza', () => {
   expect(workspaceTrusted(join('/legacy', 'mage-scratch', 'id'), [], ['/legacy/mage-scratch'])).toBe(true);
   expect(workspaceTrusted('/usuario/proyecto', [], ['/legacy/mage-scratch'])).toBe(false);
 });
 it('borradorPerdido_recuperaMismaRutaYDevuelveAviso', () => {
   const cwd = resolve('/legacy', 'mage-scratch', 'a1234567-1234-1234-1234-123456789abc');
   const created: string[] = [];
   expect(ensureWorkingDirectory(cwd, ['/legacy/mage-scratch'], { exists: () => false, mkdir: p => { created.push(p); } })).toBe(true);
   expect(created).toEqual([cwd]);
 });
 it('carpetaUsuarioAusente_noLaCreaYNombraRuta', () => {
   const created: string[] = [];
   expect(() => ensureWorkingDirectory('/usuario/proyecto', ['/legacy/mage-scratch'], { exists: () => false, mkdir: p => { created.push(p); } })).toThrow('/usuario/proyecto');
   expect(() => ensureWorkingDirectory('/usuario/proyecto', ['/legacy/mage-scratch'], { exists: () => false, mkdir: () => undefined })).toThrow(expect.objectContaining({ localized: localized('errors.os.workingDirectoryGone', { cwd: '/usuario/proyecto' }) }));
   expect(created).toEqual([]);
 });
});


it('R30_alias8_3_usaLaRutaRealYNoLaClaveLexica', () => {
 const original = mkdtempSync(join(tmpdir(), 'mage-trust-012-'));
 const canonical = realpathSync.native(original);
 try {
   expect(workspaceTrusted(original, [canonical], [])).toBe(true);
   if (original !== canonical) expect(isTrusted(original, [canonical])).toBe(false);
 } finally { rmSync(canonical, { recursive: true, force: true }); }
});

describe('scratchWorkspacePaths', () => {
  const winPaths = { platform: 'win32' as const, home: 'C:\\Users\\u', userData: 'C:\\perfil', temp: 'T', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } };

  it('scratchWorkspacePaths_sinCasaDePrueba_mismasRutas', () => {
    expect(scratchWorkspacePaths(winPaths, null)).toBe(winPaths);
  });

  it('scratchWorkspacePaths_casaDePruebaWindows_raizBajoLaCasa', () => {
    const root = localScratchRoot(scratchWorkspacePaths(winPaths, 'C:\\prueba\\home'));

    expect(root.startsWith(join('C:\\prueba\\home', 'AppData', 'Local', 'mage'))).toBe(true);
    expect(root).not.toContain('C:\\Users\\u');
  });

  it('scratchWorkspacePaths_casaDePruebaLinux_ignoraXdg', () => {
    const paths = { platform: 'linux' as const, home: '/home/u', userData: '/perfil', temp: 'T', env: { XDG_DATA_HOME: '/home/u/.local/share' } };

    const root = localScratchRoot(scratchWorkspacePaths(paths, '/tmp/prueba'));

    expect(root.startsWith(join('/tmp/prueba', '.local', 'share', 'mage'))).toBe(true);
  });

  it('scratchWorkspacePaths_casaDePrueba_noTocaElEnvOriginal', () => {
    scratchWorkspacePaths(winPaths, 'C:\\prueba\\home');

    expect(winPaths.env.LOCALAPPDATA).toBeDefined();
  });
});
