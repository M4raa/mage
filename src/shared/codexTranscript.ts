// Traduce una línea del rollout de Codex (`CODEX_HOME/sessions/AAAA/MM/DD/rollout-<fecha>-<id>.jsonl`, medido
// con codex-cli 0.160.0) a la forma de línea de transcripción de Claude que ya entiende `parseTranscriptLine`
// y `transcriptToBlocks`. Una línea entra, una línea sale (los índices por línea física no se mueven): lo que
// no es conversación sale como `codex-<tipo>`, que el normalizador trata como metadato y el hilo ignora.

const INJECTED_CONTEXT_PREFIXES = ['<environment_context>', '<app-context>', '<user_instructions>', '<permissions', '# AGENTS.md', '<turn_aborted>'];

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

// Texto de un `content` de mensaje (`input_text` / `output_text`).
export function codexContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (isRec(part) && typeof part.text === 'string' ? part.text : '')).join('');
}

// ¿Texto que Codex mete como contexto (entorno, instrucciones) y que no escribió el usuario?
export function isCodexInjectedContext(text: string): boolean {
  const head = text.trimStart();
  return INJECTED_CONTEXT_PREFIXES.some((prefix) => head.startsWith(prefix));
}

function envelope(raw: Rec, extra: Rec): Rec {
  return { uuid: typeof raw.ordinal === 'number' ? `codex-${raw.ordinal}` : null, timestamp: raw.timestamp, isSidechain: false, ...extra };
}

function toolInput(payload: Rec): unknown {
  const text = typeof payload.arguments === 'string' ? payload.arguments : typeof payload.input === 'string' ? payload.input : '';
  if (payload.type === 'custom_tool_call') return { input: text };
  try {
    const parsed: unknown = JSON.parse(text);
    return isRec(parsed) ? parsed : { arguments: text };
  } catch {
    return { arguments: text };
  }
}

function toolOutputText(output: unknown): string {
  return typeof output === 'string' ? output : codexContentText(output);
}

function adaptMessage(raw: Rec, payload: Rec): Rec {
  const text = codexContentText(payload.content);
  if (payload.role === 'assistant') {
    return envelope(raw, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  }
  const meta = payload.role !== 'user' || isCodexInjectedContext(text);
  return envelope(raw, { type: 'user', isMeta: meta, message: { role: 'user', content: text } });
}

export function adaptCodexLine(raw: unknown): Rec {
  if (!isRec(raw) || typeof raw.type !== 'string') return { type: 'codex-unknown' };
  const payload = isRec(raw.payload) ? raw.payload : null;
  if (raw.type !== 'response_item' || payload === null) return envelope(raw, { type: `codex-${raw.type}` });
  switch (payload.type) {
    case 'message':
      return adaptMessage(raw, payload);
    case 'function_call':
    case 'custom_tool_call':
      return envelope(raw, { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', id: String(payload.call_id ?? payload.id ?? ''), name: String(payload.name ?? 'tool'), input: toolInput(payload) }] } });
    case 'function_call_output':
    case 'custom_tool_call_output':
      return envelope(raw, { type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: String(payload.call_id ?? ''), content: toolOutputText(payload.output) }] } });
    default:
      return envelope(raw, { type: `codex-${String(payload.type)}` });
  }
}

// Lo que enseña el historial de una conversación de Codex, de las primeras líneas de su rollout.
export interface CodexRolloutHead {
  readonly sessionId: string;
  readonly cwd: string;
  readonly startedAtMs: number | null;
  readonly title: string;
}

const TITLE_MAX_CHARS = 80;

export function readCodexRolloutHead(lines: readonly string[]): CodexRolloutHead | null {
  let meta: Rec | null = null;
  let title = '';
  for (const line of lines) {
    const raw = parseLine(line);
    if (raw === null) continue;
    if (raw.type === 'session_meta' && isRec(raw.payload) && meta === null) meta = raw.payload;
    const adapted = adaptCodexLine(raw);
    // Solo texto de usuario: los `tool_result` también son líneas `user`, pero con una lista de bloques.
    if (title === '' && adapted.type === 'user' && adapted.isMeta !== true && isRec(adapted.message) && typeof adapted.message.content === 'string') {
      title = adapted.message.content.trim().split('\n')[0]?.slice(0, TITLE_MAX_CHARS) ?? '';
    }
    if (meta !== null && title !== '') break;
  }
  if (meta === null || typeof meta.id !== 'string') return null;
  const started = typeof meta.timestamp === 'string' ? Date.parse(meta.timestamp) : Number.NaN;
  return { sessionId: meta.id, cwd: typeof meta.cwd === 'string' ? meta.cwd : '', startedAtMs: Number.isFinite(started) ? started : null, title };
}

function parseLine(line: string): Rec | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRec(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
