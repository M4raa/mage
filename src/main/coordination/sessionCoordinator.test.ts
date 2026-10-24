import { describe, expect, it, vi } from 'vitest';
import type { CreateSessionParams, SessionEventPayload } from '@shared/ipc';
import type { MageEvent } from '@shared/events';
import type { NativeSessionRef } from '@shared/coordination';
import { SessionCoordinator, type ConversationIdentityIndex, type CoordinatedSessions, type SequencedSessionEvent } from './sessionCoordinator';

const ACCOUNT = '/home/u/.claude';

// Gestor de sesiones falso: guarda el sumidero de cada sesion para emitir eventos a mano.
function harness(options: { index?: Partial<ConversationIdentityIndex>; emitOnStart?: MageEvent } = {}) {
  const sinks = new Map<string, (payload: SessionEventPayload) => void>();
  let next = 0;
  const sessions: CoordinatedSessions = {
    create: vi.fn((params: CreateSessionParams, sink: (payload: SessionEventPayload) => void) => {
      const id = params.resumeSessionId !== undefined && params.provider === 'claude' ? params.resumeSessionId : `s${++next}`;
      sinks.set(id, sink);
      if (options.emitOnStart !== undefined) sink({ sessionId: id, event: options.emitOnStart });
      return id;
    }),
    stop: vi.fn(),
    stopOwnedBy: vi.fn().mockReturnValue([]),
    stopByConfigDir: vi.fn().mockReturnValue([]),
    stopAll: vi.fn(),
  };
  const saved = new Map<string, number>();
  const index: ConversationIdentityIndex = {
    resolveConversation: vi.fn((ref: NativeSessionRef) => ({ conversationId: `conv-${ref.nativeId}`, lastSeq: saved.get(`conv-${ref.nativeId}`) ?? 0 })),
    recordLastSeq: vi.fn((id: string, seq: number) => { saved.set(id, seq); }),
    ...options.index,
  };
  const log = vi.fn();
  let clock = 1_000;
  const coordinator = new SessionCoordinator({ sessions, index, now: () => ++clock, log });
  const received: SequencedSessionEvent[] = [];
  const create = (params: Partial<CreateSessionParams> = {}, ownerId?: number) =>
    coordinator.create({ accountDir: ACCOUNT, cwd: '/p', provider: 'claude', ...params } as CreateSessionParams, (p) => received.push(p), ownerId);
  const emit = (sessionId: string, event: MageEvent, as = sessionId) => sinks.get(sessionId)?.({ sessionId: as, event });
  return { coordinator, sessions, index, saved, log, received, create, emit };
}

const state = (value: 'idle' | 'running'): MageEvent => ({ kind: 'session_state', state: value });
const init = (sessionId: string): MageEvent => ({ kind: 'session_init', sessionId, model: 'm', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [] });

describe('SessionCoordinator — secuencia e identidades (F2.1)', () => {
  it('relay_variosEventos_secuenciaMonotonaConHoraYConversacion', () => {
    const h = harness();
    const id = h.create();

    h.emit(id, state('running'));
    h.emit(id, { kind: 'stream_delta', text: 'hola' });

    expect(h.received.map((p) => [p.seq, p.conversationId, p.sessionId])).toEqual([[1, `conv-${id}`, id], [2, `conv-${id}`, id]]);
    expect(h.received[1]!.at).toBeGreaterThan(h.received[0]!.at);
  });

  it('create_claudeNueva_ligaLaConversacionConSuIdYLaCuentaEfectiva', () => {
    const h = harness();

    const id = h.create({ accountDir: `${ACCOUNT}/mage-private` });

    expect(h.index.resolveConversation).toHaveBeenCalledWith({ provider: 'claude', accountDir: `${ACCOUNT}/mage-private`, nativeId: id });
    expect(h.coordinator.snapshot(id)).toEqual({ sessionId: id, provider: 'claude', conversationId: `conv-${id}`, nativeRef: { provider: 'claude', accountDir: `${ACCOUNT}/mage-private`, nativeId: id }, lastSeq: 0, state: 'starting' });
  });

  it('create_codexNueva_sinConversacionHastaSuSessionInit', () => {
    const h = harness();
    const id = h.create({ provider: 'codex' });
    h.emit(id, { kind: 'models_available', models: [] });

    h.emit(id, init('thread-9'));

    expect(h.received.map((p) => p.conversationId)).toEqual([null, 'conv-thread-9']);
    expect(h.coordinator.snapshot(id).nativeRef).toEqual({ provider: 'codex', accountDir: ACCOUNT, nativeId: 'thread-9' });
  });

  it('create_codexReanudada_ligaConElHiloQueReanuda', () => {
    const h = harness();

    const id = h.create({ provider: 'codex', resumeSessionId: 'thread-7' });

    expect(h.coordinator.conversationIdOf(id)).toBe('conv-thread-7');
  });

  it('bind_conversacionConSecuenciaGuardada_continuaDesdeEsa', () => {
    const h = harness();
    h.saved.set('conv-abc', 40);
    const id = h.create({ resumeSessionId: 'abc' });

    h.emit(id, state('running'));

    expect(h.received[0]!.seq).toBe(41);
  });

  it('eventoDuranteElArranque_tieneSecuencia', () => {
    const h = harness({ emitOnStart: { kind: 'notice', text: 'arrancando' } as MageEvent });

    h.create();

    expect(h.received.map((p) => p.seq)).toEqual([1]);
  });

  it('snapshot_estadoDelMotor_yReinicio', () => {
    const h = harness();
    const id = h.create();

    h.emit(id, state('running'));
    expect(h.coordinator.snapshot(id).state).toBe('running');
    h.emit(id, { kind: 'session_restarting', attempt: 1, delayMs: 10 } as MageEvent);
    expect(h.coordinator.snapshot(id).state).toBe('restarting');
    h.emit(id, state('idle'));
    expect(h.coordinator.snapshot(id)).toMatchObject({ state: 'idle', lastSeq: 3 });
  });

  it('conversationReset_elResetSaleConLaViejaYLoSiguienteConLaNueva', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, state('running'));

    h.emit(id, { kind: 'conversation_reset', newSessionId: 'nuevo' });
    h.emit(id, state('idle'), 'nuevo');

    expect(h.received.map((p) => [p.sessionId, p.conversationId, p.seq])).toEqual([
      [id, `conv-${id}`, 1], [id, `conv-${id}`, 2], ['nuevo', 'conv-nuevo', 3],
    ]);
    expect(h.index.recordLastSeq).toHaveBeenCalledWith(`conv-${id}`, 2);
    expect(h.coordinator.snapshot('nuevo').conversationId).toBe('conv-nuevo');
    expect(() => h.coordinator.snapshot(id)).toThrow(`Sesion inexistente: ${id}`);
  });

  it('stop_guardaLaSecuenciaYDejaDeSeguirla', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, state('running'));

    h.coordinator.stop(id);

    expect(h.sessions.stop).toHaveBeenCalledWith(id);
    expect(h.index.recordLastSeq).toHaveBeenCalledWith(`conv-${id}`, 1);
    expect(() => h.coordinator.snapshot(id)).toThrow(/inexistente/);
  });

  it('stop_gestorLanza_noDejaDeSeguirlaNiGuarda', () => {
    const h = harness();
    const id = h.create();
    vi.mocked(h.sessions.stop).mockImplementation(() => { throw new Error(`Sesion inexistente: ${id}`); });

    expect(() => h.coordinator.stop(id)).toThrow(/inexistente/);
    expect(h.coordinator.snapshot(id).sessionId).toBe(id);
    expect(h.index.recordLastSeq).not.toHaveBeenCalled();
  });

  it('stopOwnedBy_soloSueltaLasQueParoElGestor', () => {
    const h = harness();
    const mine = h.create({}, 7);
    const other = h.create({}, 8);
    vi.mocked(h.sessions.stopOwnedBy).mockReturnValue([mine]);

    expect(h.coordinator.stopOwnedBy(7)).toEqual([mine]);

    expect(() => h.coordinator.snapshot(mine)).toThrow(/inexistente/);
    expect(h.coordinator.snapshot(other).sessionId).toBe(other);
  });

  it('stopAll_guardaLaSecuenciaDeTodas', () => {
    const h = harness();
    const a = h.create();
    const b = h.create();
    h.emit(a, state('running'));

    h.coordinator.stopAll();

    expect(h.sessions.stopAll).toHaveBeenCalled();
    expect(h.index.recordLastSeq).toHaveBeenCalledWith(`conv-${a}`, 1);
    expect(h.index.recordLastSeq).toHaveBeenCalledWith(`conv-${b}`, 0);
  });

  it('indiceFalla_losEventosSiguenSinConversacionYQuedaTrazado', () => {
    const h = harness({ index: { resolveConversation: () => { throw new Error('EBUSY'); } } });
    const id = h.create();

    h.emit(id, state('running'));

    expect(h.received[0]).toMatchObject({ seq: 1, conversationId: null });
    expect(h.log).toHaveBeenCalledWith('warn', 'No se pudo ligar la sesion a su conversacion', expect.objectContaining({ error: 'EBUSY' }));
  });

  it('snapshot_sesionDesconocida_lanzaConElId', () => {
    expect(() => harness().coordinator.snapshot('nadie')).toThrow('Sesion inexistente: nadie');
  });
});
