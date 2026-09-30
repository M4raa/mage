import { describe, expect, it } from 'vitest';
import { compareVersions, parseChangelog, pickReleaseNotesEntry, releaseNotesDecision, type ReleaseNotesContext } from './releaseNotes';

const CHANGELOG = [
  '# Novedades de Mage',
  '',
  'Introduccion que no es de ninguna version.',
  '',
  '## 0.1.2 — en desarrollo',
  '',
  '### Cambiado',
  '- Electron 44.',
  '',
  '## 0.1.1 — 2026-09-30',
  '- Copiar.',
  '## 0.1.0',
  '- Primera.',
].join('\n');

const UPGRADE: ReleaseNotesContext = { lastSeen: '0.1.1', current: '0.1.2', onboardingDone: true, isDev: false, isMainWindow: true };

describe('parseChangelog', () => {
  it('parseChangelog_variasVersiones_lasDevuelveEnOrdenConEtiquetaYCuerpo', () => {
    // Act
    const entries = parseChangelog(CHANGELOG);

    // Assert
    expect(entries.map((entry) => entry.version)).toEqual(['0.1.2', '0.1.1', '0.1.0']);
    expect(entries[0]).toEqual({ version: '0.1.2', label: 'en desarrollo', body: '### Cambiado\n- Electron 44.' });
    expect(entries[1]?.label).toBe('2026-09-30');
  });

  it('parseChangelog_tituloSinFecha_etiquetaVacia', () => {
    expect(parseChangelog('## 0.1.0\n- Primera.')).toEqual([{ version: '0.1.0', label: '', body: '- Primera.' }]);
  });

  it('parseChangelog_textoVacio_devuelveListaVacia', () => {
    expect(parseChangelog('')).toEqual([]);
  });

  it('parseChangelog_finesDeLineaWindows_noDejaRetornosEnElCuerpo', () => {
    expect(parseChangelog('## 0.1.0\r\n- Uno.\r\n- Dos.')[0]?.body).toBe('- Uno.\n- Dos.');
  });

  it('parseChangelog_tituloConCorchetes_lanzaConLaLinea', () => {
    expect(() => parseChangelog('## [0.1.0] — 2026-09-28')).toThrow('## [0.1.0] — 2026-09-28');
  });

  it('parseChangelog_subtituloDeTercerNivel_noCortaLaVersion', () => {
    expect(parseChangelog('## 0.1.0\n### Añadido\n- Uno.')).toHaveLength(1);
  });
});

describe('compareVersions', () => {
  it('compareVersions_numerosDeDosCifras_comparaPorNumeroNoPorTexto', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
  });

  it('compareVersions_mismaVersion_devuelveCero', () => {
    expect(compareVersions('0.1.2', '0.1.2')).toBe(0);
  });

  it('compareVersions_menorEnMayor_devuelveNegativo', () => {
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  it('compareVersions_conSufijo_soloMandaElNumero', () => {
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBe(0);
  });

  it('compareVersions_cadenaVacia_lanzaConElValor', () => {
    expect(() => compareVersions('', '0.1.0')).toThrow('Version ilegible: ""');
  });

  it('compareVersions_basura_lanzaConElValor', () => {
    expect(() => compareVersions('0.1.2', 'v0.1')).toThrow('"v0.1"');
  });
});

describe('releaseNotesDecision', () => {
  it('releaseNotesDecision_subidaDeParche_abreYGuardaLaActual', () => {
    expect(releaseNotesDecision(UPGRADE)).toEqual({ open: true, remember: '0.1.2' });
  });

  it('releaseNotesDecision_saltandoVersiones_abreYGuardaLaActual', () => {
    expect(releaseNotesDecision({ ...UPGRADE, lastSeen: '0.1.0', current: '0.2.0' })).toEqual({ open: true, remember: '0.2.0' });
  });

  it('releaseNotesDecision_instalacionNueva_noAbrePeroGuardaLaActual', () => {
    expect(releaseNotesDecision({ ...UPGRADE, lastSeen: '', onboardingDone: false })).toEqual({ open: false, remember: '0.1.2' });
  });

  it('releaseNotesDecision_desdeVersionSinElCampoConAsistenteHecho_abre', () => {
    expect(releaseNotesDecision({ ...UPGRADE, lastSeen: '' })).toEqual({ open: true, remember: '0.1.2' });
  });

  it('releaseNotesDecision_mismaVersion_noHaceNada', () => {
    expect(releaseNotesDecision({ ...UPGRADE, lastSeen: '0.1.2' })).toEqual({ open: false, remember: null });
  });

  it('releaseNotesDecision_bajada_noAbreNiBajaLoGuardado', () => {
    expect(releaseNotesDecision({ ...UPGRADE, lastSeen: '0.1.3' })).toEqual({ open: false, remember: null });
  });

  it('releaseNotesDecision_enDev_noAbreNiEscribe', () => {
    expect(releaseNotesDecision({ ...UPGRADE, isDev: true })).toEqual({ open: false, remember: null });
  });

  it('releaseNotesDecision_ventanaSecundaria_noAbreNiEscribe', () => {
    expect(releaseNotesDecision({ ...UPGRADE, isMainWindow: false })).toEqual({ open: false, remember: null });
  });

  it('releaseNotesDecision_ultimaVistaIlegible_lanza', () => {
    expect(() => releaseNotesDecision({ ...UPGRADE, lastSeen: 'basura' })).toThrow('"basura"');
  });
});

describe('pickReleaseNotesEntry', () => {
  const entries = parseChangelog(CHANGELOG);

  it('pickReleaseNotesEntry_sinPeticion_devuelveLaInstalada', () => {
    expect(pickReleaseNotesEntry(entries, null, '0.1.1')?.version).toBe('0.1.1');
  });

  it('pickReleaseNotesEntry_conPeticion_devuelveLaPedida', () => {
    expect(pickReleaseNotesEntry(entries, '0.1.0', '0.1.2')?.version).toBe('0.1.0');
  });

  it('pickReleaseNotesEntry_versionesDesconocidas_devuelveLaMasReciente', () => {
    expect(pickReleaseNotesEntry(entries, '9.9.9', '8.8.8')?.version).toBe('0.1.2');
  });

  it('pickReleaseNotesEntry_changelogVacio_devuelveNull', () => {
    expect(pickReleaseNotesEntry([], null, '0.1.2')).toBeNull();
  });
});
