import { describe, expect, it, vi } from 'vitest';
import { FrameClient, readCapped, type FrameClientDeps } from './frameClient';

const TOKEN = 'oauth-SECRET-token';
const FRESH = 'oauth-FRESH-token';
const PATH = '/api/frame/artifacts?rel=mine';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function deps(overrides: Partial<FrameClientDeps> = {}): FrameClientDeps {
  return {
    fetch: vi.fn(async () => json({ artifacts: [] })) as unknown as typeof fetch,
    readAccessToken: vi.fn(() => TOKEN),
    cliVersion: '2.1.319',
    sessionId: 'session-1',
    ...overrides,
  };
}

function headersOf(fetchMock: { mock: { calls: unknown[][] } }, call: number): Record<string, string> {
  return (fetchMock.mock.calls[call]![1] as RequestInit).headers as Record<string, string>;
}

// El error con el que rechaza la promesa; falla el test si resuelve.
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  const outcome = await promise.then(() => null, (err: unknown) => err);
  if (!(outcome instanceof Error)) throw new Error(`Se esperaba un rechazo con Error y llego: ${String(outcome)}`);
  return outcome;
}

describe('FrameClient.getJson', () => {
  it('getJson_happyPath_sendsCliHeadersToApiHost', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => json({ artifacts: [] }));
    const client = new FrameClient(deps({ fetch: fetchMock as unknown as typeof fetch }));

    // Act
    const body = await client.getJson('/home/u/.claude', PATH);

    // Assert
    expect(body).toEqual({ artifacts: [] });
    expect((fetchMock.mock.calls as unknown[][])[0]![0]).toBe(`https://api.anthropic.com${PATH}`);
    expect(headersOf(fetchMock, 0)).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-code/2.1.319',
      'X-Frame-CP': 'go',
      'X-Frame-Surface': 'code',
      'X-Frame-Platform': 'cli',
      'X-Frame-Client-Version': '2.1.319',
      'X-Frame-Session-Id': 'session-1',
    });
  });

  it('getJson_eachCall_rereadsToken', async () => {
    // Arrange
    const readAccessToken = vi.fn(() => TOKEN);
    const client = new FrameClient(deps({ readAccessToken }));

    // Act
    await client.getJson('/home/u/.claude', PATH);
    await client.getJson('/home/u/.claude', PATH);

    // Assert
    expect(readAccessToken).toHaveBeenCalledTimes(2);
  });

  it('getJson_401ThenRefresh_retriesOnceWithNewToken', async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ ok: 1 }));
    const refreshSession = vi.fn(async () => FRESH);
    const client = new FrameClient(deps({ fetch: fetchMock as unknown as typeof fetch, refreshSession }));

    // Act
    const body = await client.getJson('/home/u/.claude', PATH);

    // Assert
    expect(body).toEqual({ ok: 1 });
    expect(refreshSession).toHaveBeenCalledWith('/home/u/.claude');
    expect(headersOf(fetchMock, 1).Authorization).toBe(`Bearer ${FRESH}`);
  });

  it('getJson_401WithoutRefresher_throwsSessionExpiredOfThatAccount', async () => {
    // Arrange
    const client = new FrameClient(deps({ fetch: vi.fn(async () => json({}, 401)) as unknown as typeof fetch }));

    // Act + Assert
    await expect(client.getJson('/home/u/.claude-p', PATH)).rejects.toThrow(/caducado[\s\S]*\.claude-p|\.claude-p[\s\S]*caducado/);
  });

  it('getJson_401AfterRefresh_throwsSessionExpiredWithoutThirdCall', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => json({}, 401));
    const client = new FrameClient(deps({ fetch: fetchMock as unknown as typeof fetch, refreshSession: async () => FRESH }));

    // Act + Assert
    await expect(client.getJson('/home/u/.claude', PATH)).rejects.toThrow(/caducado/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getJson_refreshFails_throwsSessionExpired', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => json({}, 401));
    const client = new FrameClient(deps({ fetch: fetchMock as unknown as typeof fetch, refreshSession: async () => null }));

    // Act + Assert
    await expect(client.getJson('/home/u/.claude', PATH)).rejects.toThrow(/caducado/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getJson_serverError_throwsWithStatusAndNeverToken', async () => {
    // Arrange
    const client = new FrameClient(deps({ fetch: vi.fn(async () => json({}, 503)) as unknown as typeof fetch }));

    // Act
    const error = await rejectionOf(client.getJson('/home/u/.claude', PATH));

    // Assert
    expect(error.message).toContain('503');
    expect(error.message).not.toContain(TOKEN);
  });

  it('getJson_notJson_throwsWithPath', async () => {
    // Arrange
    const client = new FrameClient(deps({ fetch: vi.fn(async () => new Response('not found', { status: 200 })) as unknown as typeof fetch }));

    // Act + Assert
    await expect(client.getJson('/home/u/.claude', PATH)).rejects.toThrow(/no es JSON.*\/api\/frame\/artifacts/);
  });
});

describe('FrameClient.getAsset', () => {
  it('getAsset_happyPath_sendsNoAuthorization', async () => {
    // Arrange
    const fetchMock = vi.fn(async () => new Response('<html></html>', { status: 200 }));
    const client = new FrameClient(deps({ fetch: fetchMock as unknown as typeof fetch }));

    // Act
    const bytes = await client.getAsset('https://x.frame.claudeusercontent.com/_f/1/index.html?__frame_t=SECRET', 1024, 'index.html');

    // Assert
    expect(new TextDecoder().decode(bytes)).toBe('<html></html>');
    expect(headersOf(fetchMock, 0)).toEqual({ 'User-Agent': 'claude-code/2.1.319' });
  });

  it('getAsset_notOk_throwsWithLabelAndNotUrl', async () => {
    // Arrange
    const client = new FrameClient(deps({ fetch: vi.fn(async () => new Response('', { status: 302 })) as unknown as typeof fetch }));

    // Act
    const error = await rejectionOf(client.getAsset('https://x.frame.claudeusercontent.com/_f/1/a.css?__frame_t=SECRET', 1024, 'a.css'));

    // Assert
    expect(error.message).toContain('a.css');
    expect(error.message).toContain('302');
    expect(error.message).not.toContain('SECRET');
  });
});

describe('readCapped', () => {
  it('readCapped_underLimit_returnsBytes', async () => {
    // Act
    const bytes = await readCapped(new Response('abc'), 3, 'f');

    // Assert
    expect(bytes.byteLength).toBe(3);
  });

  it('readCapped_overLimit_throwsTooLarge', async () => {
    // Act + Assert
    await expect(readCapped(new Response('abcd'), 3, 'grande.html')).rejects.toThrow(/grande\.html/);
  });

  it('readCapped_declaredLengthOverLimit_throwsBeforeReading', async () => {
    // Arrange
    const response = new Response('a', { headers: { 'content-length': '999999' } });

    // Act + Assert
    await expect(readCapped(response, 10, 'f')).rejects.toThrow(/tope/);
  });

  it('readCapped_emptyBody_returnsEmpty', async () => {
    // Act
    const bytes = await readCapped(new Response(null, { status: 204 }), 10, 'f');

    // Assert
    expect(bytes.byteLength).toBe(0);
  });
});
