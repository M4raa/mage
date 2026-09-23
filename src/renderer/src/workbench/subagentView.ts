import type { TranscriptEntry } from '@shared/transcripts';
import { extractToolResult, extractToolUses, SUBAGENT_TOOL_NAMES } from './toolView';

// Derivacion PURA del "arbol" de subagentes (nivel 1) desde el transcript PRINCIPAL ya cargado.
// Empareja cada tool_use `Agent`/`Task` con su tool_result (por tool_use_id) para leer el `agentId`
// y el `status` del `toolUseResult`. El CONTENIDO real de cada subagente vive en un fichero aparte
// (`subagents/agent-<agentId>.jsonl`) que NO se carga aqui (drill-down = sub-tarea posterior): esta
// vista es el resumen de que subagentes se lanzaron, de que tipo y con que estado.

export interface SubagentInvocation {
  readonly toolUseId: string;
  readonly entryIndex: number; // index de la linea assistant que lo invoco (para navegar/anclar)
  readonly agentType: string | null; // input.subagent_type
  readonly description: string | null; // input.description
  readonly agentId: string | null; // toolUseResult.agentId (del resultado); null si aun sin resultado
  readonly status: string | null; // toolUseResult.status (p.ej. "async_launched"); null si sin resultado
}

// Construye la lista de subagentes lanzados, en orden de invocacion. O(n): un solo recorrido para
// los resultados (indexados por tool_use_id en un Map) y otro para las invocaciones.
export function buildSubagentList(entries: readonly TranscriptEntry[]): readonly SubagentInvocation[] {
  const resultsByToolUseId = indexToolResults(entries);

  const invocations: SubagentInvocation[] = [];
  for (const entry of entries) {
    for (const use of extractToolUses(entry)) {
      if (!SUBAGENT_TOOL_NAMES.has(use.toolName)) continue;
      const result = resultsByToolUseId.get(use.toolUseId) ?? null;
      invocations.push({
        toolUseId: use.toolUseId,
        entryIndex: entry.index,
        agentType: stringOrNull(use.input.subagent_type),
        description: stringOrNull(use.input.description),
        agentId: result !== null ? stringOrNull(result.agentId) : null,
        status: result !== null ? stringOrNull(result.status) : null,
      });
    }
  }
  return invocations;
}

// Indexa por tool_use_id los datos del `toolUseResult` de cada linea tool_result. O(1) por lookup.
function indexToolResults(entries: readonly TranscriptEntry[]): ReadonlyMap<string, { agentId: unknown; status: unknown }> {
  const map = new Map<string, { agentId: unknown; status: unknown }>();
  for (const entry of entries) {
    const result = extractToolResult(entry);
    if (result === null) continue;
    const structured = toolUseResultRecord(entry.raw);
    map.set(result.toolUseId, { agentId: structured?.agentId, status: structured?.status });
  }
  return map;
}

// Lee el objeto `toolUseResult` (camelCase; fallback snake_case) crudo de una linea.
function toolUseResultRecord(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.toolUseResult)) return raw.toolUseResult;
  if (isRecord(raw.tool_use_result)) return raw.tool_use_result;
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
