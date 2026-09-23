import { describe, expect, it } from 'vitest';
import {
  emitLine,
  fakeAdapter,
  harness,
  PERMISO_R1,
  written,
  type FakeChild,
} from './agentSession.harness';

describe('AgentSession reinicio automatico (C1)', () => {
  it('onExit_unexpectedCrash_emitsRestartingAndResumesTheConversation', () => {
    const h = harness();
    h.session.start();
    emitLine(h.children[0]!, [{ kind: 'session_init', sessionId: 's1', model: 'sonnet', tools: ['Read'], mcpServers: [], slashCommands: [] }]);

    h.children[0]!.exit(1, null);

    expect(h.events.some((e) => e.kind === 'session_restarting')).toBe(true);
    const restarting = h.events.find((e) => e.kind === 'session_restarting');
    expect(restarting).toMatchObject({ attempt: 1, delayMs: 1_000 });

    h.runPendingTimer();

    expect(h.children).toHaveLength(2); // se relanzo
    expect(h.plans[1]).toMatchObject({ sessionId: 's1', resume: true }); // reanudando el hilo
  });

  it('spawnFallido_emiteErrorYPasaPorElCierreComun_reintenta', () => {
    // Node emite `error` (y `close`), NUNCA `exit`, cuando el binario no existe. Sin pasar por el cierre
    // comun la sesion se quedaba con un `child` muerto: en persistente los mensajes se escribian al
    // stdin de un fantasma EN SILENCIO, y la politica de reinicio no se consultaba jamas.
    const h = harness();
    h.session.start();

    h.children[0]!.emit('error', new Error('spawn claude ENOENT'));

    expect(h.events.some((e) => e.kind === 'error')).toBe(true);
    expect(h.events.some((e) => e.kind === 'session_restarting')).toBe(true);
    h.runPendingTimer();
    expect(h.children).toHaveLength(2); // el cierre comun corrio: se relanzo
  });

  it('onExit_beforeHandshake_relaunchesWithoutResume', () => {
    // Sin system/init no hay transcripcion: `--resume` daria "No conversation found" y encadenaria
    // reintentos condenados, asi que se relanza como arranque fresco con el mismo id.
    const h = harness();
    h.session.start();

    h.children[0]!.exit(1, null);
    h.runPendingTimer();

    expect(h.plans[1]?.resume).toBeUndefined();
  });

  it('onExit_intentionalStop_doesNotRestart', () => {
    const h = harness();
    h.session.start();

    h.session.stop();
    h.children[0]!.exit(0, 'SIGTERM');

    expect(h.events.some((e) => e.kind === 'session_restarting')).toBe(false);
    expect(h.events.some((e) => e.kind === 'error')).toBe(false);
    expect(h.timers).toHaveLength(0);
  });

  it('stop_whileRestartPending_cancelsTheScheduledRestart', () => {
    // El usuario cierra la pestana durante el backoff: no debe revivir un proceso a sus espaldas.
    const h = harness();
    h.session.start();
    h.children[0]!.exit(1, null);

    h.session.stop();
    h.runPendingTimer(); // el timer del SO podria disparar igualmente si ya estaba en vuelo

    expect(h.cleared).toHaveLength(1);
    expect(h.children).toHaveLength(1); // no se relanzo
  });

  it('onExit_attemptsExhausted_emitsErrorWithTheReason', () => {
    const h = harness();
    h.session.start();

    // maxAttempts = 2: dos reinicios y a la tercera muerte se rinde.
    h.children[0]!.exit(1, null);
    h.runPendingTimer();
    h.children[1]!.exit(1, null);
    h.runPendingTimer();
    h.children[2]!.exit(1, null);

    const error = h.events.filter((e) => e.kind === 'error').at(-1);
    expect(error).toBeDefined();
    if (error?.kind !== 'error') throw new Error('se esperaba un evento error');
    expect(error.message).toContain('no se reintenta');
    expect(error.message).toContain('3 veces');
    expect(h.children).toHaveLength(3); // no hubo un cuarto arranque
  });

  it('onExit_backoffGrows_betweenConsecutiveCrashes', () => {
    const h = harness();
    h.session.start();

    h.children[0]!.exit(1, null);
    h.runPendingTimer();
    h.children[1]!.exit(1, null);

    expect(h.timers.map((t) => t.delayMs)).toEqual([1_000, 2_000]);
  });

  it('onExit_healthyProcessDies_restartsWithBaseDelayAgain', () => {
    // Un proceso que aguanto mas del umbral no arrastra la racha: vuelve a la espera base.
    const h = harness();
    h.session.start();
    h.children[0]!.exit(1, null);
    h.runPendingTimer();
    h.advanceClock(120_000); // el relanzado vive 2 minutos

    h.children[1]!.exit(1, null);

    expect(h.timers.map((t) => t.delayMs)).toEqual([1_000, 1_000]);
    const restarts = h.events.filter((e) => e.kind === 'session_restarting');
    expect(restarts.at(-1)).toMatchObject({ attempt: 1 });
  });

  it('restart_conLineaNdjsonAMedias_noArrastraElFragmentoAlProcesoNuevo', () => {
    // El proceso muere a mitad de una linea: sin limpiar el buffer, ese fragmento se pegaria a la
    // primera linea del proceso relanzado y produciria un JSON invalido (evento 'error' espurio justo
    // al reanudar la conversacion).
    const h = harness();
    h.session.start();
    h.children[0]!.stdout.emit('data', '{"events":[{"kind":"assist'); // sin '\n': linea incompleta
    h.children[0]!.exit(1, null);
    h.runPendingTimer();

    emitLine(h.children[1]!, [{ kind: 'assistant_text', text: 'reanudado' }]);

    expect(h.events.some((e) => e.kind === 'error')).toBe(false);
    expect(h.events.at(-1)).toEqual({ kind: 'assistant_text', text: 'reanudado' });
  });

  // Fase 7.7: el HAPPY PATH del puente de permisos. Hasta aqui solo se probaba que `answerPermission`
  // LANZA tras un crash — nadie aseguraba que un `allow` llegue al CLI, ni que llegue con la tool
  // correcta. Es el camino que recorre cada permiso que el usuario aprueba en la UI.
  it('answerPermission_allow_escribeLaRespuestaConElToolUseIdDeEsePermiso', () => {
    const h = harness();
    h.session.start();
    const antes = written(h.children[0]!).length;
    emitLine(h.children[0]!, [PERMISO_R1]);

    h.session.answerPermission('r1', { behavior: 'allow' });

    // El `toolUseId` NO viaja en la respuesta del usuario: lo tiene que recordar la sesion desde la
    // peticion. Si se perdiera, el CLI aprobaria la tool equivocada (o ninguna).
    expect(written(h.children[0]!).slice(antes)).toEqual([
      { ref: { requestId: 'r1', toolUseId: 't1' }, decision: { behavior: 'allow' } },
    ]);
  });

  it('answerPermission_deny_viajaTalCualConSuMotivo', () => {
    const h = harness();
    h.session.start();
    const antes = written(h.children[0]!).length;
    emitLine(h.children[0]!, [PERMISO_R1]);

    h.session.answerPermission('r1', { behavior: 'deny', message: 'ahora no' });

    expect(written(h.children[0]!).slice(antes)).toEqual([
      { ref: { requestId: 'r1', toolUseId: 't1' }, decision: { behavior: 'deny', message: 'ahora no' } },
    ]);
  });

  it('answerPermission_dosVecesElMismo_laSegundaLanzaYNoEscribeNada', () => {
    // El CLI se queda esperando UNA respuesta por peticion; mandarle dos le descuadra el protocolo.
    const h = harness();
    h.session.start();
    emitLine(h.children[0]!, [PERMISO_R1]);
    h.session.answerPermission('r1', { behavior: 'allow' });
    const trasLaPrimera = written(h.children[0]!).length;

    expect(() => h.session.answerPermission('r1', { behavior: 'allow' })).toThrow(/desconocido o ya resuelto/i);
    expect(written(h.children[0]!)).toHaveLength(trasLaPrimera);
  });

  it('answerPermission_conVariosPendientes_respondeSoloAlQueSeLePide', () => {
    const h = harness();
    h.session.start();
    const antes = written(h.children[0]!).length;
    emitLine(h.children[0]!, [
      PERMISO_R1,
      {
        kind: 'permission_request',
        request: { requestId: 'r2', toolUseId: 't2', toolName: 'Bash', input: {}, description: 'ls', requiresUserInteraction: false, displayName: null },
      },
    ]);

    h.session.answerPermission('r2', { behavior: 'allow' });

    expect(written(h.children[0]!).slice(antes)).toEqual([
      { ref: { requestId: 'r2', toolUseId: 't2' }, decision: { behavior: 'allow' } },
    ]);
    // El otro sigue pendiente: responderlo despues tiene que seguir funcionando.
    expect(() => h.session.answerPermission('r1', { behavior: 'allow' })).not.toThrow();
  });

  it('answerPermission_requestIdInventado_lanzaSinEscribirEnElCli', () => {
    const h = harness();
    h.session.start();
    const antes = written(h.children[0]!).length;

    expect(() => h.session.answerPermission('no-existe', { behavior: 'allow' })).toThrow(/desconocido o ya resuelto/i);
    expect(written(h.children[0]!)).toHaveLength(antes);
  });

  it('onExit_withPendingPermissions_cancelsThemSoTheUiDoesNotHang', () => {
    const h = harness();
    h.session.start();
    emitLine(h.children[0]!, [
      {
        kind: 'permission_request',
        request: { requestId: 'r1', toolUseId: 't1', toolName: 'Write', input: {}, description: 'crear out.txt', requiresUserInteraction: false, displayName: null },
      },
    ]);

    h.children[0]!.exit(1, null);

    expect(h.events.some((e) => e.kind === 'permission_cancelled' && e.requestId === 'r1')).toBe(true);
  });

  it('answerPermission_afterCrash_throwsBecauseItIsNoLongerPending', () => {
    const h = harness();
    h.session.start();
    emitLine(h.children[0]!, [
      {
        kind: 'permission_request',
        request: { requestId: 'r1', toolUseId: 't1', toolName: 'Write', input: {}, description: 'crear out.txt', requiresUserInteraction: false, displayName: null },
      },
    ]);
    h.children[0]!.exit(1, null);

    expect(() => h.session.answerPermission('r1', { behavior: 'allow' })).toThrow(/desconocido o ya resuelto/i);
  });
});
