import { spawn as nodeSpawn } from 'node:child_process';
import type { ImageAttachment } from '@shared/ipc';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { LogLevel } from '@shared/debug';
import type { MageEvent, PermissionDecision } from '@shared/events';
import { validateElicitationAnswer, type ElicitationAnswer, type ElicitationRequest } from '@shared/elicitation';
import type { LaunchParams, ProviderAdapter } from './providerAdapter';
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
// La sesion se mantiene VIVA entre turnos (no cerramos stdin) para conservar contexto y maximizar
// cache_read. Desde la 0.1.2 todos los CLI son persistentes: `agy` estreno `--input-format stream-json`
// en la 1.1.15 (medido en 1.2.14) y `codex app-server` habla JSON-RPC por stdio.
//
// Un proveedor SIN interrupcion por protocolo (`agy` declara `interruptsByKill`) se interrumpe
// matando el arbol; el siguiente mensaje relanza el CLI reanudando SU conversacion (`conversationId`,
// el id que emitio en su `session_init`). Medido en agy 1.2.14: la conversacion sobrevive al corte.
export class AgentSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private lastStderr = '';
  private stopping = false;
  // Permisos abiertos: request_id -> tool_use_id (para construir el control_response).
  private readonly pendingPermissions = new Map<string, string>();
  private readonly pendingElicitations = new Map<string, ElicitationRequest>();
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
  // Id de conversacion del PROVEEDOR, capturado de su primer `session_init` (en Claude coincide con el
  // de Mage; en agy y codex es otro). Es lo que un relanzado le devuelve para no empezar de cero.
  private providerConversationId: string | null = null;
  // El turno se corto matando el proceso (proveedor sin interrupcion por protocolo): el siguiente
  // mensaje relanza el CLI reanudando la conversacion.
  private relaunchOnNextMessage = false;
  // Id de la conversacion del CLI tras un `/clear` (P-028): el relanzado reanuda ESA y no la de antes
  // del clear. null = la del arranque (`params.sessionId`).
  private resetConversationId: string | null = null;

  constructor(private readonly deps: AgentSessionDeps) {
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
    this.launch(this.deps.params);
  }

  private launch(params: LaunchParams): void {
    // Buffers del proceso ANTERIOR fuera. Si murio a mitad de una linea NDJSON, ese fragmento se
    // concatenaria con la primera linea del proceso nuevo y daria un JSON invalido -> un evento 'error'
    // espurio en la conversacion justo despues de reanudarla. Y el stderr viejo no debe atribuirse al
    // proceso nuevo si este muere sin decir nada.
    this.stdoutBuffer = '';
    this.lastStderr = '';
    const plan = this.deps.adapter.buildSpawnPlan(params);
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
    // `child` que apunta a un proceso muerto y `writeLine` escribia al stdin de un fantasma EN SILENCIO
    // (medido: no lanza). Se reusa el cierre comun para cancelar permisos, limpiar y aplicar C1.
    child.on('error', (err) => {
      this.deps.emit({ kind: 'error', message: describeSpawnError(err) });
      if (this.child === child) this.onExit(null, null);
    });
    // Solo se atiende el exit del hijo VIGENTE (B4). Con la interrupcion por corte (`agy`) la secuencia
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
    // El desglose de contexto tambien ANTES del primer turno (P-028, punto 7): medido en 2.1.284, el CLI
    // lo contesta sin turno, y sin esto el panel de Contexto solo tenia una estimacion hasta el primero.
    this.requestContextUsage();
    // Lo que el adapter encolo al construir el plan (el `initialize` de JSON-RPC de codex).
    this.flushOutgoing();
  }

  // Registra los hooks de la sesion (D2). Se manda nada mas arrancar: el CLI no emite su `init` hasta
  // recibir algo por stdin, asi que esto es tambien lo que arranca el handshake. Best-effort: si el
  // proveedor no lo soporta (agy, codex) no se manda nada, y un fallo al escribir se registra
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

  // Envia un mensaje de usuario. Precondicion: proceso vivo, o un turno cortado matando el proceso
  // (entonces se relanza aqui, reanudando la conversacion del proveedor).
  sendUserMessage(text: string, attachments: readonly ImageAttachment[] = []): void {
    if (this.child === null && this.relaunchOnNextMessage && !this.stopping) {
      this.relaunchOnNextMessage = false;
      this.launch(this.resumeParams());
    }
    this.writePayload(this.deps.adapter.encodeUserMessage(text, attachments));
  }

  // Params de un relanzado que REANUDA: el id de Mage (o el del ultimo `/clear`) con `resume`, y el id
  // de conversacion del proveedor si ya lo emitio. Si nunca hubo handshake no hay nada que reanudar y se
  // relanza con los params originales (arranque fresco con el mismo id).
  private resumeParams(): LaunchParams {
    if (!this.handshaked) return this.deps.params;
    return {
      ...this.deps.params,
      sessionId: this.resetConversationId ?? this.deps.params.sessionId,
      resume: true,
      ...(this.providerConversationId === null ? {} : { conversationId: this.providerConversationId }),
    };
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
    this.writePayload(this.deps.adapter.encodePermissionResponse({ requestId, toolUseId }, decision));
  }

  answerElicitation(answer: ElicitationAnswer): void {
    const request = this.pendingElicitations.get(answer.requestId);
    if (request === undefined) throw new Error(`Elicitation desconocida o resuelta: ${answer.requestId}`);
    if (!validateElicitationAnswer(request, answer)) throw new Error('Respuesta de elicitation inválida');
    const encode = this.deps.adapter.encodeElicitationResponse;
    if (encode === undefined) throw new Error('Este proveedor no admite elicitation');
    this.writePayload(encode.call(this.deps.adapter, answer));
    this.pendingElicitations.delete(answer.requestId);
    this.deps.emit({ kind: 'elicitation_resolved', requestId: answer.requestId, action: answer.action });
  }

  // Sin interrupcion por protocolo (`interruptsByKill`) el turno se corta matando el arbol;
  // el terminador lo emitimos nosotros para que la pestana vuelva a 'idle' (nadie mas va a mandarlo).
  interrupt(): void {
    if (this.deps.adapter.interruptsByKill === true) {
      this.interruptByKill();
      return;
    }
    this.writePayload(this.deps.adapter.encodeInterrupt());
  }

  private interruptByKill(): void {
    if (this.child === null) return; // no hay proceso: nada que interrumpir
    const child = this.child;
    this.relaunchOnNextMessage = true;
    const outcome = killProcessTree(child, this.killTree);
    this.log('info', 'Turno interrumpido matando el arbol de procesos (sin interrupcion por protocolo)', {
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
    this.cancelPendingElicitations();
    this.toolStartTimes.clear();
    this.deps.emit({ kind: 'result', result: { isError: false, subtype: 'interrupted', numTurns: null } });
  }

  // Cambia el modelo de la sesion en caliente (M2.4). El CLI lo aplica al SIGUIENTE turno.
  setModel(model: string): void {
    if (model.trim().length === 0) throw new Error(`Modelo vacio para set_model: ${JSON.stringify(model)}`);
    this.log('info', 'Cambio de modelo en caliente', { sessionId: this.deps.params.sessionId, model });
    this.writePayload(this.deps.adapter.encodeSetModel(model));
  }

  setEffort(effort: string): void {
    if (this.deps.adapter.encodeSetEffort === undefined) throw new Error(`Este proveedor no admite cambiar esfuerzo: ${JSON.stringify(effort)}`);
    this.writePayload(this.deps.adapter.encodeSetEffort(effort));
  }

  // Cambia el modo de permiso de la sesion en caliente (M2.6). El CLI responde y emite system/status.
  setPermissionMode(mode: string): void {
    if (mode.trim().length === 0) throw new Error(`Modo de permiso vacio para set_permission_mode: ${JSON.stringify(mode)}`);
    this.log('info', 'Cambio de modo de permiso', { sessionId: this.deps.params.sessionId, mode });
    this.writePayload(this.deps.adapter.encodeSetPermissionMode(mode));
  }

  // Para UN subagente en segundo plano (0.1.1 R2, punto 29). Sin `encodeStopTask` el proveedor no puede
  // (la UI solo lo ofrece en Claude). Un error del CLI (tarea que ya acabo) llega como `control_error`.
  stopTask(taskId: string): void {
    const encode = this.deps.adapter.encodeStopTask;
    if (encode === undefined) throw new Error(`El proveedor de la sesion ${this.deps.params.sessionId} no puede parar un subagente (task_id=${JSON.stringify(taskId)})`);
    this.log('info', 'Parar subagente', { sessionId: this.deps.params.sessionId, taskId });
    this.writeLine(encode.call(this.deps.adapter, taskId));
  }

  // Detiene el proceso de forma intencionada (no se reporta como crash). Marca `stopping` ANTES de
  // matar al hijo para que su 'exit' no dispare el reinicio automatico, y cancela un reinicio ya
  // programado (si el usuario cierra la pestana mientras esperabamos el backoff, no hay que relanzar).
  stop(): void {
    this.stopping = true;
    this.cancelPendingRestart();
    for (const requestId of this.pendingElicitations.keys()) {
      try { this.answerElicitation({ sessionId: this.deps.params.sessionId, requestId, action: 'cancel' }); } catch { /* El proceso ya terminó. */ }
    }
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
    this.cancelPendingElicitations();
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
  // requestContextUsage: sin `encodeInitialize` (agy, codex) o sin proceso no hace nada, y un
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

  // Lo que devuelve un `encode*`: null = el adapter no tiene nada que mandar ahora (lo aplica despues o
  // lo encola, p.ej. codex hasta tener hilo). Despues, lo que el adapter tenga en cola.
  private writePayload(payload: unknown): void {
    if (payload !== null) this.writeLine(payload);
    this.flushOutgoing();
  }

  // Mensajes que el ADAPTER manda por su cuenta (JSON-RPC de codex: el `initialized` tras el
  // `initialize`, abrir el hilo, contestar a una peticion que Mage no implementa...). Sin proceso no se
  // drenan: se quedan en la cola del adapter para el siguiente.
  private flushOutgoing(): void {
    const take = this.deps.adapter.takeOutgoing;
    if (take === undefined || this.child === null) return;
    for (const message of take.call(this.deps.adapter)) this.writeLine(message);
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
    this.flushOutgoing();
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
      this.requestContextUsage(); // fin de turno: es cuando el desglose de contexto cambia (D3)
      // Refresco del catalogo de comandos "/" (2.2): un `/reload-plugins` o un plugin instalado a
      // mitad de sesion aparece SIN reiniciar nada. Medido: un segundo `initialize` responde con los
      // 159 comandos y NO duplica los hooks (un turno de prueba recibio un solo hook_callback de Stop).
      this.requestCommandCatalog();
    } else if (event.kind === 'conversation_reset') {
      this.resetConversationId = event.newSessionId;
    } else if (event.kind === 'hook_fired') {
      this.answerHook(event.requestId); // el CLI espera respuesta: contestar antes de seguir (D2)
    } else if (event.kind === 'control_error') {
      return this.classifyControlError(event);
    } else if (event.kind === 'permission_request') {
      this.pendingPermissions.set(event.request.requestId, event.request.toolUseId);
    } else if (event.kind === 'elicitation_request') {
      this.pendingElicitations.set(event.request.requestId, event.request);
    } else if (event.kind === 'elicitation_cancelled') {
      this.pendingElicitations.delete(event.requestId);
    } else if (event.kind === 'elicitation_resolved') {
      this.pendingElicitations.delete(event.requestId);
    } else if (event.kind === 'permission_cancelled') {
      this.pendingPermissions.delete(event.requestId);
      // El CLI cancela con el mismo `control_cancel_request` una elicitation que un permiso.
      if (this.pendingElicitations.delete(event.requestId)) this.deps.emit({ kind: 'elicitation_cancelled', requestId: event.requestId });
    } else if (event.kind === 'tool_use') {
      this.toolStartTimes.set(event.tool.toolUseId, this.now());
    } else if (event.kind === 'tool_result') {
      return this.enrichToolResult(event);
    }
    return event;
  }

  // El `session_init` del proveedor trae SU id de conversacion (en Claude, el que puso Mage). Se guarda
  // el PRIMERO y no se vuelve a tocar: es el hilo de la pestana, y un id nuevo a mitad significaria que
  // el CLI arranco otra conversacion — cambiarlo dejaria la anterior huerfana en silencio, asi que se
  // registra y se mantiene el original. En Claude un `/clear` cambia de conversacion a proposito: ese
  // caso va por `conversation_reset`, no por aqui.
  private captureProviderConversationId(conversationId: string): void {
    if (conversationId.length === 0) return;
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
    this.cancelPendingElicitations();
    this.toolStartTimes.clear();
    this.log(this.stopping ? 'info' : 'error', 'Exit del proceso del agente', {
      sessionId: this.deps.params.sessionId,
      code,
      signal,
      intentional: this.stopping,
      uptimeMs,
    });

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

  private cancelPendingElicitations(): void {
    for (const requestId of this.pendingElicitations.keys()) this.deps.emit({ kind: 'elicitation_cancelled', requestId });
    this.pendingElicitations.clear();
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

  // Relanza reanudando la conversacion (`resumeParams`), asi que la pestana conserva su hilo. Los
  // otros adapters reanudan IGUAL: debajo
  // corre el mismo CLI, y relanzar con `--session-id` de un id ya usado hace que el CLI salga con
  // "Session ID ... is already in use" — o sea, los cinco reintentos de C1 fallando en cadena.
  private restartNow(): void {
    if (this.stopping || this.child !== null) return; // pararon la sesion (o ya revivio) mientras esperabamos
    try {
      this.launch(this.resumeParams());
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
