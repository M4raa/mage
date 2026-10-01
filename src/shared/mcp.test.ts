import { describe, expect, it } from 'vitest';
import { familiesInScope, isInMcpScope, mcpFamilyOf, toServerDraft, toServerObject, transportOf, validateServerDraft, validateServers, type McpServerDraft } from './mcp';

// P-028 punto 5, bug HTTP/SSE: el editor antiguo exigia `command` a todos y lo escribia siempre, asi
// que un servidor remoto no se podia guardar. Y `env` viajaba en claro al renderer.
const LOCAL = { type: 'stdio', command: 'npx', args: ['-y', 'srv'], env: { API_TOKEN: 'secreto-local' }, cwd: '/tmp/x' };
const REMOTE = { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer secreto-remoto' } };

const draft = (patch: Partial<McpServerDraft>): McpServerDraft => ({
  name: 'srv',
  transport: 'stdio',
  command: 'npx',
  argsText: '',
  url: '',
  env: [],
  headers: [],
  ...patch,
});

describe('transportOf', () => {
  it('transportOf_typeConocido_loRespeta', () => {
    expect(transportOf({ type: 'sse', url: 'https://x' })).toBe('sse');
  });

  it('transportOf_urlSinType_esHttp', () => {
    expect(transportOf({ url: 'https://x' })).toBe('http');
  });

  it('transportOf_sinUrlNiType_esLocal', () => {
    expect(transportOf({ command: 'node' })).toBe('stdio');
    expect(transportOf(null)).toBe('stdio');
  });
});

describe('toServerDraft', () => {
  it('toServerDraft_local_enmascaraLosValoresDeEnv', () => {
    const result = toServerDraft('srv', LOCAL);

    expect(result).toMatchObject({ transport: 'stdio', command: 'npx', argsText: '-y\nsrv' });
    expect(result.env).toEqual([{ key: 'API_TOKEN', value: null }]);
    expect(JSON.stringify(result)).not.toContain('secreto');
  });

  it('toServerDraft_remoto_urlYCabecerasEnmascaradas', () => {
    const result = toServerDraft('srv', REMOTE);

    expect(result).toMatchObject({ transport: 'http', url: REMOTE.url, command: '' });
    expect(result.headers).toEqual([{ key: 'Authorization', value: null }]);
    expect(JSON.stringify(result)).not.toContain('secreto');
  });

  it('toServerDraft_conValoresRevelados_losRellena', () => {
    const result = toServerDraft('srv', REMOTE, { env: {}, headers: { Authorization: 'Bearer secreto-remoto' } });

    expect(result.headers).toEqual([{ key: 'Authorization', value: 'Bearer secreto-remoto' }]);
  });
});

describe('toServerObject', () => {
  it('toServerObject_idaYVueltaLocal_conservaValoresOcultosYCamposAjenos', () => {
    expect(toServerObject(toServerDraft('srv', LOCAL), LOCAL)).toEqual(LOCAL);
  });

  it('toServerObject_idaYVueltaRemoto_sinCommandYConCabeceras', () => {
    const result = toServerObject(toServerDraft('srv', REMOTE), REMOTE);

    expect(result).toEqual(REMOTE);
    expect(result).not.toHaveProperty('command');
  });

  it('toServerObject_nuevoRemotoSse_escribeTypeYUrl', () => {
    const result = toServerObject(draft({ transport: 'sse', command: '', url: ' https://x.dev/sse ' }), null);

    expect(result).toEqual({ type: 'sse', url: 'https://x.dev/sse' });
  });

  it('toServerObject_deLocalARemoto_quitaCommandArgsYEnv', () => {
    const next = { ...toServerDraft('srv', LOCAL), transport: 'http' as const, url: 'https://x.dev/mcp', env: [] };

    expect(toServerObject(next, LOCAL)).toEqual({ type: 'http', url: 'https://x.dev/mcp', cwd: '/tmp/x' });
  });

  it('toServerObject_valorNuevo_sustituyeAlGuardado', () => {
    const next = draft({ env: [{ key: 'API_TOKEN', value: 'otro' }] });

    expect(toServerObject(next, LOCAL).env).toEqual({ API_TOKEN: 'otro' });
  });

  it('toServerObject_claveQuitada_desapareceDelEnv', () => {
    expect(toServerObject({ ...toServerDraft('srv', LOCAL), env: [] }, LOCAL)).not.toHaveProperty('env');
  });

  it('toServerObject_valorOcultoSinGuardado_lanzaNombrandoLaClave', () => {
    expect(() => toServerObject(draft({ env: [{ key: 'NUEVA', value: null }] }), LOCAL)).toThrow('"NUEVA"');
  });

  it('toServerObject_borradorInvalido_lanza', () => {
    expect(() => toServerObject(draft({ command: '  ' }), null)).toThrow('no tiene comando');
  });
});

describe('validateServerDraft', () => {
  it('validateServerDraft_remotoSinCommand_esValido', () => {
    expect(validateServerDraft(draft({ transport: 'http', command: '', url: 'https://x.dev' }))).toBeNull();
  });

  it('validateServerDraft_remotoSinUrlOConOtroProtocolo_loDice', () => {
    expect(validateServerDraft(draft({ transport: 'http', url: '' }))).toContain('URL');
    expect(validateServerDraft(draft({ transport: 'sse', url: 'ftp://x' }))).toContain('URL');
  });

  it('validateServerDraft_localSinComando_loDice', () => {
    expect(validateServerDraft(draft({ command: '' }))).toContain('no tiene comando');
  });

  it('validateServerDraft_sinNombre_loDice', () => {
    expect(validateServerDraft(draft({ name: ' ' }))).toContain('nombre');
  });

  it('validateServerDraft_claveVaciaORepetida_loDice', () => {
    expect(validateServerDraft(draft({ env: [{ key: '', value: 'x' }] }))).toContain('clave vacía');
    const repeated = [{ key: 'A', value: '1' }, { key: 'A', value: '2' }];
    expect(validateServerDraft(draft({ transport: 'http', url: 'https://x', headers: repeated }))).toContain('repetida');
  });
});

describe('validateServers', () => {
  it('validateServers_nombresRepetidos_loDice', () => {
    expect(validateServers([draft({}), draft({})])).toContain('dos servidores');
  });

  it('validateServers_listaVacia_esValida', () => {
    expect(validateServers([])).toBeNull();
  });
});

describe('«Solo en…»', () => {
  it('mcpFamilyOf_idsDeMage_suFamilia', () => {
    expect(['claude', 'agy', 'codex', 'custom:ollama', 'openai'].map(mcpFamilyOf)).toEqual(['claude', 'agy', 'codex', 'local', 'local']);
  });

  it('isInMcpScope_null_todos', () => {
    expect(isInMcpScope(null, { family: 'agy', accountId: null })).toBe(true);
  });

  it('isInMcpScope_familiaOCuenta', () => {
    const scope = ['codex', 'claude|/h/.claude-p'];

    expect(isInMcpScope(scope, { family: 'codex', accountId: '/x' })).toBe(true);
    expect(isInMcpScope(scope, { family: 'claude', accountId: '/h/.claude-p' })).toBe(true);
    expect(isInMcpScope(scope, { family: 'claude', accountId: '/h/.claude' })).toBe(false);
    expect(isInMcpScope(scope, { family: 'claude', accountId: null })).toBe(false);
  });

  it('familiesInScope_cuentaSuelta_cuentaComoSuFamilia', () => {
    expect(familiesInScope(['claude|/h', 'local'])).toEqual(['claude', 'local']);
    expect(familiesInScope(null)).toEqual(['claude', 'codex', 'agy', 'local']);
  });
});
