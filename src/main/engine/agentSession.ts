import { spawn as nodeSpawn } from 'node:child_process';
import type { ImageAttachment } from '@shared/ipc';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { LogLevel } from '@shared/debug';
import type { MageEvent, PermissionDecision } from '@shared/events';
import type { LaunchParams, ProviderAdapter, SpawnPlan } from './providerAdapter';
import { DEFAULT_RESTART_POLICY, decideRestart, type RestartPolicy } from './restartPolicy';
import { defaultKillTreeDeps, killProcessTree, type KillTreeDeps } from '../os/processTree';

// Funcion de spawn inyectable (default: la de Node) -> testable con un proceso falso.
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; stdio: 'pipe'[]; windowsHide: boolean },
) => ChildProcessWithoutNullStreams;

// Logger inyectable hacia el LogBus (opcional; en tests/prod puede omitirse -> no-op).
export type SessionLogFn = (level: LogLevel, message: string, data?: unknown) => void;

// Temporizador inyectable (default: el de Node) -> los tests de reinicio no esperan en tiempo real.
// El handle se trata como opaco a proposito: en Node es un Timeout, en el DOM un number.
export type TimerHandle = unknown;
export type SetTimerFn = (callback: () => void, delayMs: number) => TimerHandle;
export type ClearTimerFn = (handle: TimerHandle) => void;

export interface AgentSessionDeps {
  readonly adapter: ProviderAdapter;
  readonly params: LaunchParams;
  readonly emit: (event: MageEvent) => void; // eventos comunes hacia el consumidor (IPC/UI)
  readonly spawn?: SpawnFn;
  readonly log?: SessionLogFn; // stream de debug (dev); nunca recibe credenciales
  // Reinicio automatico (C1). Inyectables para poder testear sin esperas reales ni reloj del sistema.
  readonly restartPolicy?: RestartPolicy;
  readonly setTimer?: SetTimerFn;
  readonly clearTimer?: ClearTimerFn;
  readonly now?: () => number;
  // Terminacion del arbol de procesos. Inyectable para testear sin lanzar `taskkill` de verdad.
  readonly killTree?: KillTreeDeps;
}

// Orquesta el proceso de agente de UNA conversacion. La especificidad del proveedor vive en el
// adapter; aqui solo hay ciclo de vida, escritura NDJSON a stdin, parseo de stdout linea a linea y el
// puente de permisos (requestId -> toolUseId).
//
// Dos modos de turno (el adapter los declara, ver TurnMode en providerAdapter.ts):
//  - 'persistent' (default, CLI de Claude): la sesion se mantiene VIVA entre turnos (no cerramos
//    stdin) para conservar contexto y maximizar cache_read.
//  - 'perTurn' (E3, `agy`): no hay protocolo por stdin, el prompt va en argv y el proceso muere al
//    cerrar el turno. Por tanto NO se spawnea en start(), cada mensaje lanza un proceso nuevo y el
//    exit posterior a un `result` es ESPERADO: ni error, ni reinicio automatico. Ahi no cuesta caché
//    porque el proveedor la mantiene en servidor entre procesos (medido, ver IDEAS-EXTERNAS §5.5).
export class AgentSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private lastStderr = '';
  private stopping = false;
  // Permisos abiertos: request_id -> tool_use_id (para construir el control_response).
  private readonly pendingPermissions = new Map<string, string>();
  // Inicio de cada tool en curso: tool_use_id -> epoch ms (para medir la duracion en tool_result).
  private readonly toolStartTimes = new Map<string, number>();
  private readonly spawnFn: SpawnFn;
  // Reinicio automatico (C1): racha de reinicios seguidos, momento del ultimo arranque y el timer del
  // reinicio programado (para poder cancelarlo si el usuario para la sesion mientras espera).
  private restartStreak = 0;
  private startedAtMs = 0;
  private pendingRestart: TimerHandle | null = null;
  // ¿Llego a haber handshake (system/init) alguna vez? Decide si el relanzado puede usar `--resume`:
  // si el proceso murio ANTES del init no hay transcripcion que reanudar y `--resume <id>` fallaria
  // con "No conversation found", encadenando reintentos condenados.
  private handshaked = false;
  // request_id de los control_request que manda MAGE por su cuenta (registrar hooks, pedir el desglose
  // de contexto). Sirve para no ensuciar la conversacion del usuario si el CLI los rechaza. Acotado:
  // solo interesa lo reciente, y las respuestas de exito no traen el id con el que borrarlo.
  private readonly ownControlRequests = new Set<string>();
  private readonly policy: RestartPolicy;
  private readonly setTimer: SetTimerFn;
  private readonly clearTimer: ClearTimerFn;
  private readonly now: () => number;
  private readonly killTree: KillTreeDeps;
  // --- Estado exclusivo del modo 'perTurn' (E3) ---
  private readonly perTurn: boolean;
  // ¿El turno en curso ya cerro? Lo pone a true su `result` (o el propio interrupt, que emite el
  // terminador por su cuenta). Es lo que distingue un exit ESPERADO de un turno muerto a medias.
  private turnClosed = false;
  // Id de conversacion del PROVEEDOR, capturado de su `session_init`. Sin el, el segundo proceso
  // empezaria de cero y la pestana perderia el hilo.
  private providerConversationId: string | null = null;
  // Modelo con el que se lanzara el PROXIMO turno. En perTurn un cambio de modelo no manda nada al
  // CLI: se guarda aqui y se aplica al siguiente `--model`.
  private nextModel: string;

  constructor(private readonly deps: AgentSessionDeps) {
    this.perTurn = deps.adapter.turnMode === 'perTurn';
    this.nextModel = deps.params.model;
    this.spawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
    this.killTree = deps.killTree ?? defaultKillTreeDeps();
    this.policy = deps.restartPolicy ?? DEFAULT_RESTART_POLICY;
    this.setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.now = deps.now ?? (() => Date.now());
  }

  // Log hacia el LogBus (no-op si no se inyecto). El env NO se loguea (contiene credenciales).
  private log(level: LogLevel, message: string, data?: unknown): void {
    this.deps.log?.(level, message, data);
  }

  // Arranca el proceso. Precondicion: no arrancado aun.
  start(): void {
    if (this.child !== null) throw new Error(`Sesion ${this.deps.params.sessionId} ya arrancada`);
    // Repone el flag por si la instancia se reutiliza tras un stop(): si se quedara en true, el reinicio
    // automatico se daria por desactivado para siempre en esa sesion.
    this.stopping = false;
    // perTurn: el prompt viaja en argv, asi que sin mensaje no hay nada que decirle al CLI todavia. El
    // proceso se lanza en el primer sendUserMessage.
    if (this.perTurn) return;
    this.launch(this.deps.params);
  }

  // Lanza el proceso. `prompt` solo en modo perTurn: ahi el plan de spawn lo lleva dentro (argv).
  private launch(params: LaunchParams, prompt: string | null = null): void {
    // Buffers del proceso ANTERIOR fuera. Si murio a mitad de una linea NDJSON, ese fragmento se
    // concatenaria con la primera linea del proceso nuevo y daria un JSON invalido -> un evento 'error'
    // espurio en la conversacion justo despues de reanudarla. Y el stderr viejo no debe atribuirse al
    // proceso nuevo si este muere sin decir nada.
    this.stdoutBuffer = '';
    this.lastStderr = '';
    const plan = prompt === null ? this.deps.adapter.buildSpawnPlan(params) : this.buildTurnPlan(params, prompt);
    this.log('info', 'Spawn del agente', {
      sessionId: this.deps.params.sessionId,
      command: plan.command,
      args: plan.args,
      cwd: this.deps.params.cwd,
    });
    const child = this.spawnFn(plan.command, plan.args, {
      env: plan.env,
      cwd: this.deps.params.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.lastStderr = chunk;
      this.log('warn', 'stderr del CLI', { sessionId: this.deps.params.sessionId, chunk });
    });
    // Node emite `error` y `close` ante un spawn fallido (binario inexistente, PATH roto), pero NO
    // `exit`: sin esta llamada el handler de abajo no corria nunca y la sesion se quedaba con un
    // `child` que apunta a un proceso muerto — en perTurn todo mensaje posterior moria con "ya hay un
    // turno en curso", y en persistente `writeLine` escribia al stdin de un fantasma EN SILENCIO
    // (medido: no lanza). Se reusa el cierre comun para cancelar permisos, limpiar y aplicar C1.
    child.on('error', (err) => {
      this.deps.emit({ kind: 'error', message: describeSpawnError(err) });
      if (this.child === child) this.onExit(null, null);
    });
    // Solo se atiende el exit del hijo VIGENTE (B4). En modo perTurn (`agy`) la secuencia
    // send -> interrupt -> send deja al viejo muriendo mientras el nuevo ya arranco, y su `exit`
    // llegaba despues: ponia `this.child = null` (dejando huerfano al nuevo, que `stop()` ya no
    // mata), emitia "el proceso termino inesperadamente" sobre un turno que iba bien, cancelaba sus
    // permisos y concatenaba los dos stdout. La ventana es lo que tarde `taskkill`.
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.onExit(code, signal);
    });
    this.child = child;
    this.startedAtMs = this.now();
    this.sendInitialize();
  }

  // Registra los hooks de la sesion (D2). Se manda nada mas arrancar: el CLI no emite su `init` hasta
  // recibir algo por stdin, asi que esto es tambien lo que arranca el handshake. Best-effort: si el
  // proveedor no lo soporta (adapters por gateway) no se manda nada, y un fallo al escribir se registra
  // pero NO tumba la sesion (los hooks son seguimiento, no funcionalidad critica).
  private sendInitialize(): void {
    const encode = this.deps.adapter.encodeInitialize;
    if (encode === undefined) return;
    try {
      this.writeOwnControlRequest(encode.call(this.deps.adapter));
    } catch (err) {
      this.log('warn', 'No se pudo registrar los hooks de la sesion', {
        sessionId: this.deps.params.sessionId,
        error: describeError(err),
      });
    }
  }

  // Contesta a un hook_callback. OBLIGATORIO: el CLI bloquea la sesion esperando esta respuesta hasta
  // el timeout que se declaro al registrar el hook, asi que se responde siempre y cuanto antes.
  private answerHook(requestId: string): void {
    const encode = this.deps.adapter.encodeHookResponse;
    if (encode === undefined || this.child === null) return;
    try {
      this.writeLine(encode.call(this.deps.adapter, requestId));
    } catch (err) {
      this.log('error', 'No se pudo responder a un hook del CLI', {
        sessionId: this.deps.params.sessionId,
        requestId,
        error: describeError(err),
      });
    }
  }

  // Envia un mensaje de usuario. Precondicion: proceso vivo ('persistent') o ningun turno en vuelo
  // ('perTurn', donde el mensaje ES el lanzamiento del proceso).
  sendUserMessage(text: string, attachments: readonly ImageAttachment[] = []): void {
    if (this.perTurn) {
      // perTurn (`agy`): el prompt va en argv y ese proveedor NO admite imagenes; su adapter lo dice.
      if (attachments.length > 0) this.deps.adapter.encodeUserMessage(text, attachments);
      this.startTurn(text);
      return;
    }
    this.writeLine(this.deps.adapter.encodeUserMessage(text, attachments));
  }

  // perTurn: un turno = un proceso. Precondicion EXPLICITA de que no haya otro en vuelo; encolarlo
  // seria peor (el usuario no veria que su segundo mensaje esta esperando) y mandarlo en paralelo
  // rompe el hilo de la conversacion (dos procesos escribiendo la misma conversacion del proveedor).
  private startTurn(prompt: string): void {
    if (this.child !== null) {
      throw new Error(
        `Ya hay un turno en curso en la sesion ${this.deps.params.sessionId}: espera a que termine ` +
          `(mensaje no enviado: ${JSON.stringify(prompt.slice(0, PROMPT_IN_ERROR_MAX))})`,
      );
    }
    this.turnClosed = false;
    this.launch(this.turnParams(), prompt);
  }

  // Params del proximo turno: el modelo vigente (setModel en perTurn solo lo apunta) y el id de
  // conversacion del proveedor si ya lo emitio (ausente en el primer turno).
  private turnParams(): LaunchParams {
    return {
      ...this.deps.params,
      model: this.nextModel,
      ...(this.providerConversationId === null ? {} : { conversationId: this.providerConversationId }),
    };
  }

  // Plan de spawn de un turno. El adapter que declara 'perTurn' DEBE implementarlo; si no, es un error
  // de programacion y se dice con claridad en vez de fallar con un `undefined is not a function`.
  private buildTurnPlan(params: LaunchParams, prompt: string): SpawnPlan {
    const build = this.deps.adapter.buildTurnSpawnPlan;
    if (build === undefined) {
      throw new Error(
        `El adapter de la sesion ${this.deps.params.sessionId} declara turnMode 'perTurn' pero no ` +
          `implementa buildTurnSpawnPlan`,
      );
    }
    return build.call(this.deps.adapter, params, prompt);
  }

  // Responde a un permiso pendiente. Precondicion: el requestId existe.
  answerPermission(requestId: string, decision: PermissionDecision): void {
    const toolUseId = this.pendingPermissions.get(requestId);
    if (toolUseId === undefined) {
      throw new Error(`Permiso desconocido o ya resuelto: requestId=${requestId}`);
    }
    this.pendingPermissions.delete(requestId);
    this.log('info', 'Respuesta de permiso', {
      sessionId: this.deps.params.sessionId,
      requestId,
      behavior: decision.behavior,
    });
    this.writeLine(this.deps.adapter.encodePermissionResponse({ requestId, toolUseId }, decision));
  }

  interrupt(): void {
    // perTurn: no hay protocolo por el que pedir la interrupcion; el turno ES el proceso, asi que se
    // corta matando su arbol. El terminador lo emitimos nosotros para que la pestana vuelva a 'idle'
    // (nadie mas va a mandarlo) y `turnClosed` evita que el exit se reporte como turno roto.
    if (this.perTurn) {
      this.interruptTurn();
      return;
    }
    this.writeLine(this.deps.adapter.encodeInterrupt());
  }

  private interruptTurn(): void {
    if (this.child === null) return; // no hay turno en vuelo: nada que interrumpir
    const child = this.child;
    this.turnClosed = true;
    const outcome = killProcessTree(child, this.killTree);
    this.log('info', 'Turno interrumpido (perTurn): terminado el arbol de procesos', {
      sessionId: this.deps.params.sessionId,
      pid: child.pid,
      outcome,
    });
    this.child = null;
    // Este es el UNICO camino de muerte que no pasa por `onExit` (pone `child = null` antes de que el
    // proceso muera, asi que su `exit` real lo descarta el guard de B4). Hay que repetir aqui su
    // limpieza: los permisos en el aire mueren con el proceso —sin cancelarlos, la tarjeta se queda
    // esperando una respuesta que nadie leera— y los tiempos de tool del turno abortado no los borra
    // nadie (en `agy` el `step_index` es monotono, asi que se acumulaban toda la vida de la pestaña).
    for (const requestId of this.pendingPermissions.keys()) {
      this.deps.emit({ kind: 'permission_cancelled', requestId });
    }
    this.pendingPermissions.clear();
    this.toolStartTimes.clear();
    this.deps.emit({ kind: 'result', result: { isError: false, subtype: 'interrupted', costUsd: null, numTurns: null } });
  }

  // Cambia el modelo de la sesion en caliente (M2.4). El CLI lo aplica al SIGUIENTE turno.
  setModel(model: string): void {
    if (model.trim().length === 0) throw new Error(`Modelo vacio para set_model: ${JSON.stringify(model)}`);
    this.log('info', 'Cambio de modelo en caliente', { sessionId: this.deps.params.sessionId, model });
    // perTurn: cambiar de modelo es gratis y no hay nada que mandar — el proximo turno se lanza con
    // otro `--model`. Aplica desde el siguiente mensaje, igual que en 'persistent'.
    if (this.perTurn) {
      this.nextModel = model;
      return;
    }
    this.writeLine(this.deps.adapter.encodeSetModel(model));
  }

  // Cambia el modo de permiso de la sesion en caliente (M2.6). El CLI responde y emite system/status.
  setPermissionMode(mode: string): void {
    if (mode.trim().length === 0) throw new Error(`Modo de permiso vacio para set_permission_mode: ${JSON.stringify(mode)}`);
    this.log('info', 'Cambio de modo de permiso', { sessionId: this.deps.params.sessionId, mode });
    this.writeLine(this.deps.adapter.encodeSetPermissionMode(mode));
  }

  // Detiene el proceso de forma intencionada (no se reporta como crash). Marca `stopping` ANTES de
  // matar al hijo para que su 'exit' no dispare el reinicio automatico, y cancela un reinicio ya
  // programado (si el usuario cierra la pestana mientras esperabamos el backoff, no hay que relanzar).
  stop(): void {
    this.stopping = true;
    this.cancelPendingRestart();
    if (this.child === null) return;
    const child = this.child;
    // Cerrar stdin es lo que le pide al CLI que termine por las buenas. Tolerante a que el stream ya
    // este destruido (proceso muerto entre el ultimo evento y este stop): no es un error.
    try {
      child.stdin.end();
    } catch {
      // Ya cerrado: seguimos con la terminacion igualmente.
    }
    // Y con TODOS sus descendientes: el CLI spawnea servidores MCP, procesos de `Bash` y hooks, y en
    // Windows `kill()` no recorre el arbol -> quedarian huerfanos. Ver os/processTree.ts.
    const outcome = killProcessTree(child, this.killTree);
    this.log('info', 'Terminacion del arbol de procesos del agente', {
      sessionId: this.deps.params.sessionId,
      pid: child.pid,
      outcome,
    });
    this.child = null;
    this.pendingPermissions.clear();
    this.toolStartTimes.clear();
  }

  // --- Interno -------------------------------------------------------------------------------

  // Pide al CLI el desglose REAL de la ventana de contexto (D3). Es una peticion local: no llama a la
  // API ni gasta suscripcion. Best-effort a proposito: es telemetria para el Inspector, asi que si el
  // proveedor no lo soporta o el proceso acaba de morir NO se convierte en un error de la conversacion
  // (el fallo se registra en el log, que para eso esta).
  private requestContextUsage(): void {
    const encode = this.deps.adapter.encodeGetContextUsage;
    if (encode === undefined || this.child === null) return;
    try {
      this.writeOwnControlRequest(encode.call(this.deps.adapter));
    } catch (err) {
      this.log('warn', 'No se pudo pedir el uso de contexto', {
        sessionId: this.deps.params.sessionId,
        error: describeError(err),
      });
    }
  }

  // Re-pide el catalogo de comandos al cerrar turno (2.2). MISMA forma best-effort que
  // requestContextUsage: sin `encodeInitialize` (adapters por gateway) o sin proceso no hace nada, y un
  // fallo al escribir se loguea pero NUNCA tumba la sesion — es un refresco de conveniencia, no algo
  // que el usuario haya pedido.
  private requestCommandCatalog(): void {
    const encode = this.deps.adapter.encodeInitialize;
    if (encode === undefined || this.child === null) return;
    try {
      this.writeOwnControlRequest(encode.call(this.deps.adapter));
    } catch (err) {
      this.log('warn', 'No se pudo refrescar el catalogo de comandos', {
        sessionId: this.deps.params.sessionId,
        error: describeError(err),
      });
    }
  }

  // Escribe un control_request PROPIO (no pedido por el usuario) anotando su request_id, para poder
  // distinguir despues si un rechazo del CLI le importa al usuario o no. El id se lee del propio payload
  // (los control_request del protocolo lo llevan en la raiz); si no lo trae, simplemente no se anota.
  private writeOwnControlRequest(payload: unknown): void {
    const requestId = readControlRequestId(payload);
    if (requestId !== null) {
      // Cola acotada: al pasarse del tope se olvida el mas antiguo (Set conserva el orden de insercion).
      if (this.ownControlRequests.size >= MAX_TRACKED_CONTROL_REQUESTS) {
        const oldest = this.ownControlRequests.values().next().value;
        if (oldest !== undefined) this.ownControlRequests.delete(oldest);
      }
      this.ownControlRequests.add(requestId);
    }
    this.writeLine(payload);
  }

  private writeLine(obj: unknown): void {
    if (this.child === null) throw new Error(`Sesion ${this.deps.params.sessionId} no esta activa`);
    this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  // Trocea el stdout en lineas NDJSON y procesa cada una.
  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let nl: number;
    while ((nl = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, nl).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (line.length > 0) this.processLine(line);
    }
  }

  // Parsea + normaliza una linea; los errores se convierten en evento 'error' (no matan el flujo).
  private processLine(line: string): void {
    let events: MageEvent[];
    try {
      events = this.deps.adapter.normalize(JSON.parse(line));
    } catch (err) {
      this.deps.emit({ kind: 'error', message: `Evento no parseable del CLI: ${describeError(err)}` });
      return;
    }
    for (const event of events) this.trackAndEmit(event);
  }

  // Mantiene coherentes los mapas de correlacion (permisos, timing de tools) y enriquece el evento
  // antes de emitir hacia la UI.
  private trackAndEmit(rawEvent: MageEvent): void {
    const event = this.correlate(rawEvent);
    if (event === null) return; // evento consumido aqui: no le concierne al consumidor
    // El evento normalizado al stream de debug (nivel error para el kind 'error', debug el resto).
    this.log(event.kind === 'error' ? 'error' : 'debug', `Evento ${event.kind}`, {
      sessionId: this.deps.params.sessionId,
      event,
    });
    this.deps.emit(event);
  }

  // Correlacion cross-linea: mapa de permisos y medicion de duracion de tools (tool_use ->
  // tool_result por tool_use_id). Devuelve el evento posiblemente enriquecido con `durationMs`, o null
  // si se consume aqui y no debe llegar al consumidor.
  private correlate(event: MageEvent): MageEvent | null {
    if (event.kind === 'session_init') {
      this.handshaked = true; // ya hay transcripcion: un relanzado puede reanudarla
      this.captureProviderConversationId(event.sessionId);
    } else if (event.kind === 'result') {
      this.turnClosed = true; // perTurn: a partir de aqui el exit del proceso es lo ESPERADO
      this.requestContextUsage(); // fin de turno: es cuando el desglose de contexto cambia (D3)
      // Refresco del catalogo de comandos "/" (2.2): un `/reload-plugins` o un plugin instalado a
      // mitad de sesion aparece SIN reiniciar nada. Medido: un segundo `initialize` responde con los
      // 159 comandos y NO duplica los hooks (un turno de prueba recibio un solo hook_callback de Stop).
      this.requestCommandCatalog();
    } else if (event.kind === 'hook_fired') {
      this.answerHook(event.requestId); // el CLI espera respuesta: contestar antes de seguir (D2)
    } else if (event.kind === 'control_error') {
      return this.classifyControlError(event);
    } else if (event.kind === 'permission_request') {
      this.pendingPermissions.set(event.request.requestId, event.request.toolUseId);
    } else if (event.kind === 'permission_cancelled') {
      this.pendingPermissions.delete(event.requestId);
    } else if (event.kind === 'tool_use') {
      this.toolStartTimes.set(event.tool.toolUseId, this.now());
    } else if (event.kind === 'tool_result') {
      return this.enrichToolResult(event);
    }
    return event;
  }

  // perTurn: el `session_init` del proveedor trae SU id de conversacion (en 'persistent' ese campo es
  // el id que puso Mage, que ya conocemos). Se guarda el PRIMERO y no se vuelve a tocar: es el hilo de
  // la pestana, y un id nuevo a mitad significaria que el CLI arranco otra conversacion — cambiarlo
  // dejaria la anterior huerfana en silencio, asi que se registra y se mantiene el original.
  private captureProviderConversationId(conversationId: string): void {
    if (!this.perTurn || conversationId.length === 0) return;
    if (this.providerConversationId === null) {
      this.providerConversationId = conversationId;
      return;
    }
    if (this.providerConversationId !== conversationId) {
      this.log('warn', 'El proveedor abrio otra conversacion en vez de continuar la de la pestana', {
        sessionId: this.deps.params.sessionId,
        expected: this.providerConversationId,
        received: conversationId,
      });
    }
  }

  // Un control_request rechazado solo es un error DE LA CONVERSACION si lo pidio el usuario (cambiar de
  // modelo, interrumpir, responder un permiso). Si era telemetria nuestra (registrar hooks, pedir el
  // desglose de contexto) se queda en el log: un CLI que no soporte esos subtypes los rechazaria en CADA
  // arranque de sesion, y el usuario acabaria con un error rojo por conversacion por algo que no pidio
  // y que no le afecta.
  private classifyControlError(event: Extract<MageEvent, { kind: 'control_error' }>): MageEvent | null {
    if (this.ownControlRequests.delete(event.requestId)) {
      this.log('warn', 'El CLI rechazo una peticion de control propia de Mage', {
        sessionId: this.deps.params.sessionId,
        requestId: event.requestId,
        detail: event.message,
      });
      return null;
    }
    return { kind: 'error', message: `El CLI rechazo una peticion de control: ${event.message}` };
  }

  private enrichToolResult(event: Extract<MageEvent, { kind: 'tool_result' }>): MageEvent {
    const start = this.toolStartTimes.get(event.result.toolUseId);
    if (start === undefined) return event; // sin inicio conocido: durationMs se queda en null
    this.toolStartTimes.delete(event.result.toolUseId);
    return { ...event, result: { ...event.result, durationMs: this.now() - start } };
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    const uptimeMs = Math.max(0, this.now() - this.startedAtMs);
    this.child = null;
    // Los permisos que estaban en el aire mueren con el proceso: se cancelan EXPLICITAMENTE para que
    // la UI no se quede con un dialogo esperando una respuesta que ya nadie va a leer.
    for (const requestId of this.pendingPermissions.keys()) {
      this.deps.emit({ kind: 'permission_cancelled', requestId });
    }
    this.pendingPermissions.clear();
    this.toolStartTimes.clear();
    this.log(this.stopping ? 'info' : 'error', 'Exit del proceso del agente', {
      sessionId: this.deps.params.sessionId,
      code,
      signal,
      intentional: this.stopping,
      uptimeMs,
    });

    // perTurn: el proceso muere al acabar cada turno, asi que la politica de reinicio (C1) —pensada
    // para un proceso que deberia seguir vivo— no aplica aqui en absoluto.
    if (this.perTurn) {
      this.reportTurnExit(code, signal);
      return;
    }

    const decision = decideRestart(
      { attempt: this.restartStreak, uptimeMs, exitCode: code, signal, intentional: this.stopping },
      this.policy,
    );
    if (decision.action === 'none') return; // salida intencionada
    if (decision.action === 'give_up') {
      this.emitUnexpectedExit(code, signal, decision.reason);
      return;
    }
    this.scheduleRestart(decision.attempt, decision.delayMs, decision.streakReset);
  }

  // Cierre de un turno en modo perTurn. Un exit DESPUES de su `result` (o de un interrupt) es el fin
  // normal del turno: no se emite nada. Un exit SIN `result` es un fallo real y se reporta — pero NO se
  // reintenta: relanzar reenviaria el prompt, que el CLI pudo haber ejecutado a medias (el mismo motivo
  // por el que C1 no reenvia el mensaje en curso al reanudar).
  private reportTurnExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.turnClosed || this.stopping) return;
    this.emitUnexpectedExit(code, signal, 'el turno termino sin resultado y no se reenvia el mensaje');
  }

  // Programa el relanzado. No se reenvia el mensaje que estuviera en curso: el CLI pudo haberlo
  // procesado a medias y repetirlo duplicaria trabajo (y coste). Se reanuda la conversacion y el
  // usuario decide si repite.
  private scheduleRestart(attempt: number, delayMs: number, streakReset: boolean): void {
    this.restartStreak = attempt;
    this.log('warn', 'Reinicio automatico del agente programado', {
      sessionId: this.deps.params.sessionId,
      attempt,
      delayMs,
      streakReset,
    });
    this.deps.emit({ kind: 'session_restarting', attempt, delayMs });
    this.pendingRestart = this.setTimer(() => {
      this.pendingRestart = null;
      this.restartNow();
    }, delayMs);
  }

  // Relanza reanudando la conversacion (`resume: true` -> `--resume <sessionId>`), asi que la pestana
  // conserva su hilo. Si nunca hubo handshake no hay nada que reanudar y se relanza con los params
  // originales (arranque fresco con el mismo id). Los adapters por gateway reanudan IGUAL: debajo
  // corre el mismo CLI, y relanzar con `--session-id` de un id ya usado hace que el CLI salga con
  // "Session ID ... is already in use" — o sea, los cinco reintentos de C1 fallando en cadena.
  private restartNow(): void {
    if (this.stopping || this.child !== null) return; // pararon la sesion (o ya revivio) mientras esperabamos
    try {
      this.launch(this.handshaked ? { ...this.deps.params, resume: true } : this.deps.params);
    } catch (err) {
      // Si ni siquiera se puede construir el plan o lanzar el proceso, se reporta y se deja de
      // insistir: no hay nada que un reintento inmediato vaya a mejorar.
      this.deps.emit({ kind: 'error', message: `No se pudo reanudar la sesion tras el cierre: ${describeError(err)}` });
    }
  }

  private cancelPendingRestart(): void {
    if (this.pendingRestart === null) return;
    this.clearTimer(this.pendingRestart);
    this.pendingRestart = null;
  }

  private emitUnexpectedExit(code: number | null, signal: NodeJS.Signals | null, reason: string): void {
    const detail = this.lastStderr.trim();
    const suffix = detail.length > 0 ? ` — stderr: ${detail}` : '';
    this.deps.emit({
      kind: 'error',
      message:
        `El proceso del agente termino inesperadamente (code=${code}, signal=${signal ?? 'none'}) ` +
        `y no se reintenta: ${reason}${suffix}`,
    });
  }
}

// Tope de control_request propios recordados para correlacionar su respuesta. Solo interesa lo reciente
// (las respuestas llegan en el mismo turno), y las de exito no traen el id con el que borrar la entrada.
// Desde 2.2 son DOS por fin de turno (contexto + catalogo de comandos) mas el `initialize` del arranque:
// con 16 sigue sobrado, pero el numero ya no es "uno por turno".
const MAX_TRACKED_CONTROL_REQUESTS = 16;

// Cuanto prompt se cita al rechazar un mensaje por precondicion (el contrato de errores pide el valor
// recibido; un prompt entero dentro de un Error no ayuda a nadie).
const PROMPT_IN_ERROR_MAX = 60;

// Lee el request_id de un control_request ya serializable. Los del protocolo lo llevan en la raiz; si el
// payload tiene otra forma, se devuelve null y simplemente no se correlaciona.
function readControlRequestId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as { request_id?: unknown }).request_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function describeSpawnError(err: unknown): string {
  return `No se pudo arrancar el agente: ${describeError(err)}`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
