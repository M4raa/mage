import { MagePolicyError, callPort, scopeDenied } from './errors';
import { validateDelegation } from './delegation';
import { canonicalFingerprint } from './idempotencyStore';
import type { IdempotencyStore } from './idempotencyStore';
import { authorizeProject, authorizeTarget, isSessionAllowed, scopeIdentity } from './scope';
import type { ScopeSnapshot } from './scope';
import type { MageSessionsPort, SessionMetadata } from './sessionsPort';
import { createResultPage } from './resultPage';
import * as schemas from './schemas';
import type { AskCreatorInput, CancelInput, CreateInput, ListInput, ReadInput, SendInput, StatusInput } from './types';

export interface HandlerContext {
  readonly port: MageSessionsPort;
  readonly scope: ScopeSnapshot;
  readonly store: IdempotencyStore;
  readonly now: () => string;
  readonly maxDepth?: number;
}
export class MageToolHandlers {
  private readonly namespace: string;
  constructor(private readonly context: HandlerContext) {
    this.namespace = canonicalFingerprint(scopeIdentity(context.scope));
  }
  async list(input: ListInput) {
    const { port, scope } = this.context;
    authorizeProject(scope, input.projectId);
    const sessions = await callPort('listSessions', () => port.listSessions(input));
    const visible = sessions.filter((session) => isSessionAllowed(scope, session)
      && (input.projectId === undefined || input.projectId === session.projectId)
      && (input.includeFinished === true || !['done', 'interrupted'].includes(session.state)));
    return schemas.listOutputSchema.parse({ sessions: visible.map(projectSession) });
  }
  async create(input: CreateInput) {
    const { port, scope, store, now, maxDepth } = this.context;
    if (input.accountId !== undefined && !scope.accountIds.has(input.accountId)) scopeDenied();
    // Una allowlist de conversaciones existentes no autoriza añadir una nueva identidad.
    if (scope.conversationIds !== undefined) scopeDenied();
    const target = await callPort('resolveCreationTarget', () => port.resolveCreationTarget({
      provider: input.provider, accountId: input.accountId, cwd: input.cwd,
    }));
    authorizeTarget(scope, target, input.provider);
    if (input.accountId !== undefined && input.accountId !== target.accountId) scopeDenied();
    const validatedTarget = schemas.creationTargetSchema.parse({ projectId: target.projectId, accountId: target.accountId, provider: target.provider, cwd: target.cwd });
    const creatorChain = validateDelegation({ creatorChain: scope.caller?.creatorChain ?? [], callerId: scope.caller?.conversationId, maxDepth });
    const request = this.request('create', input.requestId, { input, target: validatedTarget, creatorChain });
    return store.execute(request, async () => {
      const at = schemas.utcSchema.parse(now());
      const createdBy = scope.caller === undefined ? undefined : { conversationId: scope.caller.conversationId, requestId: input.requestId, at };
      const result = await callPort('createSession', () => port.createSession({
        target: validatedTarget, prompt: input.prompt, model: input.model, effort: input.effort, permissionMode: input.permissionMode,
        requestId: input.requestId, createdBy, creatorChain,
      }));
      return schemas.createOutputSchema.parse({ conversationId: result.conversationId, state: result.state });
    });
  }
  async status(input: StatusInput) {
    await this.authorize(input.conversationId);
    const result = await callPort('getStatus', () => this.context.port.getStatus(input.conversationId));
    return schemas.statusOutputSchema.parse({ state: result.state, turnCount: result.turnCount, lastEventAt: result.lastEventAt });
  }
  async read(input: ReadInput) {
    await this.authorize(input.conversationId);
    const messages = await callPort('readResult', () => this.context.port.readResult({ conversationId: input.conversationId, afterSeq: input.afterSeq ?? 0 }));
    return createResultPage({ messages, afterSeq: input.afterSeq, maxBytes: input.maxBytes });
  }
  async send(input: SendInput) {
    await this.authorize(input.conversationId);
    return this.context.store.execute(this.request('send', input.requestId, input), async () => {
      const result = await callPort('send', () => this.context.port.send(input));
      return schemas.sendOutputSchema.parse({ receipt: result.receipt, ...(result.reason === undefined ? {} : { reason: result.reason }) });
    });
  }
  async cancel(input: CancelInput) {
    await this.authorize(input.conversationId);
    const result = await callPort('cancel', () => this.context.port.cancel(input));
    return schemas.cancelOutputSchema.parse({ cancelled: result.cancelled });
  }
  async askCreator(input: AskCreatorInput) {
    return this.context.store.execute(this.request('ask_creator', input.requestId, input), async () => {
      const result = await callPort('askCreator', () => this.context.port.askCreator(input));
      return schemas.askCreatorOutputSchema.parse({ receipt: result.receipt });
    });
  }
  private async authorize(conversationId: string): Promise<void> {
    const session = await callPort('getSession', () => this.context.port.getSession(conversationId));
    if (!isSessionAllowed(this.context.scope, session)) scopeDenied();
  }
  private request(tool: string, requestId: string, content: unknown) {
    return { namespace: `${this.namespace}:${tool}`, requestId, fingerprint: canonicalFingerprint(content) };
  }
}
function projectSession(session: SessionMetadata) {
  return {
    conversationId: session.conversationId, title: session.title, provider: session.provider, state: session.state,
    ...(session.createdBy === undefined ? {} : { createdBy: session.createdBy.conversationId }),
  };
}
export async function safeToolResult(call: () => Promise<Record<string, unknown>>) {
  try {
    const structuredContent = await call();
    return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
  } catch (error) {
    // Zod de SALIDA y errores inesperados no imprimen valores del puerto ni de now.
    const text = error instanceof MagePolicyError ? error.message : 'invalid_result: respuesta fuera del contrato';
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }
}
