import { describe, expect, it } from 'vitest';
import { backgroundTasksSummary, mergeBackgroundTasks, type BackgroundTaskRow } from './backgroundTasks';

const bash = { taskId: 'b1', type: 'local_bash', description: 'Sleep 8 seconds' };
const monitor = { taskId: 'm1', type: 'monitor', description: 'Vigila el log' };

describe('mergeBackgroundTasks', () => {
  it('mergeBackgroundTasks_nueva_tomaLaHoraActual', () => {
    expect(mergeBackgroundTasks(undefined, [bash], 1000)).toEqual([{ ...bash, sinceMs: 1000 }]);
  });

  it('mergeBackgroundTasks_yaConocida_conservaSuHora', () => {
    const previous: readonly BackgroundTaskRow[] = [{ ...bash, sinceMs: 1000 }];

    expect(mergeBackgroundTasks(previous, [bash, monitor], 5000)).toEqual([
      { ...bash, sinceMs: 1000 },
      { ...monitor, sinceMs: 5000 },
    ]);
  });

  it('mergeBackgroundTasks_sinCambios_mismaReferencia', () => {
    const previous: readonly BackgroundTaskRow[] = [{ ...bash, sinceMs: 1000 }];

    expect(mergeBackgroundTasks(previous, [bash], 9000)).toBe(previous);
  });

  it('mergeBackgroundTasks_listaVacia_quitaTodas', () => {
    expect(mergeBackgroundTasks([{ ...bash, sinceMs: 1000 }], [], 2000)).toEqual([]);
  });

  it('mergeBackgroundTasks_horaNoFinita_lanzaConElValor', () => {
    expect(() => mergeBackgroundTasks(undefined, [bash], Number.NaN)).toThrow(/NaN/);
  });
});

describe('backgroundTasksSummary', () => {
  const translate = (key: string, values?: Record<string, unknown>): string => `${key}:${String(values?.count)}`;

  it('backgroundTasksSummary_cuenta_laPasaAlTexto', () => {
    expect(backgroundTasksSummary(3, translate as never)).toBe('chat.tasks.summary:3');
  });

  it('backgroundTasksSummary_negativo_lanza', () => {
    expect(() => backgroundTasksSummary(-1, translate as never)).toThrow(/-1/);
  });
});
