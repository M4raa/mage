import type { NeutralConversation, NeutralItem } from '@shared/neutralConversation';
import { bytesFieldOf, concatBytes, textFieldOf, varintField } from './protobufWire';

// Escritores: conversación neutral → fichero nativo de cada CLI, de modo que el destino la REANUDE como suya.
// Todo medido contra los binarios reales (`spike/claude-resume-spike.mjs`, `codex-synth-rollout-spike.mjs`,
// `agy-resume-synth-spike.mjs`): se escribe lo MÍNIMO que cada CLI acepta, sin copiar nada de otra conversación.

const SYNTHETIC_MODEL = 'mage-import';
const STEP_SECONDS = 1;
const TOOL_ARGS_MAX_CHARS = 200;
const TOOL_OUTPUT_MAX_CHARS = 600;

export interface WriterClock {
  // Instante de la primera línea cuando la conversación no trae marcas de tiempo; las siguientes avanzan 1 s.
  readonly baseMs: number;
}

// Marca de tiempo de cada elemento: la suya si la tiene y, si no, la anterior + 1 s (nunca retrocede).
function timestamps(items: readonly NeutralItem[], clock: WriterClock): number[] {
  const out: number[] = [];
  let previous: number | null = null;
  for (const item of items) {
    const next: number = item.atMs !== null && (previous === null || item.atMs > previous) ? item.atMs : (previous ?? clock.baseMs - STEP_SECONDS * 1000) + STEP_SECONDS * 1000;
    out.push(next);
    previous = next;
  }
  return out;
}

// --- Claude: <cuenta>/projects/<cwd>/<id>.jsonl, cadena parentUuid ----------------------------------------------

export interface ClaudeWriteContext {
  readonly sessionId: string;
  readonly newId: () => string;
  readonly clock: WriterClock;
}

export function claudeTranscriptText(conversation: NeutralConversation, context: ClaudeWriteContext): string {
  const stamps = timestamps(conversation.items, context.clock);
  const lines: Record<string, unknown>[] = [];
  let parent: string | null = null;
  const push = (item: Record<string, unknown>, at: number): void => {
    const uuid = context.newId();
    lines.push({ parentUuid: parent, isSidechain: false, uuid, timestamp: new Date(at).toISOString(), sessionId: context.sessionId, cwd: conversation.cwd, ...item });
    parent = uuid;
  };
  const assistant = (content: unknown[], stop: string): Record<string, unknown> => ({ type: 'assistant', message: {
    id: `msg_${context.newId().replaceAll('-', '').slice(0, 24)}`, type: 'message', role: 'assistant', model: SYNTHETIC_MODEL, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  conversation.items.forEach((item, index) => {
    const at = stamps[index]!;
    if (item.kind === 'tool') {
      push(assistant([{ type: 'tool_use', id: item.id, name: item.name, input: item.input }], 'tool_use'), at);
      push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: item.id, content: item.output, ...(item.isError ? { is_error: true } : {}) }] } }, at);
    } else if (item.kind === 'user') push({ type: 'user', message: { role: 'user', content: item.text } }, at);
    else push(assistant([{ type: 'text', text: item.text }], 'end_turn'), at);
  });
  return lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
}

// --- Codex: <CODEX_HOME>/sessions/AAAA/MM/DD/rollout-<fecha>-<id>.jsonl ---------------------------------------------

export interface CodexWriteContext {
  readonly threadId: string;
  readonly clock: WriterClock;
}

const pad = (value: number): string => String(value).padStart(2, '0');

// Ruta relativa al CODEX_HOME donde Codex busca el rollout de un hilo (fecha en UTC, como la del propio CLI).
export function codexRolloutRelativePath(threadId: string, atMs: number): string[] {
  const d = new Date(atMs);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
  return ['sessions', String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1), pad(d.getUTCDate()), `rollout-${day}T${time}-${threadId}.jsonl`];
}

export function codexRolloutText(conversation: NeutralConversation, context: CodexWriteContext): string {
  const stamps = timestamps(conversation.items, context.clock);
  let ordinal = 0;
  const line = (type: string, payload: unknown, at: number): string => JSON.stringify({ timestamp: new Date(at).toISOString(), ordinal: ordinal++, type, payload });
  const lines = [line('session_meta', { id: context.threadId, session_id: context.threadId, timestamp: new Date(context.clock.baseMs).toISOString(), cwd: conversation.cwd,
    originator: 'mage', cli_version: '0.160.0', source: 'cli', model_provider: 'openai' }, context.clock.baseMs)];
  const message = (role: string, partType: string, text: string, at: number): string => line('response_item', { type: 'message', role, content: [{ type: partType, text }] }, at);
  conversation.items.forEach((item, index) => {
    const at = stamps[index]!;
    if (item.kind === 'tool') {
      lines.push(line('response_item', { type: 'function_call', call_id: item.id, name: item.name, arguments: JSON.stringify(item.input) }, at));
      lines.push(line('response_item', { type: 'function_call_output', call_id: item.id, output: item.isError ? `Error: ${item.output}` : item.output }, at));
    } else lines.push(message(item.kind, item.kind === 'user' ? 'input_text' : 'output_text', item.text, at));
  });
  return lines.join('\n') + '\n';
}

// --- agy: <perfil>/.gemini/antigravity-cli/conversations/<id>.db (SQLite + protobuf) -----------------------------------

export interface AgyStepRow {
  readonly idx: number;
  readonly stepType: number;
  readonly metadata: Uint8Array;
  readonly payload: Uint8Array;
}

export interface AgyWriteContext {
  readonly conversationId: string;
  readonly trajectoryId: string;
  readonly newId: () => string;
  readonly clock: WriterClock;
}

export interface AgyDbContent {
  readonly steps: readonly AgyStepRow[];
  readonly trajectoryId: string;
  readonly conversationId: string;
  readonly metadataBlob: Uint8Array;
}

const AGY_STEP_USER = 14;
const AGY_STEP_MODEL = 15;
const AGY_STATUS_DONE = 3;
const AGY_PROJECT = 'default-cli-project';

// agy guarda sus herramientas como un tipo de paso por herramienta; las de otro proveedor no tienen paso propio y
// entran como una línea de texto de la respuesta.
function toolAsText(item: Extract<NeutralItem, { kind: 'tool' }>): string {
  const args = JSON.stringify(item.input).slice(0, TOOL_ARGS_MAX_CHARS);
  const output = item.output.trim().slice(0, TOOL_OUTPUT_MAX_CHARS);
  return `[herramienta ${item.name}${item.isError ? ' (con error)' : ''}: ${args}${output.length === 0 ? '' : ` → ${output}`}]`;
}

function stamp(ms: number): Uint8Array {
  return concatBytes(varintField(1, Math.floor(ms / 1000)), varintField(2, (ms % 1000) * 1_000_000));
}

function agyStep(kind: 'user' | 'assistant', text: string, at: number, ctx: AgyWriteContext, idx: number): AgyStepRow {
  const metadata = concatBytes(bytesFieldOf(1, stamp(at)), varintField(3, kind === 'user' ? 4 : 2), textFieldOf(12, ctx.newId()),
    bytesFieldOf(20, concatBytes(textFieldOf(1, ctx.trajectoryId), textFieldOf(4, ctx.conversationId))));
  const body = kind === 'user'
    ? bytesFieldOf(19, concatBytes(textFieldOf(2, text), bytesFieldOf(3, textFieldOf(1, text))))
    : bytesFieldOf(20, concatBytes(textFieldOf(1, text), textFieldOf(8, text)));
  const stepType = kind === 'user' ? AGY_STEP_USER : AGY_STEP_MODEL;
  return { idx, stepType, metadata, payload: concatBytes(varintField(1, stepType), varintField(4, AGY_STATUS_DONE), bytesFieldOf(5, metadata), body) };
}

export function agyDbContent(conversation: NeutralConversation, context: AgyWriteContext): AgyDbContent {
  const stamps = timestamps(conversation.items, context.clock);
  const rows: AgyStepRow[] = [];
  conversation.items.forEach((item, index) => {
    const at = stamps[index]!;
    if (item.kind === 'tool') rows.push(agyStep('assistant', toolAsText(item), at, context, rows.length));
    else rows.push(agyStep(item.kind, item.text, at, context, rows.length));
  });
  const uri = `file:///${conversation.cwd.replaceAll('\\', '/')}`;
  const metadataBlob = concatBytes(bytesFieldOf(1, concatBytes(textFieldOf(1, uri), bytesFieldOf(3, new Uint8Array()))), bytesFieldOf(2, stamp(context.clock.baseMs)),
    textFieldOf(6, context.conversationId), textFieldOf(7, uri), textFieldOf(18, AGY_PROJECT));
  return { steps: rows, trajectoryId: context.trajectoryId, conversationId: context.conversationId, metadataBlob };
}

// Esquema de las bases de agy (las 9 sentencias medidas en agy 1.2.14 / 1.3.1).
export const AGY_DB_SCHEMA: readonly string[] = [
  'CREATE TABLE `trajectory_meta` (`trajectory_id` text,`cascade_id` text,`trajectory_type` integer,`source` integer,PRIMARY KEY (`trajectory_id`))',
  'CREATE TABLE `steps` (`idx` integer,`step_type` integer NOT NULL DEFAULT 0,`status` integer NOT NULL DEFAULT 0,`has_subtrajectory` numeric NOT NULL DEFAULT false,`metadata` blob,`error_details` blob,`permissions` blob,`task_details` blob,`render_info` blob,`step_payload` blob,`step_format` integer NOT NULL DEFAULT 0,PRIMARY KEY (`idx`))',
  'CREATE INDEX `idx_steps_status` ON `steps`(`status`)',
  'CREATE INDEX `idx_steps_step_type` ON `steps`(`step_type`)',
  'CREATE TABLE `gen_metadata` (`idx` integer,`data` blob,`size` integer NOT NULL DEFAULT 0,PRIMARY KEY (`idx`))',
  'CREATE TABLE `executor_metadata` (`idx` integer,`data` blob,PRIMARY KEY (`idx`))',
  'CREATE TABLE `parent_references` (`idx` integer,`data` blob,PRIMARY KEY (`idx`))',
  'CREATE TABLE `trajectory_metadata_blob` (`id` text DEFAULT "main",`data` blob,PRIMARY KEY (`id`))',
  'CREATE TABLE `battle_mode_infos` (`idx` integer,`data` blob,PRIMARY KEY (`idx`))',
];
