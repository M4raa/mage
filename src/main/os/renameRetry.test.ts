import { describe, expect, it } from 'vitest';
import { RENAME_ATTEMPTS, RENAME_RETRY_DELAY_MS, renameWithRetry, sleepSync } from './renameRetry';

// Windows rechaza el rename sobre un fichero que otro proceso tiene abierto para leerlo (EPERM/EBUSY, medido por
// dirección en la devolución 17): unos pocos reintentos cortos y, si se agotan, un error con la ruta.
function renameFailing(times: number, code: string) {
  const calls: Array<[string, string]> = [];
  const sleeps: number[] = [];
  const rename = (from: string, to: string): void => {
    calls.push([from, to]);
    if (calls.length <= times) throw Object.assign(new Error(`${code}: operation not permitted, rename '${from}' -> '${to}'`), { code });
  };
  return { calls, sleeps, deps: { rename, sleep: (ms: number) => { sleeps.push(ms); } } };
}

describe('renameWithRetry', () => {
  it('renameWithRetry_EPERMUnaVez_reintentaYPublica', () => {
    const { calls, sleeps, deps } = renameFailing(1, 'EPERM');

    renameWithRetry(deps, 'a.tmp', 'a.lock');

    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([RENAME_RETRY_DELAY_MS]);
  });

  it('renameWithRetry_EBUSYDosVeces_reintentaYPublica', () => {
    const { calls, deps } = renameFailing(2, 'EBUSY');

    renameWithRetry(deps, 'a.tmp', 'a.lock');

    expect(calls).toHaveLength(3);
  });

  it('renameWithRetry_EPERMSiempre_lanzaConLaRutaTrasAgotarLosIntentos', () => {
    const { calls, sleeps, deps } = renameFailing(Number.POSITIVE_INFINITY, 'EPERM');

    expect(() => renameWithRetry(deps, 'a.tmp', 'C:/locks/a.lock')).toThrow(/C:\/locks\/a\.lock.*EPERM/);
    expect(calls).toHaveLength(RENAME_ATTEMPTS);
    expect(sleeps).toHaveLength(RENAME_ATTEMPTS - 1);
  });

  it('renameWithRetry_otroError_sePropagaSinReintentar', () => {
    const { calls, deps } = renameFailing(1, 'ENOENT');

    expect(() => renameWithRetry(deps, 'a.tmp', 'a.lock')).toThrow('ENOENT');
    expect(calls).toHaveLength(1);
  });

  it('renameWithRetry_errorSinCodigo_sePropagaSinReintentar', () => {
    const calls: string[] = [];
    const rename = (): void => { calls.push('x'); throw new Error('raro'); };

    expect(() => renameWithRetry({ rename, sleep: () => undefined }, 'a', 'b')).toThrow('raro');
    expect(calls).toHaveLength(1);
  });
});

describe('sleepSync', () => {
  it('sleepSync_espera_alMenosLoPedido', () => {
    const start = performance.now();

    sleepSync(20);

    expect(performance.now() - start).toBeGreaterThanOrEqual(19);
  });

  it('sleepSync_cero_vuelveEnseguida', () => {
    const start = performance.now();

    sleepSync(0);

    expect(performance.now() - start).toBeLessThan(15);
  });
});

describe('sleepSync precondiciones', () => {
  it('sleepSync_negativoONoFinito_lanzaConElValor', () => {
    expect(() => sleepSync(-1)).toThrow('-1');
    expect(() => sleepSync(Number.NaN)).toThrow('NaN');
  });
});
