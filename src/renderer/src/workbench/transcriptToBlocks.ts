import type { TranscriptEntry } from '@shared/transcripts';
import type { Block, ImageAttachment, TextRun } from './types';
import { SUPPORTED_IMAGE_MEDIA_TYPES } from './types';
import { extractToolResult, extractToolUses } from './toolView';
import { classifyTool } from './toolClassify';
import { completeArtifactPublication, parseArtifactDraft } from '@shared/artifacts';
import { SUBAGENT_TOOL_NAMES } from './toolSummary';
import { noticeTextFor } from './cliNotices';

// Reconstruye los bloques del chat (M2.5b) a partir de una transcripcion persistida ya cargada, para
// que una conversacion REANUDADA no arranque con el panel principal vacio. PURO (datos -> datos,
// testeable): recorre las entradas en orden emitiendo bloques user/agent/tool y rellenando cada tool
// con su tool_result (emparejado por tool_use_id). Reutiliza los helpers de toolView. Los ids son
// DETERMINISTAS (derivados del indice de la entrada) — nada de Date.now/random aqui.

export function transcriptToBlocks(entries: readonly TranscriptEntry[], thinking: readonly string[] = []): readonly Block[] {
  const blocks: Block[] = [];
  const toolIndexById = new Map<string, number>(); // tool_use_id -> indice de su bloque en `blocks`
  // Cursor sobre los pensamientos que guarda Mage (el CLI los persiste vacios). Va por ORDEN, no por
  // id: ver el comentario de donde se consume. Por defecto vacio, y entonces todo queda como estaba.
  const thinkingCursor: ThinkingCursor = { texts: thinking, index: 0 };

  for (const entry of entries) {
    // Entradas inyectadas por el CLI para su contabilidad (aviso de imagen pegada,
    // <system-reminder>): no son conversacion y hasta ahora se pintaban como burbujas del usuario.
    // `=== true` a proposito: el campo tambien viene como false, y tratar su ausencia como meta
    // esconderia la mayoria de los mensajes reales.
    if (entry.isMeta) continue;
    if (entry.kind === 'user') {
      appendUserOrResult(entry, blocks, toolIndexById);
    } else if (entry.kind === 'assistant') {
      appendAssistant(entry, blocks, toolIndexById, thinkingCursor);
    } else if (entry.kind === 'system') {
      // Las lineas `system` del CLI se tiraban enteras, asi que un `/compact` DESAPARECIA al reanudar
      // la conversacion. Ahora las que son avisos vuelven al hilo como linea de sistema (2.5).
      appendSystemNotice(entry, blocks);
    }
    // metadata/unknown: no aportan al hilo de conversacion -> se ignoran.
  }
  return blocks;
}

// Una linea `user` es O BIEN un eco de tool_result (rellena un bloque tool ya emitido) O BIEN un
// mensaje real del usuario (nuevo bloque). Nunca ambas.
function appendUserOrResult(entry: TranscriptEntry, blocks: Block[], toolIndexById: Map<string, number>): void {
  const result = extractToolResult(entry);
  if (result !== null) {
    const index = toolIndexById.get(result.toolUseId);
    if (index === undefined) return; // tool_result sin su tool_use previo (raro): se ignora
    const current = blocks[index];
    if (current === undefined) return;
    if (current.kind === 'subagent') {
      blocks[index] = { ...current, agentId: result.agentId ?? current.agentId, status: result.isError ? 'error' : 'completado' };
      return;
    }
    if (current.kind !== 'tool') return;
    blocks[index] = {
      ...current,
      meta: result.isError ? 'error' : 'ok',
      isError: result.isError,
      output: result.output.length > 0 ? [{ code: false, text: result.output }] : current.output,
      filePath: result.filePath ?? current.filePath,
      diff: result.diff ?? current.diff,
      writtenContent: result.writtenContent?.split('\n') ?? current.writtenContent,
      artifact:
        current.artifactDraft === null ? current.artifact : completeArtifactPublication(current.artifactDraft, result.output),
    };
    return;
  }
  const { text, attachments } = userMessageContent(entry.raw);
  // Un mensaje que era SOLO una imagen tambien es un mensaje: con la condicion antigua (solo texto)
  // desaparecia del hilo.
  if (text.length > 0 || attachments.length > 0) {
    blocks.push({ kind: 'user', id: blockId(entry.index, 0), text, time: formatTime(entry.timestampMs), attachments });
  }
}

// Una linea `assistant` puede traer texto y/o varios tool_use. Emite el bloque de texto (si lo hay) y
// un bloque tool por cada tool_use, registrando su indice para emparejar el tool_result posterior.
// Cursor MUTABLE sobre los pensamientos guardados. Es un objeto y no un numero suelto porque
// `appendAssistant` tiene que poder avanzarlo, y devolverlo por retorno enturbiaria su firma para el
// unico caso en que hay pensamiento.
interface ThinkingCursor {
  readonly texts: readonly string[];
  index: number;
}

function appendAssistant(entry: TranscriptEntry, blocks: Block[], toolIndexById: Map<string, number>, thinking: ThinkingCursor): void {
  let slot = 0;
  // Pensamiento (2.5). MEDIDO: el CLI persiste los bloques `thinking` con texto VACIO (solo su firma),
  // asi que al reanudar se puede decir "pensó" pero no QUE penso. Se pinta igualmente: esconderlo
  // borraria del hilo que el agente estuvo pensando.
  if (hasThinkingBlock(entry.raw)) {
    // El texto lo pone MAGE, no el CLI: sus bloques `thinking` van vacios en disco (medido). El
    // N-esimo pensamiento guardado corresponde al N-esimo bloque vacio — las dos secuencias son de
    // solo-añadir y se producen a la vez, asi que casan por orden sin necesitar un id que el CLI no da.
    const saved = thinking.texts[thinking.index++];
    blocks.push({
      kind: 'thinking',
      id: blockId(entry.index, slot++),
      runs: saved === undefined ? [] : [{ code: false, text: saved }],
      streaming: false,
      elapsedMs: null,
    });
  }
  const text = assistantText(entry.raw);
  if (text.trim().length > 0) {
    blocks.push({ kind: 'agent', id: blockId(entry.index, slot++), runs: [{ code: false, text }], streaming: false });
  }
  for (const use of extractToolUses(entry)) {
    // Un subagente NO es una tool mas: tiene su propio bloque, con su transcripcion aparte.
    if (SUBAGENT_TOOL_NAMES.has(use.toolName)) {
      blocks.push({
        kind: 'subagent',
        id: blockId(entry.index, slot++),
        toolUseId: use.toolUseId,
        agentType: stringOrNull(use.input.subagent_type),
        description: stringOrNull(use.input.description),
        agentId: null,
        status: null,
      });
      toolIndexById.set(use.toolUseId, blocks.length - 1);
      continue;
    }
    blocks.push({
      kind: 'tool',
      id: blockId(entry.index, slot++),
      toolUseId: use.toolUseId,
      tool: use.toolName,
      toolClass: classifyTool(use.toolName),
      command: use.summary,
      meta: '',
      isError: false,
      output: [],
      filePath: null,
      diff: null,
      writtenContent: null,
      artifact: null,
      artifactDraft: parseArtifactDraft(use.toolName, use.input),
    });
    toolIndexById.set(use.toolUseId, blocks.length - 1);
  }
}

// Aviso del CLI persistido como linea `system` (compactacion, sobre todo). Se traduce con el MISMO
// modulo que la ruta en vivo (`cliNotices`), asi el hilo reanudado dice exactamente lo mismo que dijo
// en su momento.
function appendSystemNotice(entry: TranscriptEntry, blocks: Block[]): void {
  const raw = entry.raw;
  if (!isRecord(raw) || raw.subtype !== 'compact_boundary') return;
  const metadata = isRecord(raw.compact_metadata) ? raw.compact_metadata : null;
  const trigger = typeof metadata?.trigger === 'string' ? metadata.trigger : 'manual';
  const text = noticeTextFor({ kind: 'compacted', trigger });
  if (text === null) return;
  blocks.push({ kind: 'system', id: blockId(entry.index, 0), text });
}

// ¿Trae este mensaje del asistente algun bloque de pensamiento? (su texto viene vacio en disco).
function hasThinkingBlock(raw: unknown): boolean {
  const content = messageContent(raw);
  if (!Array.isArray(content)) return false;
  return content.some((block) => isRecord(block) && block.type === 'thinking');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

// --- helpers de extraccion de texto -----------------------------------------------------------

interface UserMessageContent {
  readonly text: string;
  readonly attachments: readonly ImageAttachment[];
}

const EMPTY_USER_CONTENT: UserMessageContent = { text: '', attachments: [] };

// Texto Y ADJUNTOS de un mensaje `user`: el `content` es una cadena en la mayoria de los mensajes, o
// un array de bloques cuando el usuario mando una imagen (medido: un solo mensaje con
// [text, image]). Antes solo se miraban los bloques `text`, asi que la imagen se descartaba y el hilo
// perdia lo que el usuario habia enviado.
function userMessageContent(raw: unknown): UserMessageContent {
  const content = messageContent(raw);
  if (typeof content === 'string') return { text: content.trim(), attachments: [] };
  if (!Array.isArray(content)) return EMPTY_USER_CONTENT;

  const texts: string[] = [];
  const attachments: ImageAttachment[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    else if (block.type === 'image') pushImageAttachment(attachments, block.source);
  }
  return { text: texts.join('').trim(), attachments };
}

// Adjunto de un bloque `image` del CLI: `{source:{type:'base64', media_type, data}}`. Una guard clause
// por cada cosa que puede faltar: sin base64 (un `source` de tipo `url`, o `data` ausente) o con un
// media_type que el navegador no pinta, se descarta el ADJUNTO y se conserva el texto — nunca se
// emite un `data:` roto, que en el DOM se ve como una imagen partida y no como "no habia imagen".
function pushImageAttachment(into: ImageAttachment[], source: unknown): void {
  if (!isRecord(source) || typeof source.data !== 'string' || source.data.length === 0) return;
  const mediaType = SUPPORTED_IMAGE_MEDIA_TYPES.find((supported) => supported === source.media_type);
  if (mediaType === undefined) return;
  into.push({ mediaType, data: source.data });
}

// Texto de un mensaje `assistant`: solo bloques `text` (se ignoran `thinking` y `tool_use`).
function assistantText(raw: unknown): string {
  const content = messageContent(raw);
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: string; text: string } => isRecord(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

function messageContent(raw: unknown): unknown {
  if (!isRecord(raw)) return null;
  const message = raw.message;
  return isRecord(message) ? message.content : null;
}

function blockId(entryIndex: number, slot: number): string {
  return `tb-${entryIndex}-${slot}`;
}

// Hora local HH:MM del bloque de usuario (presentacion). Vacio si la entrada no trae timestamp.
function formatTime(timestampMs: number | null): string {
  if (timestampMs === null) return '';
  return new Date(timestampMs).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
