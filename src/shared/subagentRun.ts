// Lectura PURA de lo que el CLI cuenta de un subagente (`Agent`/`Task`), compartida por el stream en
// vivo (main) y la hidratacion desde disco (renderer). MEDIDO contra el CLI 2.1.284 (P-028 37a,
// `spike/engine-spike.mjs --subagent-bg` y la sesion 206a3694 lanzada desde Mage):
//   - `tool_use_result` de un Agent en SEGUNDO PLANO: `{isAsync: true, status: "async_launched",
//     agentId, description, resolvedModel, prompt, outputFile, canReadOutputFile}`. Llega enseguida y
//     solo dice «lanzado»: el subagente sigue trabajando.
//   - En PRIMER PLANO: `{status: "completed", agentId, totalDurationMs, totalTokens,
//     totalToolUseCount, usage, …}`.
// Tolerante: un campo que no encaja se queda en null; sin `status` ni `agentId` no es un subagente.

export interface SubagentRunInfo {
  readonly status: string; // 'async_launched' | 'completed' | lo que mande el CLI
  readonly agentId: string | null;
  readonly model: string | null;
  readonly totalTokens: number | null;
  readonly totalDurationMs: number | null;
  readonly totalToolUseCount: number | null;
}

export const SUBAGENT_ASYNC_LAUNCHED = 'async_launched';

export function parseSubagentRunInfo(structured: unknown): SubagentRunInfo | null {
  if (!isRecord(structured)) return null;
  const status = stringOrNull(structured.status);
  const agentId = stringOrNull(structured.agentId) ?? stringOrNull(structured.agent_id);
  if (status === null && agentId === null) return null;
  return {
    status: status ?? 'completed',
    agentId,
    model: stringOrNull(structured.resolvedModel),
    totalTokens: countOrNull(structured.totalTokens),
    totalDurationMs: countOrNull(structured.totalDurationMs),
    totalToolUseCount: countOrNull(structured.totalToolUseCount),
  };
}

// Entero no negativo o null. Un numero raro de la frontera no se pinta: se descarta.
export function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
