import { describe, expect, it } from 'vitest';
import { claudeSharedLaunch, codexEnvName, toAgyEntry, toClaudeArgs, toClaudeMcpConfig, toCodexOverrides } from './mcpProviderTranslate';
import { mergeServerLists, resolveCommonServers, resolveServerConfig, selectForTarget, type ResolvedStdioServer } from './mcpResolved';

// Formato neutro y su traduccion a cada CLI. La forma de cada salida es la MEDIDA en
// spike/mcp-providers-spike.mjs (agy 1.2.14, codex-cli 0.144.4).

const STDIO = resolveServerConfig('db', { command: 'C:\\Program Files\\db\\db.exe', args: ['--p', 'q"r'], env: { DB_TOKEN: 'secreto-db' } }, 'common', null) as ResolvedStdioServer;
const stdio = (patch: Partial<ResolvedStdioServer> = {}): ResolvedStdioServer => ({ ...STDIO, ...patch });
const remote = resolveServerConfig('api', { type: 'http', url: 'https://api.dev/mcp', headers: { Authorization: 'Bearer secreto-api' }, oauth: { clientId: 'cid', callbackPort: 7777, resource: 'https://res' } }, 'common', null);
const sse = resolveServerConfig('viejo', { type: 'sse', url: 'https://sse.dev' }, 'common', null);

describe('resolveServerConfig', () => {
  it('resolveServerConfig_stdio_separaLoQueNoInterpretaEnExtra', () => {
    const server = resolveServerConfig('x', { command: 'node', timeout: 30, cwd: '/w' }, 'common', ['claude']);

    expect(server).toMatchObject({ transport: 'stdio', command: 'node', args: [], env: {}, cwd: '/w', extra: { timeout: 30 }, onlyIn: ['claude'] });
  });

  it('resolveServerConfig_remoto_leeOAuthYDaIdsDeBoveda', () => {
    expect(remote.transport === 'http' && remote.oauth).toEqual({
      clientId: 'cid',
      clientSecretId: 'mcp-oauth-client-secret:api',
      tokenStoreId: 'mcp-oauth-token:api',
      scopes: [],
      callbackPort: 7777,
      resource: 'https://res',
    });
  });

  it('resolveServerConfig_puertoFueraDeRango_seIgnora', () => {
    const server = resolveServerConfig('a', { type: 'http', url: 'https://a', oauth: { callbackPort: 70_000 } }, 'common', null);

    expect(server.transport === 'http' && server.oauth.callbackPort).toBeNull();
  });

  it.each([
    ['sin comando', { type: 'stdio' }, /comando/],
    ['sin url', { type: 'http' }, /URL/],
    ['no es objeto', 'x', /objeto/],
  ])('resolveServerConfig_%s_lanzaConElNombre', (_caso, raw, error) => {
    expect(() => resolveServerConfig('roto', raw, 'common', null)).toThrow(error);
  });
});

describe('mergeServerLists + selectForTarget', () => {
  it('mergeServerLists_mismoNombre_ganaElComunYAvisa', () => {
    const common = resolveCommonServers({ db: { command: 'a' } }, {});
    const extensions = { servers: [{ ...stdio(), name: 'db', source: 'extension' as const }], warnings: [] };

    const merged = mergeServerLists(common, extensions);

    expect(merged.servers.map((s) => s.source)).toEqual(['common']);
    expect(merged.warnings[0]).toContain('db');
  });

  it('selectForTarget_soloEnCuenta_soloEsaCuenta', () => {
    const scoped = stdio({ onlyIn: ['claude|/h/.claude-p'] });

    expect(selectForTarget([scoped], { family: 'claude', accountId: '/h/.claude-p' })).toHaveLength(1);
    expect(selectForTarget([scoped], { family: 'claude', accountId: '/h/.claude' })).toHaveLength(0);
    expect(selectForTarget([scoped], { family: 'codex', accountId: null })).toHaveLength(0);
  });

  it('selectForTarget_sse_noLlegaACodex', () => {
    expect(selectForTarget([sse], { family: 'codex', accountId: null })).toEqual([]);
    expect(selectForTarget([sse], { family: 'claude', accountId: '/c' })).toHaveLength(1);
  });
});

describe('Claude', () => {
  it('toClaudeMcpConfig_devuelveLaFormaDeMcpJsonConExtra', () => {
    // Arrange
    const servers = [resolveServerConfig('x', { command: 'node', timeout: 5 }, 'common', null), remote];
    // Act
    const { config } = toClaudeMcpConfig(servers);
    // Assert
    expect(config.mcpServers.x).toEqual({ type: 'stdio', command: 'node', timeout: 5 });
    expect(config.mcpServers.api).toMatchObject({ type: 'http', url: 'https://api.dev/mcp', headers: { Authorization: 'Bearer secreto-api' } });
  });

  it('toClaudeMcpConfig_valorQueYaEsReferencia_seDejaTalCual', () => {
    // Arrange
    const server = resolveServerConfig('x', { command: 'n', env: { T: 'Bearer ${TOKEN}' } }, 'common', null);
    // Act
    const { config } = toClaudeMcpConfig([server]);
    // Assert
    expect((config.mcpServers.x as { env: Record<string, string> }).env.T).toBe('Bearer ${TOKEN}');
  });

  // Medido en 2.1.319: el entorno del CLI llega al Bash del agente; el `env` de un servidor del fichero, no.
  it('toClaudeArgs_extensionConSecretoDeLaBoveda_vaAlFicheroSinReferencias', () => {
    // Arrange
    const ext = { ...stdio({ name: 'ext', env: { KEY: '${MAGE_MCP_SECRET_EXT_KEY}' }, args: ['--k', '${MAGE_MCP_SECRET_EXT_KEY}'] }), secrets: { MAGE_MCP_SECRET_EXT_KEY: 'valor-de-la-boveda' } };
    let written = '';
    // Act
    const { args } = toClaudeArgs([ext], null, (text) => {
      written = text;
      return '/gen/x.json';
    });
    // Assert
    expect(JSON.parse(written).mcpServers.ext).toMatchObject({ args: ['--k', 'valor-de-la-boveda'], env: { KEY: 'valor-de-la-boveda' } });
    expect(written).not.toContain('MAGE_MCP_SECRET_');
    expect(args.join(' ')).not.toContain('valor-de-la-boveda');
  });

  it('toClaudeMcpConfig_credencialDeSesionDeMage_quedaComoReferencia', () => {
    // Arrange
    const mage = stdio({ name: 'mage', env: { ELECTRON_RUN_AS_NODE: '1', MAGE_MCP_CALLER: 'cred-123' } });
    // Act
    const { config } = toClaudeMcpConfig([mage]);
    // Assert
    expect((config.mcpServers.mage as { env: Record<string, string> }).env).toEqual({ ELECTRON_RUN_AS_NODE: '1', MAGE_MCP_CALLER: '${MAGE_MCP_CALLER}' });
    expect(JSON.stringify(config)).not.toContain('cred-123');
  });

  it('toClaudeArgs_sinServidoresNiSettings_sinFlagsYSinEscribir', () => {
    const args = toClaudeArgs([], null, () => {
      throw new Error('no debe escribir');
    });

    expect(args).toEqual({ args: [] });
  });

  it('toClaudeArgs_conFragmentoYExtra_unSoloSettingsFusionado', () => {
    const { args } = toClaudeArgs([], { hooks: {} }, () => '', { ultracode: true });

    expect(args).toEqual(['--settings', '{"hooks":{},"ultracode":true}']);
  });

  it('toClaudeArgs_soloExtra_settingsConExtra', () => {
    const { args } = toClaudeArgs([], null, () => '', { ultracode: true });

    expect(args).toEqual(['--settings', '{"ultracode":true}']);
  });

  it('toClaudeArgs_sinNada_sinSettings', () => {
    const { args } = toClaudeArgs([], null, () => '', {});

    expect(args).not.toContain('--settings');
  });

  it('claudeSharedLaunch_sinSharedConExtra_settings', () => {
    expect(claudeSharedLaunch(undefined, '/c', () => '', { ultracode: true })).toEqual({ args: ['--settings', '{"ultracode":true}'], env: {} });
  });

  it('toClaudeArgs_conServidores_valoresEnElFicheroYNuncaEnLaLinea', () => {
    // Arrange
    let written = '';
    // Act
    const { args } = toClaudeArgs([stdio(), remote], { hooks: {} }, (text) => {
      written = text;
      return '/gen/x.json';
    });
    // Assert
    expect(args).toEqual(['--mcp-config', '/gen/x.json', '--settings', '{"hooks":{}}']);
    expect(JSON.parse(written).mcpServers).toMatchObject({ db: { env: { DB_TOKEN: 'secreto-db' } }, api: { headers: { Authorization: 'Bearer secreto-api' } } });
    expect(args.join(' ')).not.toContain('secreto');
  });

  it('claudeSharedLaunch_conSecretosDeStdioYHttp_elEntornoDelCliNoLosLleva', () => {
    // Arrange
    const shared = { mcpServers: [stdio(), remote], settingsFragment: null, claudeAiConnectors: false };
    // Act
    const { env } = claudeSharedLaunch(shared, '/c', () => '/gen/x.json');
    // Assert
    expect(env).toEqual({ ENABLE_CLAUDEAI_MCP_SERVERS: 'false' });
    expect(JSON.stringify(env)).not.toContain('secreto');
  });

  it('claudeSharedLaunch_sinCompartido_nada', () => {
    expect(claudeSharedLaunch(undefined, '/c', () => '')).toEqual({ args: [], env: {} });
  });
});

describe('toCodexOverrides', () => {
  it('toCodexOverrides_stdio_comandoYArgsEnTomlYSecretosPorEnvVars', () => {
    const result = toCodexOverrides([stdio()]);

    expect(result.args).toEqual([
      '-c', 'mcp_servers.db.command="C:\\\\Program Files\\\\db\\\\db.exe"',
      '-c', 'mcp_servers.db.args=["--p","q\\"r"]',
      '-c', 'mcp_servers.db.env_vars=["DB_TOKEN"]',
    ]);
    expect(result.env).toEqual({ DB_TOKEN: 'secreto-db' });
    expect(result.args.join(' ')).not.toContain('secreto');
  });

  it('toCodexOverrides_http_cabecerasDesdeVariablesYOAuth', () => {
    const result = toCodexOverrides([remote]);

    expect(result.args).toEqual([
      '-c', 'mcp_servers.api.url="https://api.dev/mcp"',
      '-c', 'mcp_servers.api.env_http_headers={"Authorization"="MAGE_MCP_API_AUTHORIZATION"}',
      '-c', 'mcp_servers.api.oauth.client_id="cid"',
      '-c', 'mcp_servers.api.oauth_resource="https://res"',
    ]);
    expect(result.env).toEqual({ MAGE_MCP_API_AUTHORIZATION: 'Bearer secreto-api' });
  });

  it.each([
    ['nombre con punto', stdio({ name: 'a.b' }), /nombre/],
    ['SSE', sse, /SSE/],
  ])('toCodexOverrides_%s_seOmiteConAviso', (_caso, server, aviso) => {
    const result = toCodexOverrides([server]);

    expect(result.args).toEqual([]);
    expect(result.warnings[0]).toMatch(aviso);
  });

  it('toCodexOverrides_dosServidoresConLaMismaVariableDistinta_elSegundoSeOmite', () => {
    const otro = stdio({ name: 'otro', env: { DB_TOKEN: 'distinto' } });

    const result = toCodexOverrides([stdio(), otro]);

    expect(result.env).toEqual({ DB_TOKEN: 'secreto-db' });
    expect(result.args.some((arg) => arg.startsWith('mcp_servers.otro.'))).toBe(false);
    expect(result.warnings[0]).toContain('DB_TOKEN');
  });

  it('toCodexOverrides_vacio_nada', () => {
    expect(toCodexOverrides([])).toEqual({ args: [], env: {}, warnings: [] });
  });

  it('codexEnvName_nombresRaros_soloMayusculasNumerosYGuionBajo', () => {
    expect(codexEnvName('my-srv', 'X-Api.Key')).toBe('MAGE_MCP_MY_SRV_X_API_KEY');
  });
});

describe('secretos de la bóveda en Codex y agy', () => {
  const ext = { ...stdio({ name: 'ext', env: { KEY: '${MAGE_MCP_SECRET_EXT_KEY}' } }), secrets: { MAGE_MCP_SECRET_EXT_KEY: 'valor-de-la-boveda' } };

  it('toCodexOverrides_secretoEnEnv_vaAlEntornoNuncaALosArgs', () => {
    const result = toCodexOverrides([ext]);

    expect(result.env.KEY).toBe('valor-de-la-boveda');
    expect(result.args.join(' ')).not.toContain('valor-de-la-boveda');
  });

  it('toCodexOverrides_secretoEnArgs_seOmite', () => {
    const result = toCodexOverrides([{ ...ext, args: ['${MAGE_MCP_SECRET_EXT_KEY}'] }]);

    expect(result.args).toEqual([]);
    expect(result.warnings[0]).toContain('sensible');
  });

  it('toAgyEntry_conSecreto_loMaterializa', () => {
    expect(toAgyEntry(ext)).toMatchObject({ env: { KEY: 'valor-de-la-boveda' } });
  });
});

describe('toAgyEntry', () => {
  it('toAgyEntry_stdio_formaDeAgyMcpAdd', () => {
    expect(toAgyEntry(stdio())).toEqual({ command: 'C:\\Program Files\\db\\db.exe', args: ['--p', 'q"r'], env: { DB_TOKEN: 'secreto-db' }, disabled: false });
  });

  it('toAgyEntry_http_serverUrl', () => {
    expect(toAgyEntry(remote)).toEqual({ serverUrl: 'https://api.dev/mcp', headers: { Authorization: 'Bearer secreto-api' }, disabled: false });
  });

  it('toAgyEntry_sse_null', () => {
    expect(toAgyEntry(sse)).toBeNull();
  });
});
