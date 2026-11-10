import { addDetails, EMPTY_DETAIL, HOURS_PER_DAY, type DayDetail, type DayKey, type ModelUsage } from '@shared/usageHistory';
import { messageAt, parseProtobuf, textAt, type WireField } from '../conversations/protobufWire';
import type { AgyStep } from '../conversations/agyHistory';
import type { LocalTime } from './usageHistory';

// Consumo de agy a partir de sus conversaciones (SQLite, un paso por fila en protobuf sin esquema publicado; P-039 F3).
// PURO: recibe los pasos ya leídos.
//
// MEDIDO (P-039 M1, `spike/agy-tokens-spike.mjs`, agy 1.3.x): las respuestas del modelo (paso 15) y los pasos 23
// (auxiliares) traen el uso en `5.9`: `2` entrada, `3` salida total (pensamiento `9` + respuesta `10`), `5` tokens en
// caché (cuando hay) y `1` el modelo como ENUMERADO interno (1084, 1050…), que no se puede traducir a un nombre: la
// clave es `agy:<n>` y no tiene precio. El instante va en `5.1.1` (segundos) y las herramientas, en `5.4.2`.

const STEP_MODEL_RESPONSE = 15;
const STEP_AUXILIARY = 23;
const USAGE_STEPS: ReadonlySet<number> = new Set([STEP_MODEL_RESPONSE, STEP_AUXILIARY]);
const MS_PER_SECOND = 1000;

// Prefijo de las claves de modelo de agy: el enumerado no es un nombre ni tiene precio.
export const AGY_MODEL_PREFIX = 'agy:';

function varint(fields: readonly WireField[] | null, field: number): number {
  const found = fields?.find((f) => f.field === field && f.kind === 'varint');
  return found?.kind === 'varint' && Number.isInteger(found.value) && found.value >= 0 ? found.value : 0;
}

function atMsOf(fields: readonly WireField[]): number | null {
  const seconds = varint(messageAt(fields, [5, 1]), 1);
  return seconds > 0 ? seconds * MS_PER_SECOND : null;
}

function usageOf(fields: readonly WireField[]): { readonly key: string; readonly tokens: ModelUsage } | null {
  const usage = messageAt(fields, [5, 9]);
  if (usage === null) return null;
  const prompt = varint(usage, 2);
  const cached = Math.min(varint(usage, 5), prompt);
  const tokens: ModelUsage = { inputTokens: prompt - cached, outputTokens: varint(usage, 3), cacheReadTokens: cached, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, turns: 1 };
  return { key: `${AGY_MODEL_PREFIX}${varint(usage, 1)}`, tokens };
}

function stepDetail(step: AgyStep, fields: readonly WireField[], hour: number): DayDetail | null {
  const hours = new Array<number>(HOURS_PER_DAY).fill(0);
  if (USAGE_STEPS.has(step.stepType)) {
    const usage = usageOf(fields);
    if (usage === null) return null;
    if (step.stepType === STEP_MODEL_RESPONSE) hours[hour] = 1;
    return { ...EMPTY_DETAIL, hours, byModel: { [usage.key]: usage.tokens } };
  }
  const tool = textAt(fields, [5, 4, 2]);
  return tool === null ? null : { ...EMPTY_DETAIL, hours, tools: { [tool]: 1 } };
}

// Suma por día los pasos de una conversación. Un paso sin instante o ilegible se salta (se cuenta para el log).
export function parseAgySteps(steps: readonly AgyStep[], timeOf: (ms: number) => LocalTime): { readonly days: Readonly<Record<DayKey, DayDetail>>; readonly invalidSteps: number } {
  const days: Record<DayKey, DayDetail> = {};
  let invalidSteps = 0;
  for (const step of steps) {
    const fields = parseProtobuf(step.payload);
    if (fields === null) {
      invalidSteps += 1;
      continue;
    }
    const atMs = atMsOf(fields);
    if (atMs === null) continue;
    const { day, hour } = timeOf(atMs);
    const detail = stepDetail(step, fields, hour);
    if (detail !== null) days[day] = addDetails(days[day] ?? EMPTY_DETAIL, detail);
  }
  return { days, invalidSteps };
}
