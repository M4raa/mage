import type { PermissionRequest, ToolResult, ToolUse, TurnUsage } from '@shared/events';
import { SUBAGENT_ASYNC_LAUNCHED, type SubagentRunInfo } from '@shared/subagentRun';
import type { AskQuestion } from '@shared/askUserQuestion';
import type { Block, ImageAttachment, PermissionView, TextRun } from './types';
import type { DiffLine } from './diffLines';
import { parseStructuredPatch } from './diffLines';
import { classifyTool } from './toolClassify';
import { completeArtifactPublication, parseArtifactDraft } from '@shared/artifacts';
import { formatToolMeta, summarizeToolInput } from './toolSummary';

// Mapeo PURO del modelo de eventos comun (MageEvent) a los bloques/permiso de la UI. Sin React ni
// zustand: solo funciones de datos -> datos (testeable en Vitest, env node). Los ids de bloque los
// pasa el store (determinismo; nada de Date.now/random aqui). El store orquesta; la logica vive aqui.


export interface DeltaResult {
  readonly blocks: readonly Block[];
  readonly streamingId: string | null;
}

// Acumula un delta de streaming en el bloque `agent` en curso (lo crea si no existe). En Fase B el
// texto se acumula plano (sin parsear code inline); ya es streaming real.
export function appendDelta(
  blocks: readonly Block[],
  streamingId: string | null,
  text: string,
  newId: string,
): DeltaResult {
  if (streamingId !== null) {
  // Atajo para el caso normal: el bloque que crece es el ULTIMO. Sin esto se recorria y se
  // reasignaba el hilo ENTERO en cada delta (P16). `appendThinkingDelta` ya usaba este mismo atajo.
  const last = blocks[blocks.length - 1];
  if (last !== undefined && last.kind === 'agent' && last.id === streamingId) {
    return { blocks: [...blocks.slice(0, -1), { ...last, runs: growRuns(last.runs, text) }], streamingId };
  }
    const next = blocks.map((b) =>
      b.kind === 'agent' && b.id === streamingId ? { ...b, runs: growRuns(b.runs, text) } : b,
    );
    return { blocks: next, streamingId };
  }
  // Un delta VACIO no abre bloque: el CLI emite alguno al empezar el turno y abrirlo dejaba un bloque
  // de agente sin texto que, al cerrarse, se veia como una raya suelta en el chat (A5).
  if (text.length === 0) return { blocks, streamingId: null };
  const agent: Block = { kind: 'agent', id: newId, runs: [{ code: false, text }], streaming: true };
  return { blocks: [...blocks, agent], streamingId: newId };
}

// Marca como cerrado (no streaming) el bloque de agente en curso; sin efecto si no existe.
export function closeStreaming(blocks: readonly Block[], streamingId: string | null): readonly Block[] {
  if (streamingId === null) return blocks;
  return blocks.map((b) => (b.kind === 'agent' && b.id === streamingId ? { ...b, streaming: false } : b));
}

// Mensaje del usuario a añadir al hilo. Objeto de contexto en vez de cuatro parametros sueltos: con
// los adjuntos serian cinco, y `text`/`time`/`id` son todos strings (invertir dos en la llamada
// compila igual).
export interface NewUserBlock {
  readonly id: string;
  readonly text: string;
  readonly time: string;
  // Imagenes del mensaje. La ruta VIVA todavia manda siempre [] (enviar imagenes es de la Fase E);
  // existe aqui para que el bloque optimista y el reconstruido desde la transcripcion sean el mismo.
  readonly attachments: readonly ImageAttachment[];
}

// Bloque de usuario (optimista: lo anadimos al enviar; el CLI no reemite el mensaje del usuario).
export function appendUserBlock(blocks: readonly Block[], user: NewUserBlock): readonly Block[] {
  return [...blocks, { kind: 'user', ...user }];
}

// ¿La peticion pendiente es una PREGUNTA (AskUserQuestion) aun sin contestar? Es el mismo can_use_tool
// que un permiso, pero no se contesta con Permitir/Denegar: ni el panel ni los atajos 1/2/3 pueden
// responderla (contestarla vacia la dejaba viva y al agente sin respuestas, P-026 1.4).
export function hasPendingQuestion(
  pending: { readonly requestId: string } | null | undefined,
  blocks: readonly Block[],
): boolean {
  if (pending === null || pending === undefined) return false;
  return blocks.some((b) => b.kind === 'question' && b.requestId === pending.requestId && b.state === 'pending');
}

// Tarjeta de pregunta del agente (2.3, AskUserQuestion). Nace `pending`: hasta que se conteste, el
// panel de permiso no ofrece Permitir/Denegar para su requestId.
export function appendQuestionBlock(
  blocks: readonly Block[],
  question: { readonly id: string; readonly requestId: string; readonly questions: readonly AskQuestion[] },
): readonly Block[] {
  return [...blocks, { kind: 'question', ...question, state: 'pending', answers: null }];
}

// ¿Hay ya una tarjeta para este requestId? El CLI puede reenviar el mismo can_use_tool (o el reducer
// verlo dos veces al reanudar): duplicar la tarjeta ofreceria contestar dos veces lo mismo.
export function hasQuestionBlock(blocks: readonly Block[], requestId: string): boolean {
  return blocks.some((block) => block.kind === 'question' && block.requestId === requestId);
}

// Marca la tarjeta como contestada y CONSERVA las respuestas: el hilo tiene que seguir contando lo que
// se eligio cuando se relea la conversacion.
export function answerQuestionBlock(
  blocks: readonly Block[],
  requestId: string,
  answers: Readonly<Record<string, string>>,
): readonly Block[] {
  return blocks.map((block) =>
    block.kind === 'question' && block.requestId === requestId ? { ...block, state: 'answered', answers } : block,
  );
}

// La peticion se cancelo desde el CLI (control_cancel_request): la tarjeta deja de ser contestable.
// Devuelve el MISMO array si no habia ninguna tarjeta pendiente con ese requestId (igual que
// `closeStreaming`): asi el reducer puede distinguir "no ha cambiado nada" sin comparar contenidos.
export function cancelQuestionBlock(blocks: readonly Block[], requestId: string): readonly Block[] {
  const matches = (block: Block): boolean =>
    block.kind === 'question' && block.requestId === requestId && block.state === 'pending';
  if (!blocks.some(matches)) return blocks;
  return blocks.map((block) => (matches(block) ? { ...block, state: 'cancelled' } : block));
}

// --- Tarjeta de PERMISO en el chat (2.3b) -----------------------------------------------------
//
// Misma familia que la tarjeta de pregunta: el permiso es parte del relato de la conversacion, asi que
// se pinta EN EL HILO y ahi se contesta. La tarjeta se queda despues como registro de lo que se pidio
// y de lo que se decidio (permitido/denegado/cancelado), que es lo que hace legible una conversacion
// releida un mes despues.

export function appendPermissionBlock(
  blocks: readonly Block[],
  permission: {
    readonly id: string;
    readonly requestId: string;
    readonly toolName: string;
    readonly prompt: string;
    readonly target: string;
    readonly summary: string;
  },
): readonly Block[] {
  return [...blocks, { kind: 'permission', ...permission, state: 'pending' }];
}

// ¿Hay ya tarjeta de permiso para este requestId? El CLI puede reenviar el mismo can_use_tool: dos
// tarjetas para una peticion ofrecerian contestar dos veces lo mismo, y la segunda respuesta hace que
// `AgentSession.answerPermission` lance.
export function hasPermissionBlock(blocks: readonly Block[], requestId: string): boolean {
  return blocks.some((block) => block.kind === 'permission' && block.requestId === requestId);
}

// Cierra la tarjeta con la decision tomada. Devuelve el MISMO array si no habia ninguna PENDIENTE con
// ese requestId (mismo contrato que `cancelQuestionBlock`): asi el reducer no emite un parche vacio, y
// una respuesta que llega tarde —o dos veces— no reescribe una tarjeta ya cerrada.
export function resolvePermissionBlock(
  blocks: readonly Block[],
  requestId: string,
  state: 'allowed' | 'denied' | 'cancelled',
): readonly Block[] {
  const matches = (block: Block): boolean =>
    block.kind === 'permission' && block.requestId === requestId && block.state === 'pending';
  if (!blocks.some(matches)) return blocks;
  // La condicion se repite dentro del map (en vez de reusar `matches`) para que TypeScript ESTRECHE el
  // bloque a la variante 'permission': con un predicado suelto, el spread valdria para cualquier
  // variante y `state: 'allowed'` acabaria siendo asignable a una tarjeta de pregunta.
  return blocks.map((block) =>
    block.kind === 'permission' && block.requestId === requestId && block.state === 'pending' ? { ...block, state } : block,
  );
}

// Bloque de tool (al llegar el tool_use): meta/output vacios hasta que llegue su tool_result.
export function appendToolUse(blocks: readonly Block[], tool: ToolUse, id: string): readonly Block[] {
  const block: Block = {
    kind: 'tool',
    id,
    toolUseId: tool.toolUseId,
    tool: tool.toolName,
    toolClass: classifyTool(tool.toolName),
    // El MISMO resumen que la ruta de la transcripcion (toolSummary): antes habia dos, y la misma tool
    // se veia distinta segun viniera del stream o de reconstruir el hilo.
    command: summarizeToolInput(tool.toolName, tool.input),
    meta: '',
    isError: false,
    output: [],
    filePath: null,
    diff: null,
    writtenContent: null,
    artifact: null,
    // Del input de la tool solo se guarda lo que la tarjeta necesita (titulo, descripcion, favicon,
    // ruta): el resto del input no entra en el estado.
    artifactDraft: parseArtifactDraft(tool.toolName, tool.input),
    parentToolUseId: tool.parentToolUseId ?? null,
  };
  return [...blocks, block];
}

// Bloque de SUBAGENTE (2.5): un `Task`/`Agent` no es una tool mas. `agentId` llega con su tool_result;
// hasta entonces no se puede abrir su transcripcion.
export function appendSubagentBlock(blocks: readonly Block[], tool: ToolUse, id: string): readonly Block[] {
  return [
    ...blocks,
    {
      kind: 'subagent',
      id,
      toolUseId: tool.toolUseId,
      agentType: stringOrNull(tool.input.subagent_type),
      description: stringOrNull(tool.input.description),
      ...EMPTY_SUBAGENT_RUN,
    },
  ];
}

// Estados de un bloque de subagente (ademas de null = lanzandose). Texto en castellano porque es lo que
// se pinta en Actividad y en el panel.
export const SUBAGENT_STATUS = {
  background: 'en segundo plano',
  completed: 'completado',
  error: 'error',
  stopped: 'detenido',
} as const;

type SubagentBlock = Extract<Block, { kind: 'subagent' }>;

export const EMPTY_SUBAGENT_RUN = { agentId: null, status: null, elapsedMs: null, tokens: null, toolUses: null, model: null } as const;

// ¿Sigue trabajando? Lanzandose (sin resultado) o lanzado en segundo plano y sin notificacion todavia.
export function isSubagentRunning(block: SubagentBlock): boolean {
  return block.status === null || block.status === SUBAGENT_STATUS.background;
}

// Lo que el resultado del Agent dice del subagente, aplicado a su bloque (vivo e hidratacion). Un
// `async_launched` NO lo termina: solo dice que se lanzo, y el tiempo del lanzamiento no es el suyo.
export function withSubagentRun(block: SubagentBlock, run: SubagentRunInfo | null, fallback: { readonly isError: boolean; readonly durationMs: number | null }): SubagentBlock {
  const agentId = run?.agentId ?? block.agentId;
  const model = run?.model ?? block.model;
  if (run?.status === SUBAGENT_ASYNC_LAUNCHED && !fallback.isError) {
    return { ...block, agentId, model, status: SUBAGENT_STATUS.background, elapsedMs: null };
  }
  return {
    ...block,
    agentId,
    model,
    status: fallback.isError ? SUBAGENT_STATUS.error : SUBAGENT_STATUS.completed,
    elapsedMs: run?.totalDurationMs ?? fallback.durationMs,
    tokens: run?.totalTokens ?? block.tokens,
    toolUses: run?.totalToolUseCount ?? block.toolUses,
  };
}

// Rellena el bloque de subagente con lo que trae su tool_result. Sin coincidencia devuelve los MISMOS
// bloques, para que el caller pueda distinguir "no habia nada que rellenar".
export function applySubagentResult(blocks: readonly Block[], result: ToolResult): readonly Block[] {
  if (!blocks.some((b) => b.kind === 'subagent' && b.toolUseId === result.toolUseId)) return blocks;
  // Respaldo por texto para un CLI que no mande el `tool_use_result`: el medido es `agentId: <id>`.
  const run = result.subagent ?? textualRun(result.output);
  return blocks.map((block) => (block.kind === 'subagent' && block.toolUseId === result.toolUseId ? withSubagentRun(block, run, result) : block));
}

// Progreso o fin de un subagente en segundo plano (`task_progress`/`task_notification`, o el aviso
// persistido al hidratar). Mismo contrato: sin bloque que casar, los MISMOS bloques.
export interface SubagentUpdate {
  readonly toolUseId: string;
  readonly status: string; // 'running' | 'completed' | 'stopped' | 'failed' | …
  readonly tokens: number | null;
  readonly toolUses: number | null;
  readonly durationMs: number | null;
}

export function applySubagentUpdate(blocks: readonly Block[], update: SubagentUpdate): readonly Block[] {
  if (!blocks.some((b) => b.kind === 'subagent' && b.toolUseId === update.toolUseId)) return blocks;
  return blocks.map((block) => (block.kind === 'subagent' && block.toolUseId === update.toolUseId ? withSubagentUpdate(block, update) : block));
}

export function withSubagentUpdate(block: SubagentBlock, update: SubagentUpdate): SubagentBlock {
  const counters = { tokens: update.tokens ?? block.tokens, toolUses: update.toolUses ?? block.toolUses };
  if (update.status === 'running') return { ...block, ...counters, status: SUBAGENT_STATUS.background };
  return { ...block, ...counters, status: statusFromNotification(update.status), elapsedMs: update.durationMs ?? block.elapsedMs };
}

// Medido: 'completed' y 'stopped' (lo mato un interrupt). 'failed' lo usa el CLI para las tareas MCP.
function statusFromNotification(status: string): string {
  if (status === 'completed') return SUBAGENT_STATUS.completed;
  if (status === 'stopped' || status === 'killed') return SUBAGENT_STATUS.stopped;
  return SUBAGENT_STATUS.error;
}

// El id viaja tambien en el TEXTO del resultado: `agentId: af3b… (internal ID…` (medido en 2.1.284, sin
// comillas). Solo se usa si no llego el `tool_use_result`; entonces no se sabe si fue en segundo plano.
const AGENT_ID_IN_TEXT = /\bagent_?[Ii]d"?\s*:\s*"?([A-Za-z0-9_-]+)/;

function textualRun(output: string): SubagentRunInfo | null {
  const agentId = AGENT_ID_IN_TEXT.exec(output)?.[1] ?? null;
  if (agentId === null) return null;
  return { status: 'completed', agentId, model: null, totalTokens: null, totalDurationMs: null, totalToolUseCount: null };
}

// Acumula un delta de PENSAMIENTO (2.5) en el bloque en curso, o lo abre. Mismo patron anti-fantasma
// que `appendDelta`: un delta vacio NO abre bloque.
export function appendThinkingDelta(blocks: readonly Block[], text: string, newId: string): readonly Block[] {
  const last = blocks[blocks.length - 1];
  if (last !== undefined && last.kind === 'thinking' && last.streaming) {
    return [...blocks.slice(0, -1), { ...last, runs: growRuns(last.runs, text) }];
  }
  if (text.length === 0) return blocks;
  return [...blocks, { kind: 'thinking', id: newId, runs: [{ code: false, text }], streaming: true, elapsedMs: null }];
}

// Cierra el bloque de pensamiento en curso (si lo hay) anotando cuanto duro.
export function closeThinking(blocks: readonly Block[], elapsedMs: number | null): readonly Block[] {
  const last = blocks[blocks.length - 1];
  if (last === undefined || last.kind !== 'thinking' || !last.streaming) return blocks;
  return [...blocks.slice(0, -1), { ...last, streaming: false, elapsedMs }];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

// Rellena el bloque de tool correspondiente (por toolUseId) con su meta, salida y —si es una tool
// de fichero— la ruta y el preview del contenido/diff. Si no lo encuentra, sin cambios.
export function applyToolResult(blocks: readonly Block[], result: ToolResult): readonly Block[] {
  const file = result.file;
  return blocks.map((b) =>
    b.kind === 'tool' && b.toolUseId === result.toolUseId
      ? {
          ...b,
          meta: formatToolMeta(result),
          isError: result.isError,
          output: [{ code: false, text: result.output }],
          filePath: file?.path ?? b.filePath,
          // El diff se parsea con el UNICO parser (el mismo que usa la ruta de la transcripcion), y con
          // los numeros de linea que trae cada hunk.
          diff: parseStructuredPatch(file?.structuredPatch) ?? b.diff,
          writtenContent: file?.content?.split('\n') ?? b.writtenContent,
          // La URL del artifact llega en el TEXTO del resultado (denominador comun de las dos rutas).
          artifact: b.artifactDraft === null ? b.artifact : completeArtifactPublication(b.artifactDraft, result.output),
        }
      : b,
  );
}


export function appendErrorBlock(blocks: readonly Block[], message: string, id: string, deniedCommand?: string): readonly Block[] {
  return [...blocks, { kind: 'error', id, message, ...(deniedCommand === undefined ? {} : { deniedCommand }) }];
}

// Marcador de sistema (M2.4): p.ej. "🗜 Contexto compactado (manual)".
export function appendSystemBlock(blocks: readonly Block[], text: string, id: string): readonly Block[] {
  return [...blocks, { kind: 'system', id, text }];
}

// Salida de un comando local (P-028, grupo C). Una salida vacia (`/clear`) no deja bloque.
export function appendCommandOutputBlock(
  blocks: readonly Block[],
  output: { readonly command: string | null; readonly text: string },
  id: string,
): readonly Block[] {
  const text = output.text.trim();
  if (text.length === 0) return blocks;
  return [...blocks, { kind: 'command-output', id, command: output.command, text }];
}

// Como se pinta una salida de comando (P-028): una linea va como la linea centrada de sistema; con
// forma de markdown (`/context` trae tablas `|---|`, medido en 2.1.284) se renderiza; el resto
// (`/usage`, `/skill-doctor`: columnas alineadas con espacios) va en `<pre>` para no perder la alineacion.
export type CommandOutputLayout = 'line' | 'markdown' | 'pre';

const MARKDOWN_SIGNS: readonly RegExp[] = [/^\s*\|?\s*:?-{3,}:?\s*\|/m, /^#{1,6}\s/m, /^```/m];

export function commandOutputLayout(text: string): CommandOutputLayout {
  const trimmed = text.trim();
  if (!trimmed.includes('\n')) return 'line';
  return MARKDOWN_SIGNS.some((sign) => sign.test(trimmed)) ? 'markdown' : 'pre';
}

// ¿El bloque tiene algo que ENSEÑAR? Guard de presentacion (feedback GUI A5): un bloque sin contenido
// se renderizaba como una raya suelta y la conversacion aparecia "cortada" por lineas fantasma. Un
// bloque de agente EN STREAMING si se pinta aunque este vacio (es el hueco donde va a caer el texto).
export function hasVisibleContent(block: Block): boolean {
  switch (block.kind) {
    case 'user':
      // Un mensaje que era solo una imagen NO esta vacio: con la condicion anterior (solo texto)
      // desaparecia del hilo entero.
      return block.text.trim().length > 0 || block.attachments.length > 0;
    case 'agent':
      return block.streaming || block.runs.some((run) => run.text.trim().length > 0);
    case 'tool':
      return block.tool.trim().length > 0;
    case 'error':
      return block.message.trim().length > 0;
    case 'system':
    case 'command-output':
      return block.text.trim().length > 0;
    case 'question':
      // Una tarjeta SIEMPRE se pinta, incluso cancelada: es la traza de que el agente pregunto.
      return true;
    case 'permission':
      // Igual que la de pregunta: contestada, denegada o cancelada, la tarjeta es la traza de que el
      // agente pidio permiso y de lo que se le contesto.
      return true;
    case 'subagent':
      return true;
    case 'thinking':
      // El "▸ Pensó" SIN texto tambien se pinta: en una conversacion reanudada el CLI persiste los
      // bloques de pensamiento vacios (medido), y esconderlo borraria del hilo que el agente penso.
      return true;
  }
}

// Nombre de la tool que esta EJECUTANDOSE ahora (ultimo bloque tool sin resultado), o null. Lo usa el
// indicador de actividad para decir "Ejecutando Write…" en vez de un generico "Pensando…".
export function pendingToolName(blocks: readonly Block[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block === undefined || block.kind !== 'tool') continue;
    return block.meta.length === 0 ? block.tool : null;
  }
  return null;
}

// Texto del marcador de uso de un turno (E3). Solo los proveedores que reportan uso en su terminador
// lo traen (hoy `agy`), y es la UNICA forma de ver lo que gasta esa pestana: el panel de Uso lee el
// historial de la cuenta de Claude, que no sabe nada de `agy`. Los contadores que el proveedor no
// reporta se OMITEN (nunca se pintan como 0: no es lo mismo). Devuelve null si no hay ninguno.
export function turnUsageText(usage: TurnUsage): string | null {
  const parts: string[] = [];
  pushCounter(parts, usage.inputTokens, 'entrada');
  pushCounter(parts, usage.outputTokens, 'salida');
  pushCounter(parts, usage.thinkingTokens, 'pensamiento');
  pushCounter(parts, usage.cacheReadTokens, 'caché');
  pushCounter(parts, usage.totalTokens, 'total');
  return parts.length === 0 ? null : `◷ Tokens del turno: ${parts.join(' · ')}`;
}

// Anade "<n> <etiqueta>" si el contador viene. Un contador negativo o no entero es dato corrupto de la
// frontera: se lanza con el valor recibido en vez de pintar un numero sin sentido.
function pushCounter(parts: string[], value: number | null, label: string): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Contador de tokens invalido para "${label}": ${JSON.stringify(value)}`);
  }
  parts.push(`${value.toLocaleString('es-ES')} ${label}`);
}

// Texto del marcador de reinicio automatico (C1). El proceso del agente se cayo y Mage lo esta
// relanzando reanudando la conversacion: hay que decirlo, o la pestana parece congelada sin motivo.
// La espera se redondea a decimas de segundo (un "1.5 s" es mas legible que 1500 ms).
export function restartingText(attempt: number, delayMs: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`Numero de intento invalido para el aviso de reinicio: ${attempt}`);
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(`Espera invalida para el aviso de reinicio: ${delayMs}`);
  }
  const seconds = (Math.round(delayMs / 100) / 10).toFixed(1);
  return `⟳ El agente se cerró; reanudando la conversación en ${seconds} s (intento ${attempt})`;
}

// Peticion de permiso -> vista del Inspector (prompt + tarjeta target/diff + resumen).
export function mapPermissionToView(request: PermissionRequest): PermissionView {
  const { toolName, input } = request;
  return {
    prompt: buildPrompt(toolName),
    target: buildTarget(toolName, input),
    toolLabel: toolName,
    diff: buildDiff(toolName, input),
    summary: buildSummary(toolName, input),
  };
}

// --- Helpers internos -------------------------------------------------------------------------

// Acumula texto en el ultimo run no-code (o crea uno). Todos los runs de streaming son no-code.
function growRuns(runs: readonly TextRun[], text: string): readonly TextRun[] {
  const last = runs[runs.length - 1];
  if (last !== undefined && !last.code) {
    return [...runs.slice(0, -1), { code: false, text: last.text + text }];
  }
  return [...runs, { code: false, text }];
}




function buildPrompt(toolName: string): string {
  if (isWriteTool(toolName)) return 'El agente quiere escribir en el proyecto:';
  if (toolName === 'Bash') return 'El agente quiere ejecutar un comando:';
  return `El agente quiere usar ${toolName}:`;
}

function buildTarget(toolName: string, input: Readonly<Record<string, unknown>>): string {
  const detail = firstString(input.file_path, input.path, input.command);
  return detail.length > 0 ? `${toolName} ${detail}` : toolName;
}

// Diff de la tarjeta de permiso a partir del INPUT (aun no hay structuredPatch; llega en tool_result).
function buildDiff(toolName: string, input: Readonly<Record<string, unknown>>): readonly DiffLine[] {
  // SIN numeros de linea a proposito: este diff se deriva del INPUT de la tool (old_string/new_string),
  // que no dice por que linea del fichero va. Numerarlo seria inventarlo.
  if (toolName === 'Edit') {
    const removed = toLines(input.old_string).map((text): DiffLine => ({ sign: '-', text, oldLine: null, newLine: null }));
    const added = toLines(input.new_string).map((text): DiffLine => ({ sign: '+', text, oldLine: null, newLine: null }));
    return [...removed, ...added];
  }
  if (isWriteTool(toolName)) {
    return toLines(input.content).map((text): DiffLine => ({ sign: '+', text, oldLine: null, newLine: null }));
  }
  return [];
}

function buildSummary(toolName: string, input: Readonly<Record<string, unknown>>): string {
  if (toolName === 'Edit') {
    return `+${toLines(input.new_string).length} −${toLines(input.old_string).length}`;
  }
  if (isWriteTool(toolName)) return `+${toLines(input.content).length} −0`;
  return '';
}

function isWriteTool(toolName: string): boolean {
  return toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit';
}

function toLines(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  return value.split('\n');
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}
