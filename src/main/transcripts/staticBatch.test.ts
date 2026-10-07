import { describe, expect, it } from 'vitest';
import { staticTranscriptBatch } from './staticBatch';

describe('staticTranscriptBatch', () => {
  it('staticTranscriptBatch_lineasValidas_unLoteFinalConSusEntradas', () => {
    const batch = staticTranscriptBatch([{ type: 'user', message: { role: 'user', content: 'hola' } }, { type: 'agy-nota' }]);

    expect(batch.isFinal).toBe(true);
    expect(batch.entries.map((e) => [e.index, e.kind])).toEqual([[0, 'user'], [1, 'agy-nota']]);
    expect(batch.totalLinesSoFar).toBe(2);
  });

  it('staticTranscriptBatch_lineaSinTipo_vaAErrores', () => {
    const batch = staticTranscriptBatch([{ sin: 'tipo' }]);

    expect(batch.entries).toEqual([]);
    expect(batch.errors).toHaveLength(1);
    expect(batch.errors[0]?.lineNumber).toBe(1);
  });

  it('staticTranscriptBatch_vacio_loteFinalVacio', () => {
    expect(staticTranscriptBatch([])).toMatchObject({ entries: [], errors: [], isFinal: true, totalLinesSoFar: 0 });
  });
});
