import { describe, expect, it } from 'vitest';
import { ModelCatalog } from './modelCatalog';
import { parseRuntimeProbeParams, probeRuntimeEndpoint } from './runtimeProbe';

const KEY = 'sk-de-la-boveda-123';

// `fetch` falso que registra la cabecera Authorization y devuelve un catalogo LM Studio.
function catalogWith(seen: string[], fail = false): ModelCatalog {
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers.authorization !== undefined) seen.push(headers.authorization);
    if (fail) return new Response(`clave incorrecta: ${KEY}`, { status: 401 });
    const path = new URL(typeof input === 'string' ? input : input.toString()).pathname;
    if (path === '/v1/models') return Response.json({ data: [{ id: 'qwen' }, { id: 'llama' }] });
    if (path === '/api/v1/models') return Response.json({ models: [{ key: 'qwen', max_context_length: 32768, capabilities: { trained_for_tool_use: true } }] });
    return new Response('no', { status: 404 });
  }) as typeof globalThis.fetch;
  return new ModelCatalog({ fetch, now: () => 0 });
}

describe('parseRuntimeProbeParams', () => {
  it('parse_withApiKeyField_rejected', () => {
    expect(() => parseRuntimeProbeParams({ providerId: 'custom:a', baseUrl: 'http://h/v1', apiKey: KEY })).toThrow(/invalida/);
  });

  it('parse_errorMessage_neverQuotesValues', () => {
    try {
      parseRuntimeProbeParams({ providerId: 'custom:a', baseUrl: 'http://h/v1', apiKey: KEY });
    } catch (err) {
      expect((err as Error).message).not.toContain(KEY);
    }
  });

  it('parse_builtInId_rejected', () => {
    expect(() => parseRuntimeProbeParams({ providerId: 'claude', baseUrl: 'http://h/v1' })).toThrow();
  });

  it('parse_newProvider_ok', () => {
    expect(parseRuntimeProbeParams({ providerId: null, baseUrl: ' http://h/v1 ' })).toEqual({ providerId: null, baseUrl: 'http://h/v1' });
  });
});

describe('probeRuntimeEndpoint', () => {
  it('probe_savedProvider_usesVaultKeyAndResultHasNoKey', async () => {
    const seen: string[] = [];

    const result = await probeRuntimeEndpoint({ providerId: 'custom:a', baseUrl: 'http://127.0.0.1:1234/v1' }, { catalog: catalogWith(seen), apiKeyFor: () => KEY });

    expect(result).toEqual({ models: ['qwen', 'llama'], contextWindow: 32768, supportsTools: true, warning: null, error: null });
    expect(seen.every((header) => header === `Bearer ${KEY}`)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('probe_newProvider_noAuthorization', async () => {
    const seen: string[] = [];

    await probeRuntimeEndpoint({ providerId: null, baseUrl: 'http://127.0.0.1:1234/v1' }, { catalog: catalogWith(seen), apiKeyFor: () => KEY });

    expect(seen).toEqual([]);
  });

  it('probe_serverRejects_errorWithoutKey', async () => {
    const result = await probeRuntimeEndpoint({ providerId: 'custom:a', baseUrl: 'http://127.0.0.1:1234/v1' }, { catalog: catalogWith([], true), apiKeyFor: () => KEY });

    expect(result.models).toBeNull();
    expect(result.error).toMatch(/401/);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
