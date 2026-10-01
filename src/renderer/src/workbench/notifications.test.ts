import { describe, expect, it } from 'vitest';
import {
  EMPTY_NOTIFICATIONS,
  MAX_HISTORY,
  MAX_QUEUED_TOASTS,
  MAX_VISIBLE_TOASTS,
  clearHistory,
  defaultTimeoutFor,
  dismissNotification,
  markAllRead,
  pushNotification,
  tickRemaining,
  unreadCount,
  type NotificationsState,
  type NotifyInput,
} from './notifications';

const INFO: NotifyInput = { level: 'info', title: 'Hola', source: 'test' };

// Empuja N avisos con ids n1..nN.
function pushMany(state: NotificationsState, inputs: readonly NotifyInput[]): NotificationsState {
  return inputs.reduce((acc, input, i) => pushNotification(acc, input, { id: `n${i + 1}`, nowMs: i }), state);
}

describe('pushNotification', () => {
  it('pushNotification_sinClave_apilaEnToastsYCentro', () => {
    // Arrange / Act
    const state = pushMany(EMPTY_NOTIFICATIONS, [INFO, INFO]);

    // Assert
    expect(state.toasts.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(state.history.map((n) => n.id)).toEqual(['n2', 'n1']);
  });

  it('pushNotification_mismaDedupeKey_sustituyeConservaElIdYSumaContador', () => {
    // Arrange
    const keyed: NotifyInput = { ...INFO, dedupeKey: 'k' };

    // Act
    const state = pushMany(EMPTY_NOTIFICATIONS, [keyed, { ...keyed, title: 'Otra vez' }]);

    // Assert
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0]).toMatchObject({ id: 'n1', title: 'Otra vez', count: 2 });
    expect(state.history).toHaveLength(1);
  });

  it('pushNotification_claveYaDescartada_vuelveConElContadorDelCentro', () => {
    // Arrange
    const keyed: NotifyInput = { ...INFO, dedupeKey: 'k' };
    const first = dismissNotification(pushMany(EMPTY_NOTIFICATIONS, [keyed]), 'n1');

    // Act
    const state = pushNotification(first, keyed, { id: 'n9', nowMs: 5 });

    // Assert
    expect(state.toasts[0]).toMatchObject({ id: 'n9', count: 2 });
  });

  it('pushNotification_cuartoAviso_quedaEnColaDetrasDeLosVisibles', () => {
    // Arrange / Act
    const state = pushMany(EMPTY_NOTIFICATIONS, [INFO, INFO, INFO, INFO]);
    const afterDismiss = dismissNotification(state, 'n1');

    // Assert
    expect(state.toasts.slice(0, MAX_VISIBLE_TOASTS).map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(afterDismiss.toasts.slice(0, MAX_VISIBLE_TOASTS).map((n) => n.id)).toEqual(['n2', 'n3', 'n4']);
  });

  it('pushNotification_colaLlena_descartaElNoErrorMasAntiguoDeLaColaNuncaUnError', () => {
    // Arrange: 3 visibles + un error y luego infos hasta llenar la cola
    const error: NotifyInput = { level: 'error', title: 'Fallo', source: 'test' };
    const inputs = [INFO, INFO, INFO, error, ...Array.from({ length: MAX_QUEUED_TOASTS }, () => INFO)];

    // Act
    const state = pushMany(EMPTY_NOTIFICATIONS, inputs);

    // Assert
    expect(state.toasts).toHaveLength(MAX_VISIBLE_TOASTS + MAX_QUEUED_TOASTS);
    expect(state.toasts.some((n) => n.id === 'n4')).toBe(true);
    expect(state.toasts.some((n) => n.id === 'n5')).toBe(false);
  });

  it('pushNotification_masDelTopeDelCentro_guardaSoloLasUltimas', () => {
    // Arrange / Act
    const state = pushMany(EMPTY_NOTIFICATIONS, Array.from({ length: MAX_HISTORY + 5 }, () => INFO));

    // Assert
    expect(state.history).toHaveLength(MAX_HISTORY);
    expect(state.history[0]?.id).toBe(`n${MAX_HISTORY + 5}`);
  });

  it('pushNotification_tiempoPorNivel_errorPersistenteYAvisoDiezSegundos', () => {
    // Arrange / Act
    const state = pushMany(EMPTY_NOTIFICATIONS, [{ ...INFO, level: 'error' }, { ...INFO, level: 'warning' }, { ...INFO, timeoutMs: null }]);

    // Assert
    expect(state.toasts.map((n) => n.timeoutMs)).toEqual([null, 10_000, null]);
  });

  it('pushNotification_cuerpoVacio_quedaEnNull', () => {
    const state = pushMany(EMPTY_NOTIFICATIONS, [{ ...INFO, body: '  ' }]);

    expect(state.toasts[0]?.body).toBeNull();
  });

  it('pushNotification_tituloVacio_lanzaConElValor', () => {
    expect(() => pushMany(EMPTY_NOTIFICATIONS, [{ ...INFO, title: ' ' }])).toThrow('" "');
  });

  it('pushNotification_timeoutNegativo_lanzaConElValor', () => {
    expect(() => pushMany(EMPTY_NOTIFICATIONS, [{ ...INFO, timeoutMs: -1 }])).toThrow('-1');
  });

  it('pushNotification_tresAcciones_lanza', () => {
    const action = { label: 'a', run: () => undefined };

    expect(() => pushMany(EMPTY_NOTIFICATIONS, [{ ...INFO, actions: [action, action, action] }])).toThrow('3');
  });
});

describe('centro de notificaciones', () => {
  it('dismissNotification_quitaElToastPeroNoDelCentro', () => {
    const state = dismissNotification(pushMany(EMPTY_NOTIFICATIONS, [INFO]), 'n1');

    expect(state.toasts).toHaveLength(0);
    expect(state.history).toHaveLength(1);
  });

  it('dismissNotification_idQueYaNoEsta_devuelveElMismoEstado', () => {
    const state = pushMany(EMPTY_NOTIFICATIONS, [INFO]);

    expect(dismissNotification(state, 'nada')).toBe(state);
  });

  it('markAllRead_conSinLeer_dejaElContadorACero', () => {
    const state = pushMany(EMPTY_NOTIFICATIONS, [INFO, INFO]);

    expect(unreadCount(state)).toBe(2);
    expect(unreadCount(markAllRead(state))).toBe(0);
  });

  it('clearHistory_vaciaElCentroYDejaLosToasts', () => {
    const state = clearHistory(pushMany(EMPTY_NOTIFICATIONS, [INFO]));

    expect(state.history).toHaveLength(0);
    expect(state.toasts).toHaveLength(1);
  });
});

describe('reloj', () => {
  it('defaultTimeoutFor_error_esNull', () => {
    expect(defaultTimeoutFor('error')).toBeNull();
  });

  it('defaultTimeoutFor_warning_es10s', () => {
    expect(defaultTimeoutFor('warning')).toBe(10_000);
  });

  it('tickRemaining_pasaMasQueLoQueQueda_llegaACero', () => {
    expect(tickRemaining(500, 800)).toBe(0);
  });

  it('tickRemaining_cero_noBaja', () => {
    expect(tickRemaining(500, 0)).toBe(500);
  });

  it('tickRemaining_elapsedNegativo_lanza', () => {
    expect(() => tickRemaining(500, -1)).toThrow('-1');
  });
});
