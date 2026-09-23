import type { TranscriptEntry } from '@shared/transcripts';
import type { DiffLine } from './diffLines';
import { parseStructuredPatch } from './diffLines';
import { summarizeToolInput, SUBAGENT_TOOL_NAMES } from './toolSummary';

// Derivacion PURA (en el renderer) de las llamadas a herramientas y sus resultados desde el
// `raw` de una entrada de transcripcion ya cargada. No toca el parser/IPC (el detalle de una tool
// solo se necesita al expandir UNA fila, no en cada entrada -> no engorda TranscriptEntry). El
// campo estructurado hermano en el PERSISTIDO es `toolUseResult` (camelCase), distinto del
// `tool_use_result` del protocolo EN VIVO (engine/*): por eso NO se comparte con engine/normalize.

export interface ToolUseView {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly summary: string; // resumen corto del input (comando / fichero / descripcion)
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolResultView {
  readonly toolUseId: string;
  readonly isError: boolean;
  readonly output: string; // texto aplanado del bloque tool_result (confirmacion / stdout)
  readonly filePath: string | null; // de toolUseResult.filePath (Edit/Write)
  readonly diff: readonly DiffLine[] | null; // de toolUseResult.structuredPatch (Edit/Write)
  readonly writtenContent: string | null; // de toolUseResult.content (Write create)
  // Id del subagente que lanzo esta llamada (`Task`/`Agent`): con el se abre su transcripcion. null
  // cuando el resultado no lo trae — entonces el bloque se queda sin boton, nunca con uno roto.
  readonly agentId: string | null;
}

// Vive ahora en `toolSummary` (el modulo que decide como se resume una tool); se re-exporta para no
// tocar a sus consumidores.
export { SUBAGENT_TOOL_NAMES };

// Extrae los bloques tool_use de una linea assistant. [] si no es assistant o no tiene tool_use.
export function extractToolUses(entry: TranscriptEntry): readonly ToolUseView[] {
  if (entry.kind !== 'assistant') return [];
  const content = messageContentArray(entry.raw);
  if (content === null) return [];

  const uses: ToolUseView[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_use') continue;
    if (typeof block.id !== 'string' || typeof block.name !== 'string') continue;
    const input = isRecord(block.input) ? block.input : {};
    uses.push({ toolUseId: block.id, toolName: block.name, summary: summarizeToolInput(block.name, input), input });
  }
  return uses;
}

// Extrae el resultado de una linea `user` que sea eco de un tool_result. null si es un user normal.
export function extractToolResult(entry: TranscriptEntry): ToolResultView | null {
  if (entry.kind !== 'user') return null;
  const content = messageContentArray(entry.raw);
  if (content === null) return null;

  const block = content.find((b) => isRecord(b) && b.type === 'tool_result');
  if (!isRecord(block) || typeof block.tool_use_id !== 'string') return null;

  const structured = extractToolUseResult(entry.raw);
  return {
    toolUseId: block.tool_use_id,
    isError: block.is_error === true,
    output: flattenToolContent(block.content),
    filePath: structured !== null && typeof structured.filePath === 'string' ? structured.filePath : null,
    diff: structured !== null ? parseStructuredPatch(structured.structuredPatch) : null,
    writtenContent: structured !== null && typeof structured.content === 'string' ? structured.content : null,
    agentId: extractAgentId(structured),
  };
}





// --- helpers internos -------------------------------------------------------------------------

// `message.content` como array, o null (user con content string / linea sin message valido).
function messageContentArray(raw: unknown): readonly unknown[] | null {
  if (!isRecord(raw)) return null;
  const message = raw.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return null;
  return message.content;
}

// Campo estructurado hermano del message en el PERSISTIDO: `toolUseResult` (camelCase). Se acepta
// tambien `tool_use_result` (snake_case) por robustez ante otras versiones del formato.
function extractToolUseResult(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.toolUseResult)) return raw.toolUseResult;
  if (isRecord(raw.tool_use_result)) return raw.tool_use_result;
  return null;
}

// Id del subagente dentro del `toolUseResult` estructurado. Se aceptan las dos grafias vistas
// (`agentId`/`agent_id`): el formato varia por version del CLI y aqui solo hace falta el id.
function extractAgentId(structured: Record<string, unknown> | null): string | null {
  if (structured === null) return null;
  const value = structured.agentId ?? structured.agent_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Aplana el `content` de un tool_result a texto: string tal cual; array -> une bloques de texto y
// marca imagenes/otros como [imagen]/[contenido]. Cualquier otra cosa -> "".
function flattenToolContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!isRecord(block)) return '';
      if (block.type === 'text' && typeof block.text === 'string') return block.text;
      if (block.type === 'image') return '[imagen]';
      return '[contenido]';
    })
    .join('\n');
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
