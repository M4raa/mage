import { describe, expect, it } from 'vitest';
import { foreignText, localized } from '@shared/i18n/localizedText';
import { IDLE_UPDATE_STATE } from '@shared/update';
import { canCheckForUpdates, updateStatusText } from './updateStatus';

describe('updateStatus (#15)', () => {
  it('updateStatusText_cadaEstado_loDiceConSuVersionOMotivo', () => {
    expect(updateStatusText(IDLE_UPDATE_STATE)).toContain('Todavía no');
    expect(updateStatusText({ kind: 'checking' })).toBe('Buscando actualizaciones…');
    expect(updateStatusText({ kind: 'upToDate', version: '0.1.3' })).toContain('al día (versión 0.1.3)');
    expect(updateStatusText({ kind: 'error', message: foreignText('ENOTFOUND') })).toBe('No se pudo buscar: ENOTFOUND');
    expect(updateStatusText({ kind: 'downloading', version: '0.1.4' })).toContain('0.1.4');
    expect(updateStatusText({ kind: 'ready', version: '0.1.4', releaseNotes: null })).toContain('lista');
  });

  it('updateStatusText_errorConTextoDeMage_loPintaEnCastellano', () => {
    expect(updateStatusText({ kind: 'error', message: localized('app.update.devNoCheck') })).toBe('No se pudo buscar: En desarrollo no se buscan actualizaciones: solo lo hace la app instalada.');
    expect(updateStatusText({ kind: 'error', message: localized('app.update.noMessage') })).toBe('No se pudo buscar: error sin mensaje');
  });

  it('canCheckForUpdates_buscandoODescargando_no', () => {
    expect(canCheckForUpdates({ kind: 'checking' })).toBe(false);
    expect(canCheckForUpdates({ kind: 'downloading', version: '0.1.4' })).toBe(false);
  });

  it('canCheckForUpdates_reposoAlDiaErrorOLista_si', () => {
    expect(canCheckForUpdates(IDLE_UPDATE_STATE)).toBe(true);
    expect(canCheckForUpdates({ kind: 'upToDate', version: '0.1.3' })).toBe(true);
    expect(canCheckForUpdates({ kind: 'error', message: foreignText('x') })).toBe(true);
    expect(canCheckForUpdates({ kind: 'ready', version: '0.1.4', releaseNotes: null })).toBe(true);
  });
});
