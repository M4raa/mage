import { describe, expect, it, vi } from 'vitest';
import { TokenRefreshService, type TokenRefreshDeps } from './tokenRefreshService';
import type { ClaudeAiOauth } from './oauthFlow';

const PREVIOUS: ClaudeAiOauth = {
  accessToken: 'sk-viejo-SECRETO',
  refreshToken: 'rt-viejo-SECRETO',
  expiresAt: 1_000,
  scopes: ['user:inference'],
  subscriptionType: 'max',
  rateLimitTier: 'tier-3',
};

const OK_TOKEN = { access_token: 'sk-nuevo', refresh_token: 'rt-nuevo', expires_in: 3600 };

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    json: async () => body,
  } as unknown as Response;
}

function deps(overrides: Partial<TokenRefreshDeps> = {}): TokenRefreshDeps {
  return {
    fetch: vi.fn(async () => jsonResponse(OK_TOKEN)) as unknown as typeof fetch,
    readOauthBlock: vi.fn(() => PREVIOUS),
    writeOauthBlock: vi.fn(),
    now: () => 5_000,
    log: vi.fn(),
    ...overrides,
  };
}

describe('TokenRefreshService.refresh', () => {
  it('refresh_configDirVacio_lanza', async () => {
    await expect(new TokenRefreshService(deps()).refresh('  ')).rejects.toThrow(/configDir/i);
  });

  it('refresh_happyPath_devuelveElTokenNuevoYLoPersiste', async () => {
    const writeOauthBlock = vi.fn();
    const service = new TokenRefreshService(deps({ writeOauthBlock }));

    const token = await service.refresh('/home/u/.claude');

    expect(token).toBe('sk-nuevo');
    expect(writeOauthBlock).toHaveBeenCalledWith('/home/u/.claude', expect.objectContaining({ accessToken: 'sk-nuevo', refreshToken: 'rt-nuevo' }));
  });

  it('refresh_sinPerfil_conservaSubscriptionTypeYRateLimitTier', async () => {
    // Una renovacion NO consulta el perfil; recalcular esa metadata la pondria a null y empeoraria el
    // fichero que se encontro.
    const writeOauthBlock = vi.fn();
    const service = new TokenRefreshService(deps({ writeOauthBlock }));

    await service.refresh('/home/u/.claude');

    expect(writeOauthBlock).toHaveBeenCalledWith('/home/u/.claude', expect.objectContaining({ subscriptionType: 'max', rateLimitTier: 'tier-3' }));
  });

  it('refresh_expiresAtSeCalculaConElRelojInyectado', async () => {
    const writeOauthBlock = vi.fn();
    const service = new TokenRefreshService(deps({ writeOauthBlock, now: () => 5_000 }));

    await service.refresh('/home/u/.claude');

    expect(writeOauthBlock).toHaveBeenCalledWith('/home/u/.claude', expect.objectContaining({ expiresAt: 5_000 + 3_600_000 }));
  });

  it('refresh_sinCredencialesEnDisco_devuelveNullSinLlamarALaRed', async () => {
    const fetchMock = vi.fn();
    const service = new TokenRefreshService(deps({ readOauthBlock: () => null, fetch: fetchMock as unknown as typeof fetch }));

    expect(await service.refresh('/home/u/.claude')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh_servidorRechaza_devuelveNullSinEscribir', async () => {
    const writeOauthBlock = vi.fn();
    const service = new TokenRefreshService(
      deps({
        writeOauthBlock,
        fetch: (async () => jsonResponse({}, { ok: false, status: 400, statusText: 'Bad Request' })) as unknown as typeof fetch,
      }),
    );

    expect(await service.refresh('/home/u/.claude')).toBeNull();
    expect(writeOauthBlock).not.toHaveBeenCalled();
  });

  it('refresh_respuestaQueNoValidaElEsquema_devuelveNull', async () => {
    const service = new TokenRefreshService(deps({ fetch: (async () => jsonResponse({ access_token: '' })) as unknown as typeof fetch }));

    expect(await service.refresh('/home/u/.claude')).toBeNull();
  });

  it('refresh_falloDeRed_devuelveNullSinPropagar', async () => {
    const service = new TokenRefreshService(
      deps({
        fetch: (async () => {
          throw new Error('ECONNRESET');
        }) as unknown as typeof fetch,
      }),
    );

    expect(await service.refresh('/home/u/.claude')).toBeNull();
  });

  it('refresh_noSePuedeEscribir_devuelveNullAunqueElTokenSeaValido', async () => {
    // Devolver el token sin persistirlo dejaria el fichero con el viejo: el siguiente arranque volveria
    // a fallar sin explicacion.
    const service = new TokenRefreshService(
      deps({
        writeOauthBlock: () => {
          throw new Error('EACCES');
        },
      }),
    );

    expect(await service.refresh('/home/u/.claude')).toBeNull();
  });

  it('refresh_dosLlamadasSimultaneas_hacenUnSoloGrant', async () => {
    // Dos paneles pidiendo uso a la vez no deben gastar el mismo refresh token dos veces.
    const fetchMock = vi.fn(async () => jsonResponse(OK_TOKEN));
    const service = new TokenRefreshService(deps({ fetch: fetchMock as unknown as typeof fetch }));

    const [a, b] = await Promise.all([service.refresh('/home/u/.claude'), service.refresh('/home/u/.claude')]);

    expect(a).toBe('sk-nuevo');
    expect(b).toBe('sk-nuevo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refresh_nuncaLogueaNingunToken', async () => {
    const log = vi.fn();
    const service = new TokenRefreshService(deps({ log }));

    await service.refresh('/home/u/.claude');

    const messages = log.mock.calls.map((call) => String(call[1])).join('\n');
    expect(messages).not.toContain(PREVIOUS.refreshToken);
    expect(messages).not.toContain('sk-nuevo');
  });
});
