import { describe, expect, it, vi } from 'vitest';
import { buildMcpCommonImport, SharedConfigService, type SharedConfigDeps } from './sharedConfigService';

// P-026 2.5 (D10): la primera vez, mcp-common.json se crea con la union de `mcp-shared.json` y los MCP
// de ambito usuario de cada cuenta. Formas REALES (nombres cambiados): el script de PowerShell escribe
// con BOM y cada `.claude.json` trae `oauthAccount` junto a `mcpServers`.
const SERVER_A = { type: 'stdio', command: 'npx', args: ['-y', 'a'], env: {} };
const SERVER_A_OTRO = { type: 'stdio', command: 'node', args: ['a.js'], env: {} };
const SERVER_B = { type: 'stdio', command: 'uvx', args: ['b'], env: { B_TOKEN: 'secreto' } };

const shared = (servers: Record<string, unknown> | null) => ({
  label: 'mcp-shared.json',
  text: servers === null ? null : `﻿${JSON.stringify({ mcpServers: servers })}`,
});
const account = (label: string, servers: Record<string, unknown>) => ({
  label,
  text: JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c', accountUuid: 'u-1' }, userID: 'id-1', mcpServers: servers }),
});

describe('buildMcpCommonImport', () => {
  it('buildMcpCommonImport_sinFuentes_vacioYSinNotas', () => {
    expect(buildMcpCommonImport(shared(null), [])).toEqual({ mcpServers: {}, notes: [] });
  });

  it('buildMcpCommonImport_uneLasFuentes_yToleraElBom', () => {
    const result = buildMcpCommonImport(shared({ a: SERVER_A }), [account('.claude', { b: SERVER_B })]);

    expect(result.mcpServers).toEqual({ a: SERVER_A, b: SERVER_B });
    expect(result.notes).toEqual([]);
  });

  it('buildMcpCommonImport_colisionConOtraConfig_ganaMcpSharedYLoAvisa', () => {
    const result = buildMcpCommonImport(shared({ a: SERVER_A }), [account('.claude-p', { a: SERVER_A_OTRO })]);

    expect(result.mcpServers).toEqual({ a: SERVER_A });
    expect(result.notes).toEqual(['«a» está en mcp-shared.json y en .claude-p con otra configuración: se queda la de mcp-shared.json.']);
  });

  it('buildMcpCommonImport_mismaConfigEnDosSitios_sinNota', () => {
    expect(buildMcpCommonImport(shared({ a: SERVER_A }), [account('.claude', { a: SERVER_A })]).notes).toEqual([]);
  });

  it('buildMcpCommonImport_nuncaSacaOauthAccountNiUserId', () => {
    const out = JSON.stringify(buildMcpCommonImport(shared(null), [account('.claude', { b: SERVER_B })]));

    expect(out).not.toContain('oauthAccount');
    expect(out).not.toContain('a@b.c');
    expect(out).not.toContain('id-1');
  });

  it('buildMcpCommonImport_jsonInvalido_lanzaConLaFuenteYSinElTexto', () => {
    const roto = { label: '.claude-p', text: '{"mcpServers": {"b": {"env": {"B_TOKEN": "secreto"' };

    expect(() => buildMcpCommonImport(shared(null), [roto])).toThrow(/\.claude-p no es JSON valido/);
    expect(() => buildMcpCommonImport(shared(null), [roto])).not.toThrow(/secreto/);
  });

  it('buildMcpCommonImport_mcpServersQueNoEsObjeto_lanza', () => {
    expect(() => buildMcpCommonImport({ label: 'mcp-shared.json', text: '{"mcpServers": []}' }, [])).toThrow(/mcpServers/);
  });
});

describe('SharedConfigService.importMcpCommonIfMissing', () => {
  function deps(overrides: Partial<SharedConfigDeps> = {}): SharedConfigDeps {
    return {
      exists: () => false,
      readFile: () => '{}',
      writeFile: () => undefined,
      rename: () => undefined,
      ensureDir: () => undefined,
      tempSuffix: () => 'tmp1',
      log: () => undefined,
      ...overrides,
    };
  }

  it('importMcpCommonIfMissing_noExiste_loCreaConLaUnion', () => {
    const writeFile = vi.fn();
    const service = new SharedConfigService(deps({ writeFile }));

    const notes = service.importMcpCommonIfMissing('/u/mcp-common.json', shared({ a: SERVER_A }), []);

    expect(notes).toEqual([]);
    expect(JSON.parse(String(writeFile.mock.calls[0]?.[1]))).toEqual({ mcpServers: { a: SERVER_A } });
  });

  it('importMcpCommonIfMissing_yaExiste_noImporta', () => {
    const writeFile = vi.fn();
    const service = new SharedConfigService(deps({ exists: () => true, writeFile }));

    expect(service.importMcpCommonIfMissing('/u/mcp-common.json', shared({ a: SERVER_A }), [])).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
