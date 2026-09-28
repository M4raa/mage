import { classifySystemWrapper } from '@shared/systemWrappers';

// Extraccion PURA de metadatos (cwd + titulo) de una transcripcion persistida, a partir de su CABEZA y
// su COLA (dos trozos acotados del fichero). Sin FS ni IPC -> testable. Toda linea ilegible se ignora
// (contrato tolerante en la frontera de lectura; la primera linea de la cola suele venir partida).
//
// Preferencia de titulo (P-026, 1.6): ULTIMO `custom-title` > ULTIMO `ai-title` > primer mensaje REAL
// del usuario. Medido sobre 267 transcripciones: en 60 el `custom-title` estaba mas alla de los
// primeros 64 KB (de ahi la cola) y 88 tenian varios, de los que vale el ultimo (el CLI los re-añade).
// El `ai-title` va antes que el mensaje porque es el nombre que el propio Claude Code le pone: es el
// que el usuario ve en el CLI. Un mensaje «real» no es `isMeta` ni un envoltorio de sistema.

export interface ConversationMeta {
  readonly cwd: string; // '' si ninguna linea trae cwd en lo leido
  readonly title: string; // '' si no se pudo derivar (el llamador aplica su fallback)
  // ¿Hay al menos un mensaje real del usuario? Sin ninguno, la conversacion no sale en el historial (D4).
  readonly hasUserMessage: boolean;
  // El primer mensaje real es una tarea programada (D20: insignia en el historial).
  readonly isScheduled: boolean;
}

const MAX_TITLE_LENGTH = 80;
// Las etiquetas del pegado de Claude Code rodean texto REAL del usuario: se quitan del titulo, no del chat.
const PASTED_TAGS = /<\/?pasted_content\b[^>]*>/g;

interface FirstUserMessage {
  readonly title: string;
  readonly isScheduled: boolean;
}

export function deriveConversationMeta(head: readonly string[], tail: readonly string[] = []): ConversationMeta {
  let cwd = '';
  let customTitle = '';
  let aiTitle = '';
  let firstUser: FirstUserMessage | null = null;

  // Cabeza y luego cola: asi «el ultimo» es el de la cola si lo hay. Si se solapan (fichero pequeño),
  // repetir lineas no cambia ni el primero ni el ultimo.
  for (const line of [...head, ...tail]) {
    const obj = parseLine(line);
    if (obj === null) continue;
    if (cwd === '' && typeof obj.cwd === 'string') cwd = obj.cwd;
    if (obj.type === 'custom-title') customTitle = readString(obj.customTitle) || customTitle;
    if (obj.type === 'ai-title') aiTitle = readString(obj.aiTitle) || aiTitle;
    if (firstUser === null && obj.type === 'user' && obj.isMeta !== true) firstUser = realUserMessage(obj);
  }

  return {
    cwd,
    title: truncateTitle(customTitle || aiTitle || (firstUser?.title ?? '')),
    hasUserMessage: firstUser !== null,
    isScheduled: firstUser?.isScheduled ?? false,
  };
}

// Mensaje REAL del usuario, o null si la linea no lo es (eco de tool_result, aviso, salida de comando…).
// Un comando cuenta como mensaje (lo tecleo el usuario) y titula con `/x y`; una tarea programada, con
// su nombre. Un mensaje de solo imagen es real pero no da titulo.
function realUserMessage(obj: Record<string, unknown>): FirstUserMessage | null {
  const { text, hasImage } = userContent(obj);
  if (text.length === 0) return hasImage ? { title: '', isScheduled: false } : null;
  const wrapper = classifySystemWrapper(text);
  switch (wrapper.kind) {
    case 'plain':
      return { title: text.replace(PASTED_TAGS, ' '), isScheduled: false };
    case 'command':
      return { title: wrapper.command, isScheduled: false };
    case 'scheduled-task':
      return { title: wrapper.name, isScheduled: true };
    default:
      return null;
  }
}

function truncateTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_TITLE_LENGTH) return clean;
  return `${clean.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

// Texto del mensaje: content string directo, o concatenacion de bloques `text`. Un eco de tool_result
// (array sin texto ni imagen) no trae nada.
function userContent(obj: Record<string, unknown>): { readonly text: string; readonly hasImage: boolean } {
  const message = obj.message;
  if (!isRecord(message)) return { text: '', hasImage: false };
  const content = message.content;
  if (typeof content === 'string') return { text: content.trim(), hasImage: false };
  if (!Array.isArray(content)) return { text: '', hasImage: false };
  const text = content
    .map((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter((part) => part.length > 0)
    .join(' ')
    .trim();
  return { text, hasImage: content.some((block) => isRecord(block) && block.type === 'image') };
}

function parseLine(line: string): Record<string, unknown> | null {
  if (line.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null; // linea partida (trozo cortado) o JSON invalido: se ignora
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
