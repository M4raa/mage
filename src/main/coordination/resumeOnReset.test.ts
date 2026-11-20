import { describe, expect, it, vi } from 'vitest';
import type { MageEvent } from '@shared/events';
import type { UsageInfo } from '@shared/usage';
import { RESUME_TEXT, ResumeOnReset } from './resumeOnReset';
import { RESUME_DELAY_MS } from './resumePlan';

const NOW = new Date(2026, 10, 19, 12, 0, 0).getTime();
const RESET = new Date(2026, 10, 19, 15, 0, 0).getTime();
const RATE_LIMIT: MageEvent = { kind: 'rate_limit', summary: 'límite', resetsAtMs: null };
const usage = (fiveHour: number, resetsAt: number | null, weekly = 10): UsageInfo => ({
  fiveHour: { utilization: fiveHour, resetsAt }, sevenDay: { utilization: weekly, resetsAt: null }, limits: [], apiCreditsMinor: null, fetchedAt: NOW,
});

function setup(options: { enabled?: boolean; usage?: () => Promise<UsageInfo | null> } = {}) {
  const flags = new Map<string, boolean>([['s1', options.enabled ?? true]]);
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const sent: { sessionId: string; text: string }[] = [];
  const notices: { sessionId: string; key: string; values?: Readonly<Record<string, string | number>> }[] = [];
  let now = NOW;
  const deps = {
    store: { get: (id: string) => flags.get(id) ?? false, set: (id: string, on: boolean) => { flags.set(id, on); } },
    usage: vi.fn(options.usage ?? (async () => usage(100, RESET))),
    send: vi.fn((sessionId: string, text: string) => { sent.push({ sessionId, text }); }),
    notify: vi.fn((sessionId: string, text: { key: string; values?: Readonly<Record<string, string | number>> }) => { notices.push({ sessionId, key: text.key, values: text.values }); }),
    setTimer: vi.fn((fn: () => void, ms: number) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; }),
    now: () => now,
    log: vi.fn(),
  };
  const resume = new ResumeOnReset(deps);
  const rateLimit = async (sessionId = 's1') => { resume.onEvent(sessionId, RATE_LIMIT); await vi.waitFor(() => { if (resume.scheduledAt(sessionId) === null && notices.length === 0) throw new Error('aún no'); }); };
  return { resume, deps, timers, sent, notices, flags, rateLimit, setNow: (value: number) => { now = value; } };
}

describe('ResumeOnReset', () => {
  it('onEvent_rateLimitConResetFuturo_programaUnaVezYAvisaDeLaHora', async () => {
    const { resume, timers, notices, rateLimit } = setup();
    await rateLimit();
    expect(resume.scheduledAt('s1')).toBe(RESET + RESUME_DELAY_MS);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(RESET + RESUME_DELAY_MS - NOW);
    expect(notices).toEqual([{ sessionId: 's1', key: 'chat.resumeOnReset.scheduled', values: { time: '15:02' } }]);
  });
  it('onEvent_segundoRateLimitAntesDeLaHora_noDuplica', async () => {
    const { resume, deps, timers, notices, rateLimit } = setup();
    await rateLimit();
    resume.onEvent('s1', RATE_LIMIT);
    await Promise.resolve();
    expect(timers).toHaveLength(1);
    expect(notices).toHaveLength(1);
    expect(deps.usage).toHaveBeenCalledTimes(1);
  });
  it('onEvent_dosRateLimitSeguidosMientrasSeConsulta_unaSolaConsulta', async () => {
    let release: (value: UsageInfo) => void = () => undefined;
    const { resume, deps, timers } = setup({ usage: () => new Promise<UsageInfo>((resolve) => { release = resolve; }) });
    resume.onEvent('s1', RATE_LIMIT);
    resume.onEvent('s1', RATE_LIMIT);
    release(usage(100, RESET));
    await vi.waitFor(() => { if (timers.length === 0) throw new Error('aún no'); });
    expect(deps.usage).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
  });
  it('timer_vence_mandaContinuaYLaSesionQuedaSinProgramar', async () => {
    const { resume, timers, sent, rateLimit } = setup();
    await rateLimit();
    timers[0]?.fn();
    expect(sent).toEqual([{ sessionId: 's1', text: RESUME_TEXT }]);
    expect(resume.scheduledAt('s1')).toBeNull();
  });
  it('timer_vence_suPropioEnvioNoSeTomaPorUnEnvioDelUsuario', async () => {
    const { resume, deps, timers, rateLimit } = setup();
    await rateLimit();
    deps.send.mockImplementation(() => { resume.onUserSend('s1'); });
    timers[0]?.fn();
    expect(deps.send).toHaveBeenCalledTimes(1);
    resume.onEvent('s1', RATE_LIMIT);
    await vi.waitFor(() => { expect(resume.scheduledAt('s1')).not.toBeNull(); });
  });
  it('timer_resetPasado_ahoraMasDosMinutos', async () => {
    const { resume, rateLimit } = setup({ usage: async () => usage(100, NOW - 60_000) });
    await rateLimit();
    expect(resume.scheduledAt('s1')).toBe(NOW + RESUME_DELAY_MS);
  });
  it('onEvent_semanalAgotada_noProgramaYAvisa', async () => {
    const { resume, timers, notices, rateLimit } = setup({ usage: async () => usage(100, RESET, 100) });
    await rateLimit();
    expect(timers).toHaveLength(0);
    expect(resume.scheduledAt('s1')).toBeNull();
    expect(notices).toEqual([{ sessionId: 's1', key: 'chat.resumeOnReset.weekly', values: undefined }]);
  });
  it('onEvent_sinHoraDeReset_noProgramaYAvisa', async () => {
    const { timers, notices, rateLimit } = setup({ usage: async () => usage(100, null) });
    await rateLimit();
    expect(timers).toHaveLength(0);
    expect(notices[0]?.key).toBe('chat.resumeOnReset.unknownReset');
  });
  it('onEvent_usoQueFalla_avisaQueNoSeSabeYQuedaEnElLog', async () => {
    const { deps, timers, notices, rateLimit } = setup({ usage: async () => { throw new Error('HTTP 401'); } });
    await rateLimit();
    expect(timers).toHaveLength(0);
    expect(notices[0]?.key).toBe('chat.resumeOnReset.unknownReset');
    expect(deps.log).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ error: 'HTTP 401' }));
  });
  it('onEvent_opcionApagada_noHaceNada', async () => {
    const { resume, deps, timers, notices } = setup({ enabled: false });
    resume.onEvent('s1', RATE_LIMIT);
    await Promise.resolve();
    expect(deps.usage).not.toHaveBeenCalled();
    expect(timers).toHaveLength(0);
    expect(notices).toHaveLength(0);
  });
  it('onEvent_otroEvento_noHaceNada', async () => {
    const { resume, deps } = setup();
    resume.onEvent('s1', { kind: 'compacted', trigger: 'auto' });
    await Promise.resolve();
    expect(deps.usage).not.toHaveBeenCalled();
  });
  it('set_apagarLaOpcion_cancelaLoProgramado', async () => {
    const { resume, timers, flags, rateLimit } = setup();
    await rateLimit();
    resume.set('s1', false);
    expect(timers[0]?.cancelled).toBe(true);
    expect(resume.scheduledAt('s1')).toBeNull();
    expect(flags.get('s1')).toBe(false);
  });
  it('set_encender_guardaElBooleanoYNoProgramaNada', () => {
    const { resume, timers, flags } = setup({ enabled: false });
    resume.set('s1', true);
    expect(flags.get('s1')).toBe(true);
    expect(timers).toHaveLength(0);
  });
  it('onUserSend_unEnvioAntesDeLaHora_cancela', async () => {
    const { resume, timers, rateLimit } = setup();
    await rateLimit();
    resume.onUserSend('s1');
    expect(timers[0]?.cancelled).toBe(true);
    expect(resume.scheduledAt('s1')).toBeNull();
  });
  it('onUserSend_durantelaConsulta_loQueSalgaNoSePrograma', async () => {
    let release: (value: UsageInfo) => void = () => undefined;
    const { resume, timers, notices } = setup({ usage: () => new Promise<UsageInfo>((resolve) => { release = resolve; }) });
    resume.onEvent('s1', RATE_LIMIT);
    resume.onUserSend('s1');
    release(usage(100, RESET));
    await Promise.resolve();
    await Promise.resolve();
    expect(timers).toHaveLength(0);
    expect(notices).toHaveLength(0);
  });
  it('forget_cerrarLaSesion_cancelaLoProgramado', async () => {
    const { resume, timers, rateLimit } = setup();
    await rateLimit();
    resume.forget('s1');
    expect(timers[0]?.cancelled).toBe(true);
    expect(resume.scheduledAt('s1')).toBeNull();
  });
  it('onEvent_conversationReset_cancelaLoProgramado', async () => {
    const { resume, timers, rateLimit } = setup();
    await rateLimit();
    resume.onEvent('s1', { kind: 'conversation_reset', newSessionId: 'otra' } as MageEvent);
    expect(timers[0]?.cancelled).toBe(true);
  });
  it('timer_laOpcionSeApagoSinCancelar_noEnvia', async () => {
    const { deps, timers, flags, sent, rateLimit } = setup();
    await rateLimit();
    flags.set('s1', false);
    timers[0]?.fn();
    expect(sent).toEqual([]);
    expect(deps.send).not.toHaveBeenCalled();
  });
  it('timer_elEnvioFalla_quedaEnElLogYNoLanza', async () => {
    const { deps, timers, rateLimit } = setup();
    await rateLimit();
    deps.send.mockImplementation(() => { throw new Error('sesión cerrada'); });
    expect(() => timers[0]?.fn()).not.toThrow();
    expect(deps.log).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ error: 'sesión cerrada' }));
  });
});
