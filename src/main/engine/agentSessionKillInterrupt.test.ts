import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import type { LaunchParams, ProviderAdapter, SpawnPlan } from './providerAdapter';
import { emitLine, fakeAdapter, harness, written } from './agentSession.harness';

// Proveedor SIN interrupcion por protocolo (`agy`): AgentSession corta matando el arbol y el siguiente
// mensaje relanza el CLI reanudando la conversacion del proveedor.
function killInterruptAdapter(): { adapter: ProviderAdapter; plans: LaunchParams[] } {
  const base = fakeAdapter();
  const adapter: ProviderAdapter = { ...base.adapter, interruptsByKill: true, encodeInitialize: undefined, encodeGetContextUsage: undefined };
  return { adapter, plans: base.plans };
}

const INIT: MageEvent = {
  kind: 'session_init',
  sessionId: 'agy-conv-9',
  model: 'gemini',
  tools: [],
  mcpServers: [],
  slashCommands: [],
  skills: [],
  plugins: [],
  pluginErrors: [],
};

describe('AgentSession con interrupcion por corte', () => {
  it('interrupt_interruptsByKill_mataElArbolYCierraElTurnoSinError', () => {
    const h = harness(killInterruptAdapter());
    h.session.start();
    h.session.sendUserMessage('turno largo');

    h.session.interrupt();
    h.children[0]!.exit(null, 'SIGTERM');

    expect(h.treeKills).toHaveLength(1);
    expect(h.events.some((e) => e.kind === 'error')).toBe(false);
    expect(h.events.at(-1)).toEqual({ kind: 'result', result: { isError: false, subtype: 'interrupted', numTurns: null } });
    expect(h.timers).toHaveLength(0); // el exit del proceso cortado no dispara el reinicio automatico
  });

  it('sendUserMessage_trasElCorte_relanzaConElConversationIdDelProveedor', () => {
    const fake = killInterruptAdapter();
    const h = harness(fake);
    h.session.start();
    emitLine(h.children[0]!, [INIT]);
    h.session.interrupt();

    h.session.sendUserMessage('sigue');

    expect(h.children).toHaveLength(2);
    expect(fake.plans[1]).toMatchObject({ sessionId: 's1', resume: true, conversationId: 'agy-conv-9' });
    expect(written(h.children[1]!)).toEqual([{ text: 'sigue' }]);
  });

  it('sendUserMessage_corteAntesDelInit_relanzaSinConversationId', () => {
    const fake = killInterruptAdapter();
    const h = harness(fake);
    h.session.start();
    h.session.interrupt();

    h.session.sendUserMessage('otra vez');

    expect(fake.plans[1]?.conversationId).toBeUndefined();
    expect(fake.plans[1]?.resume).toBeUndefined();
  });

  it('interrupt_sinProceso_esNoOp', () => {
    const h = harness(killInterruptAdapter());
    h.session.start();
    h.session.interrupt();
    const events = h.events.length;

    h.session.interrupt();

    expect(h.treeKills).toHaveLength(1);
    expect(h.events).toHaveLength(events);
  });
});

// Un adapter con mensajes propios (`takeOutgoing`, codex) y `encode*` que devuelven null.
describe('AgentSession con cola de salida del adapter', () => {
  function queueingAdapter(): { adapter: ProviderAdapter; queue: unknown[] } {
    const queue: unknown[] = [];
    const adapter: ProviderAdapter = {
      auth: { kind: 'external', reason: 'prueba' },
      buildSpawnPlan: (): SpawnPlan => {
        queue.push({ hello: true });
        return { command: 'codex', args: ['app-server'], env: {} };
      },
      encodeUserMessage: (text) => {
        queue.push({ turn: text });
        return null;
      },
      encodePermissionResponse: () => null,
      encodeInterrupt: () => null,
      encodeSetModel: () => null,
      encodeSetPermissionMode: () => null,
      takeOutgoing: () => queue.splice(0),
      normalize: (raw) => {
        queue.push({ answer: raw });
        return [];
      },
    };
    return { adapter, queue };
  }

  it('start_conColaDelAdapter_laEscribeTrasLanzar', () => {
    const { adapter } = queueingAdapter();
    const h = harness({ adapter, plans: [] });

    h.session.start();

    expect(written(h.children[0]!)).toEqual([{ hello: true }]);
  });

  it('sendUserMessage_encodeDevuelveNull_noEscribeNullSinoLaCola', () => {
    const { adapter } = queueingAdapter();
    const h = harness({ adapter, plans: [] });
    h.session.start();

    h.session.sendUserMessage('hola');
    h.session.setModel('gpt-5.5');
    h.session.interrupt();

    expect(written(h.children[0]!)).toEqual([{ hello: true }, { turn: 'hola' }]);
  });

  it('lineaDeStdout_elAdapterContesta_seEscribeLaRespuesta', () => {
    const { adapter } = queueingAdapter();
    const h = harness({ adapter, plans: [] });
    h.session.start();

    h.children[0]!.stdout.emit('data', '{"id":1}\n');

    expect(written(h.children[0]!).at(-1)).toEqual({ answer: { id: 1 } });
  });
});
