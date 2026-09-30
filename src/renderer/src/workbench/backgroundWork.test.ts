import { describe, expect, it } from 'vitest';
import type { MageEvent } from '@shared/events';
import {
  backgroundLabel,
  backgroundMoveBlockedReason,
  nextBackgroundState,
  shouldBackgroundOnClose,
  tabMoveBlockedReason,
  type BackgroundSession,
} from './backgroundWork';

// Evento minimo del tipo pedido (los campos que no mira `nextBackgroundState` van con lo justo).
function event(kind: MageEvent['kind']): MageEvent {
  if (kind === 'result') {
    return { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } };
  }
  if (kind === 'error') return { kind: 'error', message: 'roto' };
  if (kind === 'permission_cancelled') return { kind: 'permission_cancelled', requestId: 'r1' };
  if (kind === 'permission_request') {
    return {
      kind: 'permission_request',
      request: {
        requestId: 'r1',
        toolUseId: 't1',
        toolName: 'Bash',
        input: {},
        description: null,
        requiresUserInteraction: false,
        displayName: null,
      },
    };
  }
  return { kind: 'stream_delta', text: 'hola' };
}

describe('shouldBackgroundOnClose', () => {
  it('shouldBackgroundOnClose_agenteTrabajando_devuelveTrue', () => {
    expect(shouldBackgroundOnClose('streaming')).toBe(true);
  });

  it('shouldBackgroundOnClose_permisoPendiente_devuelveTrue', () => {
    expect(shouldBackgroundOnClose('needs_permission')).toBe(true);
  });

  it('shouldBackgroundOnClose_conversacionParadaOSinEstado_devuelveFalse', () => {
    expect(shouldBackgroundOnClose('idle')).toBe(false);
    expect(shouldBackgroundOnClose('error')).toBe(false);
    expect(shouldBackgroundOnClose(undefined)).toBe(false);
  });
});

describe('nextBackgroundState', () => {
  it('nextBackgroundState_finDeTurno_pasaAPendienteDeRevision', () => {
    expect(nextBackgroundState('working', event('result'))).toBe('done');
  });

  it('nextBackgroundState_error_tambienCierraElTrabajo', () => {
    expect(nextBackgroundState('working', event('error'))).toBe('done');
  });

  it('nextBackgroundState_peticionDePermiso_pasaAPendienteDeAccion', () => {
    expect(nextBackgroundState('working', event('permission_request'))).toBe('needs_action');
  });

  it('nextBackgroundState_permisoCancelado_vuelveATrabajando', () => {
    expect(nextBackgroundState('needs_action', event('permission_cancelled'))).toBe('working');
  });

  it('nextBackgroundState_permisoCanceladoSinPermisoPendiente_noCambiaNada', () => {
    expect(nextBackgroundState('done', event('permission_cancelled'))).toBe('done');
  });

  it('nextBackgroundState_eventoDeRuido_devuelveElMismoEstado', () => {
    expect(nextBackgroundState('working', event('stream_delta'))).toBe('working');
    expect(nextBackgroundState('done', event('stream_delta'))).toBe('done');
  });
});

describe('backgroundLabel', () => {
  it('backgroundLabel_cadaEstado_tieneSuTextoEnCastellano', () => {
    expect(backgroundLabel('working')).toBe('en segundo plano');
    expect(backgroundLabel('needs_action')).toBe('pendiente de acción');
    expect(backgroundLabel('done')).toBe('pendiente de revisión');
  });
});

describe('tabMoveBlockedReason', () => {
  it('tabMoveBlockedReason_turnoEnMarcha_daElMotivo', () => {
    expect(tabMoveBlockedReason('streaming')).toMatch(/turno en marcha/);
    expect(tabMoveBlockedReason('needs_permission')).toMatch(/turno en marcha/);
  });

  it('tabMoveBlockedReason_ociosaOSinEstado_null', () => {
    expect(tabMoveBlockedReason('idle')).toBeNull();
    expect(tabMoveBlockedReason(undefined)).toBeNull();
  });
});

describe('backgroundMoveBlockedReason', () => {
  const session = (state: BackgroundSession['state']): BackgroundSession => ({
    sessionId: 's',
    title: 't',
    accountId: 'a',
    state,
    sinceMs: 0,
    alwaysAllowTools: [],
  });

  it('backgroundMoveBlockedReason_trabajandoOPendiente_daElMotivo', () => {
    expect(backgroundMoveBlockedReason(session('working'))).toMatch(/segundo plano/);
    expect(backgroundMoveBlockedReason(session('needs_action'))).toMatch(/segundo plano/);
  });

  it('backgroundMoveBlockedReason_terminadaOSinSesion_null', () => {
    expect(backgroundMoveBlockedReason(session('done'))).toBeNull();
    expect(backgroundMoveBlockedReason(undefined)).toBeNull();
  });
});
