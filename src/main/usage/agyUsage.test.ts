import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAgyUsage, readAgyUsage } from './agyUsage';

// `agy --output-format json --print /usage` de agy 1.2.14 (gratis), copiado el 2026-10-01.
const MEASURED = readFileSync(join(__dirname, '__fixtures__', 'agy-usage.json'), 'utf8');

describe('parseAgyUsage', () => {
  it('parseAgyUsage_salidaMedida_dosGruposConSusDosVentanas', () => {
    const groups = parseAgyUsage(MEASURED);

    expect(groups.map((g) => g.name)).toEqual(['Gemini Models', 'Claude and GPT models']);
    expect(groups[0]!.buckets.map((b) => b.window).sort()).toEqual(['5h', 'weekly']);
    for (const bucket of groups.flatMap((g) => g.buckets)) {
      expect(Number.isInteger(bucket.usedPercent)).toBe(true);
      expect(bucket.usedPercent).toBeGreaterThanOrEqual(0);
      expect(bucket.resetsAt).not.toBeNull();
    }
  });

  it('parseAgyUsage_fraccionRestante_porcentajeGastadoEntero', () => {
    const output = JSON.stringify({ command: { data: { groups: [{ name: 'G', buckets: [{ id: 'g-5h', name: 'x', window: '5h', remaining_fraction: 0.9894, reset_time: '2026-10-01T11:46:58Z' }] }] } } });

    expect(parseAgyUsage(output)[0]!.buckets[0]).toEqual({ id: 'g-5h', name: 'x', window: '5h', usedPercent: 1, resetsAt: Date.parse('2026-10-01T11:46:58Z') });
  });

  it('parseAgyUsage_cuboRaro_seOmiteSinTumbarAlResto', () => {
    const output = JSON.stringify({ command: { data: { groups: [{ name: 'G', buckets: [{ id: 'a', remaining_fraction: 2 }, { id: 'b', remaining_fraction: 0.5 }] }] } } });

    expect(parseAgyUsage(output)[0]!.buckets.map((b) => b.id)).toEqual(['b']);
  });

  it('parseAgyUsage_modoClaveSinGrupos_listaVacia', () => {
    expect(parseAgyUsage(JSON.stringify({ command: { data: { groups: [] } } }))).toEqual([]);
  });

  it.each(['no es json', '{"status":"SUCCESS"}'])('parseAgyUsage_salidaInvalida_lanza_%#', (output) => {
    expect(() => parseAgyUsage(output)).toThrow(/agy \/usage/);
  });
});

describe('readAgyUsage', () => {
  it('readAgyUsage_agyFalla_unavailableConElMotivo', async () => {
    const snapshot = await readAgyUsage({ runUsage: () => Promise.reject(new Error('No se encontro el CLI')), now: () => 5 });

    expect(snapshot).toEqual({ status: 'unavailable', reason: 'No se encontro el CLI', fetchedAt: 5 });
  });

  it('readAgyUsage_salidaMedida_ok', async () => {
    const snapshot = await readAgyUsage({ runUsage: () => Promise.resolve(MEASURED), now: () => 5 });

    expect(snapshot.status).toBe('ok');
  });
});
