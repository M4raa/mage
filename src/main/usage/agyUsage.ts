import { z } from 'zod';
import type { AgyUsageBucket, AgyUsageGroup, AgyUsageSnapshot } from '@shared/usage';

// Uso de la suscripcion de agy para el panel de Uso (M9). MEDIDO en agy 1.2.14 (`spike/agy-spike.mjs
// --persistent`, sonda 5): `agy --output-format json --print /usage` es GRATIS (`num_turns: 0`, uso a
// cero, el `remaining_fraction` no cambia entre dos llamadas) y trae `command.data.groups[]`:
//   {name, description, buckets: [{id, name, window: "weekly"|"5h", remaining_fraction: 0..1, reset_time}]}
// Dos grupos: Gemini y «Claude y GPT». El texto redondea; el JSON no.

export const AGY_USAGE_ARGS: readonly string[] = ['--output-format', 'json', '--print', '/usage'];

const BucketSchema = z
  .object({
    id: z.string(),
    name: z.string().catch(''),
    window: z.string().catch(''),
    remaining_fraction: z.number().min(0).max(1),
    reset_time: z.string().optional(),
  })
  .passthrough();
const GroupSchema = z.object({ name: z.string().catch(''), buckets: z.array(z.unknown()).catch([]) }).passthrough();
const OutputSchema = z.object({ command: z.object({ data: z.object({ groups: z.array(z.unknown()) }).passthrough() }).passthrough() }).passthrough();

const PERCENT = 100;

// Parsea la salida JSON de `/usage`. Una salida que no es JSON o no trae grupos LANZA con su tamaño;
// un grupo o cubo raro se omite sin tumbar al resto.
export function parseAgyUsage(stdout: string): readonly AgyUsageGroup[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`agy /usage no devolvio JSON (${err instanceof Error ? err.message : String(err)}): ${stdout.length} caracteres`);
  }
  const output = OutputSchema.safeParse(parsed);
  if (!output.success) throw new Error(`agy /usage sin grupos de uso: ${output.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  return output.data.command.data.groups.flatMap((raw) => {
    const group = GroupSchema.safeParse(raw);
    if (!group.success) return [];
    const buckets = group.data.buckets.flatMap((rawBucket) => toBucket(rawBucket));
    return buckets.length === 0 ? [] : [{ name: group.data.name, buckets }];
  });
}

function toBucket(raw: unknown): AgyUsageBucket[] {
  const bucket = BucketSchema.safeParse(raw);
  if (!bucket.success) return [];
  const { id, name, window, remaining_fraction: remaining, reset_time: resetTime } = bucket.data;
  const resetMs = resetTime === undefined ? Number.NaN : Date.parse(resetTime);
  return [{ id, name, window, usedPercent: Math.round((1 - remaining) * PERCENT), resetsAt: Number.isNaN(resetMs) ? null : resetMs }];
}

export interface AgyUsageDeps {
  // stdout de `agy <AGY_USAGE_ARGS>`; lanza si no hay agy o falla.
  readonly runUsage: () => Promise<string>;
  readonly now: () => number;
}

export async function readAgyUsage(deps: AgyUsageDeps): Promise<AgyUsageSnapshot> {
  try {
    return { status: 'ok', groups: parseAgyUsage(await deps.runUsage()), fetchedAt: deps.now() };
  } catch (err) {
    // No es un `catch` mudo: el motivo viaja al panel, que lo enseña.
    return { status: 'unavailable', reason: err instanceof Error ? err.message : String(err), fetchedAt: deps.now() };
  }
}
