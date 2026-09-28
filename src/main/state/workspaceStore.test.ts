import { describe, expect, it, vi } from 'vitest';
import type { PersistedWorkspace } from '@shared/state';
import { WorkspaceStore, type WorkspaceStoreDeps } from './workspaceStore';

const FILE = 'C:\\userData\\workspace-state.json';

function buildDeps(overrides: Partial<WorkspaceStoreDeps> = {}): WorkspaceStoreDeps {
  return {
    filePath: FILE,
    exists: () => true,
    readFile: () => '{}',
    writeFile: () => undefined,
    rename: () => undefined,
    tempSuffix: () => 'suf',
    ...overrides,
  };
}

const validState: PersistedWorkspace = {
  version: 1,
  activeTabId: 'tab1',
  tabs: [{ id: 'tab1', accountId: '.claude', accountAlias: 'main', cwd: '/p', model: 'opus', provider: 'claude', title: 'p', privacy: 'shared', sessionId: 's1' }],
};

describe('WorkspaceStore.load', () => {
  it('ficheroNoExiste_devuelveNull', () => {
    const store = new WorkspaceStore(buildDeps({ exists: () => false }));

    expect(store.load()).toBeNull();
  });

  it('jsonCorrupto_devuelveNullSinLanzar', () => {
    const store = new WorkspaceStore(buildDeps({ readFile: () => '{no es json' }));

    expect(store.load()).toBeNull();
  });

  it('estadoQueNoEncajaElEsquema_devuelveNull', () => {
    const store = new WorkspaceStore(buildDeps({ readFile: () => JSON.stringify({ version: 1, tabs: 'nope' }) }));

    expect(store.load()).toBeNull();
  });

  it('estadoValido_loDevuelveParseado', () => {
    const store = new WorkspaceStore(buildDeps({ readFile: () => JSON.stringify(validState) }));

    expect(store.load()).toEqual(validState);
  });

  it('load_pestanaEnModoAuto_parsea', () => {
    // P-026 2.3: un modo nuevo del ciclo guardado por esta version se restaura tal cual.
    const conAuto = { ...validState, tabs: [{ ...validState.tabs[0]!, permissionMode: 'auto' }] };
    const store = new WorkspaceStore(buildDeps({ readFile: () => JSON.stringify(conAuto) }));

    expect(store.load()?.tabs[0]?.permissionMode).toBe('auto');
  });

  it('load_pestanaConModoDesconocido_loDescartaSinPerderElWorkspace', () => {
    const raro = { ...validState, tabs: [{ ...validState.tabs[0]!, permissionMode: 'dontAsk' }] };
    const store = new WorkspaceStore(buildDeps({ readFile: () => JSON.stringify(raro) }));

    const loaded = store.load();

    expect(loaded?.tabs).toHaveLength(1);
    expect(loaded?.tabs[0]?.permissionMode).toBeUndefined();
  });
});

describe('WorkspaceStore.save', () => {
  it('estadoValido_escribeEnTmpYRenombraAtomicamente', () => {
    const writeFile = vi.fn();
    const rename = vi.fn();
    const store = new WorkspaceStore(buildDeps({ writeFile, rename }));

    store.save(validState);

    expect(writeFile).toHaveBeenCalledWith(`${FILE}.suf.tmp`, expect.stringContaining('"tab1"'));
    expect(rename).toHaveBeenCalledWith(`${FILE}.suf.tmp`, FILE);
  });

  it('save_dosEscriturasConcurrentes_usanTemporalesDistintos', () => {
    // Sin sufijo unico, dos instancias comparten el mismo tmp: el rename de una publica el fichero a
    // medio escribir de la otra y load() devuelve null (todas las pestanas perdidas, en silencio).
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    let call = 0;
    const buildStore = (): WorkspaceStore =>
      new WorkspaceStore(
        buildDeps({
          tempSuffix: () => `uuid-${++call}`,
          writeFile: (path) => writes.push(path),
          rename: (from, to) => renames.push([from, to]),
        }),
      );

    buildStore().save(validState);
    buildStore().save(validState);

    expect(new Set(writes).size).toBe(2); // ningun temporal compartido
    expect(renames.every(([, to]) => to === FILE)).toBe(true); // ambos publican el destino real
  });

  it('estadoInvalido_lanzaYNoEscribe_splitDirectionInvalido', () => {
    const writeFile = vi.fn();
    const store = new WorkspaceStore(buildDeps({ writeFile }));

    expect(() =>
      store.save({ ...validState, splitTabId: 'tab1', splitDirection: 'diagonal' } as unknown as PersistedWorkspace),
    ).toThrow(/invalido/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('estadoInvalido_lanzaYNoEscribe', () => {
    const writeFile = vi.fn();
    const store = new WorkspaceStore(buildDeps({ writeFile }));

    // tabs no es un array -> viola el esquema.
    expect(() => store.save({ version: 1, activeTabId: 'x', tabs: 'nope' } as unknown as PersistedWorkspace)).toThrow(/invalido/i);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

// El grupo que FALTABA, y que habria cazado el defecto: los cuatro campos de la Ronda 3 estaban en el
// tipo pero no en el esquema, y Zod borra las claves desconocidas al cargar Y al guardar — asi que
// anclar una pestaña, darle color o dividir el workspace no sobrevivia a un reinicio. Se mide el CICLO
// completo (guardar -> leer lo escrito), no solo una de las dos mitades: el defecto se caia en las dos.
describe('WorkspaceStore — ciclo completo save/load (Ronda 3, items 12 y 13)', () => {
  // Guarda `state`, captura lo que se escribio de verdad en disco y lo vuelve a leer con el store.
  function saveAndLoad(state: PersistedWorkspace): PersistedWorkspace | null {
    let written = '';
    const store = new WorkspaceStore(buildDeps({ writeFile: (_path, content) => { written = content; }, readFile: () => written }));
    store.save(state);
    return store.load();
  }

  it('saveYLoad_pestanaAncladaConColor_sobrevivenAlCicloCompleto', () => {
    const tab = { ...validState.tabs[0]!, pinned: true, colorIndex: 3 };

    const loaded = saveAndLoad({ ...validState, tabs: [tab] });

    expect(loaded?.tabs[0]?.pinned).toBe(true);
    expect(loaded?.tabs[0]?.colorIndex).toBe(3);
  });

  it('saveYLoad_workspaceDividido_conservaSplitTabIdYDireccion', () => {
    const loaded = saveAndLoad({ ...validState, splitTabId: 'tab2', splitDirection: 'col' });

    expect(loaded?.splitTabId).toBe('tab2');
    expect(loaded?.splitDirection).toBe('col');
  });

  it('load_estadoSinEsosCampos_cargaIgual', () => {
    // Compatibilidad con un `workspace-state.json` anterior: los cuatro son `.optional()`, asi que no
    // hace falta subir WORKSPACE_STATE_VERSION.
    const store = new WorkspaceStore(buildDeps({ readFile: () => JSON.stringify(validState) }));

    const loaded = store.load();

    expect(loaded).toEqual(validState);
    expect(loaded?.tabs[0]?.pinned).toBeUndefined();
    expect(loaded?.splitTabId).toBeUndefined();
  });

  it('load_colorIndexNegativo_descartaElFicheroEnteroSinLanzar', () => {
    // El esquema es de fichero completo: una pestaña invalida invalida el estado y se arranca limpio
    // (contrato de `load`), en vez de propagar una pestaña a medias al renderer.
    const corrupt = { ...validState, tabs: [{ ...validState.tabs[0]!, colorIndex: -1 }] };
    const store = new WorkspaceStore(buildDeps({ readFile: () => JSON.stringify(corrupt) }));

    expect(store.load()).toBeNull();
  });
});
