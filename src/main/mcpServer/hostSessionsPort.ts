import { isAbsolute, resolve } from 'node:path';
import { buildUpdatedInput, parseAskUserQuestion } from '@shared/askUserQuestion';
import type { AskQuestion } from '@shared/askUserQuestion';
import type { PendingRequest, SendReceipt } from '@shared/coordination';
import type { MageEvent } from '@shared/events';
import type { SessionCoordinator } from '../coordination/sessionCoordinator';
import type { ConversationIndexStore } from '../state/conversationIndexStore';
import { TrustRequiredError, UnknownAccountError } from '../host/hostErrors';
import type { HostCreateRequest } from '../host/hostProtocol';
import type { DelegationLog, DelegationView } from './delegationLog';
import { MagePolicyError } from './errors';
import type { CancelInput, CancelOutput, CreateOutput, ListInput, PublicMessage, SendInput, SendOutput, StatusOutput } from './types';
import type { CreateSessionCommand, CreationRequest, CreationTarget, MageSessionsPort, SessionMetadata } from './sessionsPort';

// El puerto REAL del MCP en main: UNO por conexión, con la sesión que llama ya resuelta. Solo ve a sus
// descendientes (D-M8, M-U3): lo que otra conversación creó, o lo que creó un descendiente, es `not_found`.

export const CONVERSATION_ID_TIMEOUT_MS = 15_000;
export const NO_PROJECT_ID = 'none';
const MAX_TITLE_CHARS = 80;
const CANCELLABLE_STATES: ReadonlySet<string> = new Set(['working', 'permission_pending', 'waiting_answer']);

export interface HostSessionsPortDeps {
  readonly caller: { readonly sessionId: string; readonly conversationId: string; readonly accountId: string };
  readonly log: Pick<DelegationLog, 'watch' | 'get' | 'list' | 'messagesAfter' | 'recordInstruction'>;
  readonly index: Pick<ConversationIndexStore, 'recordDelegation'>;
  readonly coordinator: Pick<SessionCoordinator, 'subscribe' | 'snapshot' | 'send' | 'interrupt' | 'answerPermission' | 'announce'>;
  // Cuentas de Claude y Codex de Mage (M-U4: también las de API).
  readonly accounts: () => readonly { readonly id: string; readonly provider: string }[];
  readonly projects: () => readonly { readonly id: string; readonly cwd: string | null }[];
  // Lanza por la frontera del host (`resolveHostLaunchParams` + `launchHostSession(…, 'mcp', createdBy)`); devuelve el sessionId.
  readonly launch: (request: HostCreateRequest, createdBy: { readonly conversationId: string }) => string;
  readonly setTimer: (fn: () => void, ms: number) => () => void;
}

export class HostSessionsPort implements MageSessionsPort {
  constructor(private readonly deps: HostSessionsPortDeps) {}

  async resolveCreationTarget(input: CreationRequest): Promise<CreationTarget> {
    const { provider, accountId, cwd } = input;
    if (!isAbsolute(cwd)) throw new MagePolicyError(`invalid_cwd: ${cwd}`);
    const target = path(cwd);
    // ponytail: igualdad exacta de ruta, sin mayúsculas/minúsculas de Windows ni enlaces; afinar si hace falta.
    const project = this.deps.projects().find((candidate) => candidate.cwd !== null && path(candidate.cwd) === target);
    return { projectId: project?.id ?? NO_PROJECT_ID, accountId: this.pickAccount(provider, accountId), provider, cwd };
  }

  async createSession(cmd: CreateSessionCommand): Promise<CreateOutput> {
    const { caller, coordinator, index, log, launch } = this.deps;
    const { target, prompt, requestId } = cmd;
    if (cmd.createdBy === undefined) throw new Error(`createdBy es obligatorio para delegar desde ${caller.conversationId}`);
    const sessionId = this.launchTranslated(launch, {
      commandId: requestId, provider: target.provider, accountId: target.accountId, cwd: target.cwd,
      ...(cmd.model === undefined ? {} : { model: cmd.model }), trust: { acknowledged: false },
    });
    const conversationId = await this.waitForConversationId(sessionId);
    index.recordDelegation(conversationId, { createdBy: cmd.createdBy, creatorChain: cmd.creatorChain });
    log.watch({
      sessionId, conversationId, creatorSessionId: caller.sessionId, creatorConversationId: caller.conversationId, title: titleOf(prompt),
      provider: target.provider, accountId: target.accountId, projectId: target.projectId, createdBy: cmd.createdBy, creatorChain: cmd.creatorChain,
    });
    coordinator.send({ sessionId, text: prompt, commandId: requestId });
    log.recordInstruction(sessionId, prompt);
    coordinator.announce(caller.sessionId, { kind: 'delegation_created', childId: conversationId, requestId });
    this.announceMessage(sessionId, conversationId, 'instruction', prompt);
    return { conversationId, state: 'running' };
  }

  async listSessions(_input: ListInput): Promise<readonly SessionMetadata[]> {
    return this.deps.log.list().filter((view) => this.isDescendant(view)).map(metadataOf);
  }

  async getSession(conversationId: string): Promise<SessionMetadata> {
    return metadataOf(this.descendant(conversationId));
  }

  async getStatus(conversationId: string): Promise<StatusOutput> {
    const { state, turnCount, lastEventAt } = this.descendant(conversationId);
    return { state, turnCount, lastEventAt };
  }

  async readResult(input: { conversationId: string; afterSeq: number }): Promise<readonly PublicMessage[]> {
    this.descendant(input.conversationId);
    return this.deps.log.messagesAfter(input.conversationId, input.afterSeq);
  }

  async send(input: SendInput): Promise<SendOutput> {
    const view = this.descendant(input.conversationId);
    if (view.closed) return { receipt: 'rejected', reason: 'session_closed' };
    const { sessionId } = view.child;
    const pending = this.deps.coordinator.snapshot(sessionId).pending;
    const question = pending.find(isQuestionPermission);
    if (question !== undefined) return this.answerQuestion(view, question, input);
    // Una pregunta de coordinación no da a la creadora poder para aprobar lo que es del usuario (F11).
    if (pending.some((item) => item.kind === 'elicitation')) return { receipt: 'rejected', reason: 'elicitation_requires_user' };
    if (pending.length > 0) return { receipt: 'rejected', reason: 'permission_requires_user' };
    return this.deliver(view, input);
  }

  async cancel(input: CancelInput): Promise<CancelOutput> {
    const view = this.descendant(input.conversationId);
    if (!CANCELLABLE_STATES.has(view.state)) return { cancelled: false };
    this.deps.coordinator.interrupt(view.child.sessionId);
    return { cancelled: true };
  }

  private pickAccount(provider: string, accountId: string | undefined): string {
    const accounts = this.deps.accounts();
    if (accountId !== undefined) {
      if (!accounts.some((account) => account.id === accountId && account.provider === provider)) throw new MagePolicyError(`unknown_account: ${accountId}`);
      return accountId;
    }
    const { caller } = this.deps;
    if (accounts.some((account) => account.id === caller.accountId && account.provider === provider)) return caller.accountId;
    const first = accounts.find((account) => account.provider === provider);
    if (first === undefined) throw new MagePolicyError(`no_account: ${provider}`);
    return first.id;
  }

  private launchTranslated(launch: HostSessionsPortDeps['launch'], request: HostCreateRequest): string {
    try {
      return launch(request, { conversationId: this.deps.caller.conversationId });
    } catch (error) {
      if (error instanceof TrustRequiredError) throw new MagePolicyError(`trust_required: ${error.cwd}`, { cause: error });
      if (error instanceof UnknownAccountError) throw new MagePolicyError(`unknown_account: ${error.accountId}`, { cause: error });
      throw error;
    }
  }

  // El conversationId puede llegar después (Codex y agy lo dicen en su `session_init`): se espera con plazo.
  private waitForConversationId(sessionId: string): Promise<string> {
    const { coordinator, setTimer } = this.deps;
    return new Promise((resolveId, reject) => {
      const holder: { cancelTimer: () => void } = { cancelTimer: () => undefined };
      const finish = (settle: () => void) => { holder.cancelTimer(); subscription.unsubscribe(); settle(); };
      const subscription = coordinator.subscribe(sessionId, {
        sink: (payload) => { if (payload.conversationId != null) finish(() => resolveId(payload.conversationId as string)); },
        onClosed: () => finish(() => reject(new MagePolicyError(`conversation_id_timeout: ${sessionId}`))),
      });
      const known = subscription.snapshot.conversationId;
      if (known !== null) return finish(() => resolveId(known));
      holder.cancelTimer = setTimer(() => finish(() => reject(new MagePolicyError(`conversation_id_timeout: ${sessionId}`))), CONVERSATION_ID_TIMEOUT_MS);
    });
  }

  private answerQuestion(view: DelegationView, pending: PendingRequest & { kind: 'permission' }, input: SendInput): SendOutput {
    const questions = parseAskUserQuestion(pending.request.input) as readonly AskQuestion[];
    const answers = Object.fromEntries(questions.map((question) => [question.question, input.text]));
    const receipt = this.deps.coordinator.answerPermission(view.child.sessionId, pending.request.requestId, {
      behavior: 'allow', updatedInput: buildUpdatedInput(pending.request.input, answers),
    });
    if (receipt.status !== 'accepted') return { receipt: 'rejected', reason: receipt.reason };
    this.deps.log.recordInstruction(view.child.sessionId, input.text);
    this.announceMessage(view.child.sessionId, view.child.conversationId, 'answer', input.text);
    return { receipt: 'accepted' };
  }

  private deliver(view: DelegationView, input: SendInput): SendOutput {
    const { coordinator, log } = this.deps;
    const { sessionId, conversationId } = view.child;
    const sent: SendReceipt = coordinator.send({
      sessionId, text: input.text, commandId: input.requestId, ...(input.mode === 'direct' ? { mode: 'steer' as const } : {}),
    });
    log.recordInstruction(sessionId, input.text);
    this.announceMessage(sessionId, conversationId, 'instruction', input.text);
    return { receipt: sent.status === 'queued' ? 'queued' : 'accepted' };
  }

  private announceMessage(sessionId: string, toId: string, messageKind: 'instruction' | 'answer', text: string): void {
    const event: MageEvent = { kind: 'delegation_message', fromId: this.deps.caller.conversationId, toId, messageKind, text };
    this.deps.coordinator.announce(sessionId, event);
  }

  // M-U3: solo las descendientes de la llamante; para las demás, la misma respuesta que si no existieran.
  private descendant(conversationId: string): DelegationView {
    const view = this.deps.log.get(conversationId);
    if (view === null || !this.isDescendant(view)) throw new MagePolicyError(`not_found: ${conversationId}`);
    return view;
  }

  private isDescendant(view: DelegationView): boolean {
    return view.child.creatorChain.includes(this.deps.caller.conversationId);
  }
}

// M-U2: un cliente que no es una sesión lanzada por Mage no tiene herramientas de Mage.
export class ExternalSessionsPort implements MageSessionsPort {
  listSessions(): Promise<never> { return reject(); }
  resolveCreationTarget(): Promise<never> { return reject(); }
  createSession(): Promise<never> { return reject(); }
  getSession(): Promise<never> { return reject(); }
  getStatus(): Promise<never> { return reject(); }
  readResult(): Promise<never> { return reject(); }
  send(): Promise<never> { return reject(); }
  cancel(): Promise<never> { return reject(); }
}
function reject(): Promise<never> {
  return Promise.reject(new MagePolicyError('mage_external_caller: las herramientas de Mage solo funcionan desde una sesión lanzada por Mage'));
}

const path = (value: string): string => resolve(value);
const titleOf = (prompt: string): string => (prompt.split('\n')[0] ?? '').trim().slice(0, MAX_TITLE_CHARS);
function isQuestionPermission(pending: PendingRequest): pending is PendingRequest & { kind: 'permission' } {
  return pending.kind === 'permission' && parseAskUserQuestion(pending.request.input) !== null;
}
function metadataOf(view: DelegationView): SessionMetadata {
  const { child } = view;
  return {
    conversationId: child.conversationId, title: child.title, provider: child.provider, state: view.state, projectId: child.projectId,
    accountId: child.accountId, isPrivate: false, createdBy: child.createdBy, creatorChain: child.creatorChain,
  };
}
