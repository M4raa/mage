import { describe, expect, it, vi } from 'vitest';
import { StatusService, type StatusDeps } from './statusService';

const OK_BODY = {
  status: { indicator: 'minor', description: 'Partial Outage' },
  incidents: [{ name: 'Elevated errors', status: 'investigating', impact: 'minor' }],
};

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    json: async () => body,
  } as unknown as Response;
}

function deps(overrides: Partial<StatusDeps> = {}): StatusDeps {
  return {
    fetch: vi.fn(async () => jsonResponse(OK_BODY)) as unknown as typeof fetch,
    now: () => 1_000_000,
    ...overrides,
  };
}

describe('StatusService.getStatus', () => {
  it('getStatus_happyPath_mapsFields', async () => {
    const info = await new StatusService(deps()).getStatus();

    expect(info.indicator).toBe('minor');
    expect(info.description).toBe('Partial Outage');
    expect(info.incidents).toEqual([{ name: 'Elevated errors', status: 'investigating', impact: 'minor' }]);
    expect(info.fetchedAt).toBe(1_000_000);
  });

  it('getStatus_unknownIndicator_normalizesToNone', async () => {
    const service = new StatusService(
      deps({ fetch: (async () => jsonResponse({ status: { indicator: 'weird' } })) as unknown as typeof fetch }),
    );

    expect((await service.getStatus()).indicator).toBe('none');
  });

  it('getStatus_withinTtl_servesFromCache', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_BODY));
    let clock = 1_000_000;
    const service = new StatusService(deps({ fetch: fetchMock as unknown as typeof fetch, now: () => clock, cacheTtlMs: 60_000 }));

    await service.getStatus();
    clock += 59_000;
    await service.getStatus();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getStatus_afterTtl_refetches', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OK_BODY));
    let clock = 1_000_000;
    const service = new StatusService(deps({ fetch: fetchMock as unknown as typeof fetch, now: () => clock, cacheTtlMs: 60_000 }));

    await service.getStatus();
    clock += 60_001;
    await service.getStatus();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getStatus_non200_throwsWithStatus', async () => {
    const service = new StatusService(
      deps({ fetch: (async () => jsonResponse({}, { ok: false, status: 503, statusText: 'Service Unavailable' })) as unknown as typeof fetch }),
    );

    await expect(service.getStatus()).rejects.toThrow(/503/);
  });

  it('getStatus_missingFields_fillsSafeDefaults', async () => {
    const service = new StatusService(deps({ fetch: (async () => jsonResponse({})) as unknown as typeof fetch }));

    const info = await service.getStatus();

    expect(info.indicator).toBe('none');
    expect(info.description).toBe('');
    expect(info.incidents).toEqual([]);
  });
});
