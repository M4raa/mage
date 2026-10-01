import { describe, expect, it } from 'vitest';
import { parseCodexAppList, parseCodexMcpList } from './codexMcp';

// Fixture: salida REAL de `codex mcp list --json` (codex-cli 0.144.4, CODEX_HOME aislado,
// spike/mcp-providers-spike.mjs), con los valores falsos del spike.
const LIST = JSON.stringify([
  {
    name: 'vg-local',
    enabled: true,
    disabled_reason: null,
    transport: { type: 'stdio', command: 'node', args: ['server.js'], env: { VG_KEY: 'vg-secret' }, env_vars: [], cwd: null },
    startup_timeout_sec: null,
    tool_timeout_sec: null,
    auth_status: 'unsupported',
  },
  {
    name: 'vg-remote',
    enabled: false,
    disabled_reason: null,
    transport: { type: 'streamable_http', url: 'https://vg.invalid/mcp', bearer_token_env_var: 'VG_TOKEN', http_headers: null, env_http_headers: null },
    startup_timeout_sec: null,
    tool_timeout_sec: null,
    auth_status: 'bearer_token',
  },
  { name: 'raro', enabled: true, transport: { type: 'websocket' } },
  { sinNombre: true },
]);

describe('parseCodexMcpList', () => {
  it('parseCodexMcpList_salidaMedida_formaDeMcpJson', () => {
    const [local, http, raro] = parseCodexMcpList(LIST);

    expect(local).toEqual({ name: 'vg-local', enabled: true, authStatus: 'unsupported', config: { type: 'stdio', command: 'node', args: ['server.js'], env: { VG_KEY: 'vg-secret' } } });
    expect(http).toEqual({ name: 'vg-remote', enabled: false, authStatus: 'bearer_token', config: { type: 'http', url: 'https://vg.invalid/mcp' } });
    expect(raro).toMatchObject({ name: 'raro', config: null });
  });

  it('parseCodexMcpList_entradaSinNombre_seOmite', () => {
    expect(parseCodexMcpList(LIST)).toHaveLength(3);
  });

  it('parseCodexMcpList_listaVacia_vacia', () => {
    expect(parseCodexMcpList('[]')).toEqual([]);
  });

  it('parseCodexMcpList_noJson_lanzaSinElTexto', () => {
    expect(() => parseCodexMcpList('{"env":"vg-secret"')).toThrow(/caracteres/);
    expect(() => parseCodexMcpList('{"env":"vg-secret"')).not.toThrow(/vg-secret/);
  });

  it('parseCodexMcpList_noEsLista_lanza', () => {
    expect(() => parseCodexMcpList('{}')).toThrow(/lista/);
  });
});

describe('parseCodexAppList', () => {
  it('parseCodexAppList_sinCuenta_vacioYSinCursor', () => {
    expect(parseCodexAppList({ data: [], nextCursor: null })).toEqual({ apps: [], nextCursor: null });
  });

  // Segun el esquema AppInfo de `codex app-server generate-json-schema` 0.144.4 (SIN VERIFICAR con cuenta).
  it('parseCodexAppList_segunElEsquema_camposDeLaVista', () => {
    const result = parseCodexAppList({
      data: [
        { id: 'gdrive', name: 'Google Drive', description: null, isAccessible: true, isEnabled: true, installUrl: null, logoUrl: 'x' },
        { id: 'slack', name: 'Slack', installUrl: 'https://chatgpt.com/apps/slack' },
        { id: '', name: 'roto' },
      ],
      nextCursor: 'c2',
    });

    expect(result.apps).toEqual([
      { id: 'gdrive', name: 'Google Drive', description: '', enabled: true, accessible: true, installUrl: null },
      { id: 'slack', name: 'Slack', description: '', enabled: true, accessible: false, installUrl: 'https://chatgpt.com/apps/slack' },
    ]);
    expect(result.nextCursor).toBe('c2');
  });

  it('parseCodexAppList_sinData_lanza', () => {
    expect(() => parseCodexAppList({ apps: [] })).toThrow(/app\/list/);
  });
});
