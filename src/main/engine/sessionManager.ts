import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { ImageAttachment } from '@shared/ipc';
import type { PermissionDecision } from '@shared/events';
import type { CreateSessionParams, SessionEventPayload } from '@shared/ipc';
import { AgentSession, type AgentSessionDeps, type SessionLogFn } from './agentSession';
import type { ProviderAdapter } from './providerAdapter';
import { resolveLaunchParams, type DefaultsDeps } from './sessionDefaults';
import { unregisterSession } from './proxy/gateway';
import { pathEquals } from '../os/pathUtils';

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
  stopTask(taskId: string): void;
  stop(): void;
}

// Fabrica de sesiones inyectable (default: la real). Sin esto, el manager instanciaba AgentSession
// dentro de `create` y cualquier test suyo spawneaba el CLI de verdad.
export type SessionFactory = (deps: AgentSessionDeps) => ManagedSession;

// Gestiona el ciclo de vida de multiples sesiones (una por pestana). Acceso O(1) por id.
export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  // Dueño de cada sesion: el id del webContents que la creo. Las sesiones viven en main, no en la
  // ventana, asi que sin esto cerrar una ventana dejaba sus CLI corriendo sin nadie que recibiera sus
  // eventos (P-028, raiz de los puntos 17 y 36): un permiso pendiente se quedaba colgado para siempre
  // y reabrir la pestaña chocaba con "esa conversacion ya esta abierta".
  private readonly owners = new Map<string, number>();
  // Config dir EFECTIVO de cada sesion (el de la cuenta o su `mage-private`). Hace falta para parar
  // las sesiones de una cuenta que se va a borrar, esten en la ventana que esten (P-028, punto 30).
  private readonly accountDirs = new Map<string, string>();
  // Id con el que ARRANCO cada sesion re-etiquetada por un `/clear` (P-028), por id actual.
  private readonly originalIds = new Map<string, string>();

  constructor(
    private readonly adapterFactory: (provider: string) => ProviderAdapter,
    private readonly defaults: DefaultsDeps,
    private readonly log?: SessionLogFn,
    private readonly createSession: SessionFactory = (deps) => new AgentSession(deps),
  ) {}

  // Crea y arranca una sesion; devuelve su id. Los eventos van al sink proporcionado. `ownerId` (el
  // webContents que la pide) permite pararlas todas juntas cuando ese dueño desaparece.
  // Reanudar (M2.5) solo aplica a Claude: se reutiliza el sessionId pasado (misma transcripcion) y se
  // marca `resume`. Otros proveedores ignoran resumeSessionId y arrancan una sesion fresca con id nuevo.
  create(params: CreateSessionParams, sink: EventSink, ownerId?: number): string {
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
    // `/clear` (P-028) abre OTRA conversacion en el mismo proceso: a partir de su `conversation_reset`
    // la sesion se etiqueta con el id nuevo, que es el que usan la transcripcion, la persistencia y el
    // `--resume`. El evento del reset aun sale con el id viejo, para que el renderer sepa de que pestaña es.
    let key = sessionId;
    const session = this.createSession({
      adapter: this.adapterFactory(params.provider),
      params: launch,
      emit: (event) => {
        sink({ sessionId: key, event });
        if (event.kind === 'conversation_reset') key = this.rekey(key, event.newSessionId);
      },
      ...(this.log === undefined ? {} : { log: this.log }),
    });
    // El registro se DESHACE si el arranque falla. Antes se registraba y luego se llamaba a
    // `start()`: si el spawn reventaba, el id quedaba en el mapa para siempre y la guarda de
    // "esa conversacion ya esta abierta" impedia reabrirla hasta reiniciar Mage.
    this.sessions.set(sessionId, session);
    this.accountDirs.set(sessionId, params.accountDir);
    try {
      session.start();
    } catch (err) {
      this.sessions.delete(sessionId);
      this.accountDirs.delete(sessionId);
      throw err;
    }
    if (ownerId !== undefined) this.owners.set(sessionId, ownerId);
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

  // Para un subagente de la sesion (0.1.1 R2, punto 29).
  stopTask(sessionId: string, taskId: string): void {
    this.require(sessionId).stopTask(taskId);
  }

  stop(sessionId: string): void {
    // El ticket del gateway muere con la sesion (B11). `unregisterSession` estaba exportada y no la
    // importaba NADIE: el Map crecia durante toda la vida del proceso y el `sk-mage-<sessionId>` de
    // una pestaña cerrada seguia siendo valido contra el puerto local.
    unregisterSession(sessionId);
    // Tras un `/clear` el ticket del arranque sigue registrado con el id de ANTES (P-028).
    const original = this.originalIds.get(sessionId);
    if (original !== undefined) unregisterSession(original);
    this.originalIds.delete(sessionId);
    this.require(sessionId).stop();
    this.sessions.delete(sessionId);
    this.owners.delete(sessionId);
    this.accountDirs.delete(sessionId);
  }

  // Para las sesiones de un dueño (la ventana que se destruye). Devuelve cuantas paro.
  stopOwnedBy(ownerId: number): number {
    const owned = [...this.owners].filter(([, owner]) => owner === ownerId).map(([sessionId]) => sessionId);
    for (const sessionId of owned) this.stop(sessionId);
    return owned.length;
  }

  // Para todas las sesiones que corren bajo `configDir` o bajo su perfil privado (hijo directo).
  // Devuelve cuantas paro. Antes de borrar una cuenta: un CLI vivo sobre un dir borrado lo recrearia.
  stopByConfigDir(configDir: string): number {
    const ids = [...this.accountDirs]
      .filter(([, dir]) => pathEquals(dir, configDir) || pathEquals(dirname(dir), configDir))
      .map(([id]) => id);
    for (const id of ids) this.stop(id);
    return ids.length;
  }

  // Mueve la sesion `from` al id `to`. Devuelve el id con el que queda: `from` si `to` no sirve (vacio,
  // el mismo, o ya ocupado por otra pestaña, que seria mezclar dos conversaciones).
  private rekey(from: string, to: string): string {
    const session = this.sessions.get(from);
    if (session === undefined || to.length === 0 || to === from || this.sessions.has(to)) {
      this.log?.('warn', 'conversation_reset sin re-etiquetar la sesion', { from, to });
      return from;
    }
    this.sessions.delete(from);
    this.sessions.set(to, session);
    // El config dir viaja con la sesion: si no, borrar la cuenta no pararia una sesion tras un `/clear`.
    const accountDir = this.accountDirs.get(from);
    this.accountDirs.delete(from);
    if (accountDir !== undefined) this.accountDirs.set(to, accountDir);
    // Y el dueño: cerrar su ventana tiene que seguir parandola despues del `/clear`.
    const owner = this.owners.get(from);
    this.owners.delete(from);
    if (owner !== undefined) this.owners.set(to, owner);
    this.originalIds.set(to, this.originalIds.get(from) ?? from);
    this.originalIds.delete(from);
    return to;
  }

  // Detiene todas las sesiones (al cerrar la app).
  stopAll(): void {
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
    this.owners.clear();
    this.accountDirs.clear();
  }

  private require(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new Error(`Sesion inexistente: ${sessionId}`);
    return session;
  }
}
