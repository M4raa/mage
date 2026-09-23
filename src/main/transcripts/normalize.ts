import { parseEpochMs } from '../usage/schemas';
import {
  TranscriptAssistantLineSchema,
  TranscriptSystemLineSchema,
  TranscriptUserLineSchema,
} from './schemas';
import type { TranscriptEntry, TranscriptLineCategory, TranscriptTokenUsage } from '@shared/transcripts';

// Tipos con schema estricto propio (interpretados por el parser). Cualquier otro `type` cae en
// metadata/unknown segun CATALOGUED_METADATA_KINDS. Nunca es una lista cerrada para clasificar:
// solo decide que ES un turno interpretable; todo lo demas se conserva igual como raw.
const TURN_KINDS = new Set(['user', 'assistant', 'system']);

// Tipos de metadata de la persistencia ya catalogados en esta sesion (ver schemas.ts). Un tipo NO
// listado aqui no se descarta: se clasifica 'unknown' (mismo tratamiento de render que metadata,
// pero permite detectar tipos nuevos en tests/telemetria sin perder datos).
const CATALOGUED_METADATA_KINDS = new Set([
  'mode',
  'permission-mode',
  'file-history-snapshot',
  // Visto en transcripciones reales posteriores al catalogo original: es metadata de historial de
  // ficheros, igual que el snapshot, no un tipo nuevo por descubrir.
  'file-history-delta',
  'attachment',
  'ai-title',
  'last-prompt',
  'queue-operation',
  'custom-title',
  'agent-name',
]);

// Longitud maxima del resumen de una fila colapsada (evita filas gigantes con el `attachment` de
// >1KB completo; el detalle sigue disponible integro en `raw` al expandir).
// Exportado para que el test fije el limite SIN duplicar el numero: si cambia aqui, cambia alli.
export const SUMMARY_MAX_LENGTH = 140;

export type ParsedLineResult =
  | { readonly ok: true; readonly entry: TranscriptEntry }
  | { readonly ok: false; readonly error: string; readonly lineNumber: number };

// Clasifica un `type` crudo sin lista cerrada: turn = interpretable por el parser; metadata = uno
// de los tipos propios de la persistencia ya vistos; unknown = tipo aun no catalogado (no lanza,
// se conserva igual que metadata para no perder la linea).
export function classifyLineType(type: string): TranscriptLineCategory {
  if (TURN_KINDS.has(type)) return 'turn';
  if (CATALOGUED_METADATA_KINDS.has(type)) return 'metadata';
  return 'unknown';
}

// Parsea UNA linea ya JSON.parse-ada del NDJSON persistido. Contrato explicito (nunca
// `catch { return default }` silencioso): JSON sin `type` string -> ok:false con el numero de
// linea. Si `type` es user/assistant/system y la validacion estricta falla por forma inesperada,
// se degrada a entrada "raw" (mejor mostrar algo bruto que perder la linea del historial).
export function parseTranscriptLine(raw: unknown, lineNumber: number): ParsedLineResult {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return { ok: false, error: 'Linea sin campo "type" string valido', lineNumber };
  }

  const category = classifyLineType(raw.type);
  if (category !== 'turn') {
    return { ok: true, entry: toRawEntry(raw, lineNumber, category) };
  }

  return { ok: true, entry: toTurnEntry(raw, lineNumber) };
}

function toTurnEntry(raw: Record<string, unknown>, lineNumber: number): TranscriptEntry {
  const schema =
    raw.type === 'user' ? TranscriptUserLineSchema : raw.type === 'assistant' ? TranscriptAssistantLineSchema : TranscriptSystemLineSchema;
  const parsed = schema.safeParse(raw);
  // Forma inesperada dentro de un tipo interpretable: se degrada a raw (no se pierde la linea).
  if (!parsed.success) return toRawEntry(raw, lineNumber, 'turn');
  return buildEntry(raw, lineNumber, 'turn');
}

function toRawEntry(raw: Record<string, unknown>, lineNumber: number, category: TranscriptLineCategory): TranscriptEntry {
  return buildEntry(raw, lineNumber, category);
}

function buildEntry(raw: Record<string, unknown>, lineNumber: number, category: TranscriptLineCategory): TranscriptEntry {
  const kind = typeof raw.type === 'string' ? raw.type : 'unknown';
  return {
    index: lineNumber - 1,
    uuid: typeof raw.uuid === 'string' ? raw.uuid : null,
    parentUuid: typeof raw.parentUuid === 'string' ? raw.parentUuid : null,
    isSidechain: raw.isSidechain === true,
    // `=== true` y no `?? false`: el campo aparece explicitamente como false en transcripciones
    // reales, asi que solo cuenta como meta cuando lo dice.
    isMeta: raw.isMeta === true,
    timestampMs: parseEpochMs(typeof raw.timestamp === 'string' ? raw.timestamp : null),
    category,
    kind,
    summary: summarize(kind, raw),
    tokenUsage: extractTokenUsage(kind, raw),
    raw,
  };
}

// Extrae el uso de tokens de una linea assistant desde message.usage. Devuelve null salvo que sea
// una linea assistant con `message.usage` presente (parseo seguro en la frontera: cualquier campo
// numerico invalido -> 0, nunca NaN/negativo/float; nunca lanza). Un usuario/system/metadata no
// tiene usage -> null.
export function extractTokenUsage(kind: string, raw: Record<string, unknown>): TranscriptTokenUsage | null {
  if (kind !== 'assistant') return null;
  const message = raw.message;
  if (!isRecord(message)) return null;
  const usage = message.usage;
  if (!isRecord(usage)) return null;

  return {
    inputTokens: toNonNegativeInt(usage.input_tokens),
    outputTokens: toNonNegativeInt(usage.output_tokens),
    cacheCreationInputTokens: toNonNegativeInt(usage.cache_creation_input_tokens),
    cacheReadInputTokens: toNonNegativeInt(usage.cache_read_input_tokens),
    model: typeof message.model === 'string' ? message.model : null,
  };
}

// Sanea un valor externo a un entero >=0 (tokens SIEMPRE enteros): no finito/no numerico/negativo
// -> 0; float -> truncado hacia abajo. Nunca propaga NaN, negativos ni decimales.
function toNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

// Resumen corto de una entrada para la fila colapsada. Nunca interpreta `raw` en el hilo de UI:
// se calcula aqui, en el normalizador, para que el render sea puro texto.
export function summarize(kind: string, raw: Record<string, unknown>): string {
  const text = summaryTextFor(kind, raw);
  return text.length > SUMMARY_MAX_LENGTH ? `${text.slice(0, SUMMARY_MAX_LENGTH)}…` : text;
}

function summaryTextFor(kind: string, raw: Record<string, unknown>): string {
  switch (kind) {
    case 'user':
      return `user: ${flattenMessageContent(raw)}`;
    case 'assistant':
      return `assistant: ${flattenMessageContent(raw)}`;
    case 'system':
      return `system${typeof raw.subtype === 'string' ? `/${raw.subtype}` : ''}`;
    case 'mode':
      return `mode: ${readStringField(raw, 'mode')}`;
    case 'permission-mode':
      return `permission-mode: ${readStringField(raw, 'permissionMode')}`;
    case 'ai-title':
      return `ai-title: ${readStringField(raw, 'aiTitle')}`;
    case 'last-prompt':
      return `last-prompt: ${readStringField(raw, 'lastPrompt')}`;
    case 'agent-name':
      return `agent-name: ${readStringField(raw, 'agentName')}`;
    case 'custom-title':
      return `custom-title: ${readStringField(raw, 'customTitle')}`;
    case 'file-history-snapshot':
      return 'file-history-snapshot';
    case 'queue-operation':
      return `queue-operation: ${readStringField(raw, 'operation')}`;
    case 'attachment':
      return `attachment: ${attachmentKind(raw)}`;
    default:
      return kind;
  }
}

function attachmentKind(raw: Record<string, unknown>): string {
  const attachment = raw.attachment;
  return isRecord(attachment) && typeof attachment.type === 'string' ? attachment.type : 'desconocido';
}

function flattenMessageContent(raw: Record<string, unknown>): string {
  const message = raw.message;
  if (!isRecord(message)) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!isRecord(block)) return '';
      if (block.type === 'text' && typeof block.text === 'string') return block.text;
      if (block.type === 'tool_use' && typeof block.name === 'string') return `[tool: ${block.name}]`;
      if (block.type === 'tool_result') return '[tool_result]';
      return `[${typeof block.type === 'string' ? block.type : 'contenido'}]`;
    })
    .join(' ');
}

function readStringField(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
