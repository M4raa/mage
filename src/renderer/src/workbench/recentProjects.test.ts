import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@shared/conversations';
import { recentProjects, type RecentProjectsInput } from './recentProjects';

function item(cwd: string, updatedAtMs: number, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    sessionId: `s-${cwd}-${updatedAtMs}`,
    configDir: 'C:\\Users\\u\\.claude',
    cwd,
    title: 't',
    privacy: 'shared',
    updatedAtMs,
    sizeBytes: 1,
    isScheduled: false,
    ...overrides,
  };
}

function input(history: readonly ConversationSummary[], overrides: Partial<RecentProjectsInput> = {}): RecentProjectsInput {
  return { history, scratchRoot: 'C:\\Temp\\mage-scratch', limit: 6, caseInsensitive: true, ...overrides };
}

describe('recentProjects', () => {
  it('recentProjects_historialVacio_devuelveVacio', () => {
    expect(recentProjects(input([]))).toEqual([]);
  });

  it('recentProjects_ordenaPorLaConversacionMasReciente', () => {
    const result = recentProjects(input([item('C:\\src\\a', 10), item('C:\\src\\b', 30), item('C:\\src\\c', 20)]));

    expect(result.map((p) => p.name)).toEqual(['b', 'c', 'a']);
  });

  it('recentProjects_mismaCarpetaVariasVeces_unaEntradaConLaFechaMasNueva', () => {
    const result = recentProjects(input([item('C:\\src\\a', 10), item('C:\\src\\a', 50), item('C:\\src\\b', 20)]));

    expect(result).toEqual([
      { cwd: 'C:\\src\\a', name: 'a', updatedAtMs: 50 },
      { cwd: 'C:\\src\\b', name: 'b', updatedAtMs: 20 },
    ]);
  });

  it('recentProjects_windowsMayusculasYSeparadores_seAgrupan', () => {
    const result = recentProjects(input([item('C:\\Src\\Mage', 10), item('c:/src/mage/', 20)]));

    expect(result).toHaveLength(1);
    expect(result[0]?.updatedAtMs).toBe(20);
  });

  it('recentProjects_posixDistingueMayusculas', () => {
    const result = recentProjects(input([item('/src/Mage', 10), item('/src/mage', 20)], { caseInsensitive: false, scratchRoot: null }));

    expect(result).toHaveLength(2);
  });

  it('recentProjects_cwdVacio_seDescarta', () => {
    expect(recentProjects(input([item('', 10), item('   ', 11)]))).toEqual([]);
  });

  it('recentProjects_carpetasDelScratch_seDescartan', () => {
    const result = recentProjects(input([item('C:\\Temp\\mage-scratch\\uuid-1', 99), item('C:\\src\\a', 1)]));

    expect(result.map((p) => p.cwd)).toEqual(['C:\\src\\a']);
  });

  it('recentProjects_conversacionesPrivadas_seDescartan', () => {
    expect(recentProjects(input([item('C:\\src\\secreto', 10, { privacy: 'private' })]))).toEqual([]);
  });

  it('recentProjects_masQueElLimite_recorta', () => {
    const history = Array.from({ length: 10 }, (_, i) => item(`C:\\src\\p${i}`, i));

    const result = recentProjects(input(history, { limit: 6 }));

    expect(result).toHaveLength(6);
    expect(result[0]?.name).toBe('p9');
  });

  it('recentProjects_limiteCeroONegativo_devuelveVacio', () => {
    expect(recentProjects(input([item('C:\\src\\a', 1)], { limit: 0 }))).toEqual([]);
    expect(recentProjects(input([item('C:\\src\\a', 1)], { limit: -1 }))).toEqual([]);
  });

  it('recentProjects_raizDeUnidad_usaLaRutaComoNombre', () => {
    const result = recentProjects(input([item('/', 1)], { scratchRoot: null, caseInsensitive: false }));

    expect(result[0]?.name).toBe('/');
  });
});
