import { describe, expect, it } from 'vitest';
import { resolveNotificationTarget, type NotificationTargetContext } from './notificationTarget';
import { toNotifyParams } from './notify';

const context = (overrides: Partial<NotificationTargetContext> = {}): NotificationTargetContext => ({
  tabs: [
    { id: 'tab1', accountId: 'acc-a', provider: 'claude' },
    { id: 'tab2', accountId: 'acc-b', provider: 'claude', resumeSessionId: 's-reabierta' },
    { id: 'tab3', accountId: 'acc-x', provider: 'codex', resumeSessionId: 'thread-3' },
  ],
  sessionIdByChat: { tab1: 's-viva', tab3: 'mage-uuid-3' },
  backgroundAccountBySession: {},
  historySessionIds: new Set(),
  ...overrides,
});

describe('resolveNotificationTarget', () => {
  it('resolveNotificationTarget_pestañaAbierta_vaAElla', () => {
    expect(resolveNotificationTarget({ tabId: 'tab1', sessionId: 's-viva' }, context())).toEqual({ kind: 'tab', tabId: 'tab1', accountId: 'acc-a' });
  });

  it('resolveNotificationTarget_idDeOtraVentana_laEncuentraPorSesion', () => {
    // En otra ventana el id de pestaña no significa nada: manda la sesion (tambien la de reanudar).
    expect(resolveNotificationTarget({ tabId: 'tab9', sessionId: 's-reabierta' }, context())).toEqual({ kind: 'tab', tabId: 'tab2', accountId: 'acc-b' });
  });

  // Devolución 19: en Codex la sesión viva (eventos) y la conversación (CI, otra ventana) son ids distintos.
  it('resolveNotificationTarget_codexPorSesionViva_vaASuPestaña', () => {
    expect(resolveNotificationTarget({ tabId: 'tab9', sessionId: 'mage-uuid-3' }, context())).toEqual({ kind: 'tab', tabId: 'tab3', accountId: 'acc-x' });
  });

  it('resolveNotificationTarget_codexPorIdDelHilo_vaASuPestaña', () => {
    expect(resolveNotificationTarget({ tabId: 'tab9', sessionId: 'thread-3' }, context())).toEqual({ kind: 'tab', tabId: 'tab3', accountId: 'acc-x' });
  });

  it('resolveNotificationTarget_sesionEnSegundoPlano_resaltaSuFilaConSuCuenta', () => {
    const destination = resolveNotificationTarget({ sessionId: 's-bg' }, context({ backgroundAccountBySession: { 's-bg': 'acc-c' } }));

    expect(destination).toEqual({ kind: 'history', sessionId: 's-bg', accountId: 'acc-c' });
  });

  it('resolveNotificationTarget_soloEnElHistorial_resaltaSinCambiarDeCuenta', () => {
    const destination = resolveNotificationTarget({ tabId: 'cerrada', sessionId: 's-disco' }, context({ historySessionIds: new Set(['s-disco']) }));

    expect(destination).toEqual({ kind: 'history', sessionId: 's-disco', accountId: null });
  });

  it('resolveNotificationTarget_enNingunSitio_nada', () => {
    expect(resolveNotificationTarget({ tabId: 'x', sessionId: 'y' }, context())).toEqual({ kind: 'none' });
  });
});

describe('toNotifyParams', () => {
  it('toNotifyParams_subagenteTerminado_pideAbrirActividad', () => {
    const params = toNotifyParams({ title: 'Subagente terminado', body: 'p', opensActivity: true }, { tabId: 't', sessionId: 's' });

    expect(params).toEqual({ title: 'Subagente terminado', body: 'p', target: { tabId: 't', sessionId: 's', opensActivity: true } });
  });

  it('toNotifyParams_resto_soloLaConversacion', () => {
    expect(toNotifyParams({ title: 'Turno completado', body: 'p' }, { sessionId: 's' })).toEqual({ title: 'Turno completado', body: 'p', target: { sessionId: 's' } });
  });
});
