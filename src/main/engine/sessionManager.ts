import { randomUUID } from 'node:crypto';
import type { ImageAttachment } from '@shared/ipc';
import type { PermissionDecision } from '@shared/events';
import type { CreateSessionParams, SessionEventPayload } from '@shared/ipc';
import { AgentSession, type AgentSessionDeps, type SessionLogFn } from './agentSession';
import type { ProviderAdapter } from './providerAdapter';
import { resolveLaunchParams, type DefaultsDeps } from './sessionDefaults';
import { unregisterSession } from './proxy/gateway';

// Sumidero de eventos hacia el consumidor (en produccion, webContents.send del renderer).
export type EventSink = (payload: SessionEventPayload) => void;

// Subconjunto de AgentSession que el manager usa. Explicito para poder inyectar un doble en tests sin
// arrancar procesos de verdad; AgentSession lo satisface estructuralmente.
export interface ManagedSession {
  start(): void;
  sendUserMessage(text: string, attachments?: readonly ImageAttachment[]): void;
  answerPermission(requestId: string, decision: PermissionDecision): void;
  interrupt(): void;
  setModel(model: string): void;
  setPermissionMode(mode: string): void;
  stop(): void;
}

// Fabrica de sesiones inyectable (default: la real). Sin esto, el manager instanciaba AgentSession
// dentro de `create` y cualquier test suyo spawneaba el CLI de verdad.
export type SessionFactory = (deps: AgentSessionDeps) => ManagedSession;

// Gestiona el ciclo de vida de multiples sesiones (una por pestana). Acceso O(1) por id.
export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(
    private readonly adapterFactory: (provider: string) => ProviderAdapter,
    private readonly defaults: DefaultsDeps,
    private readonly log?: SessionLogFn,
    private readonly createSession: SessionFactory = (deps) => new AgentSession(deps),
  ) {}

  // Crea y arranca una sesion; devuelve su id. Los eventos van al sink proporcionado.
  // Reanudar (M2.5) solo aplica a Claude: se reutiliza el sessionId pasado (misma transcripcion) y se
  // marca `resume`. Otros proveedores ignoran resumeSessionId y arrancan una sesion fresca con id nuevo.
  create(params: CreateSessionParams, sink: EventSink): string {
    const isResume =
      params.provider === 'claude' && typeof params.resumeSessionId === 'string' && params.resumeSessionId.length > 0;
    const sessionId = isResume ? (params.resumeSessionId as string) : randomUUID();
    // Una conversacion NO puede estar viva dos veces: serian dos procesos del CLI escribiendo la misma
    // transcripcion, que acabaria corrupta. Hoy el renderer ya evita llegar aqui (openConversation
    // activa la pestana existente en vez de abrir otra), pero esto es una FRONTERA IPC y el estado
    // persistido puede traer dos pestanas con el mismo resumeSessionId — p.ej. un workspace-state.json
    // escrito por dos instancias de Mage antes de que existiera el lock de instancia unica. Sin esta
    // guarda, el segundo `create` pisaba el registro del primero y los mensajes de la pestana vieja
    // acababan yendo a la sesion nueva.
    if (this.sessions.has(sessionId)) {
      throw new Error(`Esa conversacion ya esta abierta en otra pestana (sesion ${sessionId})`);
    }
    const launch = resolveLaunchParams(sessionId, params, this.defaults, isResume);
    const session = this.createSession({
      adapter: this.adapterFactory(params.provider),
      params: launch,
      emit: (event) => sink({ sessionId, event }),
      ...(this.log === undefined ? {} : { log: this.log }),
    });
    // El registro se DESHACE si el arranque falla. Antes se registraba y luego se llamaba a
    // `start()`: si el spawn reventaba, el id quedaba en el mapa para siempre y la guarda de
    // "esa conversacion ya esta abierta" impedia reabrirla hasta reiniciar Mage.
    this.sessions.set(sessionId, session);
    try {
      session.start();
    } catch (err) {
      this.sessions.delete(sessionId);
      throw err;
    }
    return sessionId;
  }

  sendMessage(sessionId: string, text: string, attachments: readonly ImageAttachment[] = []): void {
    this.require(sessionId).sendUserMessage(text, attachments);
  }

  answerPermission(sessionId: string, requestId: string, decision: PermissionDecision): void {
    this.require(sessionId).answerPermission(requestId, decision);
  }

  interrupt(sessionId: string): void {
    this.require(sessionId).interrupt();
  }

  // Cambio de modelo en caliente (M2.4); aplica al siguiente turno de la sesion.
  setModel(sessionId: string, model: string): void {
    this.require(sessionId).setModel(model);
  }

  // Cambio de modo de permiso en caliente (M2.6).
  setPermissionMode(sessionId: string, mode: string): void {
    this.require(sessionId).setPermissionMode(mode);
  }

  stop(sessionId: string): void {
    // El ticket del gateway muere con la sesion (B11). `unregisterSession` estaba exportada y no la
    // importaba NADIE: el Map crecia durante toda la vida del proceso y el `sk-mage-<sessionId>` de
    // una pestaña cerrada seguia siendo valido contra el puerto local.
    unregisterSession(sessionId);
    this.require(sessionId).stop();
    this.sessions.delete(sessionId);
  }

  // Detiene todas las sesiones (al cerrar la app).
  stopAll(): void {
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
  }

  private require(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new Error(`Sesion inexistente: ${sessionId}`);
    return session;
  }
}
