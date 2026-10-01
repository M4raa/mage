import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MageApi } from '@shared/ipc';
import type { ConversationSummary } from '@shared/conversations';
import { createWorkbenchStore, type ConversationFolderChoice } from './workbenchStore';
import { findLeafPath, singleLeaf } from './splitLayout';
import { useNotificationStore } from './notificationStore';
import { EMPTY_NOTIFICATIONS } from './notifications';
import type { Account, Tab } from './types';

// El store alcanzaba `window.mage` directamente en 18 sitios, asi que estas 850 lineas de orquestacion
// no tenian una sola red — y ahi vivia el bug de `closeTab`. Con el cliente inyectado (decision A1) se
// puede montar con un doble y probar el CABLEADO, que es justo lo que los tests de logica pura NO ven:
// I11 dejo `verify:gui` en 35/67 con 1.826 unitarios en verde.

function tab(id: string, over: Partial<Tab> = {}): Tab {
  return {
    id,
    accountId: 'C:\\Users\\u\\.claude',
    accountAlias: 'principal',
    cwd: 'C:\\proyecto',
    model: 'sonnet',
    provider: 'claude',
    title: `Conversacion ${id}`,
    privacy: 'shared',
    ...over,
  };
}

// Doble del cliente IPC: solo se implementa lo que toca cada caso, y cualquier otra llamada LANZA.
// Un mock que se traga llamadas inesperadas esconde justo el tipo de fallo que estos tests buscan.
function fakeMage(over: Partial<MageApi> = {}): MageApi {
  return new Proxy({ ...over } as MageApi, {
    get: (target, prop: string) => {
      if (prop in target) return (target as unknown as Record<string, unknown>)[prop];
      return () => {
        throw new Error(`El test no esperaba una llamada a window.mage.${prop}`);
      };
    },
  });
}

// Borradores por pestaña (auditoria B.1.2): antes vivian como estado local del `PromptBar`, que no se
// remonta al cambiar de pestaña, asi que el texto de A se enviaba a B.
describe('setDraft', () => {
  it('setDraft_dosPestanas_cadaUnaConservaElSuyo', () => {
    // Arrange
    const store = createWorkbenchStore(fakeMage());
    store.setState({ tabs: [tab('a'), tab('b')], activeTabId: 'a' });

    // Act
    store.getState().setDraft('a', { text: 'para A', attachments: [] });
    store.getState().setDraft('b', { text: 'para B', attachments: [] });

    // Assert
    expect(store.getState().draftByChat['a']?.text).toBe('para A');
    expect(store.getState().draftByChat['b']?.text).toBe('para B');
  });

  it('setDraft_borradorVacio_borraLaEntradaEnVezDeGuardarla', () => {
    // Arrange
    const store = createWorkbenchStore(fakeMage());
    store.setState({ tabs: [tab('a')], activeTabId: 'a', draftByChat: { a: { text: 'a medias', attachments: [] } } });

    // Act
    store.getState().setDraft('a', { text: '', attachments: [] });

    // Assert
    expect(store.getState().draftByChat).toEqual({});
  });

  it('setDraft_null_borraElBorrador', () => {
    // Arrange
    const store = createWorkbenchStore(fakeMage());
    store.setState({ tabs: [tab('a')], activeTabId: 'a', draftByChat: { a: { text: 'enviado', attachments: [] } } });

    // Act
    store.getState().setDraft('a', null);

    // Assert
    expect(store.getState().draftByChat).toEqual({});
  });

  it('setDraft_sinPestanaActiva_noGuardaNada', () => {
    // Arrange: sin conversacion abierta, `activeTabId` es la cadena vacia y no hay a quien atribuirlo.
    const store = createWorkbenchStore(fakeMage());

    // Act
    store.getState().setDraft('', { text: 'huerfano', attachments: [] });

    // Assert
    expect(store.getState().draftByChat).toEqual({});
  });
});

describe('closeTab', () => {
  it('closeTab_pestanaConEstadoDeMotor_limpiaTodosSusMapas', async () => {
    // B12: se limpiaban diez mapas y faltaban `turnStartByChat` y `lastActivityByChat`.
    const store = createWorkbenchStore(fakeMage({ stop: vi.fn().mockResolvedValue(undefined), saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({
      tabs: [tab('a'), tab('b')],
      activeTabId: 'a',
      splitLayout: singleLeaf('a'),
      sessionIdByChat: { a: 's-a' },
      statusByChat: { a: 'streaming' },
      blocksByChat: { a: [] },
      turnStartByChat: { a: 1_000 },
      lastActivityByChat: { a: 2_000 },
      draftByChat: { a: { text: 'a medias', attachments: [] } },
    });

    await store.getState().closeTab('a');

    const s = store.getState();
    expect(s.turnStartByChat).toEqual({});
    expect(s.lastActivityByChat).toEqual({});
    expect(s.sessionIdByChat).toEqual({});
    expect(s.statusByChat).toEqual({});
    expect(s.blocksByChat).toEqual({});
    expect(s.draftByChat).toEqual({});
    expect(s.tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('closeTab_conSesionViva_esperaAQueElCliPareAntesDeResolver', async () => {
    // B17: se hacia `void stop()`, asi que borrar la conversacion corria contra un fichero aun abierto.
    let paradoCon: string | null = null;
    let resolverStop: (() => void) | undefined;
    const stop = vi.fn().mockImplementation((sessionId: string) => {
      paradoCon = sessionId;
      return new Promise<void>((resolve) => {
        resolverStop = resolve;
      });
    });
    const store = createWorkbenchStore(fakeMage({ stop, saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a' } });

    let cerrado = false;
    const cierre = store
      .getState()
      .closeTab('a')
      .then(() => {
        cerrado = true;
      });

    expect(paradoCon).toBe('s-a');
    expect(cerrado).toBe(false); // todavia no: el CLI sigue parando
    resolverStop?.();
    await cierre;
    expect(cerrado).toBe(true);
  });

  it('closeTab_conTrabajoEnVuelo_noParaElCliYLaDejaEnSegundoPlano', async () => {
    // Decision del usuario (2026-09-15): cerrar no corta el trabajo. La sesion sigue viva y la
    // conversacion queda apuntada para que su fila del panel lo diga.
    const stop = vi.fn();
    const store = createWorkbenchStore(fakeMage({ stop, saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a' }, statusByChat: { a: 'streaming' } });

    await store.getState().closeTab('a');

    expect(stop).not.toHaveBeenCalled();
    expect(store.getState().backgroundSessions['s-a']?.state).toBe('working');
  });

  it('closeTab_conPermisoPendiente_quedaPendienteDeAccion', async () => {
    const store = createWorkbenchStore(fakeMage({ stop: vi.fn(), saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a' }, statusByChat: { a: 'needs_permission' } });

    await store.getState().closeTab('a');

    expect(store.getState().backgroundSessions['s-a']?.state).toBe('needs_action');
  });

  it('closeTab_conversacionParada_siParaElCliYNoDejaNadaEnSegundoPlano', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ stop, saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a' }, statusByChat: { a: 'idle' } });

    await store.getState().closeTab('a');

    expect(stop).toHaveBeenCalledWith('s-a');
    expect(store.getState().backgroundSessions).toEqual({});
  });

  it('closeTab_sinSesionViva_noLlamaAStop', async () => {
    const stop = vi.fn();
    const store = createWorkbenchStore(fakeMage({ stop, saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: {} });

    await store.getState().closeTab('a');

    expect(stop).not.toHaveBeenCalled();
  });
});

describe('sesiones en segundo plano', () => {
  it('handleEvent_sesionEnSegundoPlanoTerminaElTurno_quedaPendienteDeRevision', async () => {
    const store = createWorkbenchStore(
      fakeMage({
        stop: vi.fn(),
        saveWorkspace: vi.fn().mockResolvedValue(undefined),
        listConversations: vi.fn().mockResolvedValue([]),
        notify: vi.fn().mockResolvedValue(undefined),
      }),
    );
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a' }, statusByChat: { a: 'streaming' } });
    await store.getState().closeTab('a');

    store.getState().handleEvent('s-a', { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });

    expect(store.getState().backgroundSessions['s-a']?.state).toBe('done');
  });

  it('handleEvent_sesionYaParada_ignoraElEventoRezagado', () => {
    const store = createWorkbenchStore(fakeMage({}));

    store.getState().handleEvent('s-fantasma', { kind: 'stream_delta', text: 'hola' });

    expect(store.getState().backgroundSessions).toEqual({});
    expect(store.getState().blocksByChat).toEqual({});
  });

  it('discardBackgroundSession_conversacionReclamada_paraElCliYLaSacaDelMapa', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ stop, saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a' }, statusByChat: { a: 'streaming' } });
    await store.getState().closeTab('a');

    await store.getState().discardBackgroundSession('s-a');

    expect(stop).toHaveBeenCalledWith('s-a');
    expect(store.getState().backgroundSessions).toEqual({});
  });
});

describe('setActiveTab', () => {
  it('setActiveTab_pestanaYaVisibleEnOtroPanel_soloCambiaElFocoYNoReordena', () => {
    // B5: se intercambiaban los dos paneles, asi que cada clic de foco los barajaba bajo el cursor.
    const store = createWorkbenchStore(fakeMage({ saveWorkspace: vi.fn().mockResolvedValue(undefined) }));
    // Arbol literal: dos paneles hermanos. Se construye a mano y no con un helper para que el test
    // fije la FORMA que espera, no la que devuelva la implementacion de turno.
    const dividido = { kind: "split" as const, direction: "row" as const, ratio: 0.5, a: singleLeaf("a"), b: singleLeaf("b") };
    store.setState({ tabs: [tab('a'), tab('b')], activeTabId: 'a', splitLayout: dividido });

    store.getState().setActiveTab('b');

    expect(store.getState().activeTabId).toBe('b');
    expect(store.getState().splitLayout).toEqual(dividido); // el arbol NO se toca
  });

  // CAMBIO DE COMPORTAMIENTO (grupos de pestañas): antes la pestaña no visible SUSTITUIA el contenido
  // del panel enfocado; ahora se AÑADE a la barra de ese panel y queda activa en el. Es lo que hace
  // que cada panel tenga su propia lista en vez de una sola barra global.
  it('setActiveTab_pestanaNoVisible_entraEnLaBarraDelPanelEnfocadoYQuedaActiva', () => {
    const store = createWorkbenchStore(fakeMage({ saveWorkspace: vi.fn().mockResolvedValue(undefined) }));
    store.setState({ tabs: [tab('a'), tab('c')], activeTabId: 'a', splitLayout: singleLeaf('a') });

    store.getState().setActiveTab('c');

    expect(store.getState().activeTabId).toBe('c');
    expect(store.getState().splitLayout).toEqual({ kind: 'leaf', tabIds: ['a', 'c'], activeTabId: 'c' });
  });

  it('setActiveTab_laMismaPestana_noTocaElArbol', () => {
    const store = createWorkbenchStore(fakeMage());
    const antes = singleLeaf('a');
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: antes });

    store.getState().setActiveTab('a');

    expect(store.getState().splitLayout).toBe(antes);
  });
});

describe('ensureSession', () => {
  const sesionCreada = { sessionId: 's-1', configDir: 'C:\\Users\\u\\.claude' };

  it('ensureSession_dosLlamadasSolapadas_creaUNASolaSesion', async () => {
    // B16: entre mirar el mapa y que responda `createSession` hay un round-trip de IPC entero, y la
    // segunda llamada veia `undefined` tambien -> DOS procesos `claude` para una sola pestaña.
    let resolverCreate: ((value: typeof sesionCreada) => void) | undefined;
    const createSession = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolverCreate = resolve as (value: typeof sesionCreada) => void;
        }),
    );
    const store = createWorkbenchStore(
      fakeMage({ createSession, isFolderTrusted: vi.fn().mockResolvedValue(true), saveWorkspace: vi.fn().mockResolvedValue(undefined), saveConversationPrefs: vi.fn().mockResolvedValue(undefined) }),
    );
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a') });

    const primera = store.getState().ensureSession('a');
    const segunda = store.getState().ensureSession('a');
    // Se espera a que `createSession` llegue de verdad: antes hay una comprobacion de confianza de la
    // carpeta (asincrona), asi que resolver a pelo dejaria `resolverCreate` sin asignar y el test
    // colgado. Lo que se comprueba —una sola creacion para dos llamadas solapadas— no cambia.
    await vi.waitFor(() => expect(createSession).toHaveBeenCalled());
    resolverCreate?.(sesionCreada);

    expect(await primera).toBe('s-1');
    expect(await segunda).toBe('s-1');
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('ensureSession_conSesionYaViva_noVuelveACrear', async () => {
    const createSession = vi.fn();
    const store = createWorkbenchStore(fakeMage({ createSession }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-vieja' } });

    expect(await store.getState().ensureSession('a')).toBe('s-vieja');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('ensureSession_pestanaCerradaMientrasArrancaba_paraLaSesionYLanza', async () => {
    // B16, segunda mitad: sin la guarda se resucitaba el mapa de una pestaña muerta y el proceso del
    // CLI se quedaba sin nadie que lo parase, porque `closeTab` ya habia pasado por ahi.
    const stop = vi.fn().mockResolvedValue(undefined);
    let resolverCreate: ((value: typeof sesionCreada) => void) | undefined;
    const createSession = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolverCreate = resolve as (value: typeof sesionCreada) => void;
        }),
    );
    const store = createWorkbenchStore(fakeMage({ createSession, stop, isFolderTrusted: vi.fn().mockResolvedValue(true), saveWorkspace: vi.fn().mockResolvedValue(undefined) }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a') });

    const arranque = store.getState().ensureSession('a');
    await vi.waitFor(() => expect(createSession).toHaveBeenCalled());
    store.setState({ tabs: [] }); // la pestaña se cierra a mitad del round-trip
    resolverCreate?.(sesionCreada);

    await expect(arranque).rejects.toThrow(/se cerro mientras arrancaba/i);
    expect(stop).toHaveBeenCalledWith('s-1');
    expect(store.getState().sessionIdByChat.a).toBeUndefined();
  });

  it('ensureSession_carpetaSinAutorizar_preguntaYNoArrancaSiSeDiceQueNo', async () => {
    // La frontera: lanzar el CLI en una carpeta ejecuta sus hooks, asi que si no esta autorizada hay
    // que PREGUNTAR y esperar. Que main lo vuelva a comprobar por su cuenta no quita que el renderer
    // tenga que hacerlo: si no, el usuario veria un error en vez de un dialogo.
    const createSession = vi.fn();
    const store = createWorkbenchStore(fakeMage({ createSession, isFolderTrusted: vi.fn().mockResolvedValue(false) }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a') });

    const arranque = store.getState().ensureSession('a');
    await vi.waitFor(() => expect(store.getState().trustRequests).toHaveLength(1));
    expect(createSession).not.toHaveBeenCalled();

    await store.getState().answerTrustRequest(store.getState().trustRequests[0] ?? '', false);

    await expect(arranque).rejects.toThrow(/no autorizada/i);
    expect(createSession).not.toHaveBeenCalled();
    expect(store.getState().trustRequests).toHaveLength(0);
  });

  it('ensureSession_carpetaAutorizadaEnElDialogo_laGuardaYArranca', async () => {
    const createSession = vi.fn().mockResolvedValue(sesionCreada);
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(
      fakeMage({
        createSession,
        saveSettings,
        isFolderTrusted: vi.fn().mockResolvedValue(false),
        saveWorkspace: vi.fn().mockResolvedValue(undefined),
        saveConversationPrefs: vi.fn().mockResolvedValue(undefined),
      }),
    );
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a') });

    const arranque = store.getState().ensureSession('a');
    await vi.waitFor(() => expect(store.getState().trustRequests).toHaveLength(1));
    await store.getState().answerTrustRequest(store.getState().trustRequests[0] ?? '', true);

    expect(await arranque).toBe('s-1');
    expect(store.getState().settings.trustedFolders).toHaveLength(1);
    // Guardado SIN debounce: main decide leyendo el fichero, y la sesion arranca en cuanto se contesta.
    expect(saveSettings).toHaveBeenCalled();
  });

  it('ensureSession_pestanaInexistente_lanzaConElId', async () => {
    const store = createWorkbenchStore(fakeMage());
    store.setState({ tabs: [], activeTabId: '', splitLayout: singleLeaf('') });

    await expect(store.getState().ensureSession('fantasma')).rejects.toThrow(/fantasma/);
  });
});

describe('hydrateBlocks', () => {
  const bloque = (id: string): { kind: 'user'; id: string; text: string; time: string; attachments: readonly never[] } => ({
    kind: 'user',
    id,
    text: id,
    time: '12:00',
    attachments: [],
  });

  it('hydrateBlocks_conUnMensajeYaEscrito_anteponeElHistorialEnVezDeDescartarlo', () => {
    // B6: el bloque optimista del usuario hacia que la hidratacion se rindiera PARA SIEMPRE, y el
    // historial no volvia hasta cerrar y reabrir la pestaña.
    const store = createWorkbenchStore(fakeMage());
    // Pestaña REABIERTA del historial, que es el escenario de B6: hay historial en disco que rescatar.
    store.setState({ tabs: [tab('a', { resumeSessionId: 's-vieja' })], blocksByChat: { a: [bloque('mio')] } });

    store.getState().hydrateBlocks('a', [bloque('h1'), bloque('h2')]);

    expect(store.getState().blocksByChat.a?.map((b) => b.id)).toEqual(['h1', 'h2', 'mio']);
  });

  it('hydrateBlocks_chatVacio_poneElHistorialTalCual', () => {
    const store = createWorkbenchStore(fakeMage());
    store.setState({ blocksByChat: {} });

    store.getState().hydrateBlocks('a', [bloque('h1')]);

    expect(store.getState().blocksByChat.a?.map((b) => b.id)).toEqual(['h1']);
  });

  it('hydrateBlocks_dosVecesElMismoHistorial_noLoDuplica', () => {
    const store = createWorkbenchStore(fakeMage());
    const historial = [bloque('h1'), bloque('h2')];
    store.setState({ blocksByChat: {} });

    store.getState().hydrateBlocks('a', historial);
    store.getState().hydrateBlocks('a', historial);

    expect(store.getState().blocksByChat.a?.map((b) => b.id)).toEqual(['h1', 'h2']);
  });

  // REPRODUCCION de la auditoria B.1.4, que pedia medirlo antes de tocar B6. Conversacion NUEVA (sin
  // `resumeSessionId`): el primer `open()` no encuentra .jsonl, asi que el chat arranca sin hidratar y
  // sus bloques llevan ids del STREAM (`blk<n>`). Al acabar el turno llega la transcripcion con ids de
  // TRANSCRIPCION (`tb-<i>-<slot>`), que no coinciden con ninguno: la guarda de idempotencia no casa y
  // se antepone entero el mismo turno que ya esta abajo.
  it('hydrateBlocks_conversacionNuevaConSuPrimerTurnoEnPantalla_noDuplicaElTurno', () => {
    // Arrange
    const store = createWorkbenchStore(fakeMage());
    store.setState({
      tabs: [tab('a')], // sin resumeSessionId: no viene del historial
      blocksByChat: { a: [bloque('blk1'), bloque('blk2')] },
    });

    // Act: la transcripcion del turno que acaba de terminar, con sus ids propios.
    store.getState().hydrateBlocks('a', [bloque('tb-0-0'), bloque('tb-0-1')]);

    // Assert
    expect(store.getState().blocksByChat.a?.map((b) => b.id)).toEqual(['blk1', 'blk2']);
  });

  it('hydrateBlocks_sinBloques_esNoOp', () => {
    const store = createWorkbenchStore(fakeMage());
    store.setState({ blocksByChat: { a: [bloque('mio')] } });

    store.getState().hydrateBlocks('a', []);

    expect(store.getState().blocksByChat.a?.map((b) => b.id)).toEqual(['mio']);
  });
});

// El workspace se guarda con DEBOUNCE, o sea desde un `setTimeout`. Un callback de temporizador corre
// fuera de toda pila de llamada: lo que escape de ahi no lo recoge ningun `try` ni ningun `await`, y
// Vitest lo reporta como "unhandled error" en el fichero de test que tocara estar corriendo — que ni
// siquiera tiene por que ser este. Paso en CI el 2026-09-18 y el error aparecia en
// `src/main/engine/proxy/streamTranslator.test.ts`, que no toca el renderer ni de lejos.
describe('persistencia con debounce', () => {
  const tabDePrueba = (id: string): Tab =>
    ({ id, accountId: '.claude', title: id, cwd: 'C:/tmp', model: 'sonnet', provider: 'claude', privacy: 'shared' }) as Tab;

  // AVISO sobre esta seccion, para quien venga detras: el temporizador de persistencia es de MODULO y
  // `vitest.config.ts` corre con `isolate: false`, asi que el estado de este debounce se comparte entre
  // tests y entre FICHEROS. Por eso aqui solo hay aserciones que no dependen del orden. En concreto:
  // NO se puede escribir un test que falle cuando el callback del temporizador lanza, porque Vitest no
  // lo reporta como test fallido sino como "unhandled error" del fichero que tocara estar corriendo —
  // que es exactamente como se manifesto en CI el 2026-09-18, apareciendo en `streamTranslator.test.ts`.
  // La prueba de ese arreglo es CI en verde, no un `expect`.
  it('saveWorkspaceQueNoDevuelvePromesa_seLlamaIgual', () => {
    vi.useFakeTimers();
    try {
      // `vi.fn()` sin `mockResolvedValue` devuelve `undefined`: es el doble que reventaba en CI con
      // "Cannot read properties of undefined (reading 'catch')".
      const guardar = vi.fn();
      const store = createWorkbenchStore(fakeMage({ saveWorkspace: guardar }));
      store.setState({ tabs: [tabDePrueba('a')], activeTabId: 'a', splitLayout: singleLeaf('a') });

      store.getState().renameTab('a', 'un nombre nuevo');
      vi.runAllTimers();

      expect(guardar).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('storeNuevo_cancelaLaEscrituraPendienteDelAnterior', () => {
    vi.useFakeTimers();
    try {
      const guardarViejo = vi.fn().mockResolvedValue(undefined);
      const viejo = createWorkbenchStore(fakeMage({ saveWorkspace: guardarViejo }));
      viejo.setState({ tabs: [tabDePrueba('a')], activeTabId: 'a', splitLayout: singleLeaf('a') });
      viejo.getState().renameTab('a', 'cambio que queda pendiente de escribir');

      // Crear el store siguiente (otro fichero de test, u otra recarga de HMR) invalida esa escritura:
      // ese temporizador apunta al `getState` y al cliente del store viejo.
      createWorkbenchStore(fakeMage({ saveWorkspace: vi.fn().mockResolvedValue(undefined) }));
      vi.runAllTimers();

      expect(guardarViejo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// P-028, 36: mover una pestaña a una ventana NUEVA por el transporte "pull", y lo que no se mueve.
describe('pestaña a otra ventana', () => {
  const ACCOUNT = 'C:\\Users\\u\\.claude';
  const account = { id: ACCOUNT, alias: 'principal' } as Account;

  it('openInNewWindow_pestañaOciosa_laEntregaAMainYLaCierraAqui', async () => {
    const openWindowWithTab = vi.fn().mockResolvedValue('w2');
    const store = createWorkbenchStore(fakeMage({ openWindowWithTab, saveWorkspace: vi.fn().mockResolvedValue(undefined) }));
    store.setState({ tabs: [tab('a'), tab('b')], activeTabId: 'a', splitLayout: singleLeaf('a') });

    await store.getState().openInNewWindow('b');

    expect(openWindowWithTab).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', cwd: 'C:\\proyecto' }));
    expect(store.getState().tabs.map((t) => t.id)).toEqual(['a']);
  });

  it('openInNewWindow_turnoEnMarcha_lanzaConElMotivoYNoLaMueve', async () => {
    const openWindowWithTab = vi.fn();
    const store = createWorkbenchStore(fakeMage({ openWindowWithTab }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', statusByChat: { a: 'streaming' } });

    await expect(store.getState().openInNewWindow('a')).rejects.toThrow(/turno en marcha/);
    expect(openWindowWithTab).not.toHaveBeenCalled();
    expect(store.getState().tabs).toHaveLength(1);
  });

  it('dropTabOutside_mainNoLaMueve_laPestañaSeQuedaAqui', async () => {
    const store = createWorkbenchStore(fakeMage({ dropTabOutside: vi.fn().mockResolvedValue('none') }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a' });

    await store.getState().dropTabOutside('a');

    expect(store.getState().tabs).toHaveLength(1);
  });

  it('adoptTab_idYaOcupadoEnEstaVentana_leDaUnoNuevo', () => {
    const store = createWorkbenchStore(fakeMage({ saveWorkspace: vi.fn().mockResolvedValue(undefined) }));
    store.setState({ accounts: [account], tabs: [tab('tab1')], activeTabId: 'tab1', splitLayout: singleLeaf('tab1') });

    store.getState().adoptTab({ ...tab('tab1', { title: 'llegada' }) } as never);

    const ids = store.getState().tabs.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
    expect(store.getState().tabs[1]?.title).toBe('llegada');
    expect(store.getState().activeTabId).toBe(ids[1]);
  });

  it('adoptPendingTabs_adoptaLoQueEsperabaAEstaVentana', async () => {
    const store = createWorkbenchStore(
      fakeMage({ takePendingTabs: vi.fn().mockResolvedValue([tab('x', { title: 'movida' })]), saveWorkspace: vi.fn().mockResolvedValue(undefined) }),
    );
    store.setState({ accounts: [account], tabs: [], activeTabId: '' });

    await store.getState().adoptPendingTabs();

    expect(store.getState().tabs.map((t) => t.title)).toEqual(['movida']);
  });
});

// El `＋` de una barra ya NO abre el formulario de "Nueva conversacion" (peticion del usuario): crea la
// pestaña directamente, en carpeta temporal y con los valores por defecto. El dialogo sigue existiendo
// como accion secundaria (`openNewTabDialog`), que es lo unico que debe encender `newTabOpen`.
describe('pestaña nueva sin formulario', () => {
  function accountsState(): Account[] {
    return [
      {
        id: 'C:\\Users\\u\\.claude',
        monogram: 'P',
        alias: 'principal',
        provider: 'Claude',
        providerId: 'claude',
        apiBilled: false,
        defaultModel: 'sonnet',
        accent: { base: '#888', tint: '#888', bgActive: '#888', borderInactive: '#888' },
        activity: 'idle',
        usage: { fiveHour: { pct: 0, label: '' }, weekly: { pct: 0, label: '' } },
        email: null,
        loginStatus: 'logged_in',
        isMain: true,
      },
    ];
  }

  it('addTabToPane_conCuentaActiva_creaLaPestanaEnEsePanelSinAbrirElDialogo', async () => {
    // Arrange
    const store = createWorkbenchStore(
      fakeMage({ getScratchDir: vi.fn().mockResolvedValue('C:\\tmp\\scratch'), saveWorkspace: vi.fn().mockResolvedValue(undefined) }),
    );
    store.setState({
      accounts: accountsState(),
      activeAccountId: 'C:\\Users\\u\\.claude',
      tabs: [tab('a'), tab('b')],
      activeTabId: 'a',
      splitLayout: { kind: 'split', direction: 'row', ratio: 0.5, a: singleLeaf('a'), b: singleLeaf('b') },
    });

    // Act
    await store.getState().addTabToPane(['b']);

    // Assert
    const state = store.getState();
    expect(state.newTabOpen).toBe(false);
    expect(state.tabs).toHaveLength(3);
    expect(state.tabs[2]?.cwd).toBe('C:\\tmp\\scratch');
    expect(findLeafPath(state.splitLayout, state.activeTabId)).toEqual(['b']);
  });

  // P-028 16: «Nuevo chat» con el ajuste 'lastProject' nace en la carpeta del proyecto mas reciente.
  function historyItem(cwd: string, updatedAtMs: number): ConversationSummary {
    return { sessionId: `s-${updatedAtMs}`, configDir: 'C:\\Users\\u\\.claude', cwd, title: 't', privacy: 'shared', updatedAtMs, sizeBytes: 1, isScheduled: false };
  }

  async function createWithLastProject(existsDirs: MageApi['existsDirs'], folder?: ConversationFolderChoice): Promise<string | undefined> {
    const store = createWorkbenchStore(
      fakeMage({ getScratchDir: vi.fn().mockResolvedValue('C:\\tmp\\scratch'), saveWorkspace: vi.fn().mockResolvedValue(undefined), existsDirs }),
    );
    store.setState((s) => ({
      accounts: accountsState(),
      activeAccountId: 'C:\\Users\\u\\.claude',
      settings: { ...s.settings, newConversationFolder: 'lastProject' },
      conversationHistory: [historyItem('C:\\src\\viejo', 1), historyItem('C:\\src\\borrado', 3), historyItem('C:\\src\\nuevo', 2)],
    }));
    await store.getState().createConversation('shared', folder);
    return store.getState().tabs.at(-1)?.cwd;
  }

  // Grupo A (0.1.2): la pantalla sin pestañas crea en el proyecto elegido, y su «＋ Nuevo chat», siempre
  // en la temporal, diga lo que diga el ajuste.
  it('createConversation_conCwd_usaEsaCarpetaSinMirarElAjuste', async () => {
    const existsDirs = vi.fn().mockResolvedValue([true, true, true]);

    const cwd = await createWithLastProject(existsDirs, { cwd: 'C:\\src\\elegido' });

    expect(cwd).toBe('C:\\src\\elegido');
    expect(existsDirs).not.toHaveBeenCalled();
  });

  it('createConversation_conScratch_usaLaTemporalAunqueElAjusteDigaUltimoProyecto', async () => {
    const existsDirs = vi.fn().mockResolvedValue([true, true, true]);

    const cwd = await createWithLastProject(existsDirs, { scratch: true });

    expect(cwd).toBe('C:\\tmp\\scratch');
    expect(existsDirs).not.toHaveBeenCalled();
  });

  it('createConversation_carpetaVacia_sigueElAjuste', async () => {
    const cwd = await createWithLastProject(vi.fn().mockResolvedValue([false, true, true]), {});

    expect(cwd).toBe('C:\\src\\nuevo');
  });

  it('createConversation_ultimoProyecto_usaElMasRecienteQueExiste', async () => {
    const cwd = await createWithLastProject(vi.fn().mockResolvedValue([false, true, true]));

    expect(cwd).toBe('C:\\src\\nuevo');
  });

  it('createConversation_ultimoProyectoNingunoExiste_caeALaTemporal', async () => {
    const cwd = await createWithLastProject(vi.fn().mockResolvedValue([false, false, false]));

    expect(cwd).toBe('C:\\tmp\\scratch');
  });

  it('createConversation_ultimoProyectoFallaLaConsulta_caeALaTemporal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cwd = await createWithLastProject(vi.fn().mockRejectedValue(new Error('EPERM')));

    expect(cwd).toBe('C:\\tmp\\scratch');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('openNewTabDialog_conCamino_abreElDialogoAncladoAEsePanel', () => {
    // Arrange
    const store = createWorkbenchStore(fakeMage());
    store.setState({
      tabs: [tab('a'), tab('b')],
      activeTabId: 'a',
      splitLayout: { kind: 'split', direction: 'row', ratio: 0.5, a: singleLeaf('a'), b: singleLeaf('b') },
    });

    // Act
    store.getState().openNewTabDialog(['b']);

    // Assert
    expect(store.getState().newTabOpen).toBe(true);
    expect(store.getState().newTabAnchorTabId).toBe('b');
  });
});

// D3 de P-026: renombrar en Mage manda `/rename` al CLI. MEDIDO (CLI 2.1.283): el comando se resuelve
// en local y contesta con un `result` de 0 turnos, que no es un turno del usuario.
describe('renameConversation', () => {
  const RESULT = (numTurns: number) =>
    ({ kind: 'result', result: { isError: false, subtype: 'success', numTurns } }) as const;

  function mounted(status: 'idle' | 'streaming', withSession = true) {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(
      fakeMage({ sendMessage, notify, saveWorkspace: vi.fn().mockResolvedValue(undefined), getUsage: vi.fn().mockResolvedValue(null) }),
    );
    store.setState({
      tabs: [tab('a')],
      activeTabId: 'a',
      splitLayout: singleLeaf('a'),
      sessionIdByChat: withSession ? { a: 's-a' } : {},
      statusByChat: { a: status },
    });
    return { store, sendMessage, notify };
  }

  it('renameConversation_sesionOciosa_mandaRenameYNoDejaPendiente', () => {
    const { store, sendMessage } = mounted('idle');

    store.getState().renameConversation('a', '  Nuevo nombre ');

    expect(sendMessage).toHaveBeenCalledWith({ sessionId: 's-a', text: '/rename Nuevo nombre' });
    expect(store.getState().tabs[0]).toMatchObject({ title: 'Nuevo nombre' });
    expect(store.getState().tabs[0]?.pendingCliTitle).toBeUndefined();
  });

  it('renameConversation_turnoEnMarcha_quedaPendienteYSaleAlAcabar', () => {
    const { store, sendMessage } = mounted('streaming');

    store.getState().renameConversation('a', 'Nuevo');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.getState().tabs[0]?.pendingCliTitle).toBe('Nuevo');

    store.getState().handleEvent('s-a', RESULT(3));

    expect(sendMessage).toHaveBeenCalledWith({ sessionId: 's-a', text: '/rename Nuevo' });
    expect(store.getState().tabs[0]?.pendingCliTitle).toBeUndefined();
  });

  it('renameConversation_sinSesion_quedaPendiente', () => {
    const { store, sendMessage } = mounted('idle', false);

    store.getState().renameConversation('a', 'Nuevo');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.getState().tabs[0]?.pendingCliTitle).toBe('Nuevo');
  });

  it('renameConversation_resultDelRename_seTragaSinNotificarNiCerrarNada', () => {
    const { store, notify } = mounted('idle');
    store.getState().renameConversation('a', 'Nuevo');
    const blocksAntes = store.getState().blocksByChat.a;

    store.getState().handleEvent('s-a', RESULT(0));

    expect(notify).not.toHaveBeenCalled();
    expect(store.getState().blocksByChat.a).toBe(blocksAntes);
    // Solo se traga UNO: el siguiente `result` de 0 turnos (un `/rename` que tecleo el usuario) si cuenta.
    store.getState().handleEvent('s-a', RESULT(0));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('renameConversation_proveedorSinTranscripcionDeClaude_noMandaNada', () => {
    const { store, sendMessage } = mounted('idle');
    store.setState({ tabs: [tab('a', { provider: 'agy' })] });

    store.getState().renameConversation('a', 'Nuevo');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.getState().tabs[0]).toMatchObject({ title: 'Nuevo' });
    expect(store.getState().tabs[0]?.pendingCliTitle).toBeUndefined();
  });

  // P-028, punto 3: la salida del `/rename` renombra la pestaña al llegar, sin esperar a releer.
  const renameOutput = (args: string, text: string) => ({ kind: 'local_command_output' as const, command: 'rename', args, text });

  it('handleEvent_localRenameConArgs_renombraPestaña', () => {
    const { store } = mounted('idle');

    store.getState().handleEvent('s-a', renameOutput('Mi nombre', 'Session renamed to: Mi nombre'));

    expect(store.getState().tabs[0]?.title).toBe('Mi nombre');
    expect(store.getState().blocksByChat.a).toEqual([expect.objectContaining({ kind: 'command-output', command: 'rename' })]);
  });

  it('handleEvent_renameSinArgs_tomaElNombreDeLaSalida', () => {
    const { store } = mounted('idle');

    store.getState().handleEvent('s-a', renameOutput('', 'Session renamed to: generado-por-el-cli'));

    expect(store.getState().tabs[0]?.title).toBe('generado-por-el-cli');
  });

  it('handleEvent_renameDuranteTurno_renombraAlLlegar', () => {
    const { store } = mounted('streaming');

    store.getState().handleEvent('s-a', renameOutput('Durante', 'Session renamed to: Durante'));

    expect(store.getState().tabs[0]?.title).toBe('Durante');
  });

  it('handleEvent_conPendingCliTitle_ganaElDelUsuario', async () => {
    const { store, sendMessage } = mounted('streaming');
    store.getState().renameConversation('a', 'Desde la UI');

    await store.getState().sendActiveMessage('/rename Tecleado');
    store.getState().handleEvent('s-a', renameOutput('Tecleado', 'Session renamed to: Tecleado'));
    store.getState().handleEvent('s-a', RESULT(3));

    expect(store.getState().tabs[0]?.title).toBe('Tecleado');
    expect(sendMessage).not.toHaveBeenCalledWith({ sessionId: 's-a', text: '/rename Desde la UI' });
  });

  it('sendActiveMessage_primerMensajeComando_noAutotitula', async () => {
    const { store } = mounted('idle');
    store.setState({ tabs: [tab('a', { title: 'Nuevo chat' })] });

    await store.getState().sendActiveMessage('/context');
    expect(store.getState().tabs[0]?.title).toBe('Nuevo chat');
    store.getState().handleEvent('s-a', RESULT(0));

    await store.getState().sendActiveMessage('Arregla el login');
    expect(store.getState().tabs[0]?.title).toBe('Arregla el login');
  });
});

// Dos tools en paralelo = dos can_use_tool seguidos (medido el 2026-09-28 con dos `Read` en modo
// Manual). Con un solo hueco, la segunda pisaba a la primera y el turno se colgaba para siempre.
describe('permisos en cola', () => {
  const READ = (requestId: string, toolName = 'Read') =>
    ({
      kind: 'permission_request',
      request: { requestId, toolUseId: `u-${requestId}`, toolName, input: {}, description: null, requiresUserInteraction: false, displayName: null },
    }) as const;

  function withTwoPending() {
    const answerPermission = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(
      fakeMage({ answerPermission, notify: vi.fn().mockResolvedValue(undefined), saveConversationPrefs: vi.fn().mockResolvedValue(undefined) }),
    );
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a' }, statusByChat: { a: 'streaming' } });
    store.getState().handleEvent('s-a', READ('r1'));
    store.getState().handleEvent('s-a', READ('r2'));
    return { store, answerPermission };
  }

  it('answerPermissionFor_dosPeticionesEnParalelo_cadaTarjetaContestaLaSuya', () => {
    const { store, answerPermission } = withTwoPending();

    store.getState().answerPermissionFor('a', { behavior: 'allow' }, 'r2');

    expect(answerPermission).toHaveBeenCalledWith({ sessionId: 's-a', requestId: 'r2', decision: { behavior: 'allow' } });
    expect(store.getState().pendingByChat['a']?.map((p) => p.requestId)).toEqual(['r1']);
    expect(store.getState().statusByChat['a']).toBe('needs_permission');

    store.getState().answerPermissionFor('a', { behavior: 'deny', message: 'no' }, 'r1');

    expect(answerPermission).toHaveBeenLastCalledWith({ sessionId: 's-a', requestId: 'r1', decision: { behavior: 'deny', message: 'no' } });
    expect(store.getState().pendingByChat['a']).toEqual([]);
    expect(store.getState().statusByChat['a']).toBe('streaming');
    const states = (store.getState().blocksByChat['a'] ?? []).flatMap((b) => (b.kind === 'permission' ? [b.state] : []));
    expect(states).toEqual(['denied', 'allowed']);
  });

  it('answerActivePermission_conCola_contestaLaMasAntigua', () => {
    const { store, answerPermission } = withTwoPending();

    store.getState().answerActivePermission({ behavior: 'allow' });

    expect(answerPermission).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1' }));
    expect(store.getState().pendingByChat['a']?.map((p) => p.requestId)).toEqual(['r2']);
  });

  it('answerPermissionFor_requestIdYaContestado_noContestaDosVeces', () => {
    const { store, answerPermission } = withTwoPending();
    store.getState().answerPermissionFor('a', { behavior: 'allow' }, 'r1');

    store.getState().answerPermissionFor('a', { behavior: 'allow' }, 'r1');

    expect(answerPermission).toHaveBeenCalledTimes(1);
  });

  it('allowAlwaysAndAnswer_conVariasDeLaMismaTool_lasConcedeTodasYNoLasDeOtra', () => {
    const { store, answerPermission } = withTwoPending();
    store.getState().handleEvent('s-a', READ('r3', 'Bash'));

    store.getState().allowAlwaysAndAnswer('Read', 'a');

    expect(answerPermission.mock.calls.map(([arg]) => (arg as { requestId: string }).requestId)).toEqual(['r1', 'r2']);
    expect(store.getState().pendingByChat['a']?.map((p) => p.requestId)).toEqual(['r3']);
    expect(store.getState().tabs[0]?.alwaysAllowTools).toEqual(['Read']);
  });
});

// P-026, 1.8: con «Permitir siempre aqui» concedido, la peticion se contesta sola y NO se avisa de un
// «Permiso requerido» que el usuario ya dio. En las dos rutas: pestaña abierta y segundo plano.
describe('permiso auto-permitido', () => {
  const REQUEST = (toolName: string) =>
    ({
      kind: 'permission_request',
      request: { requestId: 'r1', toolUseId: 'u1', toolName, input: {}, description: null, requiresUserInteraction: false, displayName: null },
    }) as const;

  it('handleEvent_permisoConReglaSiempre_contestaYNoNotifica', () => {
    const answerPermission = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ answerPermission, notify }));
    store.setState({
      tabs: [tab('a', { alwaysAllowTools: ['Bash'] })],
      activeTabId: 'a',
      splitLayout: singleLeaf('a'),
      sessionIdByChat: { a: 's-a' },
      statusByChat: { a: 'streaming' },
    });

    store.getState().handleEvent('s-a', REQUEST('Bash'));

    expect(answerPermission).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-a', requestId: 'r1' }));
    expect(notify).not.toHaveBeenCalled();
  });

  it('handleEvent_permisoSinRegla_notifica', () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ notify }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a' } });

    store.getState().handleEvent('s-a', REQUEST('Write'));

    expect(notify).toHaveBeenCalledWith({ title: 'Permiso requerido', body: 'Conversacion a: Write', target: { tabId: 'a', sessionId: 's-a' } });
  });

  it('handleEvent_segundoPlanoConReglaSiempre_contestaSinPedirAccion', () => {
    const answerPermission = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ answerPermission, notify }));
    store.setState({
      backgroundSessions: {
        's-bg': { sessionId: 's-bg', title: 'fondo', accountId: 'acc', state: 'working', sinceMs: 1, alwaysAllowTools: ['Bash'] },
      },
    });

    store.getState().handleEvent('s-bg', REQUEST('Bash'));

    expect(answerPermission).toHaveBeenCalledWith({ sessionId: 's-bg', requestId: 'r1', decision: { behavior: 'allow' } });
    expect(notify).not.toHaveBeenCalled();
    expect(store.getState().backgroundSessions['s-bg']?.state).toBe('working');
  });

  it('handleEvent_segundoPlanoSinRegla_pideAccionYNotifica', () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ notify }));
    store.setState({
      backgroundSessions: { 's-bg': { sessionId: 's-bg', title: 'fondo', accountId: 'acc', state: 'working', sinceMs: 1, alwaysAllowTools: [] } },
    });

    store.getState().handleEvent('s-bg', REQUEST('Write'));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.getState().backgroundSessions['s-bg']?.state).toBe('needs_action');
  });
});

// P-026 2.3 (D8): cinco modos en el ciclo, en este orden, y un modo desconocido vuelve al primero.
describe('cyclePermissionMode', () => {
  function mounted(permissionMode?: string) {
    const store = createWorkbenchStore(
      fakeMage({ saveWorkspace: vi.fn().mockResolvedValue(undefined), saveConversationPrefs: vi.fn().mockResolvedValue(undefined) }),
    );
    store.setState({ tabs: [tab('a', permissionMode === undefined ? {} : { permissionMode })], activeTabId: 'a', splitLayout: singleLeaf('a') });
    return store;
  }

  it('cyclePermissionMode_cincoPasos_recorreLosCincoModosYVuelve', () => {
    const store = mounted();
    const seen: (string | undefined)[] = [];

    for (let i = 0; i < 5; i += 1) {
      store.getState().cyclePermissionMode();
      seen.push(store.getState().tabs[0]?.permissionMode);
    }

    expect(seen).toEqual(['acceptEdits', 'plan', 'auto', 'bypassPermissions', 'default']);
  });

  it('cyclePermissionMode_modoDesconocido_pasaAlPrimero', () => {
    const store = mounted('dontAsk');

    store.getState().cyclePermissionMode();

    expect(store.getState().tabs[0]?.permissionMode).toBe('default');
  });
});

// P-026 2.7 (D5): cambiar de cuenta con una conversacion abierta.
describe('requestAccountSwitch y continueInAccount', () => {
  const B = 'C:/Users/u/.claude-p';
  const accounts = [
    { id: tab('x').accountId, alias: 'principal', loginStatus: 'logged_in' },
    { id: B, alias: 'otra', loginStatus: 'logged_in' },
  ] as unknown as Account[];

  function mounted(over: Partial<MageApi> = {}, status: 'idle' | 'streaming' = 'idle') {
    const store = createWorkbenchStore(
      fakeMage({
        saveWorkspace: vi.fn().mockResolvedValue(undefined),
        getUsage: vi.fn().mockResolvedValue(null),
        listConversations: vi.fn().mockResolvedValue([]),
        ...over,
      }),
    );
    store.setState({
      accounts,
      activeAccountId: accounts[0]!.id,
      tabs: [tab('a', { resumeSessionId: 's-old' })],
      activeTabId: 'a',
      splitLayout: singleLeaf('a'),
      statusByChat: { a: status },
    });
    return store;
  }

  it('requestAccountSwitch_pestanaParada_preguntaSinCambiarTodavia', () => {
    const store = mounted();

    store.getState().requestAccountSwitch(B);

    expect(store.getState().accountSwitchPrompt).toEqual({ tabId: 'a', destAccountId: B });
    expect(store.getState().activeAccountId).toBe(accounts[0]!.id);
  });

  it('requestAccountSwitch_soloCambiar_noLlamaAlIpcDeMover', () => {
    const moveConversation = vi.fn();
    const store = mounted({ moveConversation });
    store.getState().requestAccountSwitch(B);

    store.getState().closeAccountSwitchPrompt();
    store.getState().setActiveAccount(B);

    expect(store.getState().activeAccountId).toBe(B);
    expect(moveConversation).not.toHaveBeenCalled();
  });

  it('requestAccountSwitch_turnoEnMarcha_cambiaSinPreguntar', () => {
    const store = mounted({ getScratchDir: vi.fn(() => new Promise<string>(() => undefined)) }, 'streaming');

    store.getState().requestAccountSwitch(B);

    expect(store.getState().accountSwitchPrompt).toBeNull();
    expect(store.getState().activeAccountId).toBe(B);
  });

  it('requestAccountSwitch_reassign_cambiaAccountIdDeLaPestana', () => {
    // Arrange: chat nuevo (sin resume, sin sesion, sin bloques) de la principal, con cwd y borrador.
    const store = mounted();
    store.setState({
      tabs: [tab('a', { model: 'opus', resolvedConfigDir: 'C:/viejo/mage-private' })],
      modelCatalogByAccount: { [B]: [{ id: 'opus', label: 'Opus' }] },
    });

    // Act
    store.getState().requestAccountSwitch(B);

    // Assert: sin dialogo, la pestaña pasa a B con su modelo y sin el config dir de la vieja.
    const moved = store.getState().tabs[0]!;
    expect(store.getState().accountSwitchPrompt).toBeNull();
    expect(store.getState().activeAccountId).toBe(B);
    expect(moved.accountId).toBe(B);
    expect(moved.accountAlias).toBe('otra');
    expect(moved.model).toBe('opus');
    expect(moved.resolvedConfigDir).toBeUndefined();
  });

  it('setAccountAccent_fijaYQuitaElColorDeLaCuenta', () => {
    // Funcion plana y no vi.fn: el guardado va con debounce y dispara DESPUES del test, cuando vitest ya
    // ha reseteado los mocks (un vi.fn devolveria undefined y el `.catch` reventaria fuera del test).
    const store = mounted({ saveSettings: () => Promise.resolve() });
    store.setState({ accounts: accounts.map((a, i) => ({ ...a, accent: { base: `var(--mg-accent-${i}-base)` } })) as Account[] });

    store.getState().setAccountAccent(B, 4);
    const conColor = store.getState().accounts.find((a) => a.id === B)?.accent.base;
    store.getState().setAccountAccent(B, undefined);

    expect(conColor).toBe('var(--mg-accent-4-base)');
    expect(store.getState().settings.accentByAccount).toEqual({});
    expect(store.getState().accounts.find((a) => a.id === B)?.accent.base).toBe('var(--mg-accent-1-base)');
  });

  it('setActiveTab_pestanaDeOtraCuenta_cambiaCuentaActiva', () => {
    // Arrange: dos pestañas visibles, una de cada cuenta; enfocada la de la principal.
    const store = mounted();
    store.setState({ tabs: [tab('a'), tab('b', { accountId: B })], splitLayout: singleLeaf('a') });

    // Act
    store.getState().setActiveTab('b');

    // Assert
    expect(store.getState().activeAccountId).toBe(B);
  });

  it('closeTab_laSiguienteEsDeOtraCuenta_cambiaCuentaActiva', async () => {
    const store = mounted({ stop: vi.fn().mockResolvedValue(undefined) });
    store.setState({ tabs: [tab('a'), tab('b', { accountId: B })] });

    await store.getState().closeTab('a');

    expect(store.getState().activeTabId).toBe('b');
    expect(store.getState().activeAccountId).toBe(B);
  });

  it('setActiveTab_cuentaDesconocida_noCambiaLaActiva', () => {
    const store = mounted();
    store.setState({ tabs: [tab('a'), tab('b', { accountId: 'C:/Users/u/.claude-borrada' })] });

    store.getState().setActiveTab('b');

    expect(store.getState().activeAccountId).toBe(accounts[0]!.id);
  });

  it('requestAccountSwitch_chatConBloques_soloCambiaDeCuenta', () => {
    const store = mounted();
    store.setState({ tabs: [tab('a')], blocksByChat: { a: [{ id: 'b1', kind: 'system', text: 'x' }] as never } });

    store.getState().requestAccountSwitch(B);

    expect(store.getState().tabs[0]!.accountId).toBe(accounts[0]!.id);
    expect(store.getState().activeAccountId).toBe(B);
  });

  it('continueInAccount_soloResumeSessionId_mueve', async () => {
    const moveConversation = vi.fn().mockResolvedValue({ configDir: B });
    const store = mounted({ moveConversation });

    await store.getState().continueInAccount('a', B);

    expect(moveConversation).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-old', destAccountDir: B }));
  });

  it('continueInAccount_elMovimientoFalla_propagaElError', async () => {
    const store = mounted({ moveConversation: vi.fn().mockRejectedValue(new Error('El destino ya existe')) });

    await expect(store.getState().continueInAccount('a', B)).rejects.toThrow(/destino ya existe/);
    expect(store.getState().activeAccountId).toBe(accounts[0]!.id);
  });
});

// P-028 6: modo de permiso por defecto de las conversaciones nuevas.
describe('createConversation y el modo de permiso por defecto', () => {
  const account = { id: tab('x').accountId, alias: 'principal', loginStatus: 'logged_in' } as unknown as Account;

  function fresh(defaultPermissionMode: 'plan' | 'bypassPermissions' | ''): ReturnType<typeof createWorkbenchStore> {
    const store = createWorkbenchStore(
      fakeMage({ saveWorkspace: vi.fn().mockResolvedValue(undefined), getScratchDir: vi.fn().mockResolvedValue('C:/scratch') }),
    );
    store.setState({
      accounts: [account],
      activeAccountId: account.id,
      settings: { ...store.getState().settings, defaultPermissionMode },
    });
    return store;
  }

  it('createConversation_conModoPorDefecto_pasaPermissionModeALaTab', async () => {
    const store = fresh('plan');

    await store.getState().createConversation('shared');

    expect(store.getState().tabs[0]?.permissionMode).toBe('plan');
  });

  it('createConversation_conOmitirPermisosPorDefecto_loPasaALaTab', async () => {
    const store = fresh('bypassPermissions');

    await store.getState().createConversation('shared');

    expect(store.getState().tabs[0]?.permissionMode).toBe('bypassPermissions');
  });

  it('createConversation_sinModoPorDefecto_dejaQueLoAdopteDelCli', async () => {
    const store = fresh('');

    await store.getState().createConversation('shared');

    expect(store.getState().tabs[0]?.permissionMode).toBeUndefined();
  });

  it('newTab_proveedorNoClaude_noAplicaElModoPorDefecto', async () => {
    const store = fresh('plan');

    await store.getState().newTab({ accountId: account.id, cwd: 'C:/p', model: 'gpt', provider: 'openai' });

    expect(store.getState().tabs[0]?.permissionMode).toBeUndefined();
  });
});

// 0.1.1 R2, punto 29: parar UN subagente manda `stopTask` con la sesion de SU pestaña.
describe('stopSubagent', () => {
  it('stopSubagent_conSesion_mandaStopTaskConSuSesion', () => {
    const stopTask = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ stopTask }));
    store.setState({ sessionIdByChat: { t1: 's1' } });

    store.getState().stopSubagent('t1', 'a19e');

    expect(stopTask).toHaveBeenCalledWith({ sessionId: 's1', taskId: 'a19e' });
  });

  it('stopSubagent_sinSesionOTaskIdVacio_noMandaNada', () => {
    const stopTask = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ stopTask }));
    store.setState({ sessionIdByChat: { t1: 's1' } });

    store.getState().stopSubagent('otra', 'a19e');
    store.getState().stopSubagent('t1', '');

    expect(stopTask).not.toHaveBeenCalled();
  });
});

// 0.1.1 R2, punto 30: con un turno en marcha la cola es de Mage. Nada va al stdin hasta que acaba.
describe('cola de mensajes', () => {
  const RESULT = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } } as const;
  const IMG = { mediaType: 'image/png', data: 'AAAA' } as const;

  function mounted(status: 'idle' | 'streaming') {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const interrupt = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(
      fakeMage({ sendMessage, interrupt, notify: vi.fn().mockResolvedValue(undefined), saveWorkspace: vi.fn().mockResolvedValue(undefined), getUsage: vi.fn().mockResolvedValue(null) }),
    );
    store.setState({
      tabs: [tab('a')],
      activeTabId: 'a',
      splitLayout: singleLeaf('a'),
      sessionIdByChat: { a: 's-a' },
      statusByChat: { a: status },
      turnStartByChat: { a: 1000 },
    });
    return { store, sendMessage, interrupt };
  }

  it('sendMessageToTab_turnoEnMarcha_encolaSinBurbujaNiStdinNiReloj', async () => {
    const { store, sendMessage } = mounted('streaming');

    await store.getState().sendMessageToTab('a', ' segundo ', [IMG]);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.getState().blocksByChat.a ?? []).toEqual([]);
    expect(store.getState().queuedByChat.a?.map((m) => [m.text, m.attachments])).toEqual([['segundo', [IMG]]]);
    expect(store.getState().turnStartByChat.a).toBe(1000);
  });

  it('sendMessageToTab_comandoConTurnoEnMarcha_tambienEspera', async () => {
    const { store, sendMessage } = mounted('streaming');

    await store.getState().sendMessageToTab('a', '/context');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.getState().queuedByChat.a).toHaveLength(1);
  });

  it('result_conCola_enviaSoloElPrimeroYElSiguienteEsperaASuTurno', async () => {
    const { store, sendMessage } = mounted('streaming');
    await store.getState().sendMessageToTab('a', 'uno');
    await store.getState().sendMessageToTab('a', 'dos', [IMG]);

    store.getState().handleEvent('s-a', RESULT);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(sendMessage).toHaveBeenLastCalledWith({ sessionId: 's-a', text: 'uno' });
    expect(store.getState().statusByChat.a).toBe('streaming');
    expect(store.getState().blocksByChat.a?.filter((b) => b.kind === 'user').map((b) => b.kind === 'user' && b.text)).toEqual(['uno']);
    expect(store.getState().queuedByChat.a?.map((m) => m.text)).toEqual(['dos']);

    store.getState().handleEvent('s-a', RESULT);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));

    expect(sendMessage).toHaveBeenLastCalledWith({ sessionId: 's-a', text: 'dos', attachments: [IMG] });
    expect(store.getState().queuedByChat.a).toBeUndefined();
  });

  it('interrupt_conCola_laDevuelveAlInputYNoLaEnviaAlAcabar', async () => {
    const { store, sendMessage, interrupt } = mounted('streaming');
    store.getState().setDraft('a', { text: 'borrador', attachments: [] });
    await store.getState().sendMessageToTab('a', 'uno');
    await store.getState().sendMessageToTab('a', 'mira [Imagen 1]', [IMG]);

    store.getState().interruptActiveSession();
    store.getState().handleEvent('s-a', RESULT);

    expect(interrupt).toHaveBeenCalledWith('s-a');
    expect(store.getState().queuedByChat.a).toBeUndefined();
    expect(store.getState().draftByChat.a?.text).toBe('uno\n\nmira [Imagen 1]\n\nborrador');
    expect(store.getState().draftByChat.a?.attachments.map((a) => a.attachment)).toEqual([IMG]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('turnoQueAbreElCli_cuentaComoEnMarchaYLaColaEsperaASuResult', async () => {
    const { store, sendMessage } = mounted('idle');
    store.getState().handleEvent('s-a', { kind: 'request_started' });

    await store.getState().sendMessageToTab('a', 'uno');
    expect(sendMessage).not.toHaveBeenCalled();

    store.getState().handleEvent('s-a', RESULT);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ sessionId: 's-a', text: 'uno' }));
  });

  it('editQueuedMessage_loDevuelveAlInputYLoQuitaDeLaCola', async () => {
    const { store } = mounted('streaming');
    await store.getState().sendMessageToTab('a', 'uno');
    await store.getState().sendMessageToTab('a', 'dos');
    const [first] = store.getState().queuedByChat.a ?? [];

    store.getState().editQueuedMessage('a', first?.id ?? '');

    expect(store.getState().draftByChat.a?.text).toBe('uno');
    expect(store.getState().queuedByChat.a?.map((m) => m.text)).toEqual(['dos']);
  });

  it('removeQueuedMessage_elUltimo_vaciaLaEntrada', async () => {
    const { store } = mounted('streaming');
    await store.getState().sendMessageToTab('a', 'uno');
    const [first] = store.getState().queuedByChat.a ?? [];

    store.getState().removeQueuedMessage('a', first?.id ?? '');

    expect(store.getState().queuedByChat.a).toBeUndefined();
  });
});

// Grupo F: la pseudo-pestaña de novedades (id reservado en el arbol, fuera de `tabs`).
describe('showReleaseNotesIfUpdated', () => {
  // `saveSettings` como funcion plana: el guardado va con debounce y dispara despues del test, cuando un
  // vi.fn ya reseteado devolveria undefined (mismo caso que `setAccountAccent`).
  const windows = (id: string) => vi.fn().mockResolvedValue([{ windowId: id, isCurrent: true }]);
  const settingsWith = (lastSeen: string) => ({ ...createWorkbenchStore(fakeMage()).getState().settings, onboardingCompletedVersion: 1, lastSeenReleaseNotesVersion: lastSeen });

  it('showReleaseNotesIfUpdated_subidaEnLaPrincipal_abreLaPestanaYGuardaLaVersion', async () => {
    // Arrange
    const store = createWorkbenchStore(fakeMage({ getAppVersion: vi.fn().mockResolvedValue('0.1.2'), listWindows: windows('main'), saveWorkspace: vi.fn().mockResolvedValue(undefined), saveSettings: () => Promise.resolve() }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), settings: settingsWith('0.1.1') });

    // Act
    await store.getState().showReleaseNotesIfUpdated(false);

    // Assert
    const s = store.getState();
    expect(s.activeTabId).toBe('mage:novedades');
    expect(findLeafPath(s.splitLayout, 'mage:novedades')).not.toBeNull();
    expect(s.tabs.map((t) => t.id)).toEqual(['a']);
    expect(s.settings.lastSeenReleaseNotesVersion).toBe('0.1.2');
    expect(s.appVersion).toBe('0.1.2');
  });

  it('setOnboardingCompleted_subidaQueEsperabaAlAsistente_abreLasNovedades', async () => {
    // Arrange
    const store = createWorkbenchStore(fakeMage({ getAppVersion: vi.fn().mockResolvedValue('0.1.2'), listWindows: windows('main'), saveWorkspace: vi.fn().mockResolvedValue(undefined), saveSettings: () => Promise.resolve() }));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), settings: { ...settingsWith('0.1.1'), onboardingCompletedVersion: 0 } });
    await store.getState().showReleaseNotesIfUpdated(false);
    const whilePending = store.getState().activeTabId;
    // En vitest `import.meta.env.DEV` es true: la misma bandera que usa el harness para decidir como fuera de dev.
    vi.stubEnv('VITE_MAGE_RELEASE_NOTES_IN_DEV', '1');

    // Act
    store.getState().setOnboardingCompleted(true);
    await vi.waitFor(() => expect(store.getState().activeTabId).toBe('mage:novedades'));

    // Assert
    expect(whilePending).toBe('a');
    expect(store.getState().settings.lastSeenReleaseNotesVersion).toBe('0.1.2');
    vi.unstubAllEnvs();
  });

  it('showReleaseNotesIfUpdated_ventanaSecundaria_noAbreNiGuarda', async () => {
    // Arrange
    const store = createWorkbenchStore(fakeMage({ getAppVersion: vi.fn().mockResolvedValue('0.1.2'), listWindows: windows('w2') }));
    store.setState({ settings: settingsWith('0.1.1') });

    // Act
    await store.getState().showReleaseNotesIfUpdated(false);

    // Assert
    expect(store.getState().activeTabId).toBe('');
    expect(store.getState().settings.lastSeenReleaseNotesVersion).toBe('0.1.1');
  });
});

describe('closeTab (novedades)', () => {
  const closingMage = () => fakeMage({ saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) });

  it('closeTab_novedadesActiva_laQuitaDelArbolYActivaLaConversacion', async () => {
    // Arrange
    const store = createWorkbenchStore(closingMage());
    store.setState({ tabs: [tab('a')], activeTabId: 'mage:novedades', splitLayout: { kind: 'leaf', tabIds: ['a', 'mage:novedades'], activeTabId: 'mage:novedades' } });

    // Act
    await store.getState().closeTab('mage:novedades');

    // Assert
    expect(store.getState().activeTabId).toBe('a');
    expect(store.getState().splitLayout).toEqual(singleLeaf('a'));
  });

  it('closeTab_ultimaConversacionConNovedadesAbierta_elFocoPasaANovedades', async () => {
    // Arrange
    const store = createWorkbenchStore(closingMage());
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: { kind: 'leaf', tabIds: ['a', 'mage:novedades'], activeTabId: 'a' } });

    // Act
    await store.getState().closeTab('a');

    // Assert
    expect(store.getState().activeTabId).toBe('mage:novedades');
    expect(store.getState().splitLayout).toEqual(singleLeaf('mage:novedades'));
  });
});

// Grupo B: los dialogos propios de cierre y de actualizacion. Main decide; el store solo contesta.
describe('dialogos de cierre y actualizacion', () => {
  const READY = { kind: 'ready', version: '0.1.3', releaseNotes: null } as const;

  it('answerClosePrompt_contesta_cierraElDialogoYMandaLaRespuestaAMain', () => {
    // Arrange
    const answerClose = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ answerClose }));
    store.setState({ closePromptOpen: true });

    // Act
    store.getState().answerClosePrompt({ action: 'hide', remember: true });

    // Assert
    expect(store.getState().closePromptOpen).toBe(false);
    expect(answerClose).toHaveBeenCalledWith({ action: 'hide', remember: true });
  });

  it('openUpdatePrompt_conActualizacionLista_abreSuVersion', () => {
    const store = createWorkbenchStore(fakeMage());
    store.setState({ updateState: READY });

    store.getState().openUpdatePrompt();

    expect(store.getState().updatePromptVersion).toBe('0.1.3');
  });

  it('openUpdatePrompt_sinActualizacionLista_noAbreNada', () => {
    const store = createWorkbenchStore(fakeMage());
    store.setState({ updateState: { kind: 'downloading', version: '0.1.3' } });

    store.getState().openUpdatePrompt();

    expect(store.getState().updatePromptVersion).toBeNull();
  });

  it('dismissUpdatePrompt_masTarde_cierraElDialogoYConservaElEstado', () => {
    const store = createWorkbenchStore(fakeMage());
    store.setState({ updateState: READY, updatePromptVersion: '0.1.3' });

    store.getState().dismissUpdatePrompt();

    expect(store.getState().updatePromptVersion).toBeNull();
    expect(store.getState().updateState).toEqual(READY);
  });

  it('installUpdate_reiniciarAhora_loPideAMain', () => {
    const installUpdate = vi.fn().mockResolvedValue(undefined);
    const store = createWorkbenchStore(fakeMage({ installUpdate }));
    store.setState({ updateState: READY, updatePromptVersion: '0.1.3' });

    store.getState().installUpdate();

    expect(installUpdate).toHaveBeenCalledTimes(1);
    expect(store.getState().updatePromptVersion).toBeNull();
  });
});

// Grupo D: PR vinculado, barreras del turno de «Crear PR», vigilancia y auto-fix.
describe('PR de la pestaña (grupo D)', () => {
  const PR = {
    number: 7, title: 'Arregla x', url: 'https://github.com/acme/demo/pull/7', state: 'open' as const, isDraft: false, headRefName: 'f', headSha: 'sha1',
    baseRefName: 'main', mergeable: 'mergeable' as const, mergeStateStatus: 'UNSTABLE', reviewDecision: null, autoMerge: false,
    checks: [{ name: 'check', workflow: 'check', state: 'fail' as const, url: null, startedAt: null, completedAt: null }],
    summary: { pending: 0, pass: 0, fail: 1, skip: 0, cancel: 0 },
  };

  function prStore(over: Partial<MageApi> = {}) {
    const mage = { ghWatch: vi.fn().mockResolvedValue(undefined), ghUnwatch: vi.fn().mockResolvedValue(undefined), saveWorkspace: vi.fn().mockResolvedValue(undefined), ...over };
    const store = createWorkbenchStore(fakeMage(mage));
    store.setState({ tabs: [tab('a')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a' }, statusByChat: { a: 'streaming' } });
    return { store, mage };
  }

  it('handleEvent_ghPrCreateConUrlEnElResultado_vinculaYVigila', () => {
    const { store, mage } = prStore();

    store.getState().handleEvent('s-a', { kind: 'tool_use', tool: { toolUseId: 'u1', toolName: 'Bash', input: { command: 'gh pr create --fill' } } });
    store.getState().handleEvent('s-a', { kind: 'tool_result', result: { toolUseId: 'u1', isError: false, output: 'https://github.com/acme/demo/pull/7\n', durationMs: 1 } });

    expect(store.getState().tabs[0]?.prNumber).toBe(7);
    expect(mage.ghWatch).toHaveBeenCalledWith({ cwd: 'C:\\proyecto', accountDir: 'C:\\Users\\u\\.claude', key: 'a', number: 7 });
  });

  it('handleEvent_urlDeUnBashQueNoEsGhPrCreate_noVincula', () => {
    const { store } = prStore();

    store.getState().handleEvent('s-a', { kind: 'tool_use', tool: { toolUseId: 'u1', toolName: 'Bash', input: { command: 'cat notas.md' } } });
    store.getState().handleEvent('s-a', { kind: 'tool_result', result: { toolUseId: 'u1', isError: false, output: 'https://github.com/acme/demo/pull/7', durationMs: 1 } });

    expect(store.getState().tabs[0]?.prNumber).toBeUndefined();
  });

  it('handleEvent_marcaPrCreated_vincula', () => {
    const { store } = prStore();

    store.getState().handleEvent('s-a', { kind: 'assistant_text', text: 'Hecho: <pr-created>https://github.com/acme/demo/pull/9</pr-created>' });

    expect(store.getState().tabs[0]?.prNumber).toBe(9);
  });

  it('handleEvent_pushForzadoEnElTurnoDePr_loDeniegaSinTarjeta', () => {
    const answerPermission = vi.fn().mockResolvedValue(undefined);
    const { store } = prStore({ answerPermission });
    store.setState({ prGuardByChat: { a: true } });
    const request = { requestId: 'r1', toolUseId: 'u1', toolName: 'Bash', input: { command: 'git push --force' }, description: null, requiresUserInteraction: false, displayName: null };

    store.getState().handleEvent('s-a', { kind: 'permission_request', request });

    expect(answerPermission).toHaveBeenCalledWith({ sessionId: 's-a', requestId: 'r1', decision: { behavior: 'deny', message: expect.stringContaining('git push --force') } });
    expect(store.getState().pendingByChat['a'] ?? []).toEqual([]);
  });

  it('handleEvent_pushForzadoFueraDelTurnoDePr_pideComoSiempre', () => {
    const answerPermission = vi.fn();
    const { store } = prStore({ answerPermission, notify: vi.fn().mockResolvedValue(undefined) });
    const request = { requestId: 'r1', toolUseId: 'u1', toolName: 'Bash', input: { command: 'git push --force' }, description: null, requiresUserInteraction: false, displayName: null };

    store.getState().handleEvent('s-a', { kind: 'permission_request', request });

    expect(answerPermission).not.toHaveBeenCalled();
    expect(store.getState().pendingByChat['a']).toHaveLength(1);
  });

  it('insertCreatePrPrompt_dejaElPromptSinEnviar', () => {
    const { store } = prStore();
    store.setState({ statusByChat: {} });

    store.getState().insertCreatePrPrompt('a');

    expect(store.getState().draftByChat['a']?.text).toContain('gh pr create');
    expect(store.getState().statusByChat['a']).toBeUndefined();
  });

  it('applyGhPrUpdate_ciTerminadoYAutoFix_avisaYEncolaElEventoUnaVez', () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const { store } = prStore({ notify });
    store.setState({ tabs: [tab('a', { prNumber: 7, prAutoFix: true })] });

    store.getState().applyGhPrUpdate({ key: 'a', snapshot: { kind: 'pr', pr: PR }, ciFinished: true });
    store.getState().applyGhPrUpdate({ key: 'a', snapshot: { kind: 'pr', pr: PR }, ciFinished: false });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'CI terminado' }));
    const queued = store.getState().queuedByChat['a'] ?? [];
    expect(queued).toHaveLength(1);
    expect(queued[0]?.text).toContain('<ci-monitor-event>');
  });

  it('applyGhPrUpdate_deOtroPr_seDescarta', () => {
    const { store } = prStore();
    store.setState({ tabs: [tab('a', { prNumber: 3 })] });

    store.getState().applyGhPrUpdate({ key: 'a', snapshot: { kind: 'pr', pr: PR }, ciFinished: false });

    expect(store.getState().prByTab['a']).toBeUndefined();
  });

  it('unbindPr_loQuitaLoRecuerdaYDejaDeVigilar', () => {
    const { store, mage } = prStore();
    store.setState({ tabs: [tab('a', { prNumber: 7, prAutoFix: true })] });

    store.getState().unbindPr('a');

    expect(store.getState().tabs[0]).toMatchObject({ prDismissed: 7 });
    expect(store.getState().tabs[0]?.prNumber).toBeUndefined();
    expect(mage.ghUnwatch).toHaveBeenCalledWith('a');
  });

  it('refreshPr_ramaConPrAbierto_loVinculaSalvoQueSeQuitara', async () => {
    const ghBranchPr = vi.fn().mockResolvedValue({ kind: 'pr', pr: PR });
    const { store } = prStore({ ghBranchPr });
    store.setState({ tabs: [tab('a'), tab('b', { prDismissed: 7 })] });

    await store.getState().refreshPr('a');
    await store.getState().refreshPr('b');

    expect(store.getState().tabs.map((t) => t.prNumber)).toEqual([7, undefined]);
  });
});

// Grupo D, bloque 3: el worktree se crea al arrancar la primera sesion y se archiva al cerrar.
describe('worktree de la pestaña (grupo D)', () => {
  const REPO_SNAPSHOT = { kind: 'repo' as const, branch: 'main', detached: false, headShort: 'abc1234', upstream: null, ahead: 0, behind: 0, dirty: false, added: 0, removed: 0, changedFiles: 0, untracked: 0 };
  const WT = 'C:/proyecto/.claude/worktrees/arreglar-el-login';

  function sessionMage(over: Partial<MageApi> = {}) {
    return {
      createSession: vi.fn().mockResolvedValue({ sessionId: 's-1', configDir: 'C:/Users/u/.claude' }),
      isFolderTrusted: vi.fn().mockResolvedValue(true),
      saveWorkspace: vi.fn().mockResolvedValue(undefined),
      saveConversationPrefs: vi.fn().mockResolvedValue(undefined),
      worktreeCreate: vi.fn().mockResolvedValue({ path: WT, branch: 'claude/arreglar-el-login' }),
      worktreeRestore: vi.fn().mockResolvedValue(undefined),
      ...over,
    };
  }

  function withRepo(mage: ReturnType<typeof sessionMage>, over: Partial<Tab> = {}) {
    const store = createWorkbenchStore(fakeMage(mage));
    store.setState({
      tabs: [tab('a', { cwd: 'C:/proyecto', ...over })],
      activeTabId: 'a',
      splitLayout: singleLeaf('a'),
      gitByCwd: { 'C:/proyecto': { snapshot: REPO_SNAPSHOT, branches: ['main'], error: null } },
      blocksByChat: { a: [{ kind: 'user', id: 'b1', text: 'Arreglar el login', time: '10:00', attachments: [] }] },
    });
    return store;
  }

  it('ensureSession_conversacionNuevaEnUnRepo_creaElWorktreeYArrancaAlli', async () => {
    const mage = sessionMage();
    const store = withRepo(mage);

    await store.getState().ensureSession('a');

    expect(mage.worktreeCreate).toHaveBeenCalledWith({ cwd: 'C:/proyecto', accountDir: 'C:\\Users\\u\\.claude', base: 'main', firstMessage: 'Arreglar el login' });
    expect(mage.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: WT }));
    expect(store.getState().tabs[0]?.cwd).toBe(WT);
  });

  it('ensureSession_casillaDesmarcada_trabajaEnLaCarpeta', async () => {
    const mage = sessionMage();
    const store = withRepo(mage, { worktreeOff: true });

    await store.getState().ensureSession('a');

    expect(mage.worktreeCreate).not.toHaveBeenCalled();
    expect(mage.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'C:/proyecto' }));
  });

  it('ensureSession_conversacionReabiertaDeUnWorktree_loRecreaSinCrearOtro', async () => {
    const mage = sessionMage();
    const store = withRepo(mage, { cwd: WT, resumeSessionId: 's-0' });

    await store.getState().ensureSession('a');

    expect(mage.worktreeRestore).toHaveBeenCalledWith({ cwd: WT, accountDir: 'C:\\Users\\u\\.claude' });
    expect(mage.worktreeCreate).not.toHaveBeenCalled();
  });

  it('closeTab_pestañaEnUnWorktree_loArchiva', async () => {
    const worktreeRemove = vi.fn().mockResolvedValue({ removed: true });
    const store = createWorkbenchStore(fakeMage({ worktreeRemove, saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a', { cwd: WT })], activeTabId: 'a', splitLayout: singleLeaf('a') });

    await store.getState().closeTab('a');

    expect(worktreeRemove).toHaveBeenCalledWith({ cwd: WT, accountDir: 'C:\\Users\\u\\.claude' });
  });

  it('closeTab_worktreeConCambios_avisaDeQueSeConservaYDonde', async () => {
    // Arrange
    const worktreeRemove = vi.fn().mockResolvedValue({ removed: false, reason: 'dirty' });
    const store = createWorkbenchStore(fakeMage({ worktreeRemove, saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a', { cwd: WT })], activeTabId: 'a', splitLayout: singleLeaf('a') });

    // Act
    await store.getState().closeTab('a');

    // Assert
    await vi.waitFor(() => expect(keptWorktreeToasts()).toHaveLength(1));
    const [toast] = keptWorktreeToasts();
    expect(toast).toMatchObject({ level: 'warning', body: WT, title: 'Worktree conservado: tiene cambios sin confirmar', timeoutMs: 10_000 });
    expect(toast?.actions.map((a) => a.label)).toEqual(['Abrir carpeta', 'Copiar ruta']);
  });

  it('closeTab_worktreeLimpio_noAvisa', async () => {
    // Arrange
    const worktreeRemove = vi.fn().mockResolvedValue({ removed: true });
    const store = createWorkbenchStore(fakeMage({ worktreeRemove, saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a', { cwd: WT })], activeTabId: 'a', splitLayout: singleLeaf('a') });

    // Act
    await store.getState().closeTab('a');
    await vi.waitFor(() => expect(worktreeRemove).toHaveBeenCalled());

    // Assert
    expect(keptWorktreeToasts()).toHaveLength(0);
  });

  it('handleEvent_turnoEnPestañaNoVisibleConFoco_avisaConToastQueLlevaALaPestaña', () => {
    // Arrange
    vi.stubGlobal('document', { hasFocus: () => true });
    const store = createWorkbenchStore(fakeMage({ notify: vi.fn().mockResolvedValue(undefined), getUsage: vi.fn().mockResolvedValue(null) }));
    store.setState({ tabs: [tab('a'), tab('b')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a', b: 's-b' } });

    // Act
    store.getState().handleEvent('s-b', { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });
    store.getState().handleEvent('s-a', { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });
    vi.unstubAllGlobals();

    // Assert: solo la de la pestaña que no se ve
    const toasts = useNotificationStore.getState().toasts.filter((n) => n.source === 'conversation');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ level: 'success', title: 'Turno completado', body: 'Conversacion b' });
    void toasts[0]?.actions[0]?.run();
    expect(store.getState().activeTabId).toBe('b');
  });

  it('handleEvent_sinFocoDeLaVentana_noSacaToast', () => {
    // Arrange
    vi.stubGlobal('document', { hasFocus: () => false });
    const store = createWorkbenchStore(fakeMage({ notify: vi.fn().mockResolvedValue(undefined), getUsage: vi.fn().mockResolvedValue(null) }));
    store.setState({ tabs: [tab('a'), tab('b')], activeTabId: 'a', splitLayout: singleLeaf('a'), sessionIdByChat: { a: 's-a', b: 's-b' } });

    // Act
    store.getState().handleEvent('s-b', { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });
    vi.unstubAllGlobals();

    // Assert
    expect(useNotificationStore.getState().toasts.filter((n) => n.source === 'conversation')).toHaveLength(0);
  });

  it('applyGhPrUpdate_prFusionadoConAutoArchivo_cierraLaPestañaParada', async () => {
    const store = createWorkbenchStore(fakeMage({ ghUnwatch: vi.fn().mockResolvedValue(undefined), saveWorkspace: vi.fn().mockResolvedValue(undefined), listConversations: vi.fn().mockResolvedValue([]) }));
    store.setState({ tabs: [tab('a', { prNumber: 7 })], activeTabId: 'a', splitLayout: singleLeaf('a'), settings: { ...store.getState().settings, autoArchiveOnPrClose: true } });
    const merged = { number: 7, title: 't', url: 'https://github.com/a/b/pull/7', state: 'merged' as const, isDraft: false, headRefName: 'f', headSha: 's', baseRefName: 'main', mergeable: 'unknown' as const, mergeStateStatus: '', reviewDecision: null, autoMerge: false, checks: [], summary: { pending: 0, pass: 0, fail: 0, skip: 0, cancel: 0 } };

    store.getState().applyGhPrUpdate({ key: 'a', snapshot: { kind: 'pr', pr: merged }, ciFinished: false });

    await vi.waitFor(() => expect(store.getState().tabs).toEqual([]));
  });
});

// El store de notificaciones es de modulo: se vacia antes de cada test para no depender del orden.
beforeEach(() => useNotificationStore.setState(EMPTY_NOTIFICATIONS, true));

function keptWorktreeToasts(): ReturnType<typeof useNotificationStore.getState>['toasts'] {
  return useNotificationStore.getState().toasts.filter((n) => n.dedupeKey?.startsWith('worktree-kept:') === true);
}
