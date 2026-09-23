import { describe, expect, it } from 'vitest';
import { CLIENT_ID, SCOPES, buildRefreshBody, parseStoredOauth, toRefreshedOauth, tokenResponseSchema } from './oauthFlow';

// Tras la Fase 9.2 este modulo ya NO tiene flujo de authorization code: el login lo hace el CLI y Mage
// nunca ve un token nuevo. Los tests de PKCE, authorize URL, parseo del callback, intercambio del
// code, perfil y roles se fueron con el codigo que probaban.
//
// Lo que se queda es la RENOVACION (decision D7), y aqui gana cobertura DIRECTA: hasta ahora sus tres
// funciones puras solo se ejercitaban de refilon, a traves de TokenRefreshService.

const TOKEN_OK = { access_token: 'at-nuevo', refresh_token: 'rt-nuevo', expires_in: 3600 };
const PREVIO = {
  accessToken: 'at-viejo',
  refreshToken: 'rt-viejo',
  expiresAt: 1_000,
  scopes: ['user:profile'],
  subscriptionType: 'max',
  rateLimitTier: 'tier1',
} as const;

describe('buildRefreshBody', () => {
  it('buildRefreshBody_refreshToken_construyeElGrantDeRenovacion', () => {
    expect(buildRefreshBody('rt-123')).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt-123',
      client_id: CLIENT_ID,
    });
  });

  it('buildRefreshBody_tokenVacio_lanzaEnVezDeMandarUnaPeticionInutil', () => {
    expect(() => buildRefreshBody('')).toThrow(/refresh token/i);
  });
});

describe('tokenResponseSchema (frontera laxa)', () => {
  it('tokenResponseSchema_camposExtra_losTolera', () => {
    expect(tokenResponseSchema.parse({ ...TOKEN_OK, algo_nuevo: true }).access_token).toBe('at-nuevo');
  });

  it('tokenResponseSchema_sinAccessToken_lanza', () => {
    expect(() => tokenResponseSchema.parse({ refresh_token: 'rt', expires_in: 10 })).toThrow();
  });

  it('tokenResponseSchema_sinRefreshTokenOSinExpiresIn_lanza', () => {
    // B8: eran opcionales y se rellenaban con "" y 0 — un refreshToken vacio hacia que la convergencia
    // pisara el login recien hecho. Si el servidor deja de mandarlos hay que enterarse en el momento.
    expect(() => tokenResponseSchema.parse({ access_token: 'at', expires_in: 10 })).toThrow();
    expect(() => tokenResponseSchema.parse({ access_token: 'at', refresh_token: 'rt' })).toThrow();
  });
});

describe('toRefreshedOauth', () => {
  it('toRefreshedOauth_tokenNuevo_calculaExpiresAtConElRelojInyectado', () => {
    const result = toRefreshedOauth(tokenResponseSchema.parse(TOKEN_OK), PREVIO, 10_000);

    expect(result.accessToken).toBe('at-nuevo');
    expect(result.expiresAt).toBe(10_000 + 3600 * 1000);
  });

  it('toRefreshedOauth_sinPerfil_conservaSubscriptionTypeYRateLimitTier', () => {
    // Una renovacion nunca debe EMPEORAR el fichero que encontro: recalcularlos sin perfil (que aqui no
    // se consulta) los pondria a null y borraria metadata que el CLI usa.
    const result = toRefreshedOauth(tokenResponseSchema.parse(TOKEN_OK), PREVIO, 0);

    expect(result.subscriptionType).toBe('max');
    expect(result.rateLimitTier).toBe('tier1');
  });

  it('toRefreshedOauth_sinScopeEnLaRespuesta_conservaLosAnteriores', () => {
    expect(toRefreshedOauth(tokenResponseSchema.parse(TOKEN_OK), PREVIO, 0).scopes).toEqual(['user:profile']);
  });

  it('toRefreshedOauth_conScopeEnLaRespuesta_loPartePorEspacios', () => {
    const token = tokenResponseSchema.parse({ ...TOKEN_OK, scope: 'user:profile user:inference' });

    expect(toRefreshedOauth(token, PREVIO, 0).scopes).toEqual(['user:profile', 'user:inference']);
  });
});

describe('parseStoredOauth', () => {
  const enDisco = {
    claudeAiOauth: { accessToken: 'at', refreshToken: 'rt', expiresAt: 123, subscriptionType: 'pro', rateLimitTier: null },
  };

  it('parseStoredOauth_ficheroValido_devuelveElBloque', () => {
    expect(parseStoredOauth(enDisco)).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 123,
      scopes: [...SCOPES], // sin scopes en disco, se rellena con los del CLI
      subscriptionType: 'pro',
      rateLimitTier: null,
    });
  });

  it('parseStoredOauth_ficheroVaciadoPorElCli_devuelveNull', () => {
    // Caso REAL del grupo G: al fallar un refresh, el CLI deja un .credentials.json con tokens vacios.
    expect(parseStoredOauth({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } })).toBeNull();
  });

  it('parseStoredOauth_sinBloqueONoEsObjeto_devuelveNull', () => {
    expect(parseStoredOauth({})).toBeNull();
    expect(parseStoredOauth(null)).toBeNull();
    expect(parseStoredOauth('{}')).toBeNull();
  });

  it('parseStoredOauth_camposExtraDelCli_losTolera', () => {
    const conExtras = { ...enDisco, otraClave: 1, claudeAiOauth: { ...enDisco.claudeAiOauth, algoNuevo: true } };

    expect(parseStoredOauth(conExtras)?.accessToken).toBe('at');
  });
});
