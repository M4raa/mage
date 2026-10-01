import type { ToolFileInfo } from '@shared/events';
import { ChatHttpError, type ChatClient, type ChatMessage, type ChatToolCall, type ChatToolSpec } from './chatClient';
import type { AssembledToolCall, FinishReason } from './openAiStream';

// El bucle de UN turno del runtime propio: peticion -> stream -> llamadas -> validar -> permiso ->
// ejecutar -> siguiente vuelta, hasta que el modelo para, se pasa de vueltas o se aborta. No conoce
// `MageEvent` ni la sesion: emite `LoopEvent` y deja el historial al dia. Exportado aparte de la sesion
// a proposito: un «turno sin sesion» (prompt, sin herramientas) es la pieza de P-031.

// Tope de vueltas de herramientas por turno. Un modelo pequeño puede entrar en bucle llamando lo mismo.
export const MAX_TOOL_ROUNDS = 25;

export type ToolKind = 'read' | 'edit' | 'exec';

export interface ToolOutcome {
  readonly isError: boolean;
  readonly output: string; // ya truncado para el modelo
  readonly file?: ToolFileInfo;
}

export type PreparedInput =
  | { readonly ok: true; readonly kind: ToolKind; readonly input: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string };

// Lo que el bucle necesita del catalogo de herramientas (lo implementa `tools/registry.ts`).
export interface LoopTools {
  specs(): readonly ChatToolSpec[];
  // Valida el JSON de argumentos que mando el modelo. Un error vuelve AL MODELO como resultado.
  prepare(name: string, argumentsJson: string): PreparedInput;
  // Revalida un input ya objeto (el `updatedInput` de un permiso).
  prepareInput(name: string, input: unknown): PreparedInput;
  run(name: string, input: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<ToolOutcome>;
}

export interface PreparedCall {
  readonly id: string;
  readonly name: string;
  readonly kind: ToolKind;
  readonly input: Readonly<Record<string, unknown>>;
}

export type Authorization =
  | { readonly behavior: 'allow'; readonly updatedInput?: Readonly<Record<string, unknown>> }
  // `byUser` false = lo denego la regla del modo (Plan), no una persona.
  | { readonly behavior: 'deny'; readonly message: string; readonly byUser: boolean };

export type LoopEvent =
  | { readonly kind: 'request_started' }
  | { readonly kind: 'text_delta'; readonly text: string }
  | { readonly kind: 'text_done'; readonly text: string }
  | { readonly kind: 'thinking_delta'; readonly text: string }
  | { readonly kind: 'tool_use'; readonly id: string; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
  | { readonly kind: 'tool_result'; readonly id: string; readonly isError: boolean; readonly output: string; readonly durationMs: number; readonly file?: ToolFileInfo }
  | { readonly kind: 'notice'; readonly text: string }
  // Una vuelta terminada: lo que el modelo devolvio, para la transcripcion y el presupuesto de contexto.
  | { readonly kind: 'round_done'; readonly usage: RoundUsage | null; readonly requestMessages: number };

export interface RoundUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LoopDeps {
  readonly client: ChatClient;
  readonly tools: LoopTools;
  readonly authorize: (call: PreparedCall, signal: AbortSignal) => Promise<Authorization>;
  // Ajusta los mensajes a la ventana del modelo antes de cada peticion (R5). Lanza si no caben.
  readonly fit: (messages: readonly ChatMessage[]) => readonly ChatMessage[];
  readonly emit: (event: LoopEvent) => void;
  readonly now: () => number;
  readonly newId: () => string;
}

export interface TurnInput {
  readonly model: string;
  readonly system: string;
  // Historial SIN el prompt de sistema. El bucle lo AMPLIA en sitio con lo que produce el turno.
  readonly history: ChatMessage[];
  readonly signal: AbortSignal;
  // false = no se mandan `tools` (modelo sin herramientas). El bucle lo apaga solo ante el 400 «no tools».
  readonly toolsEnabled: boolean;
}

export type TurnStatus = 'success' | 'error' | 'interrupted';

export interface TurnOutcome {
  readonly status: TurnStatus;
  readonly rounds: number;
  readonly usage: RoundUsage | null; // null = el servidor no reporto uso en ninguna vuelta
  readonly error: string | null;
  readonly toolsEnabled: boolean;
}

const NO_TOOLS_NOTICE = 'Este modelo no admite herramientas: Mage solo puede conversar con él.';
const INTERRUPTED_TOOL_OUTPUT = 'Interrumpido por el usuario antes de ejecutarse.';

interface RoundResult {
  readonly text: string;
  readonly calls: readonly AssembledToolCall[];
  readonly reason: FinishReason;
  readonly usage: RoundUsage | null;
  readonly requestMessages: number;
}

export async function runTurn(input: TurnInput, deps: LoopDeps): Promise<TurnOutcome> {
  const state = { rounds: 0, usage: null as RoundUsage | null, toolsEnabled: input.toolsEnabled };
  const finish = (status: TurnStatus, error: string | null = null): TurnOutcome => ({
    status,
    rounds: state.rounds,
    usage: state.usage,
    error,
    toolsEnabled: state.toolsEnabled,
  });
  try {
    for (;;) {
      if (input.signal.aborted) return finish('interrupted');
      const round = await streamRound(input, deps, state);
      if (round === null) continue; // reintento sin herramientas
      state.rounds += 1;
      state.usage = addUsage(state.usage, round.usage);
      const calls = round.reason === 'tool_calls' ? round.calls : [];
      const ids = calls.map((call) => call.id ?? `rt-${deps.newId()}`);
      input.history.push(assistantMessage(round.text, calls, ids));
      if (round.text.length > 0) deps.emit({ kind: 'text_done', text: round.text });
      // Las llamadas se anuncian ANTES de cerrar la vuelta: quien escribe la transcripcion cierra la linea
      // `assistant` en `round_done`, y esa linea tiene que llevar sus `tool_use` y preceder a sus resultados.
      const plans = calls.map((call, i) => prepareCall(call, ids[i]!, deps));
      deps.emit({ kind: 'round_done', usage: round.usage, requestMessages: round.requestMessages });
      if (input.signal.aborted) return closeInterrupted(input, ids, 0, finish);
      if (round.reason === 'length') return finish('error', 'El modelo cortó la respuesta por longitud (límite de tokens de salida).');
      if (calls.length === 0) return finish('success');
      const done = await runCalls(plans, input, deps);
      if (done < calls.length) return closeInterrupted(input, ids, done, finish);
      if (state.rounds >= MAX_TOOL_ROUNDS) {
        return finish('error', `El modelo superó ${MAX_TOOL_ROUNDS} vueltas de herramientas en un turno; se para aquí.`);
      }
    }
  } catch (err) {
    if (input.signal.aborted) return finish('interrupted');
    return finish('error', describeError(err));
  }
}

// Una peticion al modelo. null = el servidor rechazo `tools` y hay que repetir la vuelta sin ellas.
async function streamRound(input: TurnInput, deps: LoopDeps, state: { toolsEnabled: boolean }): Promise<RoundResult | null> {
  const messages = deps.fit([{ role: 'system', content: input.system }, ...input.history]);
  const tools = state.toolsEnabled ? deps.tools.specs() : [];
  deps.emit({ kind: 'request_started' });
  const round = { text: '', calls: [] as AssembledToolCall[], reason: 'stop' as FinishReason, usage: null as RoundUsage | null, requestMessages: messages.length };
  try {
    const request = { model: input.model, messages, ...(tools.length === 0 ? {} : { tools }) };
    for await (const part of deps.client.streamChat(request, input.signal)) {
      if (part.kind === 'text') {
        round.text += part.text;
        deps.emit({ kind: 'text_delta', text: part.text });
      } else if (part.kind === 'thinking') deps.emit({ kind: 'thinking_delta', text: part.text });
      else if (part.kind === 'tool_call') round.calls.push(part.call);
      else if (part.kind === 'usage') round.usage = { inputTokens: part.inputTokens, outputTokens: part.outputTokens };
      else round.reason = part.reason;
    }
  } catch (err) {
    if (!(err instanceof ChatHttpError) || err.kind !== 'no_tools' || tools.length === 0 || round.text.length > 0) throw err;
    state.toolsEnabled = false;
    deps.emit({ kind: 'notice', text: NO_TOOLS_NOTICE });
    return null;
  }
  return round;
}

// Ejecuta las llamadas EN ORDEN; las lecturas seguidas van en paralelo (D9b). Devuelve cuantas
// terminaron: menos que `calls.length` = se aborto a mitad.
async function runCalls(prepared: readonly CallPlan[], input: TurnInput, deps: LoopDeps): Promise<number> {
  let done = 0;
  while (done < prepared.length) {
    if (input.signal.aborted) return done;
    const batch = readBatch(prepared, done);
    const results = await Promise.all(batch.map((call) => executeCall(call, input.signal, deps)));
    for (const [i, result] of results.entries()) input.history.push({ role: 'tool', tool_call_id: batch[i]!.id, content: result });
    done += batch.length;
  }
  return done;
}

type CallPlan = { readonly id: string; readonly name: string; readonly prepared: PreparedInput };

function prepareCall(call: AssembledToolCall, id: string, deps: LoopDeps): CallPlan {
  const prepared = deps.tools.prepare(call.name, call.argumentsJson);
  deps.emit({ kind: 'tool_use', id, name: call.name, input: prepared.ok ? prepared.input : rawInput(call.argumentsJson) });
  return { id, name: call.name, prepared };
}

// Lecturas validas consecutivas desde `start` (al menos una llamada).
function readBatch(calls: readonly CallPlan[], start: number): CallPlan[] {
  const batch = [calls[start]!];
  const isRead = (plan: CallPlan | undefined): boolean => plan !== undefined && plan.prepared.ok && plan.prepared.kind === 'read';
  if (!isRead(batch[0])) return batch;
  for (let i = start + 1; isRead(calls[i]); i++) batch.push(calls[i]!);
  return batch;
}

// Una llamada de principio a fin. Devuelve el contenido del mensaje `tool` que vera el modelo.
async function executeCall(plan: CallPlan, signal: AbortSignal, deps: LoopDeps): Promise<string> {
  const started = deps.now();
  const report = (outcome: ToolOutcome): string => {
    deps.emit({ kind: 'tool_result', id: plan.id, ...outcome, durationMs: deps.now() - started });
    return outcome.output;
  };
  if (!plan.prepared.ok) return report({ isError: true, output: plan.prepared.error });
  const call: PreparedCall = { id: plan.id, name: plan.name, kind: plan.prepared.kind, input: plan.prepared.input };
  const decision = await deps.authorize(call, signal);
  if (decision.behavior === 'deny') {
    const output = decision.byUser ? `El usuario denegó ${plan.name}: ${decision.message}` : `${plan.name} no está permitido: ${decision.message}`;
    return report({ isError: true, output });
  }
  const finalInput = resolveUpdatedInput(plan.name, call.input, decision.updatedInput, deps.tools);
  if (!finalInput.ok) return report({ isError: true, output: finalInput.error });
  return report(await deps.tools.run(plan.name, finalInput.input, signal));
}

// `updatedInput` ausente o vacio = el input original (mismo contrato que el CLI de Claude).
function resolveUpdatedInput(
  name: string,
  original: Readonly<Record<string, unknown>>,
  updated: Readonly<Record<string, unknown>> | undefined,
  tools: LoopTools,
): PreparedInput | { readonly ok: true; readonly input: Readonly<Record<string, unknown>> } {
  if (updated === undefined || Object.keys(updated).length === 0) return { ok: true, input: original };
  return tools.prepareInput(name, updated);
}

// Tras abortar: cada llamada sin resultado recibe uno, porque el protocolo exige un `tool` por id.
function closeInterrupted(input: TurnInput, ids: readonly string[], done: number, finish: (s: TurnStatus) => TurnOutcome): TurnOutcome {
  for (const id of ids.slice(done)) input.history.push({ role: 'tool', tool_call_id: id, content: INTERRUPTED_TOOL_OUTPUT });
  return finish('interrupted');
}

function assistantMessage(text: string, calls: readonly AssembledToolCall[], ids: readonly string[]): ChatMessage {
  if (calls.length === 0) return { role: 'assistant', content: text };
  const toolCalls: ChatToolCall[] = calls.map((call, i) => ({
    id: ids[i]!,
    type: 'function',
    function: { name: call.name, arguments: call.argumentsJson },
  }));
  return { role: 'assistant', content: text.length === 0 ? null : text, tool_calls: toolCalls };
}

function addUsage(total: RoundUsage | null, round: RoundUsage | null): RoundUsage | null {
  if (round === null) return total;
  if (total === null) return round;
  return { inputTokens: total.inputTokens + round.inputTokens, outputTokens: total.outputTokens + round.outputTokens };
}

// Lo que se enseña de una llamada con argumentos invalidos: el texto crudo, para que se vea el fallo.
function rawInput(argumentsJson: string): Readonly<Record<string, unknown>> {
  return { argumentos: argumentsJson };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
