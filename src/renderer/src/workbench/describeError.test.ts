import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError } from './describeError';
import { EMPTY_NOTIFICATIONS } from './notifications';
import { reportActionError, useNotificationStore } from './notificationStore';

// Respuesta 3 de la devolución 17: lo que lanza un handler de main llega al renderer envuelto por Electron. El usuario
// ve el mensaje de main, sin ese prefijo y sin tocar nada más.
const D1 = 'No se puede crear ni usar esta cuenta de API: el llavero seguro de Linux está bloqueado.';

describe('describeError', () => {
  it('describeError_errorDeIpc_quitaElPrefijoDeElectron', () => {
    const err = new Error(`Error invoking remote method 'providerAccounts:create': Error: ${D1}`);

    expect(describeError(err)).toBe(D1);
  });

  it('describeError_errorDeIpcConOtroTipo_conservaElTipo', () => {
    const err = new Error("Error invoking remote method 'x:y': TypeError: no es una función");

    expect(describeError(err)).toBe('TypeError: no es una función');
  });

  it('describeError_errorSinPrefijo_intacto', () => {
    expect(describeError(new Error(D1))).toBe(D1);
  });

  it('describeError_prefijoEnMedio_intacto', () => {
    const message = "Fallo: Error invoking remote method 'x:y': Error: z";

    expect(describeError(new Error(message))).toBe(message);
  });

  it('describeError_noEsError_dejaElValorRecibido', () => {
    expect(describeError('texto')).toBe('Error desconocido: texto');
    expect(describeError(null)).toBe('Error desconocido: null');
  });
});

describe('reportActionError con un error de IPC', () => {
  afterEach(() => {
    useNotificationStore.setState(EMPTY_NOTIFICATIONS, true);
    vi.restoreAllMocks();
  });

  it('reportActionError_errorDeIpc_elAvisoEnseñaElMensajeDeMain', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reportActionError('No se pudo crear la cuenta', new Error(`Error invoking remote method 'providerAccounts:create': Error: ${D1}`), 'test');

    expect(useNotificationStore.getState().history[0]?.body).toBe(D1);
  });
});
