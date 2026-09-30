import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ZONE_SIZE_PX, reconcileLayoutWithRegistry, type PanelLayoutState, type PanelPlacement } from '@shared/panelLayout';
import { findDiscardedPanelIds, PanelLayoutStore, type PanelLayoutStoreDeps } from './panelLayoutStore';

const FILE = 'C:\\userData\\panels-layout.json';

// Catalogo de fixture modelado sobre §4.1 del plan (las cinco pestañas de hoy del Inspector + mcp,
// todas en right/a) sin depender del registro REAL del renderer (panelRegistry.ts, con `render` de
// React): estos tests de PanelLayoutStore viven en main y no pueden importar nada bajo src/renderer/
// (medido con tsc -p tsconfig.node.json, ver cabecera de panelLayoutStore.ts).
const CATALOG_V1: readonly PanelPlacement[] = [
  { id: 'conversations', defaultAnchor: 'left', defaultZone: 'a' },
  { id: 'permissions', defaultAnchor: 'right', defaultZone: 'a' },
  { id: 'context', defaultAnchor: 'right', defaultZone: 'a' },
  { id: 'logs', defaultAnchor: 'right', defaultZone: 'a' },
  { id: 'memory', defaultAnchor: 'right', defaultZone: 'a' },
  { id: 'mcp', defaultAnchor: 'right', defaultZone: 'a' },
];

function buildDeps(overrides: Partial<PanelLayoutStoreDeps> = {}): PanelLayoutStoreDeps {
  return {
    filePath: FILE,
    exists: () => true,
    readFile: () => '{}',
    writeFile: () => undefined,
    rename: () => undefined,
    tempSuffix: () => 'suf',
    log: () => undefined,
    ...overrides,
  };
}

describe('PanelLayoutStore.load', () => {
  it('load_ficheroAusente_devuelveElLayoutPorDefectoDelCatalogoV1', () => {
    const store = new PanelLayoutStore(buildDeps({ exists: () => false }));

    const result = store.load(CATALOG_V1);

    expect(result).toEqual(reconcileLayoutWithRegistry(null, CATALOG_V1));
    expect(result.stripes.left.a.panelIds).toEqual(['conversations']);
    expect(result.stripes.right.a.panelIds).toEqual(['permissions', 'context', 'logs', 'memory', 'mcp']);
    expect(result.stripes.right.a.sizePx).toBe(DEFAULT_ZONE_SIZE_PX.right);
  });

  it('load_jsonCorrupto_devuelveElLayoutPorDefectoSinLanzar', () => {
    const store = new PanelLayoutStore(buildDeps({ readFile: () => '{no es json' }));

    const result = store.load(CATALOG_V1);

    expect(result).toEqual(reconcileLayoutWithRegistry(null, CATALOG_V1));
  });

  it('load_ficheroVacio_devuelveElLayoutPorDefecto', () => {
    const store = new PanelLayoutStore(buildDeps({ readFile: () => '{}' }));

    const result = store.load(CATALOG_V1);

    expect(result).toEqual(reconcileLayoutWithRegistry(null, CATALOG_V1));
  });

  it('load_ficheroConFormaAjenaAlEsquema_devuelveElLayoutPorDefecto', () => {
    // Un array o un numero en la raiz no tiene ninguna forma de `stripes`: se trata igual que ausente.
    const store = new PanelLayoutStore(buildDeps({ readFile: () => JSON.stringify([1, 2, 3]) }));

    const result = store.load(CATALOG_V1);

    expect(result).toEqual(reconcileLayoutWithRegistry(null, CATALOG_V1));
  });

  it('load_ficheroConPanelDesconocido_seDescartaYAvisaPorElLog', () => {
    const persisted = {
      version: 1,
      stripes: {
        left: { a: { panelIds: ['conversations'], activePanelId: 'conversations', sizePx: 252 }, b: { panelIds: [], activePanelId: null, sizePx: 252 } },
        right: {
          a: { panelIds: ['permissions', 'un-panel-eliminado'], activePanelId: 'permissions', sizePx: 294 },
          b: { panelIds: [], activePanelId: null, sizePx: 294 },
        },
        bottom: { a: { panelIds: [], activePanelId: null, sizePx: 220 }, b: { panelIds: [], activePanelId: null, sizePx: 220 } },
      },
    };
    const log = vi.fn();
    const store = new PanelLayoutStore(buildDeps({ readFile: () => JSON.stringify(persisted), log }));

    const result = store.load(CATALOG_V1);

    expect(result.stripes.right.a.panelIds).not.toContain('un-panel-eliminado');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('un-panel-eliminado'));
  });

  it('load_ficheroDeUnaVersionAnteriorSinMcp_loAñadeAlReconciliar', () => {
    // Version anterior a que 'mcp' existiera en el catalogo: la zona right/a solo trae las otras
    // cuatro. Al reconciliar contra CATALOG_V1 (que ya incluye 'mcp'), debe añadirse al final.
    const persisted = {
      version: 1,
      stripes: {
        left: { a: { panelIds: ['conversations'], activePanelId: 'conversations', sizePx: 252 }, b: { panelIds: [], activePanelId: null, sizePx: 252 } },
        right: {
          a: { panelIds: ['permissions', 'context', 'logs', 'memory'], activePanelId: 'permissions', sizePx: 294 },
          b: { panelIds: [], activePanelId: null, sizePx: 294 },
        },
        bottom: { a: { panelIds: [], activePanelId: null, sizePx: 220 }, b: { panelIds: [], activePanelId: null, sizePx: 220 } },
      },
    };
    const store = new PanelLayoutStore(buildDeps({ readFile: () => JSON.stringify(persisted) }));

    const result = store.load(CATALOG_V1);

    expect(result.stripes.right.a.panelIds).toEqual(['permissions', 'context', 'logs', 'memory', 'mcp']);
    expect(result.stripes.right.a.activePanelId).toBe('permissions'); // no roba el foco (§3.3)
  });

  it('load_conPanelEscondido_loRespetaYNoLoRepone', () => {
    // Sin `hiddenPanelIds` en el envelope de lectura, Zod lo descartaba y el panel volvia en cada arranque.
    const saved = reconcileLayoutWithRegistry(null, CATALOG_V1);
    const withoutMcp = JSON.stringify({ ...saved, hiddenPanelIds: ['mcp'], stripes: { ...saved.stripes, right: { ...saved.stripes.right, a: { ...saved.stripes.right.a, panelIds: ['permissions', 'context', 'logs', 'memory'] } } } });
    const store = new PanelLayoutStore(buildDeps({ readFile: () => withoutMcp }));

    const result = store.load(CATALOG_V1);

    expect(result.stripes.right.a.panelIds).not.toContain('mcp');
    expect(result.hiddenPanelIds).toEqual(['mcp']);
  });

  it('save_conPanelEscondido_loEscribeEnElFichero', () => {
    const writeFile = vi.fn();
    const store = new PanelLayoutStore(buildDeps({ writeFile }));
    const state: PanelLayoutState = { ...reconcileLayoutWithRegistry(null, CATALOG_V1), hiddenPanelIds: ['mcp'] };

    store.save(state);

    expect(JSON.parse(String(writeFile.mock.calls[0]?.[1])).hiddenPanelIds).toEqual(['mcp']);
  });

  it('load_sinPanelesDesconocidos_noLlamaAlLog', () => {
    const log = vi.fn();
    const store = new PanelLayoutStore(buildDeps({ exists: () => false, log }));

    store.load(CATALOG_V1);

    expect(log).not.toHaveBeenCalled();
  });
});

describe('PanelLayoutStore.save', () => {
  const validState: PanelLayoutState = reconcileLayoutWithRegistry(null, CATALOG_V1);

  it('save_estadoValido_escribeEnTmpYRenombraAtomicamente', () => {
    const writeFile = vi.fn();
    const rename = vi.fn();
    const store = new PanelLayoutStore(buildDeps({ writeFile, rename }));

    store.save(validState);

    expect(writeFile).toHaveBeenCalledWith(`${FILE}.suf.tmp`, expect.stringContaining('"conversations"'));
    expect(rename).toHaveBeenCalledWith(`${FILE}.suf.tmp`, FILE);
  });

  it('save_dosEscriturasConcurrentes_usanTemporalesDistintos', () => {
    // Mismo motivo que WorkspaceStore: un tmp de nombre fijo hace que dos escrituras concurrentes se
    // pisen y el rename de una publique el layout a medio escribir de la otra.
    const writes: string[] = [];
    let call = 0;
    const buildStore = (): PanelLayoutStore => new PanelLayoutStore(buildDeps({ tempSuffix: () => `uuid-${++call}`, writeFile: (path) => writes.push(path) }));

    buildStore().save(validState);
    buildStore().save(validState);

    expect(new Set(writes).size).toBe(2);
  });

  it('save_conSplitPx_loEscribeEnElFichero', () => {
    // Hasta la Fase A se perdia AQUI: el esquema estricto de escritura no declaraba `splitPx`, asi que
    // Zod lo borraba y el reparto entre las dos zonas de un lado volvia al default en cada guardado
    // (la LECTURA si lo respetaba, lo que hacia el sintoma desconcertante).
    let written = '';
    const store = new PanelLayoutStore(buildDeps({ writeFile: (_path, content) => { written = content; } }));
    const custom: PanelLayoutState = { ...validState, stripes: { ...validState.stripes, right: { ...validState.stripes.right, splitPx: 377 } } };

    store.save(custom);

    expect(JSON.parse(written).stripes.right.splitPx).toBe(377);
  });

  it('saveYLoad_splitPx_sobreviveAlCicloCompleto', () => {
    let written = '';
    const store = new PanelLayoutStore(
      buildDeps({ writeFile: (_path, content) => { written = content; }, readFile: () => written }),
    );
    const custom: PanelLayoutState = { ...validState, stripes: { ...validState.stripes, right: { ...validState.stripes.right, splitPx: 377 } } };

    store.save(custom);

    expect(store.load(CATALOG_V1).stripes.right.splitPx).toBe(377);
  });

  it('save_estadoInvalido_lanzaYNoEscribe', () => {
    const writeFile = vi.fn();
    const store = new PanelLayoutStore(buildDeps({ writeFile }));

    expect(() => store.save({ version: 1, stripes: 'nope' } as unknown as PanelLayoutState)).toThrow(/invalido/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('save_zonaSinSizePx_lanzaYNoEscribe', () => {
    const writeFile = vi.fn();
    const store = new PanelLayoutStore(buildDeps({ writeFile }));
    const invalid = { ...validState, stripes: { ...validState.stripes, left: { ...validState.stripes.left, a: { panelIds: [], activePanelId: null } } } };

    expect(() => store.save(invalid as unknown as PanelLayoutState)).toThrow(/invalido/i);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('findDiscardedPanelIds', () => {
  it('findDiscardedPanelIds_rawStripesNull_devuelveVacio', () => {
    expect(findDiscardedPanelIds(null, CATALOG_V1)).toEqual([]);
  });

  it('findDiscardedPanelIds_todosLosIdsExistenEnElRegistro_devuelveVacio', () => {
    const stripes = { left: { a: { panelIds: ['conversations'] }, b: {} }, right: { a: { panelIds: ['mcp'] }, b: {} } };

    expect(findDiscardedPanelIds(stripes, CATALOG_V1)).toEqual([]);
  });

  it('findDiscardedPanelIds_idInexistenteEnUnaZona_loDevuelve', () => {
    const stripes = { left: { a: { panelIds: ['conversations', 'fantasma'] }, b: {} } };

    expect(findDiscardedPanelIds(stripes, CATALOG_V1)).toEqual(['fantasma']);
  });

  it('findDiscardedPanelIds_idInexistenteRepetidoEnVariasZonas_loDevuelveUnaSolaVez', () => {
    const stripes = { left: { a: { panelIds: ['fantasma'] }, b: { panelIds: ['fantasma'] } } };

    expect(findDiscardedPanelIds(stripes, CATALOG_V1)).toEqual(['fantasma']);
  });

  it('findDiscardedPanelIds_stripesVacio_devuelveVacio', () => {
    expect(findDiscardedPanelIds({}, CATALOG_V1)).toEqual([]);
  });

  it('findDiscardedPanelIds_registroVacio_devuelveTodosLosIdsPersistidos', () => {
    const stripes = { left: { a: { panelIds: ['conversations'] }, b: {} } };

    expect(findDiscardedPanelIds(stripes, [])).toEqual(['conversations']);
  });
});
