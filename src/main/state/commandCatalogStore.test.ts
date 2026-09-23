import { describe, expect, it, vi } from 'vitest';
import type { SlashCommandInfo } from '@shared/events';
import { CommandCatalogStore, type CommandCatalogStoreDeps } from './commandCatalogStore';

const FILE = 'C:\\userData\\command-catalog.json';
const ACCOUNT = 'C:\\Users\\u\\.claude';
const OTHER = 'C:\\Users\\u\\.claude-p';

const COMMANDS: readonly SlashCommandInfo[] = [
  { name: 'compact', description: 'Compacta la conversación', argumentHint: '[instrucciones]', aliases: [] },
  { name: 'itb-skills:itb-core', description: 'Comando de un plugin o skill', argumentHint: null, aliases: ['itb'] },
];

function buildDeps(overrides: Partial<CommandCatalogStoreDeps> = {}): CommandCatalogStoreDeps {
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

// Store con FS en memoria: lo que escribe es lo que lee (el ciclo completo es lo que importa aqui).
function memoryStore(initial = ''): { readonly store: CommandCatalogStore; content: () => string } {
  let content = initial;
  const store = new CommandCatalogStore(
    buildDeps({
      exists: () => content.length > 0,
      readFile: () => content,
      writeFile: (_path, data) => {
        content = data;
      },
    }),
  );
  return { store, content: () => content };
}

describe('CommandCatalogStore.load', () => {
  it('load_ficheroAusente_devuelveCatalogoVacio', () => {
    const store = new CommandCatalogStore(buildDeps({ exists: () => false }));

    expect(store.load(ACCOUNT)).toEqual([]);
  });

  it('load_jsonCorrupto_devuelveVacioSinLanzar', () => {
    const store = new CommandCatalogStore(buildDeps({ readFile: () => '{no es json' }));

    expect(store.load(ACCOUNT)).toEqual([]);
  });

  it('load_versionDesconocida_devuelveVacio', () => {
    // Es cache: una version que no entendemos se descarta entera en vez de interpretarse a medias.
    const file = JSON.stringify({ version: 99, byAccount: { [ACCOUNT]: { measuredAtMs: 1, commands: COMMANDS } } });
    const store = new CommandCatalogStore(buildDeps({ readFile: () => file }));

    expect(store.load(ACCOUNT)).toEqual([]);
  });

  it('load_cuentaSinEntrada_devuelveVacio', () => {
    const { store } = memoryStore();
    store.save(ACCOUNT, COMMANDS, 1_700_000_000_000);

    expect(store.load(OTHER)).toEqual([]);
  });
});

describe('CommandCatalogStore.save', () => {
  it('save_cuentaNueva_noPisaLasDemas', () => {
    const { store } = memoryStore();

    store.save(ACCOUNT, COMMANDS, 1_700_000_000_000);
    store.save(OTHER, [COMMANDS[0]!], 1_700_000_000_001);

    expect(store.load(ACCOUNT)).toEqual(COMMANDS);
    expect(store.load(OTHER)).toEqual([COMMANDS[0]]);
  });

  it('save_mismaCuenta_reescribeElCatalogo', () => {
    // Se REESCRIBE, no se fusiona: un plugin desinstalado tiene que desaparecer del popover.
    const { store } = memoryStore();
    store.save(ACCOUNT, COMMANDS, 1);

    store.save(ACCOUNT, [COMMANDS[0]!], 2);

    expect(store.load(ACCOUNT)).toEqual([COMMANDS[0]]);
  });

  it('save_conservaArgumentHintYAliases', () => {
    const { store } = memoryStore();

    store.save(ACCOUNT, COMMANDS, 1);

    expect(store.load(ACCOUNT)[1]).toEqual({
      name: 'itb-skills:itb-core',
      description: 'Comando de un plugin o skill',
      argumentHint: null,
      aliases: ['itb'],
    });
  });

  it('save_configDirVacio_lanzaConElValorRecibido', () => {
    const writeFile = vi.fn();
    const store = new CommandCatalogStore(buildDeps({ writeFile }));

    expect(() => store.save('', COMMANDS, 1)).toThrow(/config dir vacio.*""/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('save_formaInvalida_lanzaConElDetalle', () => {
    const writeFile = vi.fn();
    const store = new CommandCatalogStore(buildDeps({ writeFile }));

    expect(() => store.save(ACCOUNT, [{ name: 'x' } as unknown as SlashCommandInfo], 1)).toThrow(/invalido/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('save_escribeAtomicamente', () => {
    const writeFile = vi.fn();
    const rename = vi.fn();
    const store = new CommandCatalogStore(buildDeps({ writeFile, rename }));

    store.save(ACCOUNT, COMMANDS, 1);

    expect(writeFile).toHaveBeenCalledWith(`${FILE}.suf.tmp`, expect.stringContaining('compact'));
    expect(rename).toHaveBeenCalledWith(`${FILE}.suf.tmp`, FILE);
  });
});
