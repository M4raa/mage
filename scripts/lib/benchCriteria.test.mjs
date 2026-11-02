import { describe, expect, it } from 'vitest';
import { judge, judgeTask } from '../../spike/bench/criteria.mjs';

const row = (over) => ({ route: 'R3', provider: 'claude', task: 'T1', ok: true, ttfeMs: 3000, totalMs: 6000, tokens: { input: 0, output: 0, cacheRead: 70_000, cacheCreate: 0 }, ...over });
const REF = [row({ totalMs: 5000 }), row({ totalMs: 6000 }), row({ totalMs: 7000 })];

describe('criterio H5 del benchmark de F2', () => {
  it('judgeTask_igualQueLaReferencia_ok', () => {
    expect(judgeTask(REF, REF, { provider: 'claude' })).toEqual({ verdict: 'ok', reasons: [] });
  });

  it('judgeTask_pierdeExito_bloquea', () => {
    const nuevo = [row({ ok: false }), row(), row()];

    expect(judgeTask(REF, nuevo, { provider: 'claude' }).verdict).toBe('block');
  });

  it('judgeTask_totalPorEncimaDelMaximoMas20_pideRepetir', () => {
    const nuevo = [row({ totalMs: 8500 }), row({ totalMs: 8500 }), row({ totalMs: 9000 })];

    expect(judgeTask(REF, nuevo, { provider: 'claude' })).toMatchObject({ verdict: 'repeat' });
  });

  it('judgeTask_dentroDelMargenDeTiempo_ok', () => {
    const nuevo = [row({ totalMs: 8400 }), row({ totalMs: 8400 }), row({ totalMs: 8400 })];

    expect(judgeTask(REF, nuevo, { provider: 'claude' }).verdict).toBe('ok');
  });

  it('judgeTask_claudeConMasDel10PorCientoDeTokens_bloquea', () => {
    const nuevo = REF.map((r) => ({ ...r, tokens: { ...r.tokens, cacheRead: 78_000 } }));

    expect(judgeTask(REF, nuevo, { provider: 'claude' }).verdict).toBe('block');
  });

  it('judgeTask_codexNoAplicaElCriterioDeTokens', () => {
    const nuevo = REF.map((r) => ({ ...r, provider: 'codex', tokens: { ...r.tokens, cacheRead: 200_000 } }));

    expect(judgeTask(REF, nuevo, { provider: 'codex' }).verdict).toBe('ok');
  });

  it('judge_ignoraPendientesYOtrosProveedores', () => {
    const nuevo = [...REF, row({ pending: 'uso-sobre-70', ok: false }), row({ provider: 'codex', ok: false })];

    expect(judge(REF, nuevo, 'claude')).toEqual([{ task: 'T1', verdict: 'ok', reasons: [] }]);
  });

  it('judge_sinEjecucionesNuevas_pendiente', () => {
    expect(judge(REF, [row({ pending: 'uso-sobre-70' })], 'claude')[0]?.verdict).toBe('pending');
  });
});
