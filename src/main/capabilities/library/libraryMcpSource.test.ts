import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toClaudeMcpConfig, toCodexOverrides } from '../../config/mcpProviderTranslate';
import type { ResolvedStdioServer } from '../../config/mcpResolved';
import { loadBundledCatalog } from '../catalog/libraryCatalog';
import type { CapabilityEngine } from '../capabilityPackage';
import { librarySecretId } from './librarySecrets';
import { resolveLibraryMcp, type LibraryMcpContext } from './libraryMcpSource';
import type { LibraryInstallRecord } from './libraryState';

const ACCOUNT = join(resolve('/mage'), '.claude');
const OTHER_ACCOUNT = join(resolve('/mage'), '.claude-b');
const SECRET = 'sk-exa-valor-secreto-9f8e7d';
const exa = (() => {
  const entry = loadBundledCatalog().find((e) => e.id === 'exa-mcp');
  if (entry === undefined) throw new Error('Falta exa-mcp en el catálogo');
  return entry.package;
})();

const record = (over: Partial<LibraryInstallRecord> = {}): LibraryInstallRecord => ({
  packageId: exa.id, engine: 'claude', accountDir: ACCOUNT, version: exa.version, enabled: true, package: exa, ...over,
});
const idOf = (engine: CapabilityEngine = 'claude', accountDir = ACCOUNT): string =>
  librarySecretId({ packageId: exa.id, engine, accountDir }, 'EXA_API_KEY', false);
const ctxWith = (stored: Record<string, string>, platform: NodeJS.Platform = 'linux'): LibraryMcpContext => ({
  vault: { get: (id) => stored[id] ?? null }, platform, caseInsensitive: false,
});
const withKey = (engine: CapabilityEngine = 'claude') => ctxWith({ [idOf(engine)]: SECRET });
const TARGET = { engine: 'claude' as const, accountDir: ACCOUNT };

describe('resolveLibraryMcp', () => {
  it('resolveLibraryMcp_exaClaude_envConReferenciaYSecreto', () => {
    // Arrange / Act
    const { servers, warnings } = resolveLibraryMcp([record()], TARGET, withKey());
    // Assert
    const server = servers[0] as ResolvedStdioServer;
    expect(warnings).toEqual([]);
    expect(server).toMatchObject({ transport: 'stdio', name: 'exa', source: 'library', onlyIn: null, cwd: null });
    expect(server.env.EXA_API_KEY).toBe('${MAGE_MCP_SECRET_EXA_ENV_EXA_API_KEY}');
    expect(server.secrets).toEqual({ MAGE_MCP_SECRET_EXA_ENV_EXA_API_KEY: SECRET });
    expect(JSON.stringify([server.command, server.args, server.env])).not.toContain(SECRET);
  });

  it('resolveLibraryMcp_otraCuenta_vacio', () => {
    expect(resolveLibraryMcp([record({ accountDir: OTHER_ACCOUNT })], TARGET, withKey()).servers).toEqual([]);
  });

  it('resolveLibraryMcp_otroMotor_vacio', () => {
    expect(resolveLibraryMcp([record()], { engine: 'codex', accountDir: ACCOUNT }, withKey()).servers).toEqual([]);
  });

  it('resolveLibraryMcp_desactivado_vacio', () => {
    expect(resolveLibraryMcp([record({ enabled: false })], TARGET, withKey()).servers).toEqual([]);
  });

  it('resolveLibraryMcp_sinClave_avisoSinValor', () => {
    // Arrange / Act
    const result = resolveLibraryMcp([record()], TARGET, ctxWith({}));
    // Assert
    expect(result.servers).toEqual([]);
    expect(result.warnings).toEqual(['«exa-mcp» de la biblioteca omitido: falta su clave en la bóveda']);
  });

  it('resolveLibraryMcp_sinSecretos_noEsDeEstaFuente', () => {
    // Arrange: context7 no pide clave, así que lo gestiona el CLI
    const c7 = loadBundledCatalog().find((e) => e.id === 'context7')?.package;
    if (c7 === undefined) throw new Error('Falta context7');
    // Act / Assert
    expect(resolveLibraryMcp([record({ packageId: c7.id, package: c7, version: c7.version })], TARGET, withKey())).toEqual({ servers: [], warnings: [] });
  });

  it('resolveLibraryMcp_windows_cmdBarraC', () => {
    // Arrange / Act
    const server = resolveLibraryMcp([record()], TARGET, ctxWith({ [idOf()]: SECRET }, 'win32')).servers[0] as ResolvedStdioServer;
    // Assert
    expect(server.command).toBe('cmd');
    expect(server.args.slice(0, 2)).toEqual(['/c', 'npx']);
  });

  it('resolveLibraryMcp_registroRaro_avisoYSigueConLosDemas', () => {
    // Arrange: un registro con un paquete que no declara el motor de su registro
    const odd = record({ package: { ...exa, engines: ['codex'] } });
    // Act
    const result = resolveLibraryMcp([odd, record({ packageId: 'x' })], TARGET, withKey());
    // Assert
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(' ')).not.toContain(SECRET);
  });

  it('resolveLibraryMcp_traducidoAClaude_ficheroSinLaClave', () => {
    // Arrange
    const { servers } = resolveLibraryMcp([record()], TARGET, withKey());
    // Act
    const { config, env } = toClaudeMcpConfig(servers);
    // Assert
    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(Object.values(env)).toContain(SECRET);
  });

  it('resolveLibraryMcp_traducidoACodex_argumentosSinLaClave', () => {
    // Arrange
    const { servers } = resolveLibraryMcp([record({ engine: 'codex', accountDir: ACCOUNT })], { engine: 'codex', accountDir: ACCOUNT }, withKey('codex'));
    // Act
    const { args, env } = toCodexOverrides(servers);
    // Assert
    expect(args.join(' ')).not.toContain(SECRET);
    expect(env.EXA_API_KEY).toBe(SECRET);
    expect(args.some((arg) => arg.includes('env_vars=["EXA_API_KEY"]'))).toBe(true);
  });
});
