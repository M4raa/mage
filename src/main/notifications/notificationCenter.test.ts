import { describe, expect, it, vi } from 'vitest';
import { NotificationCenter, type NotificationCenterDeps, type ShownNotification } from './notificationCenter';

// `Notification` de Electron simulado: guarda sus oyentes para disparar `click`/`close` a mano.
function fakeNotification(): ShownNotification & { fire: (event: 'click' | 'close') => void; shown: boolean } {
  const listeners = new Map<string, () => void>();
  return {
    shown: false,
    on(event, listener) {
      listeners.set(event, listener);
    },
    show() {
      this.shown = true;
    },
    fire(event) {
      listeners.get(event)?.();
    },
  };
}

function setup(overrides: Partial<NotificationCenterDeps> = {}) {
  const notification = fakeNotification();
  const deps: NotificationCenterDeps = {
    isSupported: () => true,
    create: vi.fn(() => notification),
    isWindowFocused: () => false,
    focusWindow: vi.fn((windowId: string) => windowId),
    sendClicked: vi.fn(),
    ...overrides,
  };
  return { center: new NotificationCenter(deps), deps, notification };
}

const PARAMS = { title: 'Turno completado', body: 'mage', target: { tabId: 'tab3', sessionId: 's1' } };

describe('NotificationCenter', () => {
  it('show_ventanaSinFoco_laMuestraYLaGuardaHastaElClic', () => {
    const { center, notification } = setup();

    expect(center.show(PARAMS, 'w2')).toBe(true);

    expect(notification.shown).toBe(true);
    expect(center.pendingCount).toBe(1);
  });

  it('show_laVentanaQueLaPidioTieneElFoco_noLaMuestra', () => {
    const isWindowFocused = vi.fn((windowId: string) => windowId === 'w2');
    const { center, deps } = setup({ isWindowFocused });

    expect(center.show(PARAMS, 'w2')).toBe(false);
    expect(deps.create).not.toHaveBeenCalled();
  });

  it('show_sinSoporteDelSo_noLaMuestra', () => {
    const { center } = setup({ isSupported: () => false });

    expect(center.show(PARAMS, 'main')).toBe(false);
  });

  it('click_enfocaSuVentanaYLeMandaElDestino', () => {
    const { center, deps, notification } = setup();
    center.show(PARAMS, 'w2');

    notification.fire('click');

    expect(deps.focusWindow).toHaveBeenCalledWith('w2');
    expect(deps.sendClicked).toHaveBeenCalledWith('w2', PARAMS.target);
    expect(center.pendingCount).toBe(0);
  });

  it('click_ventanaYaCerrada_vaALaQueQuedoAlFrente', () => {
    const { center, deps, notification } = setup({ focusWindow: () => 'main' });
    center.show(PARAMS, 'w2');

    notification.fire('click');

    expect(deps.sendClicked).toHaveBeenCalledWith('main', PARAMS.target);
  });

  it('click_sinDestino_soloEnfoca', () => {
    const { center, deps, notification } = setup();
    center.show({ title: 't', body: 'b' }, 'main');

    notification.fire('click');

    expect(deps.focusWindow).toHaveBeenCalledWith('main');
    expect(deps.sendClicked).not.toHaveBeenCalled();
  });

  it('close_laSueltaSinEnfocar', () => {
    const { center, deps, notification } = setup();
    center.show(PARAMS, 'main');

    notification.fire('close');

    expect(center.pendingCount).toBe(0);
    expect(deps.focusWindow).not.toHaveBeenCalled();
  });
});
