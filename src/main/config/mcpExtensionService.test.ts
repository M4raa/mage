import { dirname, join, resolve, sep } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { McpExtensionService, type ExtensionFs, type ExtensionServiceDeps } from './mcpExtensionService';
import { toClaudeArgs } from './mcpProviderTranslate';

// FS en memoria: ruta -> bytes. Los directorios se deducen de las rutas (y `mkdir` los recuerda).
function memoryFs(): ExtensionFs & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const under = (path: string): string[] => [...files.keys()].filter((f) => f.startsWith(path + sep));
  return {
    files,
    exists: (path) => files.has(path) || dirs.has(path) || under(path).length > 0,
    readText: (path) => new TextDecoder().decode(read(files, path)),
    readBytes: (path) => read(files, path),
    writeBytes: (path, data) => void files.set(path, data),
    writeTextAtomic: (path, text) => void files.set(path, strToU8(text)),
    mkdir: (path) => void dirs.add(path),
    removeTree: (path) => {
      files.delete(path);
      for (const f of under(path)) files.delete(f);
      dirs.delete(path);
    },
    rename: (from, to) => {
      for (const f of under(from)) {
        files.set(to + f.slice(from.length), files.get(f)!);
        files.delete(f);
      }
      dirs.delete(from);
    },
    copyTree: (from, to) => {
      for (const f of under(from)) files.set(to + f.slice(from.length), files.get(f)!);
    },
    listDir: (path) => [...new Set([...under(path), ...[...dirs].filter((d) => d.startsWith(path + sep))].map((f) => f.slice(path.length + 1).split(sep)[0]!))],
  };
}

function read(files: Map<string, Uint8Array>, path: string): Uint8Array {
  const data = files.get(path);
  if (data === undefined) throw new Error(`ENOENT ${path}`);
  return data;
}

function memoryVault(): ExtensionServiceDeps['vault'] & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, get: (id) => values.get(id) ?? null, set: (id, v) => void values.set(id, v), has: (id) => values.has(id), delete: (id) => void values.delete(id) };
}

const ROOT = resolve(sep, 'ud', 'extensions');
const SETTINGS = resolve(sep, 'ud', 'extensions-settings');
const DESKTOP = resolve(sep, 'Claude');
const ARCHIVE = join(sep, 'descargas', 'db.mcpb');

const manifest = (patch: Record<string, unknown> = {}) => ({
  manifest_version: '0.3',
  name: 'db',
  display_name: 'Base de datos',
  version: '1.0.0',
  author: { name: 'Gar' },
  server: { type: 'node', mcp_config: { command: 'node', args: ['${__dirname}${/}server${/}index.js'], env: { KEY: '${user_config.key}' } } },
  user_config: { key: { type: 'string', title: 'Clave', sensitive: true, required: true } },
  ...patch,
});

function setup(commandAvailable = true) {
  const fs = memoryFs();
  const vault = memoryVault();
  let token = 0;
  const service = new McpExtensionService({
    root: ROOT,
    settingsRoot: SETTINGS,
    fs,
    vault,
    platform: 'win32',
    homedir: join(sep, 'home'),
    pathSeparator: sep,
    isCommandAvailable: () => commandAvailable,
    newToken: () => `t${++token}`,
    desktopDirs: () => [DESKTOP],
  });
  const writeArchive = (m: unknown): void => void fs.files.set(ARCHIVE, zipSync({ 'manifest.json': strToU8(JSON.stringify(m)), server: { 'index.js': strToU8('//') } }));
  return { fs, vault, service, writeArchive };
}

const NONE = new Set<string>();

describe('McpExtensionService', () => {
  it('install_trasLaVistaPrevia_descomprimeEnSuCarpetaYSaleEnLaLista', () => {
    const { service, writeArchive, fs } = setup();
    writeArchive(manifest());

    const preview = service.previewInstall(ARCHIVE);
    service.install(preview.token);

    expect(preview).toMatchObject({ id: 'db', displayName: 'Base de datos', author: 'Gar', replacesVersion: null, fileCount: 2 });
    expect(fs.files.has(join(ROOT, 'db', 'server', 'index.js'))).toBe(true);
    expect(service.list(NONE, NONE).extensions[0]).toMatchObject({ id: 'db', enabled: true, missingRequired: ['key'], problem: 'Falta configurar: sin eso no arranca.' });
  });

  it('install_paqueteCambiadoTrasLaVistaPrevia_lanzaYNoInstala', () => {
    const { service, writeArchive, fs } = setup();
    writeArchive(manifest());
    const preview = service.previewInstall(ARCHIVE);
    writeArchive(manifest({ version: '6.6.6' }));

    expect(() => service.install(preview.token)).toThrow(/cambiado/);
    expect(fs.exists(join(ROOT, 'db'))).toBe(false);
  });

  it('install_tokenDesconocido_lanza', () => {
    expect(() => setup().service.install('nada')).toThrow(/caducada/);
  });

  it('previewInstall_plataformaIncompatible_lanza', () => {
    const { service, writeArchive } = setup();
    writeArchive(manifest({ compatibility: { platforms: ['darwin'] } }));

    expect(() => service.previewInstall(ARCHIVE)).toThrow(/darwin/);
  });

  it('saveConfig_sensible_vaALaBovedaYNoAlFicheroDeAjustes', () => {
    const { service, writeArchive, vault, fs } = setup();
    writeArchive(manifest());
    service.install(service.previewInstall(ARCHIVE).token);

    service.saveConfig('db', { key: 'secreto-k' });

    expect(vault.values.get('mcp-extension:db:key')).toBe('secreto-k');
    expect(new TextDecoder().decode(fs.files.get(join(SETTINGS, 'db.json')))).not.toContain('secreto');
    const view = service.list(NONE, NONE).extensions[0]!;
    expect(view.fields[0]).toMatchObject({ hasValue: true, value: null });
    expect(JSON.stringify(view)).not.toContain('secreto');
    expect(view.problem).toBeNull();
  });

  it('resolveActive_configurada_servidorConElSecretoYLaCarpeta', () => {
    const { service, writeArchive } = setup();
    writeArchive(manifest());
    service.install(service.previewInstall(ARCHIVE).token);
    service.saveConfig('db', { key: 'secreto-k' });

    const { servers } = service.resolveActive();

    expect(servers).toMatchObject([{ name: 'db', command: 'node', args: [join(ROOT, 'db', 'server', 'index.js')], secrets: { MAGE_MCP_SECRET_DB_KEY: 'secreto-k' } }]);
  });

  // De la boveda al --mcp-config que se escribe en disco: el valor no puede aparecer en ningun fichero.
  it('resolveActive_hastaElMcpConfigGenerado_elValorDeLaBovedaNoLlegaANingunFichero', () => {
    const { service, writeArchive, fs } = setup();
    writeArchive(manifest());
    service.install(service.previewInstall(ARCHIVE).token);
    service.saveConfig('db', { key: 'secreto-k' });
    let generated = '';

    const { env } = toClaudeArgs(service.resolveActive().servers, null, (text) => {
      generated = text;
      return '/gen/x.json';
    });

    const onDisk = [...fs.files.values()].map((data) => new TextDecoder().decode(data));
    expect(generated).toContain('${MAGE_MCP_SECRET_DB_KEY}');
    expect(generated).not.toContain('secreto-k');
    expect(onDisk.some((text) => text.includes('secreto-k'))).toBe(false);
    expect(env.MAGE_MCP_SECRET_DB_KEY).toBe('secreto-k');
  });

  it('resolveActive_desactivadaOIncompleta_noSaleYLaIncompletaAvisa', () => {
    const { service, writeArchive } = setup();
    writeArchive(manifest());
    service.install(service.previewInstall(ARCHIVE).token);

    const incompleta = service.resolveActive();
    service.saveConfig('db', { key: 'k' });
    service.setEnabled('db', false);

    expect(incompleta.servers).toEqual([]);
    expect(incompleta.warnings[0]).toContain('Clave');
    expect(service.resolveActive()).toEqual({ servers: [], warnings: [] });
  });

  it('list_sinNodeEnElPath_avisaDelRuntime', () => {
    const { service, writeArchive } = setup(false);
    writeArchive(manifest({ user_config: {}, server: { type: 'node', mcp_config: { command: 'node' } } }));
    service.install(service.previewInstall(ARCHIVE).token);

    expect(service.list(NONE, NONE).extensions[0]!.problem).toContain('«node»');
  });

  it('list_comunConElMismoNombre_avisaDeQueGanaElComun', () => {
    const { service, writeArchive } = setup();
    writeArchive(manifest({ user_config: {} }));
    service.install(service.previewInstall(ARCHIVE).token);

    expect(service.list(new Set(['db']), NONE).extensions[0]!.problem).toContain('común');
  });

  it('list_proveedores_agySoloSiSeExporto', () => {
    const { service, writeArchive } = setup();
    writeArchive(manifest({ user_config: {} }));
    service.install(service.previewInstall(ARCHIVE).token);

    expect(service.list(NONE, NONE).extensions[0]!.providers).toEqual(['claude', 'codex', 'local']);
    expect(service.list(NONE, new Set(['db'])).extensions[0]!.providers).toEqual(['claude', 'codex', 'agy', 'local']);
    service.setOnlyIn('db', ['codex']);
    expect(service.list(NONE, NONE).extensions[0]!.providers).toEqual(['codex']);
  });

  it('install_actualizar_conservaLosAjustes', () => {
    const { service, writeArchive } = setup();
    writeArchive(manifest());
    service.install(service.previewInstall(ARCHIVE).token);
    service.saveConfig('db', { key: 'k' });
    service.setOnlyIn('db', ['claude']);
    writeArchive(manifest({ version: '2.0.0' }));

    const preview = service.previewInstall(ARCHIVE);
    service.install(preview.token);

    expect(preview.replacesVersion).toBe('1.0.0');
    expect(service.list(NONE, NONE).extensions[0]).toMatchObject({ version: '2.0.0', onlyIn: ['claude'], missingRequired: [] });
  });

  it('remove_borraCarpetaAjustesYSecretos', () => {
    const { service, writeArchive, vault, fs } = setup();
    writeArchive(manifest());
    service.install(service.previewInstall(ARCHIVE).token);
    service.saveConfig('db', { key: 'k' });

    service.remove('db');

    expect(fs.exists(join(ROOT, 'db'))).toBe(false);
    expect(fs.exists(join(SETTINGS, 'db.json'))).toBe(false);
    expect(vault.values.size).toBe(0);
  });

  it('importFromDesktop_copiaLaCarpetaYDejaDeDependerDeDesktop', () => {
    const { service, fs } = setup();
    const source = join(DESKTOP, 'Claude Extensions', 'local.mcpb.gar.db');
    fs.files.set(join(source, 'manifest.json'), strToU8(JSON.stringify(manifest({ user_config: {}, server: { type: 'node', mcp_config: { command: 'node', args: ['${__dirname}${/}server${/}index.js'] } } }))));
    fs.files.set(join(source, 'server', 'index.js'), strToU8('//'));

    const candidatos = service.list(NONE, NONE).desktop;
    service.importFromDesktop('local.mcpb.gar.db');
    fs.removeTree(source);

    expect(candidatos).toEqual([{ dirName: 'local.mcpb.gar.db', displayName: 'Base de datos', version: '1.0.0', installed: false }]);
    expect(service.resolveActive().servers[0]).toMatchObject({ args: [join(ROOT, 'db', 'server', 'index.js')] });
  });

  it.each(['../fuera', 'a/b', ''])('importFromDesktop_nombre%s_lanza', (name) => {
    expect(() => setup().service.importFromDesktop(name)).toThrow();
  });

  it('setEnabled_desconocida_lanza', () => {
    expect(() => setup().service.setEnabled('nada', true)).toThrow(/nada/);
  });

  it('list_ajustesIlegibles_avisaYSigueConLasDemas', () => {
    const { service, writeArchive, fs } = setup();
    writeArchive(manifest({ user_config: {} }));
    service.install(service.previewInstall(ARCHIVE).token);
    fs.files.set(join(SETTINGS, 'db.json'), strToU8('{'));

    const list = service.list(NONE, NONE);

    expect(list.extensions).toEqual([]);
    expect(list.warnings[0]).toContain('db');
    expect(dirname(join(SETTINGS, 'db.json'))).toBe(SETTINGS);
  });
});
