import { describe, expect, it } from 'vitest';
import { bytesFieldOf, concatBytes, textFieldOf, varintField } from '../conversations/protobufWire';
import { parseAgySteps } from './agyHistoryUsage';
import { localTimeOf } from './usageHistory';

const UTC = (ms: number) => localTimeOf(ms, 0);
const SECONDS = Date.parse('2026-11-09T10:00:00.000Z') / 1000;

// Paso con la forma MEDIDA (P-039 M1): `5.1.1` segundos, `5.9` uso, `5.4.2` herramienta.
function step(index: number, stepType: number, inner: Uint8Array) {
  const time = bytesFieldOf(1, varintField(1, SECONDS));
  return { index, stepType, payload: concatBytes(varintField(1, stepType), bytesFieldOf(5, concatBytes(time, inner))) };
}

const usage = (model: number, prompt: number, output: number, cached = 0) =>
  bytesFieldOf(9, concatBytes(varintField(1, model), varintField(2, prompt), varintField(3, output), ...(cached > 0 ? [varintField(5, cached)] : [])));
const tool = (name: string) => bytesFieldOf(4, concatBytes(textFieldOf(1, 'id-1'), textFieldOf(2, name)));

describe('parseAgySteps', () => {
  it('parseAgySteps_respuestaConCache_usoConLaCacheAparteYSinPrecio', () => {
    const parsed = parseAgySteps([step(1, 15, usage(1084, 16129, 1052, 12000))], UTC);

    expect(parsed.days['2026-11-09']?.byModel).toEqual({ 'agy:1084': { inputTokens: 4129, outputTokens: 1052, cacheReadTokens: 12000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, turns: 1 } });
    expect(parsed.days['2026-11-09']?.hours[10]).toBe(1);
  });

  it('parseAgySteps_pasoAuxiliar_cuentaTokensPeroNoHora', () => {
    const day = parseAgySteps([step(1, 23, usage(1050, 108, 4))], UTC).days['2026-11-09'];

    expect(day?.byModel['agy:1050']?.outputTokens).toBe(4);
    expect(day?.hours.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('parseAgySteps_pasoDeHerramienta_laCuenta', () => {
    expect(parseAgySteps([step(1, 8, tool('run_command')), step(2, 7, tool('run_command'))], UTC).days['2026-11-09']?.tools).toEqual({ run_command: 2 });
  });

  it('parseAgySteps_pasoIlegibleOSinInstante_seSaltaYSeCuenta', () => {
    const parsed = parseAgySteps([{ index: 1, stepType: 15, payload: new Uint8Array([0xff, 0xff]) }, { index: 2, stepType: 15, payload: varintField(1, 15) }], UTC);

    expect(parsed.days).toEqual({});
    expect(parsed.invalidSteps).toBe(1);
  });
});
