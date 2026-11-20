import { isAbsolute, resolve } from 'node:path';
import { buildUpdatedInput, parseAskUserQuestion } from '@shared/askUserQuestion';
import type { AskQuestion } from '@shared/askUserQuestion';
import type { PendingRequest, SendReceipt } from '@shared/coordination';
import type { MageEvent } from '@shared/events';
import { isPermissionMode } from '@shared/ipc';
import type { ProviderModel } from '@shared/providers';
import type { SessionCoordinator } from '../coordination/sessionCoordinator';
import type { ConversationIndexStore } from '../state/conversationIndexStore';
import { TrustRequiredError, UnknownAccountError } from '../host/hostErrors';
import type { HostCreateRequest } from '../host/hostProtocol';
import { resolveDelegatedSettings } from './delegatedSettings';
import type { DelegatedSettings, SessionSettings } from './delegatedSettings';
import type { DelegationLog, DelegationView } from './delegationLog';
import { sessionResultMessage } from '@shared/systemWrappers';
import { MagePolicyError, MageValidationError } from './errors';
import { needsLaunchCard } from './launchCard';
import type { CreatorFacts } from './launchCard';
import type { LaunchChoice, PendingLaunches } from './pendingLaunches';
import { MAX_SESSION_TITLE_CHARS } from './schemas';
import type { AskCreatorInput, AskCreatorOutput, CancelInput, CancelOutput, CreatedBy, CreateOutput, ListInput, PublicMessage, SendInput, SendOutput, StatusOutput } from './types';
import type { CreateSessionCommand, CreationRequest, CreationTarget, MageSessionsPort, SessionMetadata } from './sessionsPort';

// El puerto REAL del MCP en main: UNO por conexión, con la sesión que llama ya resuelta. Solo ve a sus
// descendientes (D-M8, M-U3): lo que otra conversación creó, o lo que creó un descendiente, es `not_found`.

export const CONVERSATION_ID_TIMEOUT_MS = 15_000;
export const NO_PROJECT_ID = 'none';
const CANCELLABLE_STATES: ReadonlySet<string> = new Set(['working', 'permission_pending', 'waiting_answer']);

export interface HostSessionsPortDeps {
  readonly caller: { readonly sessionId: string; readonly conversationId: string; readonly accountId: string };
  readonly log: Pick<DelegationLog, 'watch' | 'get' | 'list' | 'messagesAfter' | 'readMessages' | 'recordInstruction' | 'recordQuestion' | 'settleQuestion'>;
  readonly index: Pick<ConversationIndexStore, 'recordDelegation' | 'delegationOf' | 'nativeRefOf' | 'loadPrefs' | 'savePrefs'>;
  readonly coordinator: Pick<SessionCoordinator, 'subscribe' | 'snapshot' | 'send' | 'interrupt' | 'answerPermission' | 'announce' | 'ownerOf'>;
  // Cuentas de Claude y Codex de Mage (M-U4: también las de API).
  readonly accounts: () => readonly { readonly id: string; readonly provider: string }[];
  readonly projects: () => readonly { readonly id: string; readonly cwd: string | null }[];
  // Lanza por la frontera del host (`resolveHostLaunchParams` + `launchHostSession(…, 'mcp', createdBy)`); devuelve el sessionId.
  // `title` es el nombre de la subsesión (el que dio la creadora, o la primera línea del prompt).
  readonly launch: (request: HostCreateRequest, createdBy: { readonly conversationId: string; readonly sessionId: string }, title: string) => string;
  readonly setTimer: (fn: () => void, ms: number) => () => void;
  // Lo que main sabe de la creadora (`SessionSettingsRegistry`); null si no la tiene anotada.
  readonly creatorSettings: () => SessionSettings | null;
  // Catálogo de modelos cacheado de una cuenta (vacío si nunca se midió).
  readonly modelCatalog: (accountId: string) => readonly ProviderModel[];
  // El modo de Codex se fija tras lanzar y antes del primer mensaje (el adapter lo guarda para el siguiente turno).
  readonly setPermissionMode: (sessionId: string, mode: string) => void;
  // Lo que main sabe de la creadora para decidir si hace falta la tarjeta «Lanzar» (null = desconocida).
  readonly creatorFacts: () => CreatorFacts | null;
  // Las sesiones que esperan a que el usuario las lance (una para todas las conexiones).
  readonly pending: PendingLaunches;
  readonly newId: () => string;
}

// Lo que recibe la creadora cuando el usuario descarta la tarjeta (lo lee el modelo: castellano, como el resto).
export const NOT_LAUNCHED_TEXT = 'El usuario no lanzó la sesión.';

type Delegation = CreateSessionCommand & { readonly createdBy: CreatedBy };

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

  // Sin modelo o sin esfuerzo, y con el usuario delante, la sesión no arranca: espera a su tarjeta «Lanzar».
  async createSession(cmd: CreateSessionCommand): Promise<CreateOutput> {
    const { caller } = this.deps;
    if (cmd.createdBy === undefined) throw new Error(`createdBy es obligatorio para delegar desde ${caller.conversationId}`);
    const delegation: Delegation = { ...cmd, createdBy: cmd.createdBy };
    const requested = { model: cmd.model, effort: cmd.effort };
    const settings = this.settingsFor(delegation, requested);
    if (needsLaunchCard({ requested, creator: this.deps.creatorFacts() })) return this.holdForLaunch(delegation, settings);
    return { conversationId: await this.start(delegation, settings), state: 'running' };
  }

  async listSessions(_input: ListInput): Promise<readonly SessionMetadata[]> {
    const live = this.deps.log.list().filter((view) => this.isDescendant(view)).map(metadataOf);
    const parked = this.deps.pending.list().map(({ launch }) => this.parked(launch.id)?.metadata ?? null);
    return [...live, ...parked.filter((metadata): metadata is SessionMetadata => metadata !== null)];
  }

  async getSession(conversationId: string): Promise<SessionMetadata> {
    return this.parked(conversationId)?.metadata ?? metadataOf(this.descendant(conversationId));
  }

  async getStatus(conversationId: string): Promise<StatusOutput> {
    const parked = this.parked(conversationId);
    if (parked !== null) return { state: parked.metadata.state, turnCount: 0, lastEventAt: parked.since };
    const { state, turnCount, lastEventAt } = this.descendant(conversationId);
    return { state, turnCount, lastEventAt };
  }

  async readResult(input: { conversationId: string; afterSeq: number }): Promise<readonly PublicMessage[]> {
    if (this.parked(input.conversationId) !== null) return [];
    this.descendant(input.conversationId);
    return this.deps.log.readMessages(input.conversationId, input.afterSeq);
  }

  async send(input: SendInput): Promise<SendOutput> {
    const parked = this.parked(input.conversationId);
    if (parked !== null) return { receipt: 'rejected', reason: parked.metadata.state === 'awaiting_launch' ? 'awaiting_launch' : 'session_closed' };
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

  // Una que espera a lanzarse no tiene turno que parar (la descarta el usuario desde su tarjeta).
  async cancel(input: CancelInput): Promise<CancelOutput> {
    if (this.parked(input.conversationId) !== null) return { cancelled: false };
    const view = this.descendant(input.conversationId);
    if (!CANCELLABLE_STATES.has(view.state)) return { cancelled: false };
    this.deps.coordinator.interrupt(view.child.sessionId);
    return { cancelled: true };
  }

  // U26: solo una delegada (está en el registro) pregunta a su creadora; cualquier otra sesión, `not_delegated`.
  async askCreator(input: AskCreatorInput): Promise<AskCreatorOutput> {
    const { caller, log } = this.deps;
    const view = log.get(caller.conversationId);
    if (view === null) throw new MagePolicyError(`not_delegated: ${caller.conversationId}`);
    if (log.recordQuestion(view.child.sessionId, input.text) === 'creator_closed') throw new MagePolicyError(`creator_closed: ${view.child.creatorConversationId}`);
    return { receipt: 'accepted' };
  }

  // Modelo, esfuerzo y modo con que nacería: lo pedido (o lo elegido en la tarjeta) validado contra el catálogo de la cuenta.
  private settingsFor(cmd: Delegation, choice: LaunchChoice): DelegatedSettings {
    return resolveDelegatedSettings({
      creator: this.deps.creatorSettings(), targetProvider: cmd.target.provider,
      requested: { model: choice.model, effort: choice.effort, permissionMode: cmd.permissionMode }, catalog: this.deps.modelCatalog(cmd.target.accountId),
    });
  }

  // El camino de creación de siempre; devuelve el id real de la conversación. `launchId`: el que ya tiene la creadora.
  private async start(cmd: Delegation, settings: DelegatedSettings, launchId?: string): Promise<string> {
    const { caller, coordinator, index, log, launch } = this.deps;
    const { target, prompt, requestId } = cmd;
    const title = cmd.title ?? titleOf(prompt);
    const sessionId = this.launchTranslated(launch, launchRequestOf(cmd, settings), title);
    if (target.provider === 'codex') this.setCodexMode(sessionId, settings.permissionMode);
    const conversationId = await this.waitForConversationId(sessionId);
    index.recordDelegation(conversationId, { createdBy: cmd.createdBy, creatorChain: cmd.creatorChain });
    log.watch({
      sessionId, conversationId, creatorSessionId: caller.sessionId, creatorConversationId: caller.conversationId, title,
      provider: target.provider, accountId: target.accountId, projectId: target.projectId, createdBy: cmd.createdBy, creatorChain: cmd.creatorChain,
      ...(launchId === undefined ? {} : { launchId }),
    });
    coordinator.send({ sessionId, text: prompt, commandId: requestId });
    log.recordInstruction(sessionId, prompt);
    coordinator.announce(caller.sessionId, { kind: 'delegation_created', childId: conversationId, requestId });
    this.announceMessage(sessionId, conversationId, 'instruction', prompt);
    return conversationId;
  }

  // Deja la sesión pendiente (sin CLI) y pinta la tarjeta en la creadora. El índice la apunta como delegada sin sesión
  // nativa: si Mage se reinicia antes de lanzarla, `parked` la contesta como interrumpida y nada la arranca.
  private holdForLaunch(cmd: Delegation, settings: DelegatedSettings): CreateOutput {
    const { caller, pending, coordinator, index } = this.deps;
    const existing = pending.byRequest(caller.conversationId, cmd.requestId);
    if (existing !== null) return { conversationId: existing.id, state: 'awaiting_launch' };
    const id = this.deps.newId();
    const title = cmd.title ?? titleOf(cmd.prompt);
    index.recordDelegation(id, { createdBy: cmd.createdBy, creatorChain: cmd.creatorChain });
    index.savePrefs(id, { provider: cmd.target.provider, accountId: cmd.target.accountId });
    pending.add({
      id, creatorSessionId: caller.sessionId, requestId: cmd.requestId, since: cmd.createdBy.at, metadata: pendingMetadata(id, cmd, title),
      start: (choice) => this.launchPending(id, cmd, choice), discard: () => this.discardPending(id, title),
    });
    const models = this.deps.modelCatalog(cmd.target.accountId).map((model) => ({ id: model.id, label: model.label, efforts: model.supportedEfforts ?? [] }));
    coordinator.announce(caller.sessionId, {
      kind: 'delegation_launch', childId: id, title, provider: cmd.target.provider, accountId: cmd.target.accountId,
      model: settings.model ?? null, effort: settings.effort ?? null, models,
    });
    return { conversationId: id, state: 'awaiting_launch' };
  }

  // ponytail: la entrada del índice de una pendiente ya lanzada se queda (unos cien bytes); tras reiniciar contesta
  // `interrupted`, que es lo que es. Borrarla al lanzar si algún día pesa.
  private async launchPending(id: string, cmd: Delegation, choice: LaunchChoice): Promise<void> {
    const settings = this.settingsFor(cmd, choice);
    const conversationId = await this.start(cmd, settings, id);
    this.deps.coordinator.announce(this.deps.caller.sessionId, {
      kind: 'delegation_launch_settled', childId: id,
      outcome: { launched: true, model: settings.model ?? null, effort: settings.effort ?? null, conversationId },
    });
  }

  // La creadora recibe el resultado como el de cualquier otra sesión, con el texto de que no se lanzó.
  private discardPending(id: string, title: string): void {
    const { coordinator, caller } = this.deps;
    if (coordinator.ownerOf(caller.sessionId) === undefined) return;
    coordinator.announce(caller.sessionId, { kind: 'delegation_launch_settled', childId: id, outcome: { launched: false } });
    coordinator.send({ sessionId: caller.sessionId, text: sessionResultMessage({ title, conversationId: id, text: NOT_LAUNCHED_TEXT }) });
  }

  // Una descendiente sin sesión viva: esperando a lanzarse, descartada, o pendiente de antes de reiniciar Mage.
  private parked(conversationId: string): { readonly metadata: SessionMetadata; readonly since: string } | null {
    if (this.deps.log.get(conversationId) !== null) return null;
    const found = this.deps.pending.find(conversationId);
    if (found === null) return this.leftover(conversationId);
    if (!found.launch.metadata.creatorChain.includes(this.deps.caller.conversationId)) return null;
    const state = found.status === 'cancelled' ? 'interrupted' : 'awaiting_launch';
    return { metadata: { ...found.launch.metadata, state }, since: found.launch.since };
  }

  private leftover(conversationId: string): { readonly metadata: SessionMetadata; readonly since: string } | null {
    const { index, caller } = this.deps;
    if (index.nativeRefOf(conversationId) !== null) return null;
    const { createdBy, creatorChain } = index.delegationOf(conversationId);
    if (createdBy === null || !creatorChain.includes(caller.conversationId)) return null;
    const prefs = index.loadPrefs(conversationId);
    const metadata: SessionMetadata = {
      conversationId, title: '', provider: prefs?.provider ?? 'claude', state: 'interrupted', projectId: NO_PROJECT_ID,
      accountId: prefs?.accountId ?? caller.accountId, isPrivate: false, createdBy, creatorChain,
    };
    return { metadata, since: createdBy.at };
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

  private setCodexMode(sessionId: string, mode: string): void {
    try {
      this.deps.setPermissionMode(sessionId, mode);
    } catch (error) {
      throw launchFailed(error);
    }
  }

  private launchTranslated(launch: HostSessionsPortDeps['launch'], request: HostCreateRequest, title: string): string {
    try {
      return launch(request, { conversationId: this.deps.caller.conversationId, sessionId: this.deps.caller.sessionId }, title);
    } catch (error) {
      if (error instanceof TrustRequiredError) throw new MageValidationError(`trust_required: ${error.cwd}`, { cause: error });
      if (error instanceof UnknownAccountError) throw new MageValidationError(`unknown_account: ${error.accountId}`, { cause: error });
      throw launchFailed(error);
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
    const answered = log.settleQuestion(sessionId);
    log.recordInstruction(sessionId, input.text);
    this.announceMessage(sessionId, conversationId, answered ? 'answer' : 'instruction', input.text);
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
  askCreator(): Promise<never> { return reject(); }
}
function reject(): Promise<never> {
  return Promise.reject(new MagePolicyError('mage_external_caller: las herramientas de Mage solo funcionan desde una sesión lanzada por Mage'));
}

// Claude recibe el modo como flag de arranque; Codex no (se fija con `setPermissionMode` tras lanzar).
function launchRequestOf(cmd: CreateSessionCommand, settings: DelegatedSettings): HostCreateRequest {
  const { target, requestId } = cmd;
  return {
    commandId: requestId, provider: target.provider, accountId: target.accountId, cwd: target.cwd, trust: { acknowledged: false },
    ...(settings.model === undefined ? {} : { model: settings.model }),
    ...(settings.effort === undefined ? {} : { effort: settings.effort }),
    ...(target.provider === 'claude' && isPermissionMode(settings.permissionMode) ? { permissionMode: settings.permissionMode } : {}),
  };
}

// Un fallo al crear llega al agente con su motivo (el texto de `Error` de main, sin credenciales por construcción).
function launchFailed(error: unknown): MagePolicyError {
  return new MagePolicyError(`launch_failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}

const path = (value: string): string => resolve(value);
const titleOf = (prompt: string): string => (prompt.split('\n')[0] ?? '').trim().slice(0, MAX_SESSION_TITLE_CHARS);
function isQuestionPermission(pending: PendingRequest): pending is PendingRequest & { kind: 'permission' } {
  return pending.kind === 'permission' && parseAskUserQuestion(pending.request.input) !== null;
}
function pendingMetadata(id: string, cmd: Delegation, title: string): SessionMetadata {
  const { target } = cmd;
  return {
    conversationId: id, title, provider: target.provider, state: 'awaiting_launch', projectId: target.projectId, accountId: target.accountId,
    isPrivate: false, createdBy: cmd.createdBy, creatorChain: cmd.creatorChain,
  };
}
// La creadora ve a cada una con el id que recibió (el de su tarjeta, si esperó a lanzarse).
function metadataOf(view: DelegationView): SessionMetadata {
  const { child } = view;
  return {
    conversationId: child.launchId ?? child.conversationId, title: child.title, provider: child.provider, state: view.state, projectId: child.projectId,
    accountId: child.accountId, isPrivate: false, createdBy: child.createdBy, creatorChain: child.creatorChain,
  };
}
