import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isTrusted } from './workspaceTrust';
import { describe, expect, it } from 'vitest';
import { localized } from '@shared/i18n/localizedText';
import { join, resolve } from 'node:path';
import { ensureWorkingDirectory, localScratchRoot, workspaceTrusted } from './scratchWorkspace';

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
