import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agyConfigVersion, AgySyncService, planAgySync, type AgySyncDeps } from './mcpAgySync';
import { resolveServerConfig, type ResolvedMcpServer } from './mcpResolved';

const local = resolveServerConfig('db', { command: 'node', args: ['db.js'], env: { K: 'v' } }, 'common', null);
const remote = resolveServerConfig('api', { type: 'http', url: 'https://api.dev' }, 'common', null);
const sse = resolveServerConfig('viejo', { type: 'sse', url: 'https://s.dev' }, 'common', null);
const userEntry = { command: 'suyo', args: [], env: {}, disabled: false };

describe('planAgySync', () => {
  it('planAgySync_ficheroAusente_añadeLasDeMage', () => {
    const plan = planAgySync(null, [local, remote], []);

    expect(plan.changes).toEqual([
      { name: 'db', action: 'add', reason: null },
      { name: 'api', action: 'add', reason: null },
    ]);
    expect(JSON.parse(plan.text!).mcpServers).toEqual({
      db: { command: 'node', args: ['db.js'], env: { K: 'v' }, disabled: false },
      api: { serverUrl: 'https://api.dev', headers: {}, disabled: false },
    });
    expect(plan.exported).toEqual(['db', 'api']);
  });

  it('planAgySync_entradaDelUsuarioConElMismoNombre_noSeTocaYSeAvisa', () => {
    const text = JSON.stringify({ mcpServers: { db: userEntry } });

    const plan = planAgySync(text, [local], []);

    expect(plan.text).toBeNull();
    expect(plan.changes).toEqual([{ name: 'db', action: 'skip', reason: expect.stringContaining('no puso Mage') }]);
    expect(plan.exported).toEqual([]);
  });

  it('planAgySync_quitadaDeMage_seBorraDeAgySinTocarLoDelUsuario', () => {
    const text = JSON.stringify({ mcpServers: { suyo: userEntry, db: { command: 'node' } }, otra: 1 });

    const plan = planAgySync(text, [], ['db']);

    expect(plan.changes).toEqual([{ name: 'db', action: 'remove', reason: null }]);
    expect(JSON.parse(plan.text!)).toEqual({ mcpServers: { suyo: userEntry }, otra: 1 });
  });

  it('planAgySync_igualQueLoExportado_sinCambios', () => {
    const first = planAgySync(null, [local], []);

    const second = planAgySync(first.text, [local], first.exported);

    expect(second).toEqual({ text: null, changes: [], exported: ['db'] });
  });

  it('planAgySync_desactivadaEnAgy_seRespetaAlActualizar', () => {
    const text = JSON.stringify({ mcpServers: { db: { command: 'viejo', args: [], env: {}, disabled: true } } });

    const plan = planAgySync(text, [local], ['db']);

    expect(plan.changes).toEqual([{ name: 'db', action: 'update', reason: null }]);
    expect(JSON.parse(plan.text!).mcpServers.db.disabled).toBe(true);
  });

  // Un valor de la boveda solo acaba en el fichero de agy si el usuario lo confirma.
  it('planAgySync_extensionConSecretoSinConfirmar_noSeCopiaNiAparece', () => {
    const ext = { ...local, name: 'ext', env: { K: '${MAGE_MCP_SECRET_EXT_K}' }, secrets: { MAGE_MCP_SECRET_EXT_K: 'valor-de-la-boveda' } };

    const plan = planAgySync(null, [local, ext], []);

    expect(plan.changes.find((c) => c.name === 'ext')).toMatchObject({ action: 'skip', reason: expect.stringContaining('bóveda') });
    expect(plan.text).not.toContain('valor-de-la-boveda');
    expect(plan.exported).toEqual(['db']);
  });

  it('planAgySync_extensionConSecretoConfirmada_seCopiaEnClaro', () => {
    const ext = { ...local, name: 'ext', env: { K: '${MAGE_MCP_SECRET_EXT_K}' }, secrets: { MAGE_MCP_SECRET_EXT_K: 'valor-de-la-boveda' } };

    expect(planAgySync(null, [ext], [], new Set(['ext'])).text).toContain('valor-de-la-boveda');
  });

  it('planAgySync_confirmacionRetirada_quitaLoExportado', () => {
    const ext = { ...local, name: 'ext', secrets: { MAGE_MCP_SECRET_EXT_K: 'v' } };
    const first = planAgySync(null, [ext], [], new Set(['ext']));

    const second = planAgySync(first.text, [ext], first.exported);

    expect(second.changes).toContainEqual({ name: 'ext', action: 'remove', reason: null });
    expect(second.text).not.toContain('"ext"');
  });

  it('planAgySync_sse_seSaltaConMotivo', () => {
    expect(planAgySync(null, [sse], []).changes).toEqual([{ name: 'viejo', action: 'skip', reason: 'agy no admite servidores SSE' }]);
  });

  it('planAgySync_ficheroQueNoEsJson_lanzaSinElContenido', () => {
    expect(() => planAgySync('{"env":"secreto"', [local], [])).toThrow(/caracteres/);
    expect(() => planAgySync('{"env":"secreto"', [local], [])).not.toThrow(/secreto/);
  });
});

// FS en memoria con el contrato de AtomicWriteDeps.
function setup(servers: readonly ResolvedMcpServer[]) {
  const files = new Map<string, string>();
  const root = join(sep, 'u');
  const deps: AgySyncDeps = {
    configPath: join(root, '.gemini', 'config', 'mcp_config.json'),
    statePath: join(root, 'ud', 'agy-sync.json'),
    backupDir: join(root, 'ud', 'agy-backups'),
    fs: {
      exists: (p) => files.has(p),
      readFile: (p) => {
        const text = files.get(p);
        if (text === undefined) throw new Error(`ENOENT ${p}`);
        return text;
      },
      writeFile: (p, d) => void files.set(p, d),
      rename: (a, b) => {
        files.set(b, files.get(a)!);
        files.delete(a);
      },
      removeFile: (p) => void files.delete(p),
      tempSuffix: () => 'tmp',
      mkdir: () => undefined,
      listDir: (dir) => [...files.keys()].filter((f) => f.startsWith(dir + sep)).map((f) => f.slice(dir.length + 1)),
    },
    now: () => new Date('2026-10-01T10:00:00.000Z'),
    servers: () => servers,
  };
  return { files, deps, service: new AgySyncService(deps) };
}

describe('AgySyncService', () => {
  it('apply_conLaHuellaDeLaVistaPrevia_escribeCopiaYRecuerdaLoExportado', () => {
    const { service, files, deps } = setup([local]);
    files.set(deps.configPath, JSON.stringify({ mcpServers: { suyo: userEntry } }));

    const preview = service.preview();
    const result = service.apply(preview.expected);

    expect(result.status).toBe('saved');
    expect(result.status === 'saved' && result.backupPath).toBe(join(deps.backupDir, 'mcp_config-2026-10-01T10-00-00-000Z.json'));
    expect(Object.keys(JSON.parse(files.get(deps.configPath)!).mcpServers)).toEqual(['suyo', 'db']);
    expect(service.state()).toMatchObject({ exported: ['db'], lastSyncAt: '2026-10-01T10:00:00.000Z', lastError: null });
  });

  it('apply_ficheroCambiadoTrasLaVistaPrevia_staleSinEscribir', () => {
    const { service, files, deps } = setup([local]);
    const preview = service.preview();
    files.set(deps.configPath, '{"mcpServers":{}}');

    expect(service.apply(preview.expected).status).toBe('stale');
    expect(files.get(deps.configPath)).toBe('{"mcpServers":{}}');
  });

  it('autoSync_nuncaConfirmaSecretosPorSuCuenta', () => {
    const ext = { ...local, name: 'ext', secrets: { MAGE_MCP_SECRET_EXT_K: 'valor-de-la-boveda' }, env: { K: '${MAGE_MCP_SECRET_EXT_K}' } };
    const { service, files, deps } = setup([ext]);
    service.setAuto(true);

    service.autoSync();

    expect(files.get(deps.configPath) ?? '').not.toContain('valor-de-la-boveda');
    expect(service.preview().secretServers).toEqual(['ext']);
  });

  it('apply_conConfirmacion_laGuardaYLaUsaLaAutomatica', () => {
    const ext = { ...local, name: 'ext', secrets: { MAGE_MCP_SECRET_EXT_K: 'v' } };
    const { service } = setup([ext]);

    service.apply(service.preview().expected, ['ext']);

    expect(service.state().secretsConfirmed).toEqual(['ext']);
    expect(service.state().exported).toEqual(['ext']);
  });

  it('autoSync_apagada_noHaceNada', () => {
    const { service, files, deps } = setup([local]);

    expect(service.autoSync()).toBeNull();
    expect(files.has(deps.configPath)).toBe(false);
  });

  it('autoSync_encendida_sincroniza', () => {
    const { service, files, deps } = setup([local]);
    service.setAuto(true);

    expect(service.autoSync()?.status).toBe('saved');
    expect(files.has(deps.configPath)).toBe(true);
  });

  it('autoSync_ficheroRoto_guardaElErrorEnElEstado', () => {
    const { service, files, deps } = setup([local]);
    service.setAuto(true);
    files.set(deps.configPath, '{');

    expect(service.autoSync()?.status).toBe('stale');
    expect(service.state().lastError).toContain('JSON');
  });

  it('state_ilegible_porDefectoConElErrorDicho', () => {
    const { service, files, deps } = setup([]);
    files.set(deps.statePath, '{');

    expect(service.state()).toMatchObject({ auto: false, exported: [], lastError: expect.stringContaining('ilegible') });
  });

  it('agyConfigVersion_ausenteYCambio', () => {
    expect(agyConfigVersion(null)).toBeNull();
    expect(agyConfigVersion('a')).not.toBe(agyConfigVersion('b'));
  });
});
