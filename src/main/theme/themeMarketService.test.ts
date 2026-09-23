import { describe, expect, it, vi } from 'vitest';
import { ThemeMarketService } from './themeMarketService';

// Respuesta minima de busqueda de Open VSX (solo lo que el servicio necesita).
function searchResponse(): Response {
  const body = JSON.stringify({
    extensions: [
      { namespace: 'dracula-theme', name: 'theme-dracula', version: '2.25.1', displayName: 'Dracula', downloadCount: 42 },
      { namespace: 'roto', name: 'sin-version' }, // descartado: le falta version
    ],
  });
  return new Response(body, { status: 200 });
}

describe('ThemeMarketService.search', () => {
  it('queryVacia_pideLosMasDescargadosSinFiltro', async () => {
    const fetchMock = vi.fn(async (_url: string) => searchResponse());
    const service = new ThemeMarketService({ fetch: fetchMock as unknown as typeof globalThis.fetch });

    await service.search('   ');

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).not.toContain('query=');
    expect(url).toContain('sortBy=downloadCount');
    expect(url).toContain('category=Themes');
  });

  it('conQuery_laCodificaEnLaUrl', async () => {
    const fetchMock = vi.fn(async (_url: string) => searchResponse());
    const service = new ThemeMarketService({ fetch: fetchMock as unknown as typeof globalThis.fetch });

    await service.search('one dark');

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('query=one%20dark');
  });

  it('descartaExtensionesIncompletas', async () => {
    const fetchMock = vi.fn(async (_url: string) => searchResponse());
    const service = new ThemeMarketService({ fetch: fetchMock as unknown as typeof globalThis.fetch });

    const items = await service.search('dracula');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ namespace: 'dracula-theme', name: 'theme-dracula', downloadCount: 42 });
  });

  it('sinOffset_noLoMeteEnLaUrl', async () => {
    const fetchMock = vi.fn(async (_url: string) => searchResponse());
    const service = new ThemeMarketService({ fetch: fetchMock as unknown as typeof globalThis.fetch });

    await service.search('dracula');

    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('offset=');
  });

  it('conOffset_loAnadeALaUrl', async () => {
    const fetchMock = vi.fn(async (_url: string) => searchResponse());
    const service = new ThemeMarketService({ fetch: fetchMock as unknown as typeof globalThis.fetch });

    await service.search('dracula', 100);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('offset=100');
  });

  it('offsetNegativo_lanzaConElValorRecibido', async () => {
    const fetchMock = vi.fn(async (_url: string) => searchResponse());
    const service = new ThemeMarketService({ fetch: fetchMock as unknown as typeof globalThis.fetch });

    await expect(service.search('dracula', -1)).rejects.toThrow(/-1/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respuestaNoOk_lanzaConElEstadoYLaUrl', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response('nope', { status: 503 }));
    const service = new ThemeMarketService({ fetch: fetchMock as unknown as typeof globalThis.fetch });

    await expect(service.search('dracula')).rejects.toThrow(/503/);
  });
});
