import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConversationSummary } from '@shared/conversations';
import { collectTexts, messageAt, parseProtobuf, textAt, type WireField } from './protobufWire';

// Historial de agy: cada conversación es una base SQLite `<perfil>/.gemini/antigravity-cli/conversations/<id>.db`
// con una fila por paso (`steps`: `step_type` + `step_payload`, un mensaje protobuf sin esquema publicado).
// MEDIDO con agy 1.2.14 y 1.3.1 (`notes/HISTORIAL-PROVEEDORES`, fixtures sintéticos): lo que no está en esta
// lista de tipos de paso se ignora, nunca se inventa.
//   14  entrada del usuario        → texto en el campo 19.2
//   15  respuesta del modelo       → texto en el campo 20.1 (los pasos de 15 sin texto solo lanzan herramientas)
//   *   paso de herramienta        → metadatos 5.4 = {1: id de la llamada, 2: nombre, 3: argumentos JSON}; la
//                                    salida cae en el campo propio del tipo de paso, que cambia con la herramienta
//   23, 98, 101, ...               → contabilidad y avisos del sistema: fuera

const STEP_USER_INPUT = 14;
const STEP_MODEL_RESPONSE = 15;
const TOOL_OUTPUT_MAX_CHARS = 8000;
const TITLE_MAX_CHARS = 80;
const CONVERSATIONS_DIR = ['.gemini', 'antigravity-cli', 'conversations'] as const;
const DB_EXT = '.db';
const MAX_CONVERSATIONS = 300;
// Campos de nivel superior que NO son la salida de una herramienta: tipo, estado y metadatos.
const NON_OUTPUT_FIELDS: ReadonlySet<number> = new Set([1, 4, 5]);

export interface AgyStep {
  readonly index: number;
  readonly stepType: number;
  readonly payload: Uint8Array;
}

type Line = Record<string, unknown>;

function timestampOf(fields: readonly WireField[]): string | undefined {
  const seconds = messageAt(fields, [5, 1])?.find((f) => f.field === 1 && f.kind === 'varint');
  return seconds?.kind === 'varint' ? new Date(seconds.value * 1000).toISOString() : undefined;
}

function toolCallOf(fields: readonly WireField[]): { readonly id: string; readonly name: string; readonly input: unknown } | null {
  const id = textAt(fields, [5, 4, 1]);
  const name = textAt(fields, [5, 4, 2]);
  if (id === null || name === null) return null;
  return { id, name, input: toolInput(textAt(fields, [5, 4, 3])) };
}

// Los argumentos van como JSON con dos claves de presentación (`toolAction`, `toolSummary`) que sobran.
function toolInput(json: string | null): unknown {
  if (json === null) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { arguments: json };
    const { toolAction: _action, toolSummary: _summary, ...rest } = parsed as Record<string, unknown>;
    return rest;
  } catch {
    return { arguments: json };
  }
}

function toolOutputOf(fields: readonly WireField[]): string {
  const outputFields = fields.filter((f) => !NON_OUTPUT_FIELDS.has(f.field));
  const text = collectTexts(outputFields).join('\n').trim();
  return text.length > TOOL_OUTPUT_MAX_CHARS ? `${text.slice(0, TOOL_OUTPUT_MAX_CHARS)}…` : text;
}

// Pasos de una conversación de agy → líneas con la forma de transcripción de Claude (las que ya entienden
// `parseTranscriptLine` y `transcriptToBlocks`). Un paso de herramienta da dos líneas: la llamada y su salida.
export function agyStepsToLines(steps: readonly AgyStep[]): Line[] {
  const lines: Line[] = [];
  for (const step of steps) {
    const fields = parseProtobuf(step.payload);
    if (fields === null) continue;
    const base = { uuid: `agy-${step.index}`, timestamp: timestampOf(fields), isSidechain: false };
    if (step.stepType === STEP_USER_INPUT) {
      const text = textAt(fields, [19, 2]);
      if (text !== null) lines.push({ ...base, type: 'user', message: { role: 'user', content: text } });
    } else if (step.stepType === STEP_MODEL_RESPONSE) {
      const text = textAt(fields, [20, 1]);
      if (text !== null) lines.push({ ...base, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
    } else {
      pushToolLines(lines, base, fields);
    }
  }
  return lines;
}

function pushToolLines(lines: Line[], base: Line, fields: readonly WireField[]): void {
  const call = toolCallOf(fields);
  if (call === null) return;
  lines.push({ ...base, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }] } });
  lines.push({ ...base, uuid: `${String(base.uuid)}-result`, type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: toolOutputOf(fields) }] } });
}

// Carpeta de trabajo de la conversación: el `file:///…` que viaja en la primera entrada del usuario (19.12.12).
export function agyWorkspaceOf(steps: readonly AgyStep[]): string {
  for (const step of steps) {
    if (step.stepType !== STEP_USER_INPUT) continue;
    const fields = parseProtobuf(step.payload);
    const uri = fields === null ? null : textAt(fields, [19, 12, 12]);
    if (uri === null || !uri.startsWith('file:///')) continue;
    try {
      return fileURLToPath(uri);
    } catch {
      return '';
    }
  }
  return '';
}

export function agyTitleOf(steps: readonly AgyStep[]): string {
  for (const step of steps) {
    if (step.stepType !== STEP_USER_INPUT) continue;
    const fields = parseProtobuf(step.payload);
    const text = fields === null ? null : textAt(fields, [19, 2]);
    if (text !== null && text.trim().length > 0) return text.trim().split('\n')[0]!.slice(0, TITLE_MAX_CHARS);
  }
  return '';
}

// Acceso a disco de agy, inyectado: la base SQLite se abre en solo lectura en main (`node:sqlite`).
export interface AgyStore {
  readonly exists: (path: string) => boolean;
  readonly listDir: (path: string) => string[];
  readonly stat: (path: string) => { readonly mtimeMs: number; readonly sizeBytes: number };
  readonly readSteps: (dbPath: string) => AgyStep[];
  // Solo el primer paso de entrada del usuario (título y carpeta): el historial no carga conversaciones enteras.
  readonly readFirstUserStep: (dbPath: string) => AgyStep | null;
}

interface CachedSummary {
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly summary: ConversationSummary | null;
}

export class AgyHistoryService {
  // Por ruta + mtime + tamaño, como el historial de Claude y el de Codex: el sondeo es periódico.
  private readonly cache = new Map<string, CachedSummary>();

  constructor(private readonly store: AgyStore) {}

  // Conversaciones de un perfil de agy (`USERPROFILE` con el que Mage lo lanza), más recientes primero. `externalDir` es
  // el perfil REAL de agy del usuario (su `~/.gemini`): sus conversaciones también salen, las del perfil de Mage primero.
  list(profileDir: string, configDir: string, externalDir?: string): ConversationSummary[] {
    if (profileDir.trim().length === 0) throw new Error(`Perfil de agy vacio al listar conversaciones: ${JSON.stringify(profileDir)}`);
    const own = this.listProfile(profileDir, configDir);
    const ownIds = new Set(own.map((summary) => summary.sessionId));
    const external = externalDir === undefined ? [] : this.listProfile(externalDir, configDir).filter((summary) => !ownIds.has(summary.sessionId));
    return [...own, ...external].sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, MAX_CONVERSATIONS);
  }

  private listProfile(profileDir: string, configDir: string): ConversationSummary[] {
    const dir = join(profileDir, ...CONVERSATIONS_DIR);
    if (!this.store.exists(dir)) return [];
    const summaries: ConversationSummary[] = [];
    for (const file of this.store.listDir(dir)) {
      if (!file.endsWith(DB_EXT)) continue;
      const summary = this.describe(join(dir, file), file.slice(0, -DB_EXT.length), configDir);
      if (summary !== null) summaries.push(summary);
    }
    return summaries;
  }

  // Ruta de la base de una conversación (en el perfil de Mage y, si no está, en el real del usuario), o null. El id se
  // valida: nunca llega un segmento de ruta del renderer.
  findDb(profileDir: string, sessionId: string, externalDir?: string): string | null {
    if (!/^[A-Za-z0-9-]+$/.test(sessionId)) throw new Error(`sessionId de agy no valido: ${JSON.stringify(sessionId)}`);
    for (const dir of externalDir === undefined ? [profileDir] : [profileDir, externalDir]) {
      const path = join(dir, ...CONVERSATIONS_DIR, `${sessionId}${DB_EXT}`);
      if (this.store.exists(path)) return path;
    }
    return null;
  }

  // Antes de reanudar una conversación del perfil real del usuario, se COPIA al perfil de Mage: `--conversation` solo
  // reanuda dentro del perfil con el que se lanza (medido) y Mage no lanza agy con el real para no tocar su
  // `settings.json`. La original no se toca. No hace nada si ya está en el perfil de Mage.
  ensureInProfile(profileDir: string, externalDir: string | undefined, sessionId: string, copyDb: (from: string, to: string) => void): void {
    const found = this.findDb(profileDir, sessionId, externalDir);
    const target = join(profileDir, ...CONVERSATIONS_DIR, `${sessionId}${DB_EXT}`);
    if (found === null || found === target) return;
    copyDb(found, target);
  }

  readLines(dbPath: string): Line[] {
    return agyStepsToLines(this.store.readSteps(dbPath));
  }

  private describe(path: string, sessionId: string, configDir: string): ConversationSummary | null {
    try {
      const stat = this.store.stat(path);
      const cached = this.cache.get(path);
      if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.sizeBytes === stat.sizeBytes) return cached.summary;
      const first = this.store.readFirstUserStep(path);
      const steps = first === null ? [] : [first];
      const title = agyTitleOf(steps);
      const summary: ConversationSummary | null = title.length === 0 ? null : { sessionId, configDir, cwd: agyWorkspaceOf(steps), title,
        privacy: 'shared', updatedAtMs: stat.mtimeMs, sizeBytes: stat.sizeBytes, isScheduled: false, providerId: 'agy' };
      this.cache.set(path, { mtimeMs: stat.mtimeMs, sizeBytes: stat.sizeBytes, summary });
      return summary;
    } catch {
      return null;
    }
  }
}
