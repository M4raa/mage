import { describe, expect, it, vi } from 'vitest';
import type { AccountInfo } from '@shared/accounts';
import { CodexAccountCatalog } from './codexAccountCatalog';

const account: AccountInfo = { configDir: '/codex-test', name: 'test', isMain: false, providerId: 'codex',
  authKind: 'subscription', email: null, org: null, loginStatus: 'logged_in', expiresAt: null, defaultModel: null };

describe('CodexAccountCatalog', () => {
  it('list_sondeoPendiente_devuelveLasCuentasSinEsperarAlCli', async () => {
    const catalog = new CodexAccountCatalog({ probe: () => new Promise(() => undefined), now: () => 0, onError: vi.fn() });

    const result = await Promise.race([catalog.list([account]), Promise.resolve('bloqueado')]);

    expect(result).toEqual([account]);
  });

  it('confirm_falloSeguro_conservaLaFotoYNotificaLaCategoria', async () => {
    const onError = vi.fn();
    const catalog = new CodexAccountCatalog({ probe: async () => ({ authenticated: null, apps: [], error: 'timeout' }), now: () => 0, onError });

    const result = await catalog.confirm([account]);

    expect(result).toEqual([account]);
    expect(onError).toHaveBeenCalledWith('timeout');
  });

  it('confirm_consultasConcurrentes_reutilizaLaPeticionYLaCacheHastaSuCaducidad', async () => {
    let now = 0;
    const probe = vi.fn(async () => ({ authenticated: false, apps: [], error: null }));
    const catalog = new CodexAccountCatalog({ probe, now: () => now, onError: vi.fn() });

    const first = catalog.confirm([account]);
    const concurrent = catalog.confirm([account]);
    await first;
    await catalog.confirm([account]);

    expect(concurrent).toBe(first);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(catalog.list([account])[0]?.loginStatus).toBe('logged_out');
    now = 60_000;
    await catalog.confirm([account]);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('confirm_cuentaApiOSinLogin_noLanzaSondeos', async () => {
    const probe = vi.fn();
    const catalog = new CodexAccountCatalog({ probe, now: () => 0, onError: vi.fn() });
    const accounts: AccountInfo[] = [{ ...account, authKind: 'api-key' }, { ...account, loginStatus: 'logged_out' }];

    const result = await catalog.confirm(accounts);

    expect(probe).not.toHaveBeenCalled();
    expect(result).toEqual(accounts);
  });
});
