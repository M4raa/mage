import type { AskCreatorInput, AskCreatorOutput, CancelInput, CancelOutput, CreatedBy, CreateInput, CreateOutput, ListInput, PublicMessage, SendInput, SendOutput, SessionState, StatusOutput } from './types';

export type CreationRequest = Pick<CreateInput, 'provider' | 'accountId' | 'cwd'>;
export interface CreationTarget {
  readonly projectId: string;
  readonly accountId: string;
  readonly provider: CreateInput['provider'];
  readonly cwd: string;
}
export interface SessionMetadata {
  readonly conversationId: string;
  readonly title: string;
  readonly provider: string;
  readonly state: SessionState;
  readonly projectId: string;
  readonly accountId: string;
  readonly isPrivate: boolean;
  readonly createdBy?: CreatedBy;
  readonly creatorChain: readonly string[];
}
export interface CreateSessionCommand {
  readonly target: CreationTarget;
  readonly prompt: string;
  readonly model?: string;
  readonly requestId: string;
  readonly createdBy?: CreatedBy;
  readonly creatorChain: readonly string[];
}
// Todas las mutaciones resuelven al aceptar, nunca esperan la finalización del turno.
export interface MageSessionsPort {
  listSessions(input: ListInput): Promise<readonly SessionMetadata[]>;
  // Sin efectos: autoridad de proyecto canónico, cuenta y defaults; ninguna inferencia por ruta.
  resolveCreationTarget(input: CreationRequest): Promise<CreationTarget>;
  createSession(input: CreateSessionCommand): Promise<CreateOutput>;
  getSession(conversationId: string): Promise<SessionMetadata>;
  getStatus(conversationId: string): Promise<StatusOutput>;
  // Mensajes públicos, ordenados por seq, sin razonamiento interno. El servidor impone el presupuesto.
  readResult(input: { conversationId: string; afterSeq: number }): Promise<readonly PublicMessage[]>;
  send(input: SendInput): Promise<SendOutput>;
  cancel(input: CancelInput): Promise<CancelOutput>;
  // U26: la sesión que llama (una delegada) pregunta a su creadora; resuelve al registrar, no espera la respuesta.
  askCreator(input: AskCreatorInput): Promise<AskCreatorOutput>;
}
