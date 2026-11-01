import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@shared/ipc';
import { localized } from '@shared/i18n/localizedText';
import type { McpWriteResult } from '@shared/mcp';
import { esText } from '@testing/localizedText';
import { registerMcpIpc, type McpIpcDeps } from './mcpIpc';
import { SharedConfigService, type SharedConfigDeps } from './sharedConfigService';

const COMMON_PATH = '/userData/shared-config/mcp-common.json';

// Solo se ejercita el cableado de `McpCommonMutate`: el resto de deps no se tocan al registrar ni al mutar.
function register(commonText: string | null): Map<string, (event: unknown, ...args: never[]) => unknown> {
  const handlers = new Map<string, (event: unknown, ...args: never[]) => unknown>();
  const fsDeps: SharedConfigDeps = {
    exists: () => commonText !== null,
    readFile: () => commonText ?? '',
    writeFile: vi.fn(),
    rename: vi.fn(),
    removeFile: vi.fn(),
    tempSuffix: () => 'tmp',
    ensureDir: vi.fn(),
    log: vi.fn(),
  };
  registerMcpIpc({
    handle: ((channel, listener) => void handlers.set(channel, listener)) satisfies McpIpcDeps['handle'],
    service: new SharedConfigService(fsDeps),
    commonPath: () => COMMON_PATH,
    onSharedChanged: vi.fn(),
  } as unknown as McpIpcDeps);
  return handlers;
}

describe('registerMcpIpc McpCommonMutate', () => {
  it('McpCommonMutate_huellaDistintaALaDeDisco_staleConLaFraseDeMage', () => {
    const handler = register('{"mcpServers": {}}').get(IpcChannel.McpCommonMutate)!;

    const result = (handler as (event: unknown, params: unknown) => McpWriteResult)(null, { expected: 'huella-vieja', mutation: { op: 'remove', name: 'a' } });

    expect(result).toEqual({ status: 'stale', message: localized('mcp.main.commonChangedOutside') });
    expect(result.status === 'stale' && esText(result.message)).toBe('mcp-common.json ha cambiado fuera de esta pantalla. Se ha recargado: revisa la lista y repite el cambio.');
  });
});
