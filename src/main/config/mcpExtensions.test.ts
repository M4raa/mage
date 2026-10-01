import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyUserConfigValues,
  bareCommand,
  buildUserConfigFields,
  DEFAULT_EXTENSION_SETTINGS,
  extensionIdOf,
  missingRequiredFields,
  parseExtensionSettings,
  parseMcpbManifest,
  platformProblem,
  resolveExtensionServer,
  type ExtensionResolveContext,
  type McpbManifest,
} from './mcpExtensions';

// Manifest con la forma medida (HuginnDB de Claude Desktop, manifest_version 0.3) mas user_config y
// platform_overrides del esquema MCPB.
const RAW = {
  manifest_version: '0.3',
  name: 'Huginn DB',
  display_name: 'HuginnDB',
  version: '1.2.0',
  author: { name: 'Gar' },
  server: {
    type: 'binary',
    mcp_config: {
      command: '${__dirname}${/}server${/}huginndb-mcp',
      args: ['--root', '${user_config.root}', '${user_config.dirs}'],
      env: { API_KEY: '${user_config.api_key}', HOME_DIR: '${HOME}' },
      platform_overrides: { win32: { command: '${__dirname}${/}server${/}huginndb-mcp.exe' } },
    },
  },
  compatibility: { platforms: ['win32', 'darwin'] },
  user_config: {
    api_key: { type: 'string', title: 'Clave', sensitive: true, required: true },
    root: { type: 'directory', title: 'Raíz', default: '${HOME}' },
    dirs: { type: 'directory', title: 'Carpetas', multiple: true },
    verbose: { type: 'boolean', title: 'Detallado', default: false },
  },
};

const manifest = (): McpbManifest => parseMcpbManifest(JSON.stringify(RAW));
const ctx = (patch: Partial<ExtensionResolveContext> = {}): ExtensionResolveContext => ({
  id: 'huginn-db',
  dir: join('/ext', 'huginn-db'),
  manifest: manifest(),
  settings: { ...DEFAULT_EXTENSION_SETTINGS, userConfig: { root: '/datos', dirs: ['/a', '/b'] } },
  secret: (key) => (key === 'api_key' ? 'secreto-api' : null),
  platform: 'win32',
  homedir: '/home/u',
  pathSeparator: '\\',
  ...patch,
});

describe('parseMcpbManifest', () => {
  it('parseMcpbManifest_valido_toleraCamposDesconocidos', () => {
    expect(parseMcpbManifest(JSON.stringify({ ...RAW, tools: [{ name: 't' }] })).display_name).toBe('HuginnDB');
  });

  it('parseMcpbManifest_conBom_loAcepta', () => {
    expect(parseMcpbManifest(`\uFEFF${JSON.stringify(RAW)}`).name).toBe('Huginn DB');
  });

  it.each([
    ['sin version de manifest', { ...RAW, manifest_version: undefined }, /manifest_version/],
    ['sin server', { ...RAW, server: undefined }, /server/],
    ['sin comando', { ...RAW, server: { mcp_config: {} } }, /command/],
  ])('parseMcpbManifest_%s_lanza', (_caso, raw, error) => {
    expect(() => parseMcpbManifest(JSON.stringify(raw))).toThrow(error);
  });

  it('parseMcpbManifest_noJson_lanza', () => {
    expect(() => parseMcpbManifest('{')).toThrow(/JSON/);
  });

  it('extensionIdOf_nombreConEspacios_slug', () => {
    expect(extensionIdOf(manifest())).toBe('huginn-db');
  });

  it('extensionIdOf_nombreSinNadaUtil_lanza', () => {
    expect(() => extensionIdOf({ ...manifest(), name: '***' })).toThrow(/id/);
  });

  it('platformProblem_plataformaNoDeclarada_avisa', () => {
    expect(platformProblem(manifest(), 'linux')).toContain('win32');
    expect(platformProblem(manifest(), 'win32')).toBeNull();
  });
});

describe('formulario de user_config', () => {
  it('buildUserConfigFields_sensible_sinValorYConHasValueDeLaBoveda', () => {
    const fields = buildUserConfigFields(manifest(), DEFAULT_EXTENSION_SETTINGS, (key) => key === 'api_key');

    expect(fields.find((f) => f.key === 'api_key')).toMatchObject({ sensitive: true, value: null, hasValue: true });
    expect(fields.find((f) => f.key === 'verbose')).toMatchObject({ value: false, hasValue: true });
  });

  it('missingRequiredFields_obligatorioSinValor_loNombra', () => {
    const fields = buildUserConfigFields(manifest(), DEFAULT_EXTENSION_SETTINGS, () => false);

    expect(missingRequiredFields(fields)).toEqual(['api_key']);
  });

  it('applyUserConfigValues_separaSensiblesYBorraConNull', () => {
    const start = { ...DEFAULT_EXTENSION_SETTINGS, userConfig: { root: '/x' } };

    const result = applyUserConfigValues(manifest(), start, { api_key: 'nueva', root: null, verbose: true });

    expect(result.settings.userConfig).toEqual({ verbose: true });
    expect([...result.secrets]).toEqual([['api_key', 'nueva']]);
    expect(JSON.stringify(result.settings)).not.toContain('nueva');
  });

  it('applyUserConfigValues_claveDesconocida_lanza', () => {
    expect(() => applyUserConfigValues(manifest(), DEFAULT_EXTENSION_SETTINGS, { otra: 'x' })).toThrow(/otra/);
  });

  it('applyUserConfigValues_tipoQueNoCasa_lanzaSinElValor', () => {
    expect(() => applyUserConfigValues(manifest(), DEFAULT_EXTENSION_SETTINGS, { verbose: 'secreto' })).toThrow(/verbose/);
    expect(() => applyUserConfigValues(manifest(), DEFAULT_EXTENSION_SETTINGS, { verbose: 'secreto' })).not.toThrow(/secreto/);
  });

  it('applyUserConfigValues_listaEnCampoNoMultiple_lanza', () => {
    expect(() => applyUserConfigValues(manifest(), DEFAULT_EXTENSION_SETTINGS, { root: ['/a'] })).toThrow(/root/);
  });

  it('parseExtensionSettings_ausente_porDefecto', () => {
    expect(parseExtensionSettings(null)).toEqual(DEFAULT_EXTENSION_SETTINGS);
  });

  it('parseExtensionSettings_ilegible_lanza', () => {
    expect(() => parseExtensionSettings('{')).toThrow(/ilegibles/);
  });
});

describe('resolveExtensionServer', () => {
  it('resolveExtensionServer_win32_aplicaOverrideYResuelveVariables', () => {
    const server = resolveExtensionServer(ctx(), ['claude']);

    expect(server).toMatchObject({ name: 'huginn-db', source: 'extension', transport: 'stdio', onlyIn: ['claude'] });
    expect(server.command).toBe(`${join('/ext', 'huginn-db')}\\server\\huginndb-mcp.exe`);
    expect(server.args).toEqual(['--root', '/datos', '/a', '/b']);
    // El sensible queda como referencia; su valor, aparte (nunca dentro de un campo que se escriba).
    expect(server.env).toEqual({ API_KEY: '${MAGE_MCP_SECRET_HUGINN_DB_API_KEY}', HOME_DIR: '/home/u' });
    expect(server.secrets).toEqual({ MAGE_MCP_SECRET_HUGINN_DB_API_KEY: 'secreto-api' });
    expect(JSON.stringify({ ...server, secrets: undefined })).not.toContain('secreto-api');
  });

  it('resolveExtensionServer_otraPlataforma_sinOverride', () => {
    expect(resolveExtensionServer(ctx({ platform: 'darwin', pathSeparator: '/' }), null).command).toBe(`${join('/ext', 'huginn-db')}/server/huginndb-mcp`);
  });

  it('resolveExtensionServer_obligatorioSinValor_lanza', () => {
    expect(() => resolveExtensionServer(ctx({ secret: () => null }), null)).toThrow(/Clave/);
  });

  it('resolveExtensionServer_variableDesconocida_lanza', () => {
    const raw = { ...RAW, server: { mcp_config: { command: '${RARA}' } }, user_config: {} };

    expect(() => resolveExtensionServer(ctx({ manifest: parseMcpbManifest(JSON.stringify(raw)) }), null)).toThrow(/RARA/);
  });

  it('resolveExtensionServer_userConfigNoDeclarado_lanza', () => {
    const raw = { ...RAW, server: { mcp_config: { command: 'x', args: ['${user_config.nada}'] } }, user_config: {} };

    expect(() => resolveExtensionServer(ctx({ manifest: parseMcpbManifest(JSON.stringify(raw)) }), null)).toThrow(/nada/);
  });

  it('bareCommand_rutaONombre', () => {
    expect(bareCommand('node')).toBe('node');
    expect(bareCommand('/x/node')).toBeNull();
    expect(bareCommand('C:\\x\\node.exe')).toBeNull();
  });
});
