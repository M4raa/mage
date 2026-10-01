import { describe, expect, it } from 'vitest';
import { mergeStatusCache, parseStatusCache, pruneStatusCache, statusesOf } from './mcpStatusCache';

const NOW = new Date('2026-10-01T09:30:00.000Z');
const SNAPSHOT = { checkedAt: '2026-09-30T08:00:00.000Z', servers: [{ name: 'claude.ai Miro', status: 'needs-auth', scope: 'claudeai' }] };

describe('mcpStatusCache', () => {
  it('parseStatusCache_ausente_vaciaSinAviso', () => {
    const warns: string[] = [];

    expect(parseStatusCache(null, (m) => warns.push(m))).toEqual({});
    expect(warns).toEqual([]);
  });

  it('parseStatusCache_ilegible_vaciaConAvisoSinContenido', () => {
    const warns: string[] = [];

    expect(parseStatusCache('{"x":', (m) => warns.push(m))).toEqual({});
    expect(warns[0]).toContain('caracteres');
  });

  it('parseStatusCache_fechaInvalida_vaciaConAviso', () => {
    const warns: string[] = [];

    expect(parseStatusCache(JSON.stringify({ '/c': { ...SNAPSHOT, checkedAt: 'ayer' } }), (m) => warns.push(m))).toEqual({});
    expect(warns).toHaveLength(1);
  });

  it('mergeStatusCache_loNuevoSustituyeSoloEsasCuentasYQuitaConfig', () => {
    const fresh = { '/b': [{ name: 'x', status: 'connected', scope: 'user', config: { headers: { A: 'secreto' } } }] };

    const merged = mergeStatusCache({ '/a': SNAPSHOT }, fresh, NOW);

    expect(merged['/a']).toEqual(SNAPSHOT);
    expect(merged['/b']).toEqual({ checkedAt: NOW.toISOString(), servers: [{ name: 'x', status: 'connected', scope: 'user' }] });
    expect(JSON.stringify(merged)).not.toContain('secreto');
  });

  it('pruneStatusCache_cuentaBorrada_desaparece', () => {
    expect(pruneStatusCache({ '/a': SNAPSHOT, '/b': SNAPSHOT }, ['/b'])).toEqual({ '/b': SNAPSHOT });
  });

  it('statusesOf_soloLosServidores', () => {
    expect(statusesOf({ '/a': SNAPSHOT })).toEqual({ '/a': SNAPSHOT.servers });
  });
});
