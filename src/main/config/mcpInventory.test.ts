import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyImportPicks,
  buildImportCandidates,
  buildInventory,
  mcpCommonVersion,
  readMcpSources,
  resolveClaudeDesktopDirs,
  type McpInventoryDeps,
  type McpSourceLocations,
} from './mcpInventory';

// FS en memoria: ruta -> texto; los directorios se deducen de las rutas.
function memoryFs(files: Record<string, string>): McpInventoryDeps {
  const has = (path: string): boolean => path in files || Object.keys(files).some((f) => f.startsWith(path + sep));
  return {
    exists: has,
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    listDir: (path) => [...new Set(Object.keys(files).filter((f) => f.startsWith(path + sep)).map((f) => f.slice(path.length + 1).split(sep)[0]!))],
  };
}

const ROOT = join(sep, 'fake');
const HOME = join(ROOT, 'home');
const MAIN_DIR = join(HOME, '.claude');
const SECOND_DIR = join(HOME, '.claude-p');
const COMMON = join(ROOT, 'userData', 'shared-config', 'mcp-common.json');
const LEGACY = join(MAIN_DIR, 'mcp-shared.json');
const PROJECT = join(ROOT, 'src', 'mage');
const DESKTOP = join(ROOT, 'Claude');
const EXT_DIR = join(DESKTOP, 'Claude Extensions', 'local.mcpb.x.db');
const AGY = join(HOME, '.gemini', 'config', 'mcp_config.json');

const LOCAL = { type: 'stdio', command: 'npx', args: ['-y', 'a'], env: { A_TOKEN: 'secreto-a' } };
const REMOTE = { type: 'http', url: 'https://r.dev/mcp', headers: { Authorization: 'Bearer secreto-r' } };

const locations = (patch: Partial<McpSourceLocations> = {}): McpSourceLocations => ({
  commonPath: COMMON,
  legacySharedPath: null,
  accounts: [
    { configDir: MAIN_DIR, label: 'claude', stateFile: join(HOME, '.claude.json') },
    { configDir: SECOND_DIR, label: 'claude-p', stateFile: join(SECOND_DIR, '.claude.json') },
  ],
  projectDirs: [PROJECT],
  desktopDirs: [DESKTOP],
  agyConfigPath: AGY,
  agyExported: [],
  codex: [],
  ...patch,
});

// Un .claude.json real trae oauthAccount/userID junto a mcpServers.
const stateFile = (servers: Record<string, unknown>, projects: Record<string, unknown> = {}): string =>
  JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' }, userID: 'id-secreto', mcpServers: servers, projects });

const fullMachine = (): Record<string, string> => ({
  [COMMON]: JSON.stringify({ mcpServers: { comun: LOCAL }, mageDisabledServers: { apagado: LOCAL } }),
  [join(HOME, '.claude.json')]: stateFile({ comun: LOCAL, solo: REMOTE }, { [PROJECT]: { mcpServers: { local: LOCAL } } }),
  [join(SECOND_DIR, '.claude.json')]: stateFile({}),
  [join(PROJECT, '.mcp.json')]: JSON.stringify({ mcpServers: { proyecto: REMOTE } }),
  [join(DESKTOP, 'claude_desktop_config.json')]: JSON.stringify({ preferences: {}, mcpServers: { escritorio: LOCAL } }),
  [join(EXT_DIR, 'manifest.json')]: JSON.stringify({
    name: 'db',
    server: { mcp_config: { command: '${__dirname}${/}bin${/}db.exe', args: [], env: {} } },
  }),
  [join(DESKTOP, 'Claude Extensions Settings', 'local.mcpb.x.db.json')]: JSON.stringify({ isEnabled: true }),
  [LEGACY]: `﻿${JSON.stringify({ mcpServers: { viejo: LOCAL } })}`,
});

const inventoryOf = (files: Record<string, string>, patch: Partial<McpSourceLocations> = {}) =>
  buildInventory(readMcpSources(memoryFs(files), locations(patch)), [MAIN_DIR, SECOND_DIR], null);

describe('readMcpSources + buildInventory', () => {
  it('buildInventory_todasLasFuentes_unaFilaPorNombreConSusOrigenes', () => {
    const inventory = inventoryOf(fullMachine());

    const byName = Object.fromEntries(inventory.rows.map((row) => [row.name, row]));
    expect(Object.keys(byName).sort()).toEqual(['apagado', 'comun', 'escritorio', 'local', 'proyecto', 'solo']);
    expect(byName.comun!.origins.map((o) => o.kind)).toEqual(['common', 'account']);
    expect(byName.local!.origins[0]).toMatchObject({ kind: 'projectLocal', projectDir: PROJECT, label: 'Local de mage' });
    expect(byName.proyecto!.transport).toBe('http');
    expect(byName.escritorio!.origins[0]!.kind).toBe('desktop');
  });

  it('buildInventory_cuentasQueLoCargan_segunElOrigen', () => {
    const byName = Object.fromEntries(inventoryOf(fullMachine()).rows.map((row) => [row.name, row]));

    expect(byName.comun!.accounts).toEqual([MAIN_DIR, SECOND_DIR]);
    expect(byName.solo!.accounts).toEqual([MAIN_DIR]);
    expect(byName.proyecto!.accounts).toEqual([MAIN_DIR, SECOND_DIR]);
    expect(byName.escritorio!.accounts).toEqual([]);
    expect(byName.apagado!.accounts).toEqual([]);
    expect(byName.apagado!.disabled).toBe(true);
  });

  it('buildInventory_nuncaLlevaValoresNiDatosDeLaCuenta', () => {
    const serialized = JSON.stringify(inventoryOf(fullMachine()));

    expect(serialized).not.toContain('secreto');
    expect(serialized).not.toContain('a@b.c');
    expect(serialized).toContain('A_TOKEN');
    expect(serialized).toContain('Authorization');
  });

  it('buildInventory_comunRemoto_traeSuVistaSinCabeceras', () => {
    const files = { [COMMON]: JSON.stringify({ mcpServers: { r: REMOTE } }) };

    const [row] = inventoryOf(files).rows;

    expect(row!.common).toEqual({ transport: 'http', command: '', args: [], url: REMOTE.url });
    expect(row!.headerKeys).toEqual(['Authorization']);
  });

  it('buildInventory_legadoNoEntraEnElInventario', () => {
    expect(inventoryOf(fullMachine(), { legacySharedPath: LEGACY }).rows.map((r) => r.name)).not.toContain('viejo');
  });

  it('buildInventory_extensionDeDesktop_noEsFila', () => {
    expect(inventoryOf(fullMachine()).rows.map((row) => row.name)).not.toContain('db');
  });

  it('buildInventory_proveedores_comunEnTodosMenosAgyYLoDeUnaCuentaSoloClaude', () => {
    const byName = Object.fromEntries(inventoryOf(fullMachine()).rows.map((row) => [row.name, row]));

    expect(byName.comun).toMatchObject({ providers: ['claude', 'codex', 'local'], ownedBy: null, onlyIn: null, exportedToAgy: false });
    expect(byName.solo).toMatchObject({ providers: ['claude'], ownedBy: 'claude' });
    expect(byName.escritorio).toMatchObject({ providers: [], ownedBy: null });
    expect(byName.apagado!.providers).toEqual([]);
  });

  it('buildInventory_comunConSoloEnYExportadoAAgy_pastillasDeEseAlcance', () => {
    const files = { [COMMON]: JSON.stringify({ mcpServers: { a: LOCAL }, mageOnlyIn: { a: ['agy', 'claude|' + MAIN_DIR] } }) };

    const [row] = buildInventory(readMcpSources(memoryFs(files), locations()), [MAIN_DIR], null, ['a']).rows;

    expect(row).toMatchObject({ providers: ['claude', 'agy'], onlyIn: ['agy', 'claude|' + MAIN_DIR], exportedToAgy: true });
  });

  it('buildInventory_comunSse_noLlegaACodexNiAgy', () => {
    const files = { [COMMON]: JSON.stringify({ mcpServers: { s: { type: 'sse', url: 'https://s.dev' } } }) };

    expect(inventoryOf(files).rows[0]!.providers).toEqual(['claude', 'local']);
  });

  it('buildInventory_mcpConfigDeAgy_filaSoloAgySinLoQueExportoMage', () => {
    const files = {
      [AGY]: JSON.stringify({ mcpServers: { suyo: { serverUrl: 'https://a.dev', headers: { K: 'secreto-agy' } }, mio: { command: 'x' } } }),
    };

    const rows = inventoryOf(files, { agyExported: ['mio'] }).rows;

    expect(rows.map((row) => row.name)).toEqual(['suyo']);
    expect(rows[0]).toMatchObject({ transport: 'http', ownedBy: 'agy', headerKeys: ['K'] });
    expect(JSON.stringify(rows)).not.toContain('secreto');
  });

  it('buildInventory_codex_filaSoloCodexConSuCuenta', () => {
    const codex = [{ label: 'config.toml de codex', path: '/c/config.toml', accountDir: '/c', servers: [{ name: 'cx', enabled: false, authStatus: null, config: { type: 'stdio', command: 'node' } }] }];

    const [row] = inventoryOf({}, { codex }).rows;

    expect(row).toMatchObject({ name: 'cx', ownedBy: 'codex', providers: ['codex'] });
    expect(row!.origins[0]).toMatchObject({ kind: 'codex', accountDir: '/c' });
  });

  it('buildInventory_ficheroInvalido_avisaSinContenidoYSigue', () => {
    const files = { ...fullMachine(), [join(SECOND_DIR, '.claude.json')]: '{"userID": "id-secreto"' };

    const inventory = inventoryOf(files);

    expect(inventory.warnings).toHaveLength(1);
    expect(inventory.warnings[0]).toContain('no es JSON válido');
    expect(inventory.warnings[0]).not.toContain('secreto');
    expect(inventory.rows.length).toBeGreaterThan(0);
  });

  it('buildInventory_sinNingunFichero_vacio', () => {
    expect(inventoryOf({})).toEqual({ rows: [], unshared: [], commonVersion: null, warnings: [] });
  });

  it('buildInventory_mcpDeCuentaFueraDeComunes_seAvisa', () => {
    expect(inventoryOf(fullMachine()).unshared).toEqual([{ accountDir: MAIN_DIR, names: ['solo'] }]);
  });
});

describe('resolveClaudeDesktopDirs', () => {
  const ctx = (platform: NodeJS.Platform, env: Record<string, string>, existing: readonly string[], packages: readonly string[] = []) => ({
    platform,
    env,
    homedir: HOME,
    exists: (path: string) => existing.includes(path),
    listDir: () => packages,
  });

  it('resolveClaudeDesktopDirs_windowsMsix_recorrePackages', () => {
    const appData = join(ROOT, 'AppData', 'Roaming');
    const local = join(ROOT, 'AppData', 'Local');
    const msix = join(local, 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming', 'Claude');

    const dirs = resolveClaudeDesktopDirs(ctx('win32', { APPDATA: appData, LOCALAPPDATA: local }, [join(local, 'Packages'), msix], ['Claude_abc123', 'Otra_1']));

    expect(dirs).toEqual([msix]);
  });

  it('resolveClaudeDesktopDirs_windowsClasica_appData', () => {
    const appData = join(ROOT, 'AppData', 'Roaming');

    expect(resolveClaudeDesktopDirs(ctx('win32', { APPDATA: appData }, [join(appData, 'Claude')]))).toEqual([join(appData, 'Claude')]);
  });

  it('resolveClaudeDesktopDirs_macYLinux_rutasDeSuSo', () => {
    const mac = join(HOME, 'Library', 'Application Support', 'Claude');
    const linux = join(HOME, '.config', 'Claude');

    expect(resolveClaudeDesktopDirs(ctx('darwin', {}, [mac]))).toEqual([mac]);
    expect(resolveClaudeDesktopDirs(ctx('linux', {}, [linux]))).toEqual([linux]);
  });

  it('resolveClaudeDesktopDirs_noInstalado_vacio', () => {
    expect(resolveClaudeDesktopDirs(ctx('win32', {}, []))).toEqual([]);
  });
});

describe('buildImportCandidates', () => {
  const candidatesOf = (files: Record<string, string>) =>
    buildImportCandidates(readMcpSources(memoryFs(files), locations({ legacySharedPath: LEGACY })).entries);

  it('buildImportCandidates_estados_nuevoIgualYDistinto', () => {
    const files = {
      ...fullMachine(),
      [join(SECOND_DIR, '.claude.json')]: stateFile({ comun: { ...LOCAL, command: 'node' } }),
    };

    const status = candidatesOf(files).map((c) => `${c.name}@${c.originLabel}:${c.status}`);

    expect(status).toContain('comun@Cuenta claude:same');
    expect(status).toContain('comun@Cuenta claude-p:different');
    expect(status).toContain('solo@Cuenta claude:new');
  });

  it('buildImportCandidates_mismaConfigEnOtroOrden_esIgual', () => {
    const files = {
      [COMMON]: JSON.stringify({ mcpServers: { a: { command: 'npx', type: 'stdio' } } }),
      [join(SECOND_DIR, '.claude.json')]: stateFile({ a: { type: 'stdio', command: 'npx' } }),
    };

    expect(candidatesOf(files)[0]!.status).toBe('same');
  });

  it('buildImportCandidates_localDeProyecto_desmarcadoYConNota', () => {
    const local = candidatesOf(fullMachine()).find((c) => c.name === 'local')!;

    expect(local.checkedByDefault).toBe(false);
    expect(local.note).toBe(`Era de proyecto ${PROJECT}`);
  });

  it('buildImportCandidates_grupos_desktopYCli', () => {
    const groups = Object.fromEntries(candidatesOf(fullMachine()).map((c) => [c.name, c.group]));

    expect(groups).toMatchObject({ escritorio: 'desktop', viejo: 'cli', solo: 'cli', proyecto: 'cli' });
    expect(groups.db).toBeUndefined();
  });

  it('buildImportCandidates_sinValores', () => {
    expect(JSON.stringify(candidatesOf(fullMachine()))).not.toContain('secreto');
  });
});

describe('applyImportPicks', () => {
  const setup = () => {
    const read = readMcpSources(memoryFs(fullMachine()), locations({ legacySharedPath: LEGACY }));
    const idOf = (name: string, kind: string) => read.entries.find((e) => e.name === name && e.origin.kind === kind)!.origin.importId;
    return { entries: read.entries, idOf, text: fullMachine()[COMMON]! };
  };

  it('applyImportPicks_soloLoElegido_seAnade', () => {
    const { entries, idOf, text } = setup();

    const result = JSON.parse(applyImportPicks(text, entries, [{ id: idOf('solo', 'account'), replace: false }]).text);

    expect(Object.keys(result.mcpServers)).toEqual(['comun', 'solo']);
    expect(result.mcpServers.solo).toEqual(REMOTE);
    expect(result.mageDisabledServers).toEqual({ apagado: LOCAL });
  });

  it('applyImportPicks_existenteSinSustituir_ganaElActual', () => {
    const { entries, text } = setup();
    const other = { ...entries.find((e) => e.name === 'escritorio')!, name: 'comun', config: { command: 'otro' } };
    const id = other.origin.importId;

    const result = JSON.parse(applyImportPicks(text, [...entries, { ...other, origin: { ...other.origin, importId: `${id}#2` } }], [{ id: `${id}#2`, replace: false }]).text);

    expect(result.mcpServers.comun).toEqual(LOCAL);
  });

  it('applyImportPicks_sustituir_pisaElComunYUnDesactivadoSigueDesactivado', () => {
    const { entries, text } = setup();
    const base = entries.find((e) => e.name === 'escritorio')!;
    const clone = (name: string, suffix: string) => ({ ...base, name, config: { command: name }, origin: { ...base.origin, importId: `${base.origin.importId}${suffix}` } });
    const extra = [clone('comun', '#c'), clone('apagado', '#a')];

    const picks = extra.map((e) => ({ id: e.origin.importId, replace: true }));
    const result = JSON.parse(applyImportPicks(text, [...entries, ...extra], picks).text);

    expect(result.mcpServers.comun).toEqual({ command: 'comun' });
    expect(result.mageDisabledServers.apagado).toEqual({ command: 'apagado' });
  });

  it('applyImportPicks_mismoNombreDosVeces_ganaElPrimeroYLoAvisa', () => {
    const { entries, idOf, text } = setup();
    const picks = [idOf('local', 'projectLocal'), idOf('escritorio', 'desktop')].map((id) => ({ id, replace: false }));
    const renamed = entries.map((e) => (e.name === 'escritorio' ? { ...e, name: 'local' } : e));

    const result = applyImportPicks(text, renamed, picks);

    expect(JSON.parse(result.text).mcpServers.local).toEqual(LOCAL);
    expect(result.notes).toEqual(['«local» venía de dos sitios: se queda el primero elegido.']);
  });

  it('applyImportPicks_idDesconocido_lanzaYNoEscribe', () => {
    const { entries, text } = setup();

    expect(() => applyImportPicks(text, entries, [{ id: 'no-existe', replace: false }])).toThrow('no-existe');
  });

  it('applyImportPicks_sinComunPrevio_creaElFichero', () => {
    const { entries, idOf } = setup();

    const result = JSON.parse(applyImportPicks('{"mcpServers": {}}', entries, [{ id: idOf('viejo', 'legacy'), replace: false }]).text);

    expect(result).toEqual({ mcpServers: { viejo: LOCAL } });
  });
});

describe('mcpCommonVersion', () => {
  it('mcpCommonVersion_ausente_null', () => {
    expect(mcpCommonVersion(null)).toBeNull();
  });

  it('mcpCommonVersion_cambiaConElContenido', () => {
    expect(mcpCommonVersion('a')).not.toBe(mcpCommonVersion('b'));
    expect(mcpCommonVersion('a')).toBe(mcpCommonVersion('a'));
  });
});
