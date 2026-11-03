import { describe, expect, it } from 'vitest';
import { DEFAULT_KEEP_ALIVE } from '@shared/settings';
import {
  decideKeepAlive, KEEP_ALIVE_FALLBACK_MS, keepAliveIntervalMs, type KeepAliveInput, type KeepAliveSkipReason,
} from './keepAlivePolicy';

const HOUR_MS = 3_600_000;
const T0 = 1_000_000;

// Una sesion que SI lanzaria ya (vencio su plazo); cada test rompe UNA condicion.
const READY: KeepAliveInput = {
  settings: DEFAULT_KEEP_ALIVE, provider: 'claude', isApiKeyAccount: false, hasClient: true, busy: false, queueLength: 0,
  pendingCount: 0, steeringCount: 0, running: false, disabled: false, contextTokens: 200_000,
  lastRequestStartMs: T0, lastRealRequestStartMs: T0, cacheTtlMs: 3_600_000, nowMs: T0 + 3_540_000,
};

const skip = (reason: KeepAliveSkipReason) => ({ kind: 'skip', reason });

describe('decideKeepAlive: condiciones que lo impiden', () => {
  it('decideKeepAlive_notClaude_skipNotClaude', () => {
    expect(decideKeepAlive({ ...READY, provider: 'codex' })).toEqual(skip('not_claude'));
  });

  it('decideKeepAlive_settingOff_skipDisabledSetting', () => {
    expect(decideKeepAlive({ ...READY, settings: { ...DEFAULT_KEEP_ALIVE, subscriptionEnabled: false } })).toEqual(skip('disabled_setting'));
  });

  it('decideKeepAlive_sessionDisabled_skipDisabledSession', () => {
    expect(decideKeepAlive({ ...READY, disabled: true })).toEqual(skip('disabled_session'));
  });

  it('decideKeepAlive_noClient_skipNoClient', () => {
    expect(decideKeepAlive({ ...READY, hasClient: false })).toEqual(skip('no_client'));
  });

  it('decideKeepAlive_running_skipRunning', () => {
    expect(decideKeepAlive({ ...READY, running: true })).toEqual(skip('running'));
  });

  it('decideKeepAlive_busy_skipBusy', () => {
    expect(decideKeepAlive({ ...READY, busy: true })).toEqual(skip('busy'));
  });

  it('decideKeepAlive_queueNotEmpty_skipQueue', () => {
    expect(decideKeepAlive({ ...READY, queueLength: 1 })).toEqual(skip('queue'));
  });

  it('decideKeepAlive_pendingPermission_skipPending', () => {
    expect(decideKeepAlive({ ...READY, pendingCount: 1 })).toEqual(skip('pending'));
  });

  it('decideKeepAlive_steeringInFlight_skipSteering', () => {
    expect(decideKeepAlive({ ...READY, steeringCount: 1 })).toEqual(skip('steering'));
  });

  it('decideKeepAlive_noRequestYet_skipNoRequest', () => {
    expect(decideKeepAlive({ ...READY, lastRequestStartMs: null })).toEqual(skip('no_request'));
    expect(decideKeepAlive({ ...READY, lastRealRequestStartMs: null })).toEqual(skip('no_request'));
  });

  it('decideKeepAlive_smallOrUnknownContext_skipSmallContext', () => {
    expect(decideKeepAlive({ ...READY, contextTokens: 99_999 })).toEqual(skip('small_context'));
    expect(decideKeepAlive({ ...READY, contextTokens: null })).toEqual(skip('small_context'));
  });

  it('decideKeepAlive_pauseExceeded_skipPauseExceeded', () => {
    expect(decideKeepAlive({ ...READY, lastRealRequestStartMs: T0 - 9 * HOUR_MS, nowMs: T0 })).toEqual(skip('pause_exceeded'));
  });
});

describe('keepAliveIntervalMs', () => {
  it('keepAliveIntervalMs_ttl1h_3540000', () => {
    expect(keepAliveIntervalMs(3_600_000)).toBe(3_540_000);
  });

  it('keepAliveIntervalMs_ttl5m_240000', () => {
    expect(keepAliveIntervalMs(300_000)).toBe(240_000);
  });

  it('keepAliveIntervalMs_null_240000', () => {
    expect(keepAliveIntervalMs(null)).toBe(KEEP_ALIVE_FALLBACK_MS);
    expect(KEEP_ALIVE_FALLBACK_MS).toBe(240_000);
  });

  it('keepAliveIntervalMs_ttlBelowMargin_fallback', () => {
    expect(keepAliveIntervalMs(60_000)).toBe(KEEP_ALIVE_FALLBACK_MS);
    expect(keepAliveIntervalMs(0)).toBe(KEEP_ALIVE_FALLBACK_MS);
  });
});

describe('decideKeepAlive: decision', () => {
  it('decideKeepAlive_apiKeyAccountDefaults_skipDisabled', () => {
    expect(decideKeepAlive({ ...READY, isApiKeyAccount: true })).toEqual(skip('disabled_setting'));
  });

  it('decideKeepAlive_subscriptionDefaults_bigContext_wait', () => {
    const decision = decideKeepAlive({ ...READY, nowMs: T0 + 1_000 });

    expect(decision).toEqual({ kind: 'wait', dueAtMs: T0 + 3_540_000 });
  });

  it('decideKeepAlive_contextEqualsThreshold_notSmall', () => {
    expect(decideKeepAlive({ ...READY, contextTokens: 100_000 })).toEqual({ kind: 'send' });
  });

  it('decideKeepAlive_dueReached_send', () => {
    expect(decideKeepAlive(READY)).toEqual({ kind: 'send' });
  });

  it('decideKeepAlive_eightHoursPause_lastAllowedThenExceeded', () => {
    // El ultimo plazo cae justo en el limite de 8 h desde la ultima peticion real; un ms mas, no.
    const interval = 3_540_000;
    const atLimit = { ...READY, lastRequestStartMs: T0 + 8 * HOUR_MS - interval, nowMs: T0 + 8 * HOUR_MS };

    expect(decideKeepAlive(atLimit)).toEqual({ kind: 'send' });
    expect(decideKeepAlive({ ...atLimit, lastRequestStartMs: atLimit.lastRequestStartMs + 1 })).toEqual(skip('pause_exceeded'));
  });
});
