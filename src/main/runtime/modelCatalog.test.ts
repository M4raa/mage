import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW, ModelCatalog, OLLAMA_DEFAULT_CTX, serverRoot, type CatalogEndpoint } from './modelCatalog';

// `fetch` falso por ruta: lo que no esta en la tabla es 404.
function fakeFetch(routes: Record<string, unknown>): typeof fetch & ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;
    if (!(path in routes)) return new Response('no', { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const ENDPOINT: CatalogEndpoint = { id: 'custom:x', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: null };

describe('ModelCatalog.info', () => {
  it('info_manualWindow_winsOverEverything', async () => {
    const fetch = fakeFetch({});
    const catalog = new ModelCatalog({ fetch, now: () => 0 });

    const info = await catalog.info({ ...ENDPOINT, contextWindow: 16_000, supportsTools: false }, 'm');

    expect(info).toEqual({ contextWindow: 16_000, contextSource: 'manual', supportsTools: false, warning: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('info_lmStudio_usesLoadedContextAndToolFlag', async () => {
    const catalog = new ModelCatalog({
      fetch: fakeFetch({
        '/api/v1/models': {
          models: [{ key: 'qwen', max_context_length: 32_768, capabilities: { trained_for_tool_use: true }, loaded_instances: [{ config: { context_length: 8_000 } }] }],
        },
      }),
      now: () => 0,
    });

    expect(await catalog.info(ENDPOINT, 'qwen')).toEqual({ contextWindow: 8_000, contextSource: 'lmstudio', supportsTools: true, warning: null });
  });

  it('info_ollama_capsDeclaredContextAndWarns', async () => {
    const catalog = new ModelCatalog({
      fetch: fakeFetch({ '/api/show': { capabilities: ['completion'], model_info: { 'qwen2.context_length': 32_768 } } }),
      now: () => 0,
    });

    const info = await catalog.info({ ...ENDPOINT, baseUrl: 'http://127.0.0.1:11434/v1' }, 'qwen');

    expect(info).toMatchObject({ contextWindow: OLLAMA_DEFAULT_CTX, contextSource: 'ollama', supportsTools: false });
    expect(info.warning).toMatch(/OLLAMA_CONTEXT_LENGTH/);
  });

  it('info_ollamaSmallModel_noWarning', async () => {
    const catalog = new ModelCatalog({ fetch: fakeFetch({ '/api/show': { capabilities: ['tools'], model_info: { 'x.context_length': 2_048 } } }), now: () => 0 });

    expect(await catalog.info(ENDPOINT, 'x')).toEqual({ contextWindow: 2_048, contextSource: 'ollama', supportsTools: true, warning: null });
  });

  it('info_unknownServer_defaultWindowAndUnknownTools', async () => {
    const catalog = new ModelCatalog({ fetch: fakeFetch({}), now: () => 0 });

    expect(await catalog.info(ENDPOINT, 'm')).toEqual({ contextWindow: DEFAULT_CONTEXT_WINDOW, contextSource: 'default', supportsTools: null, warning: null });
  });

  it('info_lmStudioWithoutTheModel_fallsToOllama', async () => {
    const catalog = new ModelCatalog({
      fetch: fakeFetch({ '/api/v1/models': { models: [{ key: 'otro' }] }, '/api/show': { model_info: { 'a.context_length': 3_000 } } }),
      now: () => 0,
    });

    expect((await catalog.info(ENDPOINT, 'm')).contextSource).toBe('ollama');
  });

  it('info_networkDown_defaults', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;

    expect((await new ModelCatalog({ fetch, now: () => 0 }).info(ENDPOINT, 'm')).contextSource).toBe('default');
  });

  it('info_cachedWithinTtl_probesOnce', async () => {
    const fetch = fakeFetch({});
    let now = 0;
    const catalog = new ModelCatalog({ fetch, now: () => now, ttlMs: 1_000 });

    await catalog.info(ENDPOINT, 'm');
    await catalog.info(ENDPOINT, 'm');
    now = 2_000;
    await catalog.info(ENDPOINT, 'm');

    expect(fetch).toHaveBeenCalledTimes(4); // dos sondeos (LM Studio + Ollama) por cada vez que caduca
  });

  it('info_invalidManualWindow_throwsWithValue', async () => {
    await expect(new ModelCatalog({ fetch: fakeFetch({}), now: () => 0 }).info({ ...ENDPOINT, contextWindow: 0 }, 'm')).rejects.toThrow(/0/);
  });
});

describe('ModelCatalog.listModels', () => {
  it('list_ok_returnsIds', async () => {
    const catalog = new ModelCatalog({ fetch: fakeFetch({ '/v1/models': { data: [{ id: 'a' }, { id: 'b' }] } }), now: () => 0 });

    expect(await catalog.listModels(ENDPOINT)).toEqual(['a', 'b']);
  });

  it('list_serverError_throwsWithStatus', async () => {
    await expect(new ModelCatalog({ fetch: fakeFetch({}), now: () => 0 }).listModels(ENDPOINT)).rejects.toThrow(/404/);
  });
});

describe('serverRoot', () => {
  it('root_stripsV1AndSlash', () => {
    expect([serverRoot('http://h:1/v1'), serverRoot('http://h:1/v1/'), serverRoot('http://h:1')]).toEqual(['http://h:1', 'http://h:1', 'http://h:1']);
  });
});
