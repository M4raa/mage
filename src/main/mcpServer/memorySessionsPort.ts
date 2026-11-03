import type { CreationRequest, CreationTarget, CreateSessionCommand, MageSessionsPort, SessionMetadata } from './sessionsPort';
import type { AskCreatorInput, AskCreatorOutput, CancelInput, CancelOutput, CreateOutput, ListInput, PublicMessage, SendInput, SendOutput, StatusOutput } from './types';
import { createdBySchema, publicMessageSchema, statusOutputSchema, utcSchema } from './schemas';

export interface MemorySessionSeed {
  readonly metadata: SessionMetadata;
  readonly status: StatusOutput;
  readonly messages?: readonly PublicMessage[];
}
export interface MemorySessionsOptions {
  readonly targets: readonly CreationTarget[];
  readonly sessions?: readonly MemorySessionSeed[];
  readonly newConversationId: () => string;
  readonly now: () => string;
}
interface MemorySession { metadata: SessionMetadata; status: StatusOutput; messages: PublicMessage[] }
// Fixtures deterministas sin FS, procesos, red ni simulación de un proveedor real.
export class MemorySessionsPort implements MageSessionsPort {
  private readonly targets: readonly CreationTarget[];
  private readonly sessions = new Map<string, MemorySession>();
  readonly questions: AskCreatorInput[] = [];
  constructor(private readonly options: MemorySessionsOptions) {
    this.targets = options.targets.map((target) => ({ ...target }));
    for (const seed of options.sessions ?? []) this.seedSession(seed);
  }
  seedSession(seed: MemorySessionSeed): void {
    const status = statusOutputSchema.parse(seed.status);
    if (!seed.metadata.conversationId) throw new Error(`conversationId: valor recibido ${seed.metadata.conversationId}`);
    const metadata = structuredClone(seed.metadata);
    if (metadata.createdBy !== undefined) createdBySchema.parse(metadata.createdBy);
    const messages = (seed.messages ?? []).map((message) => publicMessageSchema.parse(message)).sort((a, b) => a.seq - b.seq);
    this.sessions.set(metadata.conversationId, { metadata, status, messages });
  }
  async listSessions(input: ListInput): Promise<readonly SessionMetadata[]> {
    return [...this.sessions.values()].map(({ metadata }) => structuredClone(metadata)).filter((session) =>
      (input.projectId === undefined || input.projectId === session.projectId)
      && (input.includeFinished === true || !['done', 'interrupted'].includes(session.state)));
  }
  async resolveCreationTarget(input: CreationRequest): Promise<CreationTarget> {
    const target = this.targets.find((item) => item.cwd === input.cwd && item.provider === input.provider
      && (input.accountId === undefined || input.accountId === item.accountId));
    if (target === undefined) throw new Error('creation_target_not_found');
    return { ...target };
  }
  async createSession(input: CreateSessionCommand): Promise<CreateOutput> {
    const conversationId = this.options.newConversationId();
    if (this.sessions.has(conversationId)) throw new Error(`conversation_exists: ${conversationId}`);
    const at = utcSchema.parse(this.options.now());
    this.seedSession({ metadata: {
      conversationId, title: 'Synthetic session', provider: input.target.provider, state: 'working',
      projectId: input.target.projectId, accountId: input.target.accountId, isPrivate: false,
      createdBy: input.createdBy, creatorChain: [...input.creatorChain],
    }, status: { state: 'working', turnCount: 0, lastEventAt: at }, messages: [{ seq: 1, role: 'user', text: input.prompt }] });
    return { conversationId, state: 'running' };
  }
  async getSession(conversationId: string): Promise<SessionMetadata> {
    return structuredClone(this.findSession(conversationId).metadata);
  }
  async getStatus(conversationId: string): Promise<StatusOutput> {
    return { ...this.findSession(conversationId).status };
  }
  async readResult(input: { conversationId: string; afterSeq: number }): Promise<readonly PublicMessage[]> {
    return this.findSession(input.conversationId).messages.filter((message) => message.seq > input.afterSeq).map((message) => ({ ...message }));
  }
  async send(input: SendInput): Promise<SendOutput> {
    const session = this.findSession(input.conversationId);
    const at = utcSchema.parse(this.options.now());
    const last = session.messages.at(-1)?.seq ?? 0;
    session.messages.push({ seq: last + 1, role: 'user', text: input.text });
    session.status = { ...session.status, lastEventAt: at };
    return { receipt: input.mode === 'queue' ? 'queued' : 'accepted' };
  }
  async cancel(input: CancelInput): Promise<CancelOutput> {
    if (input.scope !== 'turn') throw new Error(`scope: valor recibido ${input.scope}`);
    const session = this.findSession(input.conversationId);
    if (session.metadata.state === 'interrupted' || session.metadata.state === 'done') return { cancelled: false };
    const lastEventAt = utcSchema.parse(this.options.now());
    session.metadata = { ...session.metadata, state: 'interrupted' };
    session.status = { ...session.status, state: 'interrupted', lastEventAt };
    return { cancelled: true };
  }
  async askCreator(input: AskCreatorInput): Promise<AskCreatorOutput> {
    this.questions.push({ ...input });
    return { receipt: 'accepted' };
  }
  private findSession(conversationId: string): MemorySession {
    const session = this.sessions.get(conversationId);
    if (session === undefined) throw new Error(`session_not_found: ${conversationId}`);
    return session;
  }
}
