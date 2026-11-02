import { describe, expect, it, vi } from 'vitest';
import { localized, localizedWithParts } from '@shared/i18n/localizedText';
import type { CodexAccountMetadata } from '@shared/mcp';
import { createTranslator } from '@shared/i18n/translator';
import { esText } from '@testing/localizedText';
import { codexAppsErrorText, createCodexAppsStore } from './codexAppsStore';

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

    expect(esText(store.getState().results['/first']?.error ?? null)).toBe('No se pudieron consultar las Apps de esta cuenta.');
    expect(store.getState().results['/second']?.error).toBeNull();
    expect(store.getState().loading).toBe(false);
  });
});

describe('codexAppsErrorText', () => {
  it('codexAppsErrorText_errorDeSondeo_pintaLaFraseEnCastellanoConElReintento', () => {
    const error = localizedWithParts('mcp.main.codexProbeRejected', { code: '-32603' }, { query: localized('mcp.main.codexProbeAppsQuery') });

    expect(codexAppsErrorText(error, createTranslator('es'))).toBe('Codex rechazó la consulta de Apps (código -32603). Puedes volver a intentarlo.');
  });
});
