import { describe, expect, it, vi } from 'vitest';
import type { MageApi } from '@shared/ipc';
import { createWorkbenchStore } from './workbenchStore';
import { findLeafPath, singleLeaf } from './splitLayout';
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

    store.getState().handleEvent('s-a', { kind: 'result', result: { isError: false, subtype: 'success', costUsd: null, numTurns: 1 } });

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
