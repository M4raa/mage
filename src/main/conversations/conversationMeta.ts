// Extraccion PURA de metadatos (cwd + titulo) de una transcripcion persistida, a partir de sus
// primeras lineas NDJSON (un prefijo acotado del fichero basta: cwd y el primer prompt estan al
// principio). Sin FS ni IPC -> testable. Preferencia de titulo: custom-title > ai-title > primer
// mensaje de usuario. Toda linea ilegible se ignora (contrato tolerante en la frontera de lectura).

export interface ConversationMeta {
  readonly cwd: string; // '' si ninguna linea trae cwd en el prefijo leido
  readonly title: string; // '' si no se pudo derivar (el llamador aplica su fallback)
}

const MAX_TITLE_LENGTH = 80;

export function deriveConversationMeta(lines: readonly string[]): ConversationMeta {
  let cwd = '';
  let customTitle = '';
  let aiTitle = '';
  let firstUser = '';

  for (const line of lines) {
    const obj = parseLine(line);
    if (obj === null) continue;
    if (cwd === '' && typeof obj.cwd === 'string') cwd = obj.cwd;
    if (customTitle === '' && obj.type === 'custom-title') customTitle = readString(obj.customTitle);
    if (aiTitle === '' && obj.type === 'ai-title') aiTitle = readString(obj.aiTitle);
    if (firstUser === '' && obj.type === 'user') firstUser = firstUserText(obj);
  }

  return { cwd, title: truncateTitle(customTitle || aiTitle || firstUser) };
}

function truncateTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_TITLE_LENGTH) return clean;
  return `${clean.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

// Texto del primer mensaje de usuario: content string directo, o concatenacion de bloques `text`.
// Ignora ecos de tool_result (content array sin bloques de texto -> '').
function firstUserText(obj: Record<string, unknown>): string {
  const message = obj.message;
  if (!isRecord(message)) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter((text) => text.length > 0)
    .join(' ');
}

function parseLine(line: string): Record<string, unknown> | null {
  if (line.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null; // linea partida (prefijo cortado) o JSON invalido: se ignora
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
