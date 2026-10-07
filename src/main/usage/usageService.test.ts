import { describe, expect, it, vi } from 'vitest';
import { UsageService, type UsageDeps } from './usageService';

// Respuesta minima valida del endpoint (con los campos de los que dependemos).
const OK_BODY = {
  five_hour: { utilization: 62, resets_at: '2026-07-15T12:00:00.000Z' },
  seven_day: { utilization: 31, resets_at: 1_760_000_000 }, // epoch en segundos
  limits: [
    { kind: 'model', group: 'opus', percent: 40, severity: 'ok', resets_at: null, is_active: true },
    { kind: 'model', group: 'sonnet', percent: 22, severity: 'ok', resets_at: null, is_active: false },
  ],
  spend: { used: { amount_minor: 0 } },
};

const TOKEN = 'sk-oauth-SECRET-TOKEN-value';

// Construye una Response-like para el fetch mock.
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    json: async () => body,
  } as unknown as Response;
}

function deps(overrides: Partial<UsageDeps> = {}): UsageDeps {
  return {
    fetch: vi.fn(async () => jsonResponse(OK_BODY)) as unknown as typeof fetch,
    readAccessToken: vi.fn(() => TOKEN),
    now: () => 1_000_000,
    userAgent: 'claude-code/2.1.205',
    ...overrides,
  };
}

describe('UsageService.getUsage', () => {
  it('getUsage_emptyConfigDir_throws', async () => {
    await expect(new UsageService(deps()).getUsage('  ')).rejects.toThrow(/configDir/i);
  });

  it('getUsage_happyPath_mapsFields', async () => {
    const info = await new UsageService(deps()).getUsage('/home/u/.claude-p');

    expect(info.fiveHour.utilization).toBe(62);
    expect(info.fiveHour.resetsAt).toBe(Date.parse('2026-07-15T12:00:00.000Z'));
    expect(info.sevenDay.utilization).toBe(31);
    expect(info.sevenDay.resetsAt).toBe(1_760_000_000 * 1000); // segundos -> ms
    expect(info.limits).toHaveLength(2);
    expect(info.limits[0]).toMatchObject({ group: 'opus', percent: 40, isActive: true });
    expect(info.apiCreditsMinor).toBe(0);
    expect(info.fetchedAt).toBe(1_000_000);
  });

  it('getUsage_sendsRequiredHeaders', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(OK_BODY)));
    await new UsageService(deps({ fetch: fetchMock as unknown as typeof fetch })).getUsage('/home/u/.claude');

    const init = fetchMock.mock.calls[0]![1];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(headers['User-Agent']).toBe('claude-code/2.1.205');
  });

  it('getUsage_withinTtl_servesFromCacheWithoutRefetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_BODY));
    const readToken = vi.fn(() => TOKEN);
    let clock = 1_000_000;
    const service = new UsageService(
      deps({ fetch: fetchMock as unknown as typeof fetch, readAccessToken: readToken, now: () => clock, cacheTtlMs: 180_000 }),
    );

    await service.getUsage('/home/u/.claude');
    clock += 179_000; // dentro del TTL
    await service.getUsage('/home/u/.claude');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readToken).toHaveBeenCalledTimes(1);
  });

  it('getUsage_afterTtl_refetchesAndRereadsToken', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_BODY));
    const readToken = vi.fn(() => TOKEN);
    let clock = 1_000_000;
    const service = new UsageService(
      deps({ fetch: fetchMock as unknown as typeof fetch, readAccessToken: readToken, now: () => clock, cacheTtlMs: 180_000 }),
    );

    await service.getUsage('/home/u/.claude');
    clock += 180_001; // pasado el TTL
    await service.getUsage('/home/u/.claude');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readToken).toHaveBeenCalledTimes(2); // relee el token en cada miss
  });

  it('getUsage_differentAccounts_cachedIndependently', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_BODY));
    const service = new UsageService(deps({ fetch: fetchMock as unknown as typeof fetch }));

    await service.getUsage('/home/u/.claude');
    await service.getUsage('/home/u/.claude-p');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getUsage_non200_throwsWithStatusNotToken', async () => {
    const service = new UsageService(
      deps({ fetch: (async () => jsonResponse({}, { ok: false, status: 429, statusText: 'Too Many Requests' })) as unknown as typeof fetch }),
    );

    const promise = service.getUsage('/home/u/.claude');
    await expect(promise).rejects.toThrow(/429/);
    await expect(promise).rejects.not.toThrow(new RegExp(TOKEN)); // el token nunca en el error
  });

  it('getUsage_tras429_segundaLlamadaEnCooldown_noReintentaFetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, { ok: false, status: 429, statusText: 'Too Many Requests' }));
    let clock = 1_000_000;
    const service = new UsageService(deps({ fetch: fetchMock as unknown as typeof fetch, now: () => clock }));

    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow(/429/);
    clock += 1_000; // muy por debajo del cooldown por defecto (60s)
    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow(/cooldown/i);

    expect(fetchMock).toHaveBeenCalledTimes(1); // la segunda ni intento la red
  });

  it('getUsage_tras429_pasadoElCooldown_reintentaFetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, { ok: false, status: 429, statusText: 'Too Many Requests' }));
    let clock = 1_000_000;
    const service = new UsageService(deps({ fetch: fetchMock as unknown as typeof fetch, now: () => clock }));

    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow(/429/);
    clock += 60_001; // pasado el cooldown por defecto (60s)
    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow(/429/);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getUsage_429ConRetryAfter_respetaElValorDelServidor', async () => {
    const retryAfterResponse = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: (name: string) => (name === 'retry-after' ? '5' : null) },
      json: async () => ({}),
    } as unknown as Response;
    const fetchMock = vi.fn(async () => retryAfterResponse);
    let clock = 1_000_000;
    const service = new UsageService(deps({ fetch: fetchMock as unknown as typeof fetch, now: () => clock }));

    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow(/429/);
    clock += 5_001; // pasado el Retry-After de 5s (por debajo del fallback de 60s)
    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow(/429/);

    expect(fetchMock).toHaveBeenCalledTimes(2); // reintento antes del fallback: se respeto Retry-After
  });

  it('getUsage_exitoTrasUn429_limpiaElCooldown', async () => {
    let responded429 = true;
    const fetchMock = vi.fn(async () =>
      responded429 ? jsonResponse({}, { ok: false, status: 429, statusText: 'Too Many Requests' }) : jsonResponse(OK_BODY),
    );
    let clock = 1_000_000;
    const service = new UsageService(deps({ fetch: fetchMock as unknown as typeof fetch, now: () => clock }));

    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow(/429/);
    responded429 = false;
    clock += 60_001; // pasado el cooldown, ahora responde OK
    await service.getUsage('/home/u/.claude');
    clock += 1; // sin avanzar el TTL: si el cooldown no se limpio, esto no se notaria; se comprueba con otro 429
    responded429 = true;
    clock += 180_001; // fuerza un miss de TTL para volver a tocar la red
    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow(/429/); // no "sigue en cooldown"

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('getUsage_invalidResponseType_throws', async () => {
    // utilization como string rompe el esquema (validacion de tipo en la frontera).
    const bad = { five_hour: { utilization: 'mucho' } };
    const service = new UsageService(
      deps({ fetch: (async () => jsonResponse(bad)) as unknown as typeof fetch }),
    );

    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow();
  });

  it('getUsage_missingOptionalFields_fillsSafeDefaults', async () => {
    const service = new UsageService(deps({ fetch: (async () => jsonResponse({})) as unknown as typeof fetch }));

    const info = await service.getUsage('/home/u/.claude');

    expect(info.fiveHour).toEqual({ utilization: 0, resetsAt: null });
    expect(info.sevenDay).toEqual({ utilization: 0, resetsAt: null });
    expect(info.limits).toEqual([]);
    expect(info.apiCreditsMinor).toBeNull();
  });

  it('getUsage_401SinUsoPrevio_lanzaSesionCaducadaSinToken', async () => {
    const service = new UsageService(
      deps({ fetch: (async () => jsonResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' })) as unknown as typeof fetch }),
    );

    const promise = service.getUsage('/home/u/.claude');

    await expect(promise).rejects.toThrow(/caducado/i);
    await expect(promise).rejects.not.toThrow(new RegExp(TOKEN));
  });

  it('getUsage_401ConUsoPrevio_sirveElUltimoValorConocido', async () => {
    // Primera llamada OK (cachea), TTL vencido, y la segunda devuelve 401: el panel no debe quedarse
    // en blanco — se sirve el valor anterior, cuyo `fetchedAt` delata que es viejo.
    let clock = 1_000_000;
    let unauthorized = false;
    const service = new UsageService(
      deps({
        now: () => clock,
        fetch: (async () =>
          unauthorized ? jsonResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' }) : jsonResponse(OK_BODY)) as unknown as typeof fetch,
      }),
    );
    const fresh = await service.getUsage('/home/u/.claude');

    unauthorized = true;
    clock += 200_000; // supera el TTL de 180 s
    const served = await service.getUsage('/home/u/.claude');

    expect(served).toEqual(fresh);
    expect(served.fetchedAt).toBe(1_000_000); // el de la lectura buena, no el del intento fallido
  });

  it('getUsage_tras401_dentroDelCooldown_noReintentaFetch', async () => {
    let clock = 1_000_000;
    let unauthorized = false;
    const fetchMock = vi.fn(async () =>
      unauthorized ? jsonResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' }) : jsonResponse(OK_BODY),
    );
    const service = new UsageService(deps({ now: () => clock, fetch: fetchMock as unknown as typeof fetch }));
    await service.getUsage('/home/u/.claude');

    unauthorized = true;
    clock += 200_000;
    await service.getUsage('/home/u/.claude'); // 401 -> cooldown
    clock += 200_000; // TTL vencido otra vez, pero seguimos dentro del cooldown de 5 min
    await service.getUsage('/home/u/.claude');

    expect(fetchMock).toHaveBeenCalledTimes(2); // la tercera no llega a la red
  });

  it('getUsage_401ConRenovacionCorrecta_reintentaYDevuelveElUso', async () => {
    let calls = 0;
    const refreshSession = vi.fn(async () => 'sk-renovado');
    const service = new UsageService(
      deps({
        refreshSession,
        fetch: (async () => {
          calls += 1;
          return calls === 1 ? jsonResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' }) : jsonResponse(OK_BODY);
        }) as unknown as typeof fetch,
      }),
    );

    const info = await service.getUsage('/home/u/.claude');

    expect(refreshSession).toHaveBeenCalledWith('/home/u/.claude');
    expect(info.fiveHour.utilization).toBe(62);
    expect(calls).toBe(2); // uno con el token caducado, otro con el renovado
  });

  it('getUsage_401TrasRenovar_noReintentaUnaSegundaVez', async () => {
    // Si el token recien renovado tambien da 401, el problema no es la caducidad: reintentar en bucle
    // solo gastaria red.
    const fetchMock = vi.fn(async () => jsonResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' }));
    const service = new UsageService(deps({ refreshSession: async () => 'sk-renovado', fetch: fetchMock as unknown as typeof fetch }));

    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow(/caducado/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getUsage_401ConRenovacionFallida_degradaAlUltimoValorConocido', async () => {
    let clock = 1_000_000;
    let unauthorized = false;
    const service = new UsageService(
      deps({
        now: () => clock,
        refreshSession: async () => null, // no se pudo renovar
        fetch: (async () =>
          unauthorized ? jsonResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' }) : jsonResponse(OK_BODY)) as unknown as typeof fetch,
      }),
    );
    const fresh = await service.getUsage('/home/u/.claude');

    unauthorized = true;
    clock += 200_000;

    expect(await service.getUsage('/home/u/.claude')).toEqual(fresh);
  });

  it('getUsage_401_avisaPorLogSinFiltrarElToken', async () => {
    const log = vi.fn();
    const service = new UsageService(
      deps({ log, fetch: (async () => jsonResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' })) as unknown as typeof fetch }),
    );

    await expect(service.getUsage('/home/u/.claude')).rejects.toThrow();

    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('/home/u/.claude'));
    expect(log).not.toHaveBeenCalledWith('warn', expect.stringContaining(TOKEN));
  });
});

// Fase 9.3: el stream del CLI regala la foto de consumo en cada turno. Complementa al endpoint, no lo
// sustituye — y sobre todo, NUNCA debe empeorar lo que el endpoint ya sabia.
describe('UsageService.recordStreamUsage (uso por stream, 9.3)', () => {
  const DIR = '/home/u/.claude';
  const W = (utilization: number, resetsAt: number | null = null): { utilization: number; resetsAt: number | null } => ({
    utilization,
    resetsAt,
  });

  it('recordStreamUsage_configDirVacio_lanza', () => {
    expect(() => new UsageService(deps()).recordStreamUsage('  ', { fiveHour: W(10), sevenDay: null })).toThrow(/configDir/i);
  });

  it('recordStreamUsage_masRecienteQueElEndpoint_superponeSusVentanas', async () => {
    let ahora = 1_000_000;
    const service = new UsageService(deps({ now: () => ahora }));
    await service.getUsage(DIR); // endpoint: 62 % / 31 %

    ahora = 1_000_500;
    service.recordStreamUsage(DIR, { fiveHour: W(70, 5_000), sevenDay: W(40) });
    const info = await service.getUsage(DIR); // sigue dentro del TTL: sirve cache + stream encima

    expect(info.fiveHour).toEqual({ utilization: 70, resetsAt: 5_000 });
    expect(info.sevenDay.utilization).toBe(40);
    expect(info.fetchedAt).toBe(1_000_500); // la marca es la del dato que se ensena
  });

  it('recordStreamUsage_masRecienteQueElEndpoint_noBorraLimitsNiCreditos', async () => {
    let ahora = 1_000_000;
    const service = new UsageService(deps({ now: () => ahora }));
    await service.getUsage(DIR);

    ahora = 1_000_500;
    service.recordStreamUsage(DIR, { fiveHour: W(70), sevenDay: W(40) });
    const info = await service.getUsage(DIR);

    expect(info.limits).toHaveLength(2); // el stream no los trae: los del endpoint siguen ahi
    expect(info.apiCreditsMinor).toBe(0);
  });

  it('recordStreamUsage_ventanaNula_dejaLaDelEndpointEnPie', async () => {
    let ahora = 1_000_000;
    const service = new UsageService(deps({ now: () => ahora }));
    await service.getUsage(DIR);

    ahora = 1_000_500;
    service.recordStreamUsage(DIR, { fiveHour: null, sevenDay: W(40) });
    const info = await service.getUsage(DIR);

    expect(info.fiveHour.utilization).toBe(62); // null = "no se sabe", no "cero"
    expect(info.sevenDay.utilization).toBe(40);
  });

  it('recordStreamUsage_lasDosVentanasNulas_noSeGuarda', async () => {
    let ahora = 1_000_000;
    const service = new UsageService(deps({ now: () => ahora }));
    await service.getUsage(DIR);

    ahora = 1_000_500;
    service.recordStreamUsage(DIR, { fiveHour: null, sevenDay: null });
    const info = await service.getUsage(DIR);

    expect(info.fetchedAt).toBe(1_000_000); // no hay foto nueva que ensenar
  });

  it('recordStreamUsage_masViejaQueElEndpoint_noPisaAlEndpoint', async () => {
    let ahora = 1_000_000;
    const service = new UsageService(deps({ now: () => ahora }));
    service.recordStreamUsage(DIR, { fiveHour: W(70), sevenDay: W(40) });

    ahora = 1_000_500;
    const info = await service.getUsage(DIR); // el endpoint responde DESPUES: manda el

    expect(info.fiveHour.utilization).toBe(62);
  });

  it('getUsage_endpointCaidoSinValorPrevio_sirveLaFotoDelStreamEnVezDeLanzar', async () => {
    const service = new UsageService(
      deps({ fetch: vi.fn(async () => jsonResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' })) as unknown as typeof fetch }),
    );
    service.recordStreamUsage(DIR, { fiveHour: W(70, 9_000), sevenDay: null });

    const info = await service.getUsage(DIR);

    expect(info.fiveHour).toEqual({ utilization: 70, resetsAt: 9_000 });
    expect(info.sevenDay).toEqual({ utilization: 0, resetsAt: null }); // sin dato, no fingido
    expect(info.limits).toEqual([]);
    expect(info.apiCreditsMinor).toBeNull();
  });
});

describe('UsageService.getStreamUsage', () => {
  it('getStreamUsage_sinFotoDeLaSesion_devuelveNullSinLanzar', () => {
    expect(new UsageService(deps()).getStreamUsage('C:\home\.codex-x')).toBeNull();
  });

  it('getStreamUsage_conFoto_devuelveSusVentanas', () => {
    const service = new UsageService(deps());
    service.recordStreamUsage('C:\home\.codex-x', { fiveHour: { utilization: 10, resetsAt: null }, sevenDay: null });

    expect(service.getStreamUsage('C:\home\.codex-x')?.fiveHour.utilization).toBe(10);
  });
});
