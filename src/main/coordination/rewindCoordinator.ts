import { z } from 'zod';
import { codexTurnsToLines, type CodexTurn } from '@shared/codexTranscript';
import { localized, UserFacingError, type LocalizedText } from '@shared/i18n/localizedText';
import type {
  DivergeParams, DivergeResult, RewindApplyParams, RewindApplyResult, RewindFilesPlan, RewindPlan, RewindPlanParams,
  RewindPointRef, RewindUnavailableReason,
} from '@shared/ipc';
import { CODEX_PROVIDER_ID } from '@shared/providers';
import type { TranscriptBatch, TranscriptEntry } from '@shared/transcripts';
import type { EngineRequest } from '../engine/providerAdapter';
import type { RewindStateStore } from '../conversations/rewindStateStore';
import { staticTranscriptBatch } from '../transcripts/staticBatch';
import {
  claudeForkLeaf, claudeLastSeen, claudePrompts, codexUserMessages, discardedFrom, resolveClaudePoint, resolveCodexPoint, RewindPointError,
  type ClaudePrompt, type CodexUserMessage,
} from './rewindPoints';
import type { EngineResponse, RewindContext, SessionCoordinator } from './sessionCoordinator';

// Orquestador del rewind, de Reintentar y de Divergir (F4.4/F4.5, INFORME-040 §3.2): planifica lo que se descartaria y
// lo aplica con las operaciones NATIVAS de cada CLI, en un orden que no deja nada a medias. Nunca toca git, copia
// ficheros ni borra burbujas, y no hay camino para volver a una rama abandonada (A7).

export const REWIND_IDLE_TIMEOUT_MS = 10_000; // INFORME-040 §3.2: si el turno no para en este plazo, no se aplica nada
export const ENGINE_REQUEST_TIMEOUT_MS = 15_000;
const MAX_TURN_PAGES = 1_000; // un servidor que repitiera el cursor no deja a main en un bucle

const CLAUDE_PROVIDER_ID = 'claude';
const PAGED_ONLY_MARK = 'only supports paginated';

export interface RewindCoordinatorDeps {
  readonly coordinator: Pick<SessionCoordinator, 'rewindContext' | 'engineRequest' | 'waitForIdle' | 'returnQueueToDrafts' | 'announce' | 'interrupt' | 'send'>;
  readonly readClaudeBranch: (ref: { readonly accountDir: string; readonly cwd: string; readonly sessionId: string; readonly pendingCutUuid: string | null }) => Promise<readonly TranscriptEntry[]>;
  readonly state: Pick<RewindStateStore, 'pendingCut' | 'setPendingCut' | 'recordFork' | 'recordCopy'>;
  readonly newId: () => string;
  readonly now: () => number;
  // Un aviso que no impide seguir (una relectura que falla tras rebobinar, una respuesta del motor de otra forma).
  readonly log: (level: 'warn', message: string, data?: unknown) => void;
}

// ---------------------------------------------------------------- Respuestas del motor (Zod tolerante)

const TURNS_PAGE_SCHEMA = z.object({
  data: z.array(z.object({ id: z.string(), items: z.array(z.unknown()) }).passthrough()),
  nextCursor: z.string().nullish(),
}).passthrough();

const FILES_DRY_RUN_SCHEMA = z.object({
  canRewind: z.boolean(),
  filesChanged: z.array(z.string()).optional(),
  insertions: z.number().optional(),
  deletions: z.number().optional(),
}).passthrough();

const REWIND_CONVERSATION_SCHEMA = z.object({
  rewound: z.boolean(),
  prefillText: z.string().optional(),
  reason: z.string().optional(),
}).passthrough();

const FORKED_THREAD_SCHEMA = z.object({ thread: z.object({ id: z.string() }).passthrough() }).passthrough();

// ---------------------------------------------------------------- Puntos resueltos

interface ClaudeTarget {
  readonly provider: 'claude';
  readonly nativeId: string;
  readonly entries: readonly TranscriptEntry[];
  readonly prompts: readonly ClaudePrompt[];
  readonly point: ClaudePrompt;
}

interface CodexTarget {
  readonly provider: 'codex';
  readonly nativeId: string;
  readonly turns: readonly CodexTurn[];
  readonly messages: readonly CodexUserMessage[];
  readonly point: CodexUserMessage;
}

type Target = ClaudeTarget | CodexTarget;

interface Rewound {
  readonly draft: string;
  readonly projection: TranscriptBatch | null;
  readonly copyThreadId: string | null;
}

// ---------------------------------------------------------------- Funciones puras

function isSupported(provider: string): boolean {
  return provider === CLAUDE_PROVIDER_ID || provider === CODEX_PROVIDER_ID;
}

// Por que no se puede, en el orden de INFORME-040: proveedor, segundo plano, legacy, turno en marcha (solo al divergir)
// y, por fin, que la conversacion ni siquiera tenga id nativo.
function unavailableReason(ctx: RewindContext, action: RewindPlanParams['action']): RewindUnavailableReason | null {
  if (!isSupported(ctx.provider)) return 'unsupported';
  if (ctx.background) return 'background';
  if (ctx.provider === CODEX_PROVIDER_ID && ctx.historyMode === 'legacy' && action !== 'diverge') return 'legacy';
  if (action === 'diverge' && ctx.busy) return 'busy';
  if (ctx.nativeId === null) return 'notFound';
  return null;
}

function pointReason(err: unknown): RewindUnavailableReason | null {
  if (!(err instanceof RewindPointError)) return null;
  return err.reason === 'mid_turn' ? 'midTurn' : 'notFound';
}

function reasonText(reason: RewindUnavailableReason, provider: string): LocalizedText {
  switch (reason) {
    case 'unsupported': return localized('errors.rewind.unsupported', { provider });
    case 'background': return localized('errors.rewind.background');
    case 'legacy': return localized('errors.rewind.legacy');
    case 'notFound': return localized('errors.rewind.notFound');
    case 'midTurn': return localized('errors.rewind.midTurn');
    case 'busy': return localized('errors.rewind.busy');
  }
}

function branchBatch(entries: readonly TranscriptEntry[]): TranscriptBatch {
  return { entries, errors: [], isFinal: true, reset: true, totalLinesSoFar: entries.length, rawLineNumber: 0, bytesReadSoFar: 0 };
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`).join('; ');
}

// El `result` de una respuesta correcta validado con `schema`. Un fallo del motor o una forma inesperada lanzan con el detalle.
function parseResult<T>(response: EngineResponse, schema: z.ZodType<T>, kind: string): T {
  if (!response.ok) throw new Error(`${kind}: ${response.error ?? 'sin detalle'}`);
  const parsed = schema.safeParse(response.result);
  if (!parsed.success) throw new Error(`${kind}: respuesta inesperada (${describeIssues(parsed.error)})`);
  return parsed.data;
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------- Orquestador

export class RewindCoordinator {
  constructor(private readonly deps: RewindCoordinatorDeps) {}

  // Lo que se descartaria. Un motivo por el que no se puede sale en `unavailable`, sin lanzar.
  async plan(params: RewindPlanParams): Promise<RewindPlan> {
    const { sessionId, action } = params;
    const ctx = this.deps.coordinator.rewindContext(sessionId);
    const blocked = unavailableReason(ctx, action);
    if (blocked !== null) return this.emptyPlan(ctx, blocked);
    const target = await this.tryResolve(ctx, params);
    if (typeof target === 'string') return this.emptyPlan(ctx, target);
    const files = target.provider === CLAUDE_PROVIDER_ID && action !== 'diverge' ? await this.planFiles(sessionId, target) : null;
    return {
      provider: ctx.provider, unavailable: null, discardedMessages: this.discarded(target), files,
      recoverable: ctx.provider === CLAUDE_PROVIDER_ID, turnRunning: ctx.busy, queuedCount: ctx.queueLength, pendingCount: ctx.pendingCount,
      canSaveCopy: ctx.provider === CODEX_PROVIDER_ID && action !== 'diverge',
    };
  }

  // Rebobina (o rebobina y reenvia, `retry`). Orden de INFORME-040 §3.2: cola, parar el turno, ficheros, conversacion.
  async apply(params: RewindApplyParams): Promise<RewindApplyResult> {
    const { sessionId, action } = params;
    const { coordinator } = this.deps;
    const ctx = coordinator.rewindContext(sessionId);
    const target = await this.resolveOrThrow(ctx, params);
    const returnedQueue = coordinator.returnQueueToDrafts(sessionId);
    await this.stopTurn(ctx, sessionId);
    const filesRestored = target.provider === CLAUDE_PROVIDER_ID && params.restoreFiles && await this.restoreFiles(sessionId, target);
    const rewound = target.provider === CLAUDE_PROVIDER_ID
      ? await this.rewindClaude(sessionId, ctx, target, filesRestored)
      : await this.rewindCodex(sessionId, target, params.saveCopy);
    coordinator.announce(sessionId, { kind: 'conversation_rewound', targetNativeId: this.targetId(target), action });
    const retried = action === 'retry'
      ? coordinator.send({ sessionId, text: target.point.text, attachments: params.attachments ?? [], commandId: this.deps.newId() })
      : null;
    return { draft: retried === null ? rewound.draft : '', returnedQueue, filesRestored, copyThreadId: rewound.copyThreadId, projection: rewound.projection, retried };
  }

  // Rama nueva desde el punto. Claude: la hoja del fork (la crea quien abre la sesion); Codex: `thread/fork` sobre el hilo vivo.
  async diverge(params: DivergeParams): Promise<DivergeResult> {
    const ctx = this.deps.coordinator.rewindContext(params.sessionId);
    const target = await this.resolveOrThrow(ctx, { ...params, action: 'diverge' });
    if (target.provider === CLAUDE_PROVIDER_ID) {
      return { kind: 'claude', forkFrom: { sessionId: target.nativeId, atUuid: claudeForkLeaf(target.entries, target.prompts, target.point) } };
    }
    const response = await this.deps.coordinator.engineRequest(params.sessionId, { kind: 'thread_fork', lastTurnId: target.point.turnId }, ENGINE_REQUEST_TIMEOUT_MS);
    const threadId = this.forkedThreadId(response, 'errors.rewind.forkFailed');
    this.deps.state.recordFork(threadId, target.nativeId, CODEX_PROVIDER_ID, this.deps.now());
    return { kind: 'codex', threadId };
  }

  // ------------------------------------------------------------ Resolucion del punto

  private emptyPlan(ctx: RewindContext, unavailable: RewindUnavailableReason): RewindPlan {
    return {
      provider: ctx.provider, unavailable, discardedMessages: 0, files: null, recoverable: ctx.provider === CLAUDE_PROVIDER_ID,
      turnRunning: ctx.busy, queuedCount: ctx.queueLength, pendingCount: ctx.pendingCount, canSaveCopy: false,
    };
  }

  // El punto, o el motivo por el que no se encuentra. Otro error se propaga.
  private async tryResolve(ctx: RewindContext, params: RewindPlanParams): Promise<Target | RewindUnavailableReason> {
    try {
      return await this.resolve(ctx, params.sessionId, params.point);
    } catch (err) {
      const reason = pointReason(err);
      if (reason === null) throw err;
      return reason;
    }
  }

  // Para `apply` y `diverge`: cualquier motivo es un error que el usuario lee.
  private async resolveOrThrow(ctx: RewindContext, params: RewindPlanParams): Promise<Target> {
    const blocked = unavailableReason(ctx, params.action);
    if (blocked !== null) throw new UserFacingError(reasonText(blocked, ctx.provider));
    const target = await this.tryResolve(ctx, params);
    if (typeof target === 'string') throw new UserFacingError(reasonText(target, ctx.provider));
    return target;
  }

  private async resolve(ctx: RewindContext, sessionId: string, point: RewindPointRef): Promise<Target> {
    if (ctx.nativeId === null) throw new RewindPointError('not_found', `la sesion ${sessionId} no tiene id nativo`);
    if (ctx.provider === CLAUDE_PROVIDER_ID) return this.resolveClaude(ctx, ctx.nativeId, point);
    const turns = await this.listCodexTurns(sessionId);
    const messages = codexUserMessages(turns);
    return { provider: 'codex', nativeId: ctx.nativeId, turns, messages, point: resolveCodexPoint(messages, point) };
  }

  private async resolveClaude(ctx: RewindContext, nativeId: string, point: RewindPointRef): Promise<ClaudeTarget> {
    const entries = await this.deps.readClaudeBranch({ accountDir: ctx.accountDir, cwd: ctx.cwd, sessionId: nativeId, pendingCutUuid: this.deps.state.pendingCut(nativeId) });
    const prompts = claudePrompts(entries);
    return { provider: 'claude', nativeId, entries, prompts, point: resolveClaudePoint(prompts, point) };
  }

  // Todos los turnos vigentes del hilo (`thread/turns/list`), pagina a pagina.
  private async listCodexTurns(sessionId: string): Promise<readonly CodexTurn[]> {
    const turns: CodexTurn[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_TURN_PAGES; page += 1) {
      const response = await this.deps.coordinator.engineRequest(sessionId, { kind: 'thread_turns', cursor }, ENGINE_REQUEST_TIMEOUT_MS);
      const parsed = parseResult(response, TURNS_PAGE_SCHEMA, 'thread_turns');
      turns.push(...parsed.data);
      if (parsed.nextCursor === null || parsed.nextCursor === undefined) return turns;
      cursor = parsed.nextCursor;
    }
    throw new Error(`thread_turns: mas de ${MAX_TURN_PAGES} paginas (cursor ${JSON.stringify(cursor)}); se aborta`);
  }

  private discarded(target: Target): number {
    return target.provider === CLAUDE_PROVIDER_ID ? discardedFrom(target.prompts, target.point) : discardedFrom(target.messages, target.point);
  }

  private targetId(target: Target): string {
    return target.provider === CLAUDE_PROVIDER_ID ? target.point.uuid : target.point.turnId;
  }

  // ------------------------------------------------------------ Plan de ficheros

  private async planFiles(sessionId: string, target: ClaudeTarget): Promise<RewindFilesPlan> {
    const request: EngineRequest = { kind: 'rewind_files', userMessageUuid: target.point.uuid, dryRun: true };
    const response = await this.deps.coordinator.engineRequest(sessionId, request, ENGINE_REQUEST_TIMEOUT_MS);
    const none: RewindFilesPlan = { available: false, changed: [], insertions: 0, deletions: 0 };
    if (!response.ok) return none;
    const parsed = FILES_DRY_RUN_SCHEMA.safeParse(response.result);
    if (!parsed.success) {
      this.deps.log('warn', 'rewind_files dryRun con una respuesta de forma inesperada', { issues: describeIssues(parsed.error) });
      return none;
    }
    if (!parsed.data.canRewind) return none;
    return { available: true, changed: parsed.data.filesChanged ?? [], insertions: parsed.data.insertions ?? 0, deletions: parsed.data.deletions ?? 0 };
  }

  // ------------------------------------------------------------ Aplicar

  // Con turno en marcha: se interrumpe y se espera a reposo; si no llega, no se cambia nada.
  private async stopTurn(ctx: RewindContext, sessionId: string): Promise<void> {
    if (!ctx.busy) return;
    const { coordinator } = this.deps;
    coordinator.interrupt(sessionId);
    try {
      await coordinator.waitForIdle(sessionId, REWIND_IDLE_TIMEOUT_MS);
    } catch (err) {
      throw new UserFacingError(localized('errors.rewind.turnDidNotStop'));
    }
  }

  private async restoreFiles(sessionId: string, target: ClaudeTarget): Promise<boolean> {
    const response = await this.deps.coordinator.engineRequest(sessionId, { kind: 'rewind_files', userMessageUuid: target.point.uuid, dryRun: false }, ENGINE_REQUEST_TIMEOUT_MS);
    if (!response.ok) throw new UserFacingError(localized('errors.rewind.filesFailed', { detail: response.error ?? 'sin detalle' }));
    return true;
  }

  private async rewindClaude(sessionId: string, ctx: RewindContext, target: ClaudeTarget, filesRestored: boolean): Promise<Rewound> {
    const request: EngineRequest = { kind: 'rewind_conversation', targetUuid: target.point.uuid, lastSeenUuid: claudeLastSeen(target.prompts) };
    const response = await this.deps.coordinator.engineRequest(sessionId, request, ENGINE_REQUEST_TIMEOUT_MS);
    const parsed = REWIND_CONVERSATION_SCHEMA.safeParse(response.result);
    if (!response.ok || !parsed.success || !parsed.data.rewound) throw this.claudeConversationError(response, parsed, filesRestored);
    this.deps.state.setPendingCut(target.nativeId, target.point.uuid);
    const projection = await this.readProjection(async () => branchBatch(await this.readBranchAfterCut(ctx, target)));
    return { draft: parsed.data.prefillText ?? target.point.text, projection, copyThreadId: null };
  }

  private claudeConversationError(response: EngineResponse, parsed: ReturnType<typeof REWIND_CONVERSATION_SCHEMA.safeParse>, filesRestored: boolean): UserFacingError {
    const reason = parsed.success ? parsed.data.reason : undefined;
    const detail = response.error ?? reason ?? 'sin detalle';
    return new UserFacingError(filesRestored
      ? localized('errors.rewind.conversationFailedFilesRestored', { detail })
      : localized('errors.rewind.conversationFailed', { detail }));
  }

  private readBranchAfterCut(ctx: RewindContext, target: ClaudeTarget): Promise<readonly TranscriptEntry[]> {
    return this.deps.readClaudeBranch({ accountDir: ctx.accountDir, cwd: ctx.cwd, sessionId: target.nativeId, pendingCutUuid: target.point.uuid });
  }

  private async rewindCodex(sessionId: string, target: CodexTarget, saveCopy: boolean): Promise<Rewound> {
    const copyThreadId = saveCopy ? await this.saveCodexCopy(sessionId, target) : null;
    const response = await this.deps.coordinator.engineRequest(sessionId, { kind: 'thread_revert', beforeTurnId: target.point.turnId }, ENGINE_REQUEST_TIMEOUT_MS);
    if (!response.ok) throw new UserFacingError(this.revertFailure(response.error));
    const projection = await this.readProjection(async () => ({ ...staticTranscriptBatch(codexTurnsToLines(await this.listCodexTurns(sessionId))), reset: true }));
    return { draft: target.point.text, projection, copyThreadId };
  }

  private revertFailure(error: string | null): LocalizedText {
    if (error !== null && error.includes(PAGED_ONLY_MARK)) return localized('errors.rewind.legacy');
    return localized('errors.rewind.conversationFailed', { detail: error ?? 'sin detalle' });
  }

  // «Guardar una copia antes» (U3): `thread/fork` del hilo entero. Si falla, no se rebobina.
  private async saveCodexCopy(sessionId: string, target: CodexTarget): Promise<string> {
    const last = target.turns.at(-1);
    if (last === undefined) throw new UserFacingError(localized('errors.rewind.copyFailed', { detail: 'el hilo no tiene turnos' }));
    const response = await this.deps.coordinator.engineRequest(sessionId, { kind: 'thread_fork', lastTurnId: last.id }, ENGINE_REQUEST_TIMEOUT_MS);
    const copyId = this.forkedThreadId(response, 'errors.rewind.copyFailed');
    this.deps.state.recordCopy(copyId, target.nativeId, this.deps.now());
    return copyId;
  }

  // El id del hilo que devuelve un `thread/fork`; un fallo es el error `failureKey` (copia o divergir).
  private forkedThreadId(response: EngineResponse, failureKey: 'errors.rewind.copyFailed' | 'errors.rewind.forkFailed'): string {
    try {
      return parseResult(response, FORKED_THREAD_SCHEMA, 'thread_fork').thread.id;
    } catch (err) {
      throw new UserFacingError(localized(failureKey, { detail: errorDetail(err) }));
    }
  }

  // La relectura tras rebobinar no deshace el rewind: si falla, sin proyeccion y con aviso.
  private async readProjection(read: () => Promise<TranscriptBatch>): Promise<TranscriptBatch | null> {
    try {
      return await read();
    } catch (err) {
      this.deps.log('warn', 'No se pudo releer la conversacion tras rebobinar', { error: errorDetail(err) });
      return null;
    }
  }
}
