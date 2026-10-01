import { describe, expect, it } from 'vitest';
import type { McpExtensionView, McpInventory, McpInventoryRow } from '@shared/mcp';
import { mcpAuthMessage, buildClaudeConnectorGroups, buildMcpTable, buildServersTable, describeCheckedAt, filterMcpTable, mcpStatusLabel, mergeLiveStatuses, summarizeStatus, tagSessionServers } from './mcpView';

const row = (patch: Partial<McpInventoryRow>): McpInventoryRow => ({
  name: 'a',
  transport: 'stdio',
  origins: [{ kind: 'common', label: 'Mage', path: '/m.json', accountDir: null, projectDir: null, importId: 'common|/m.json||a' }],
  accounts: ['/c1', '/c2'],
  envKeys: [],
  headerKeys: [],
  disabled: false,
  common: { transport: 'stdio', command: 'npx', args: [], url: '' },
  providers: ['claude', 'codex', 'local'],
  ownedBy: null,
  onlyIn: null,
  exportedToAgy: false,
  ...patch,
});
const inventory = (rows: McpInventoryRow[]): McpInventory => ({ rows, unshared: [], commonVersion: null, warnings: [] });
const reported = (name: string, status: string) => ({ name, status, scope: name.startsWith('claude.ai ') ? 'claudeai' : 'dynamic' });

describe('mcpStatusLabel', () => {
  it('mcpStatusLabel_estadosMedidos_enCastellano', () => {
    expect(['connected', 'pending', 'needs-auth', 'failed'].map(mcpStatusLabel)).toEqual(['Conectado', 'Pendiente', 'Requiere autenticación', 'Falló']);
  });

  it('mcpStatusLabel_desconocido_talCual', () => {
    expect(mcpStatusLabel('nuevo-estado')).toBe('nuevo-estado');
  });
});

describe('summarizeStatus', () => {
  const report = (status: string) => ({ status: { name: 'a', status, scope: null } });

  it('summarizeStatus_sinDatos_raya', () => {
    expect(summarizeStatus([])).toBe('—');
  });

  it('summarizeStatus_todosIguales_unoSolo', () => {
    expect(summarizeStatus([report('connected'), report('connected')])).toBe('Conectado');
  });

  it('summarizeStatus_distintos_conCuenta', () => {
    expect(summarizeStatus([report('connected'), report('failed'), report('connected')])).toBe('Conectado (2) · Falló (1)');
  });
});

describe('mergeLiveStatuses', () => {
  it('mergeLiveStatuses_sondeoGanaAlInit', () => {
    const result = mergeLiveStatuses({ '/c1': [{ name: 'a', status: 'failed', scope: 'user' }] }, [
      { accountId: '/c1', servers: [{ name: 'a', status: 'connected' }] },
      { accountId: '/c2', servers: [{ name: 'a', status: 'connected' }] },
    ]);

    expect(result).toEqual({ '/c1': [{ name: 'a', status: 'failed', scope: 'user' }], '/c2': [{ name: 'a', status: 'connected', scope: null }] });
  });

  it('mergeLiveStatuses_sesionSinServidores_noCuenta', () => {
    expect(mergeLiveStatuses({}, [{ accountId: '/c1', servers: [] }])).toEqual({});
  });
});

describe('buildMcpTable', () => {
  it('buildMcpTable_sinInventarioNiEstados_vacia', () => {
    expect(buildMcpTable(null, {})).toEqual([]);
  });

  it('buildMcpTable_servidorConEstado_traducidoYConInsignias', () => {
    const [first] = buildMcpTable(inventory([row({})]), { '/c1': [{ name: 'a', status: 'connected', scope: 'dynamic' }] });

    expect(first).toMatchObject({ name: 'a', kind: 'server', typeLabel: 'Local', statusLabel: 'Conectado', badges: [{ kind: 'common', label: 'Mage' }] });
  });

  it('buildMcpTable_desactivado_ganaAlEstado', () => {
    const [first] = buildMcpTable(inventory([row({ disabled: true })]), { '/c1': [{ name: 'a', status: 'connected', scope: null }] });

    expect(first!.statusLabel).toBe('Desactivado');
  });

  it('buildMcpTable_sinSesion_raya', () => {
    expect(buildMcpTable(inventory([row({ transport: 'http' })]), {})[0]).toMatchObject({ statusLabel: '—', typeLabel: 'Remoto (HTTP)' });
  });

  it('buildMcpTable_conectoresYPlugins_filasPropias', () => {
    const rows = buildMcpTable(inventory([]), {
      '/c1': [
        { name: 'claude.ai Claude Docs', status: 'connected', scope: 'claudeai' },
        { name: 'plugin:figma:figma', status: 'needs-auth', scope: 'dynamic' },
      ],
      '/c2': [{ name: 'claude.ai Claude Docs', status: 'connected', scope: 'claudeai' }],
    });

    expect(rows.map((r) => [r.kind, r.name, r.typeLabel, r.badges[0]!.label, r.accounts, r.statusLabel])).toEqual([
      ['connector', 'Claude Docs', 'Conector claude.ai', 'claude.ai', ['/c1', '/c2'], 'Conectado'],
      ['plugin', 'figma', 'Plugin', 'Plugin figma', ['/c1'], 'Requiere autenticación'],
    ]);
  });

  it('buildMcpTable_cargadoPorSesionFueraDeFicheros_filaDeSesion', () => {
    const rows = buildMcpTable(inventory([]), { '/c1': [{ name: 'suelto', status: 'failed', scope: 'project' }] });

    expect(rows[0]).toMatchObject({ key: 'session:suelto', badges: [{ kind: 'session' }], statusLabel: 'Falló' });
  });
});

describe('buildMcpTable › needsAuth', () => {
  const live = (name: string, status: string) => ({ name, status, scope: 'dynamic' });

  it('buildMcpTable_pluginQuePideAuth_nombreDelCliYSoloLasCuentasQueLoPiden', () => {
    const rows = buildMcpTable(inventory([]), { '/c1': [live('plugin:figma:figma', 'needs-auth')], '/c2': [live('plugin:figma:figma', 'connected')] });

    expect(rows[0]).toMatchObject({ name: 'figma', cliName: 'plugin:figma:figma', needsAuth: ['/c1'] });
  });

  it('buildMcpTable_desactivado_noPideAuth', () => {
    const rows = buildMcpTable(inventory([row({ disabled: true })]), { '/c1': [live('a', 'needs-auth')] });

    expect(rows[0]).toMatchObject({ cliName: 'a', needsAuth: [] });
  });

  it('buildMcpTable_sinEstados_nadiePideAuth', () => {
    expect(buildMcpTable(inventory([row({})]), {})[0]?.needsAuth).toEqual([]);
  });
});

describe('filterMcpTable', () => {
  const rows = buildMcpTable(inventory([row({ name: 'huginndb' }), row({ name: 'playwright', transport: 'http' })]), {});

  it('filterMcpTable_vacio_todo', () => {
    expect(filterMcpTable(rows, '  ')).toHaveLength(2);
  });

  it('filterMcpTable_porNombreOTipo_sinMayusculas', () => {
    expect(filterMcpTable(rows, 'HUGIN').map((r) => r.name)).toEqual(['huginndb']);
    expect(filterMcpTable(rows, 'remoto').map((r) => r.name)).toEqual(['playwright']);
  });
});

describe('tagSessionServers', () => {
  it('tagSessionServers_insigniaPorOrigenYEstadoTraducido', () => {
    const result = tagSessionServers(
      [
        { name: 'db', status: 'connected' },
        { name: 'claude.ai Miro', status: 'needs-auth' },
        { name: 'plugin:figma:figma', status: 'pending' },
        { name: 'propio', status: 'failed' },
      ],
      ['db'],
    );

    expect(result.map((s) => [s.badge.label, s.statusLabel])).toEqual([
      ['Mage', 'Conectado'],
      ['claude.ai', 'Requiere autenticación'],
      ['Plugin figma', 'Pendiente'],
      ['Cuenta o proyecto', 'Falló'],
    ]);
  });

  it('tagSessionServers_sinServidores_vacio', () => {
    expect(tagSessionServers([], ['db'])).toEqual([]);
  });
});

describe('mcpAuthMessage', () => {
  it('mcpAuthMessage_cadaDesenlace_textoPropioYErrorTalCual', () => {
    expect(mcpAuthMessage({ kind: 'connected', statuses: null }).ok).toBe(true);
    expect(mcpAuthMessage({ kind: 'opened', statuses: null }).text).toMatch(/Comprobar estado/);
    expect(mcpAuthMessage({ kind: 'timeout', statuses: null })).toMatchObject({ ok: false });
    expect(mcpAuthMessage({ kind: 'error', message: 'Server not found: x' })).toEqual({ ok: false, text: 'Server not found: x' });
  });
});

describe('pestaña Servidores', () => {
  it('buildServersTable_sinConectoresDeClaudeAi_peroConPluginsYSoloClaude', () => {
    const rows = buildServersTable(inventory([row({})]), { '/c1': [reported('claude.ai Miro', 'needs-auth'), reported('plugin:figma:figma', 'connected')] });

    expect(rows.map((r) => [r.kind, r.name, r.ownedBy])).toEqual([
      ['server', 'a', null],
      ['plugin', 'figma', 'claude'],
    ]);
    expect(rows[0]!.providers).toEqual(['claude', 'codex', 'local']);
  });
});

describe('pestaña Conectores', () => {
  const ext = (patch: Partial<McpExtensionView>): McpExtensionView => ({
    id: 'db',
    displayName: 'Base de datos',
    version: '1',
    description: '',
    author: '',
    platforms: [],
    serverType: 'node',
    enabled: true,
    onlyIn: null,
    fields: [],
    missingRequired: [],
    problem: null,
    providers: ['claude'],
    dir: '/e/db',
    ...patch,
  });
  const input = (patch = {}) => ({
    accountIds: ['/c1', '/c2'],
    statuses: { '/c1': [reported('claude.ai Miro', 'needs-auth'), reported('plugin:figma:figma', 'connected'), reported('db', 'connected')] },
    cache: { '/c1': { checkedAt: '2026-10-01T09:00:00.000Z', servers: [] } },
    extensions: [ext({}), ext({ id: 'solo-c2', displayName: 'Solo c2', onlyIn: ['claude|/c2'] })],
    claudeAiOff: [] as string[],
    ...patch,
  });

  it('buildClaudeConnectorGroups_porCuenta_webComplementoEscritorioYChrome', () => {
    const [c1, c2] = buildClaudeConnectorGroups(input());

    expect(c1!.rows.map((r) => [r.name, r.typeLabel, r.statusLabel, r.needsAuth])).toEqual([
      ['Miro', 'Web', 'Requiere autenticación', true],
      ['figma (plugin figma)', 'Complemento', 'Conectado', false],
      ['Base de datos', 'Escritorio', 'Conectado', false],
      ['Claude in Chrome', 'Escritorio', 'Solo disponible en Claude Desktop', false],
    ]);
    expect(c1!.checkedAt).toBe('2026-10-01T09:00:00.000Z');
    expect(c2!.rows.map((r) => r.name)).toEqual(['Base de datos', 'Solo c2', 'Claude in Chrome']);
    expect(c2!.checkedAt).toBeNull();
  });

  it('buildClaudeConnectorGroups_conectoresApagados_sinConectarYDicho', () => {
    const [c1] = buildClaudeConnectorGroups(input({ claudeAiOff: ['/c1'] }));

    expect(c1).toMatchObject({ claudeAiEnabled: false });
    expect(c1!.rows[0]).toMatchObject({ name: 'Miro', statusLabel: 'Apagados en esta cuenta', needsAuth: false });
  });

  it('buildClaudeConnectorGroups_extensionConProblema_loEnseña', () => {
    const [c1] = buildClaudeConnectorGroups(input({ extensions: [ext({ problem: 'Falta configurar' })] }));

    expect(c1!.rows.find((r) => r.kind === 'extension')!.statusLabel).toBe('Falta configurar');
  });

  it('buildClaudeConnectorGroups_sinCuentas_vacio', () => {
    expect(buildClaudeConnectorGroups(input({ accountIds: [] }))).toEqual([]);
  });
});

describe('describeCheckedAt', () => {
  const now = new Date('2026-10-01T10:00:00.000Z');

  it.each([
    [null, 'Sin comprobar todavía'],
    ['2026-10-01T09:59:30.000Z', 'Última comprobación: hace un momento'],
    ['2026-10-01T09:55:00.000Z', 'Última comprobación: hace 5 min'],
    ['2026-10-01T07:00:00.000Z', 'Última comprobación: hace 3 h'],
    ['2026-09-28T10:00:00.000Z', 'Última comprobación: hace 3 días'],
    ['basura', 'Última comprobación: basura'],
  ])('describeCheckedAt_%s', (iso, text) => {
    expect(describeCheckedAt(iso, now)).toBe(text);
  });
});
