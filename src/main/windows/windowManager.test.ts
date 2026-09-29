import { describe, expect, it } from 'vitest';
import { isWindowId, MAIN_WINDOW_ID, nextWindowId, WindowManager, type ManagedWindow } from './windowManager';

// Doble de ventana: registra lo que le hacen y puede "destruirse" como una BrowserWindow cerrada.
// El test no carga Electron (el gestor recibe la fabrica inyectada).
interface FakeWindow extends ManagedWindow {
  destroyed: boolean;
  minimized: boolean;
  readonly shown: string[];
  readonly sent: { channel: string; payload: unknown }[];
  fireClosed(): void;
}

function makeFakeWindow(webContentsId: number): FakeWindow {
  const closedListeners: (() => void)[] = [];
  const window: FakeWindow = {
    destroyed: false,
    minimized: false,
    shown: [],
    sent: [],
    isDestroyed: () => window.destroyed,
    isMinimized: () => window.minimized,
    restore: () => {
      window.minimized = false;
      window.shown.push('restore');
    },
    show: () => window.shown.push('show'),
    focus: () => window.shown.push('focus'),
    close: () => {
      window.destroyed = true;
      window.fireClosed();
    },
    on: (_event: 'closed', listener: () => void) => closedListeners.push(listener),
    webContents: {
      id: webContentsId,
      send: (channel: string, payload: unknown) => window.sent.push({ channel, payload }),
    },
    fireClosed: () => {
      for (const listener of [...closedListeners]) listener();
    },
  };
  return window;
}

function makeManager(): { manager: WindowManager<FakeWindow>; created: FakeWindow[] } {
  const created: FakeWindow[] = [];
  const manager = new WindowManager<FakeWindow>({
    createWindow: () => {
      const window = makeFakeWindow(created.length + 1);
      created.push(window);
      return window;
    },
  });
  return { manager, created };
}

describe('nextWindowId', () => {
  it('nextWindowId_sinNinguna_devuelveMain', () => {
    expect(nextWindowId([])).toBe(MAIN_WINDOW_ID);
  });

  it('nextWindowId_conMainOcupada_devuelveW2', () => {
    expect(nextWindowId([MAIN_WINDOW_ID])).toBe('w2');
  });

  it('nextWindowId_conHuecoIntermedio_reutilizaElHuecoMasBajo', () => {
    // Arrange: se cerro la w2 y siguen abiertas main, w3 y w4.
    const taken = [MAIN_WINDOW_ID, 'w3', 'w4'];

    // Act / Assert
    expect(nextWindowId(taken)).toBe('w2');
  });

  it('nextWindowId_sinMain_devuelveMainAunqueHayaSecundarias', () => {
    expect(nextWindowId(['w2', 'w3'])).toBe(MAIN_WINDOW_ID);
  });
});

describe('isWindowId', () => {
  it('isWindowId_idsAcunados_true', () => {
    expect(isWindowId(MAIN_WINDOW_ID)).toBe(true);
    expect(isWindowId('w2')).toBe(true);
    expect(isWindowId('w17')).toBe(true);
  });

  it('isWindowId_idConRutaOFormaExtrana_false', () => {
    // Es la guarda que impide que un id llegado por IPC se convierta en una ruta de fichero.
    expect(isWindowId('../../etc/passwd')).toBe(false);
    expect(isWindowId('w0')).toBe(false);
    expect(isWindowId('w')).toBe(false);
    expect(isWindowId('')).toBe(false);
    expect(isWindowId('main2')).toBe(false);
  });
});

describe('WindowManager', () => {
  it('ensureMain_dosLlamadas_devuelveLaMismaVentana', () => {
    // Arrange
    const { manager, created } = makeManager();

    // Act
    const first = manager.ensureMain();
    const second = manager.ensureMain();

    // Assert
    expect(first).toBe(second);
    expect(created).toHaveLength(1);
    expect(manager.list()).toEqual([MAIN_WINDOW_ID]);
  });

  it('ensureMain_trasDestruirLaPrincipal_laRecrea', () => {
    // Arrange
    const { manager } = makeManager();
    const first = manager.ensureMain();
    first.destroyed = true; // destruida por el SO; su evento `closed` aun no llego

    // Act
    const second = manager.ensureMain();

    // Assert
    expect(second).not.toBe(first);
    expect(manager.count()).toBe(1);
  });

  it('open_conLaPrincipalAbierta_acunaW2YLaRegistra', () => {
    // Arrange
    const { manager } = makeManager();
    manager.ensureMain();

    // Act
    const opened = manager.open();

    // Assert
    expect(opened.windowId).toBe('w2');
    expect(manager.get('w2')).toBe(opened.window);
    expect(manager.list()).toEqual([MAIN_WINDOW_ID, 'w2']);
  });

  it('close_unaDeVarias_soloCierraEsaYLasDemasSiguenVivas', () => {
    // Arrange
    const { manager } = makeManager();
    manager.ensureMain();
    const { windowId } = manager.open();

    // Act
    const closed = manager.close(windowId);

    // Assert
    expect(closed).toBe(true);
    expect(manager.list()).toEqual([MAIN_WINDOW_ID]);
    expect(manager.get(MAIN_WINDOW_ID)?.isDestroyed()).toBe(false);
  });

  it('close_idInexistente_devuelveFalse', () => {
    const { manager } = makeManager();

    expect(manager.close('w9')).toBe(false);
  });

  it('windowIdOf_webContentsDeLaSegunda_devuelveSuId', () => {
    // Arrange
    const { manager } = makeManager();
    const main = manager.ensureMain();
    const second = manager.open();

    // Act / Assert
    expect(manager.windowIdOf(main.webContents.id)).toBe(MAIN_WINDOW_ID);
    expect(manager.windowIdOf(second.window.webContents.id)).toBe('w2');
  });

  it('windowIdOf_webContentsDesconocido_devuelveNull', () => {
    const { manager } = makeManager();
    manager.ensureMain();

    expect(manager.windowIdOf(999)).toBeNull();
  });

  it('broadcast_conExcepcionDelOrigen_llegaATodasMenosAEsa', () => {
    // Arrange: tres ventanas; la segunda es la que origino el cambio de ajuste.
    const { manager } = makeManager();
    const main = manager.ensureMain();
    const second = manager.open();
    const third = manager.open();

    // Act
    manager.broadcast('settings:changed', { theme: 'dark' }, second.window.webContents.id);

    // Assert
    expect(main.sent).toEqual([{ channel: 'settings:changed', payload: { theme: 'dark' } }]);
    expect(third.window.sent).toHaveLength(1);
    expect(second.window.sent).toHaveLength(0);
  });

  it('broadcast_sinExcepcion_llegaATodas', () => {
    // Arrange
    const { manager } = makeManager();
    const main = manager.ensureMain();
    const second = manager.open();

    // Act
    manager.broadcast('widget:enabledChanged', true);

    // Assert
    expect(main.sent).toHaveLength(1);
    expect(second.window.sent).toHaveLength(1);
  });

  it('broadcast_conUnaVentanaDestruida_noLeEnviaYLaOlvida', () => {
    // Arrange
    const { manager } = makeManager();
    const main = manager.ensureMain();
    const second = manager.open();
    second.window.destroyed = true;

    // Act
    manager.broadcast('settings:changed', { theme: 'light' });

    // Assert
    expect(main.sent).toHaveLength(1);
    expect(second.window.sent).toHaveLength(0);
    expect(manager.list()).toEqual([MAIN_WINDOW_ID]);
  });

  it('sendTo_ventanaExistente_entregaElPayload', () => {
    // Arrange
    const { manager } = makeManager();
    manager.ensureMain();
    const second = manager.open();

    // Act
    manager.sendTo(second.windowId, 'windows:tabReceived', { id: 't1' });

    // Assert
    expect(second.window.sent).toEqual([{ channel: 'windows:tabReceived', payload: { id: 't1' } }]);
  });

  it('sendTo_ventanaInexistente_lanzaConElIdRecibido', () => {
    const { manager } = makeManager();
    manager.ensureMain();

    expect(() => manager.sendTo('w7', 'windows:tabReceived', {})).toThrow(/"w7"/);
  });

  it('focus_ventanaMinimizada_laRestauraYLaEnfoca', () => {
    // Arrange
    const { manager } = makeManager();
    const main = manager.ensureMain();
    main.minimized = true;

    // Act
    const focused = manager.focus(MAIN_WINDOW_ID);

    // Assert
    expect(focused).toBe(true);
    expect(main.shown).toEqual(['restore', 'show', 'focus']);
  });

  it('focus_idInexistente_devuelveFalse', () => {
    const { manager } = makeManager();

    expect(manager.focus('w2')).toBe(false);
  });

  it('open_trasCerrarLaSegunda_reutilizaElMismoId', () => {
    // Arrange: el id estable es lo que hace que la segunda ventana recupere SU estado persistido.
    const { manager } = makeManager();
    manager.ensureMain();
    const second = manager.open();
    manager.close(second.windowId);

    // Act
    const reopened = manager.open();

    // Assert
    expect(reopened.windowId).toBe('w2');
  });

  it('closed_tardioDeUnaVentanaRecreada_noBorraLaNueva', () => {
    // Arrange: la principal se destruye y se recrea antes de que llegue su evento `closed`.
    const { manager } = makeManager();
    const first = manager.ensureMain();
    first.destroyed = true;
    const recreated = manager.ensureMain();

    // Act
    first.fireClosed();

    // Assert
    expect(manager.get(MAIN_WINDOW_ID)).toBe(recreated);
  });
});

// P-028, 36: la pestaña movida a una ventana NUEVA espera a que su renderer la recoja.
describe('WindowManager pendientes', () => {
  it('openWith_encolaYTakePendingLoEntregaUnaSolaVez', () => {
    const { manager } = makeManager();
    manager.ensureMain();

    const windowId = manager.openWith({ id: 'tab-1' });

    expect(windowId).toBe('w2');
    expect(manager.takePending(windowId)).toEqual([{ id: 'tab-1' }]);
    expect(manager.takePending(windowId)).toEqual([]);
  });

  it('takePending_ventanaSinNadaQueEsperar_devuelveVacio', () => {
    const { manager } = makeManager();

    expect(manager.takePending(MAIN_WINDOW_ID)).toEqual([]);
  });

  it('openWith_descartaElEstadoDelIdAntesDeCrearLaVentana', () => {
    const order: string[] = [];
    const manager = new WindowManager<FakeWindow>({
      createWindow: (id) => {
        order.push(`create:${id}`);
        return makeFakeWindow(order.length);
      },
      discardState: (id) => order.push(`discard:${id}`),
    });
    manager.ensureMain();

    manager.openWith('x');

    expect(order).toEqual(['create:main', 'discard:w2', 'create:w2']);
  });

  it('open_sinPestaña_noDescartaElEstadoDelId', () => {
    const discarded: string[] = [];
    const manager = new WindowManager<FakeWindow>({ createWindow: (_id) => makeFakeWindow(1), discardState: (id) => discarded.push(id) });

    manager.open();

    expect(discarded).toEqual([]);
  });

  it('openWith_pasaLaPosicionALaFabrica', () => {
    const placements: unknown[] = [];
    const manager = new WindowManager<FakeWindow>({
      createWindow: (_id, placement) => {
        placements.push(placement);
        return makeFakeWindow(placements.length);
      },
    });

    manager.openWith('x', { x: 10, y: 20 });

    expect(placements).toEqual([{ x: 10, y: 20 }]);
  });

  it('openWith_laVentanaSeCierraSinRecogerlo_seOlvida', () => {
    const { manager, created } = makeManager();
    const windowId = manager.openWith('x');

    created[0]?.close();

    expect(manager.takePending(windowId)).toEqual([]);
  });

  it('openWith_laFabricaFalla_noDejaNadaEncolado', () => {
    const manager = new WindowManager<FakeWindow>({
      createWindow: () => {
        throw new Error('sin pantalla');
      },
    });

    expect(() => manager.openWith('x')).toThrow(/sin pantalla/);
    expect(manager.takePending(MAIN_WINDOW_ID)).toEqual([]);
  });
});
