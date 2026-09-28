import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import type { LaunchParams, ProviderAdapter, SpawnPlan } from './providerAdapter';
import { emitLine, harness } from './agentSession.harness';

// --- Modo perTurn (E3, `agy`) ---------------------------------------------------------------------

// Adapter de mentira en modo perTurn: no hay stdin, el prompt entra en el plan de spawn. Todo lo que
// dependa de escribir por stdin LANZA, igual que el adapter real de `agy`.
function fakePerTurnAdapter(): {
  adapter: ProviderAdapter;
  plans: LaunchParams[];
  prompts: string[];
} {
  const plans: LaunchParams[] = [];
  const prompts: string[] = [];
  const adapter: ProviderAdapter = {
    // `auth` es obligatorio en ProviderAdapter (9.1). Estas sesiones no autentican nada, asi que
    // declaran el modelo mas honesto: la sesion del proveedor vive fuera de Mage.
    auth: { kind: 'external', reason: 'adapter de prueba' },
    turnMode: 'perTurn',
    buildSpawnPlan: (params): SpawnPlan => {
      throw new Error(`perTurn no arranca sin prompt: ${params.sessionId}`);
    },
    buildTurnSpawnPlan: (params, prompt): SpawnPlan => {
      plans.push(params);
      prompts.push(prompt);
      return { command: 'agy', args: ['--print', prompt], env: {} };
    },
    encodeUserMessage: () => {
      throw new Error('sin stdin');
    },
    encodePermissionResponse: () => {
      throw new Error('sin permisos');
    },
    encodeInterrupt: () => {
      throw new Error('sin interrupt por protocolo');
    },
    encodeSetModel: () => {
      throw new Error('sin set_model');
    },
    encodeSetPermissionMode: () => {
      throw new Error('sin set_permission_mode');
    },
    normalize: (raw) => (raw as { events?: MageEvent[] }).events ?? [],
  };
  return { adapter, plans, prompts };
}

const RESULT_OK: MageEvent = {
  kind: 'result',
  result: { isError: false, subtype: 'success', numTurns: 1 },
};

describe('AgentSession en modo perTurn', () => {
  it('start_perTurn_noSpawneaNadaHastaElPrimerMensaje', () => {
    const fake = fakePerTurnAdapter();
    const h = harness(fake);

    h.session.start();

    expect(h.children).toHaveLength(0);
    expect(fake.prompts).toEqual([]);
  });

  it('sendUserMessage_perTurn_lanzaUnProcesoConElPromptEnElPlan', () => {
    const fake = fakePerTurnAdapter();
    const h = harness(fake);
    h.session.start();

    h.session.sendUserMessage('hola');

    expect(h.children).toHaveLength(1);
    expect(fake.prompts).toEqual(['hola']);
    // Primer turno: aun no hay id de conversacion del proveedor que devolverle.
    expect(fake.plans[0]?.conversationId).toBeUndefined();
  });

  // El nucleo del item: el proceso muere al cerrar el turno y eso NO es un crash.
  it('exitTrasResult_perTurn_noEmiteErrorNiReinicia', () => {
    const fake = fakePerTurnAdapter();
    const h = harness(fake);
    h.session.start();
    h.session.sendUserMessage('hola');
    emitLine(h.children[0]!, [RESULT_OK]);

    h.children[0]!.exit(0, null);

    expect(h.events.some((e) => e.kind === 'error')).toBe(false);
    expect(h.events.some((e) => e.kind === 'session_restarting')).toBe(false);
    expect(h.timers).toHaveLength(0);
    expect(h.children).toHaveLength(1); // no se relanzo nada
  });

  it('exitSinResult_perTurn_reportaElFalloYNoReintenta', () => {
    const fake = fakePerTurnAdapter();
    const h = harness(fake);
    h.session.start();
    h.session.sendUserMessage('hola');

    h.children[0]!.exit(1, null);

    const error = h.events.find((e) => e.kind === 'error');
    expect(error).toMatchObject({ message: expect.stringContaining('sin resultado') as unknown as string });
    expect(h.events.some((e) => e.kind === 'session_restarting')).toBe(false);
    expect(h.timers).toHaveLength(0);
  });

  it('segundoTurno_perTurn_reusaElConversationIdQueEmitioElProveedor', () => {
    const fake = fakePerTurnAdapter();
    const h = harness(fake);
    h.session.start();
    h.session.sendUserMessage('turno 1');
    emitLine(h.children[0]!, [
      { kind: 'session_init', sessionId: 'agy-conv-9', model: 'gemini', tools: ['read_file'], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [] },
      RESULT_OK,
    ]);
    h.children[0]!.exit(0, null);

    h.session.sendUserMessage('turno 2');

    expect(fake.plans[1]?.conversationId).toBe('agy-conv-9');
    // El id de la SESION de Mage no cambia: son dos identidades distintas.
    expect(fake.plans[1]?.sessionId).toBe('s1');
  });

  it('sendUserMessage_conTurnoEnVuelo_lanzaCitandoElMensajeDescartado', () => {
    const fake = fakePerTurnAdapter();
    const h = harness(fake);
    h.session.start();
    h.session.sendUserMessage('turno 1');

    expect(() => h.session.sendUserMessage('turno 2')).toThrow(/"turno 2"/);
    expect(h.children).toHaveLength(1);
  });

  it('setModel_perTurn_noEscribeNadaYAplicaAlSiguienteTurno', () => {
    const fake = fakePerTurnAdapter();
    const h = harness(fake);
    h.session.start();
    h.session.sendUserMessage('turno 1');
    emitLine(h.children[0]!, [RESULT_OK]);
    h.children[0]!.exit(0, null);

    h.session.setModel('claude-opus-4-6-thinking');
    h.session.sendUserMessage('turno 2');

    expect(fake.plans[0]?.model).toBe('sonnet'); // el que traia la sesion
    expect(fake.plans[1]?.model).toBe('claude-opus-4-6-thinking');
  });

  it('interrupt_perTurn_mataElArbolYCierraElTurnoSinReportarError', () => {
    const fake = fakePerTurnAdapter();
    const h = harness(fake);
    h.session.start();
    h.session.sendUserMessage('turno largo');

    h.session.interrupt();
    h.children[0]!.exit(null, 'SIGTERM');

    expect(h.treeKills).toHaveLength(1);
    expect(h.events.some((e) => e.kind === 'error')).toBe(false);
    expect(h.events.at(-1)).toEqual({
      kind: 'result',
      result: { isError: false, subtype: 'interrupted', numTurns: null },
    });
  });

  it('interrupt_perTurn_sinTurnoEnVuelo_esNoOp', () => {
    const h = harness(fakePerTurnAdapter());
    h.session.start();

    h.session.interrupt();

    expect(h.treeKills).toHaveLength(0);
    expect(h.events).toEqual([]);
  });

  it('stop_perTurn_conTurnoEnVuelo_noReportaElExitComoFallo', () => {
    const fake = fakePerTurnAdapter();
    const h = harness(fake);
    h.session.start();
    h.session.sendUserMessage('hola');

    h.session.stop();
    h.children[0]!.exit(null, 'SIGTERM');

    expect(h.events.some((e) => e.kind === 'error')).toBe(false);
  });

  // Un adapter que declare perTurn sin implementar el plan de turno es un error de PROGRAMACION:
  // tiene que decirlo, no fallar con un "undefined is not a function".
  it('sendUserMessage_perTurnSinBuildTurnSpawnPlan_lanzaExplicandolo', () => {
    const fake = fakePerTurnAdapter();
    const broken: ProviderAdapter = { ...fake.adapter, buildTurnSpawnPlan: undefined };
    const h = harness({ adapter: broken, plans: fake.plans });
    h.session.start();

    expect(() => h.session.sendUserMessage('hola')).toThrow(/buildTurnSpawnPlan/);
  });
});
