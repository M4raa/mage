import { describe, expect, it, vi } from 'vitest';
import type { CodexAccountMetadata } from '@shared/mcp';
import { createCodexAppsStore } from './codexAppsStore';

describe('createCodexAppsStore', () => {
  it('refresh_consultasRepetidas_noDuplicaElSondeoPendiente', async () => {
    let finish: (value: CodexAccountMetadata) => void = () => undefined;
    const pending = new Promise<CodexAccountMetadata>((resolve) => { finish = resolve; });
    const readCodexApps = vi.fn(() => pending);
    const store = createCodexAppsStore({ readCodexApps });

    const first = store.getState().refresh(['/test']);
    const second = store.getState().refresh(['/test']);
    finish({ authenticated: true, apps: [], error: null });
    await first;
    await second;

    expect(readCodexApps).toHaveBeenCalledOnce();
    expect(store.getState().loading).toBe(false);
  });
  it('refresh_unaCuentaFalla_conservaResultadosYErrorSeguro', async () => {
    const readCodexApps = vi.fn().mockRejectedValueOnce(new Error('synthetic-private')).mockResolvedValueOnce({ authenticated: true, apps: [], error: null });
    const store = createCodexAppsStore({ readCodexApps });

    await store.getState().refresh(['/first', '/second']);

    expect(store.getState().results['/first']?.error).toBe('No se pudieron consultar las Apps de esta cuenta.');
    expect(store.getState().results['/second']?.error).toBeNull();
    expect(store.getState().loading).toBe(false);
  });
});
