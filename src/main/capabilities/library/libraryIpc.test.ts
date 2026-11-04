import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@shared/ipc';
import { parseLibraryApplyParams, registerLibraryIpc } from './libraryIpc';
import { redactSecrets } from './librarySecrets';
import type { LibraryService } from './libraryService';

type Listener = (event: unknown, arg: unknown) => unknown;

function setup() {
  const handlers = new Map<string, Listener>();
  const service = { view: vi.fn(), preview: vi.fn(), apply: vi.fn(async () => ({ status: 'done' })) };
  registerLibraryIpc({
    handle: (channel, listener) => void handlers.set(channel, listener),
    service: () => service as unknown as LibraryService,
  });
  const call = (channel: string, arg?: unknown): unknown => (handlers.get(channel) as Listener)(null, arg);
  return { handlers, service, call };
}

const VALID = { packageId: 'context7', engine: 'claude', accountDir: '/a/.claude' };

describe('registerLibraryIpc', () => {
  it('registerLibraryIpc_registersThreeChannels', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([IpcChannel.LibraryApply, IpcChannel.LibraryPreview, IpcChannel.LibraryView].sort());
  });

  it('libraryApply_invalidAction_throwsWithValue', () => {
    const { call } = setup();

    expect(() => call(IpcChannel.LibraryApply, { ...VALID, action: 'format' })).toThrow(/inválida.*format/);
  });

  it('libraryPreview_missingAccountDir_throws', () => {
    const { call } = setup();

    expect(() => call(IpcChannel.LibraryPreview, { packageId: 'context7', engine: 'claude' })).toThrow(/accountDir/);
  });

  it('libraryApply_validParams_callsServiceWithAction', async () => {
    const { call, service } = setup();

    await call(IpcChannel.LibraryApply, { ...VALID, action: 'install' });

    expect(service.apply).toHaveBeenCalledWith('install', VALID, undefined);
  });
});

describe('parseLibraryApplyParams', () => {
  it('parseLibraryApplyParams_conSecretos_losPasa', () => {
    // Arrange
    const raw = { ...VALID, action: 'install', secrets: { EXA_API_KEY: 'valor-secreto' } };
    // Act
    const params = parseLibraryApplyParams(raw);
    // Assert
    expect(params.secrets).toEqual({ EXA_API_KEY: 'valor-secreto' });
  });

  it('parseLibraryApplyParams_invalidoConSecreto_mensajeSinElValor', () => {
    // Arrange: nombre inválido (minúsculas) con un valor que no debe aparecer
    const raw = { ...VALID, action: 'install', secrets: { exa_key: 'valor-secreto-123' } };
    // Act
    const act = (): unknown => parseLibraryApplyParams(raw);
    // Assert
    expect(act).toThrow(/inválida/);
    expect(act).toThrow(/<oculto>/);
    expect(act).not.toThrow(/valor-secreto-123/);
  });

  it('parseLibraryApplyParams_secretosNoRegistro_mensajeSinElValor', () => {
    // Arrange
    const raw = { ...VALID, action: 'install', secrets: 'valor-secreto-123' };
    // Act / Assert
    expect(() => parseLibraryApplyParams(raw)).not.toThrow(/valor-secreto-123/);
  });
});

describe('redactSecrets', () => {
  it('redactSecrets_noMuta', () => {
    // Arrange
    const raw = { ...VALID, secrets: { A: 'uno', B: 'dos' } };
    // Act
    const redacted = redactSecrets(raw);
    // Assert
    expect(raw.secrets).toEqual({ A: 'uno', B: 'dos' });
    expect(redacted).toEqual({ ...VALID, secrets: { A: '<oculto>', B: '<oculto>' } });
  });

  it('redactSecrets_sinSecretos_devuelveIgual', () => {
    expect(redactSecrets(VALID)).toBe(VALID);
    expect(redactSecrets(null)).toBeNull();
  });
});
