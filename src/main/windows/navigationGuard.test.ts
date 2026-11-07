import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { installNavigationGuard, isRendererUrl, originForLog, type NavigationEventSource } from './navigationGuard';

const DIR = resolve('app', 'out', 'renderer');
const DEV = 'http://localhost:5173';
const rendererFile = (name: string): string => pathToFileURL(join(DIR, name)).href;

type Details = { readonly url: string; preventDefault(): void };

describe('isRendererUrl', () => {
  it.each([`${DEV}/`, `${DEV}/widget.html`, `${DEV}/debug.html?x=1#y`])('isRendererUrl_devMismoOrigen_permite %s', (url) => {
    expect(isRendererUrl(url, { devUrl: DEV, rendererDir: DIR })).toBe(true);
  });

  it.each(['http://localhost:5174/', 'https://example.com/', rendererFile('index.html')])('isRendererUrl_devOtroOrigenOFichero_bloquea %s', (url) => {
    expect(isRendererUrl(url, { devUrl: DEV, rendererDir: DIR })).toBe(false);
  });

  it.each([rendererFile('index.html'), rendererFile('widget.html'), rendererFile('debug.html'), `${rendererFile('index.html')}#/chat`])(
    'isRendererUrl_prodFicheroDelRenderer_permite %s',
    (url) => {
      expect(isRendererUrl(url, { devUrl: undefined, rendererDir: DIR })).toBe(true);
    },
  );

  it.each([
    pathToFileURL(resolve('app', 'out', 'otra', 'index.html')).href,
    pathToFileURL(DIR).href,
    pathToFileURL(resolve('app', 'out', 'renderer-falso', 'index.html')).href,
    'https://example.com/',
    'http://127.0.0.1:5555/x',
    'esto no es una url',
  ])('isRendererUrl_prodFueraDelRenderer_bloquea %s', (url) => {
    expect(isRendererUrl(url, { devUrl: undefined, rendererDir: DIR })).toBe(false);
  });

  it('isRendererUrl_devUrlVacia_seTrataComoProd', () => {
    const location = { devUrl: '', rendererDir: DIR };

    expect(isRendererUrl(rendererFile('index.html'), location)).toBe(true);
    expect(isRendererUrl(`${DEV}/`, location)).toBe(false);
  });
});

describe('installNavigationGuard', () => {
  function fakeContents(): { contents: NavigationEventSource; listeners: Map<string, (details: Details) => void> } {
    const listeners = new Map<string, (details: Details) => void>();
    const contents: NavigationEventSource = {
      on: (event, listener) => {
        listeners.set(event, listener);
        return contents;
      },
    };
    return { contents, listeners };
  }

  it('installNavigationGuard_urlAjena_cancelaEnLosDosEventosYAvisa', () => {
    const { contents, listeners } = fakeContents();
    const onBlocked = vi.fn();
    const navigate = { url: 'https://example.com/', preventDefault: vi.fn() };
    const redirect = { url: 'https://example.com/', preventDefault: vi.fn() };

    installNavigationGuard(contents, () => false, onBlocked);
    listeners.get('will-navigate')?.(navigate);
    listeners.get('will-redirect')?.(redirect);

    expect(navigate.preventDefault).toHaveBeenCalledTimes(1);
    expect(redirect.preventDefault).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledTimes(2);
    expect(onBlocked).toHaveBeenCalledWith('https://example.com/');
  });

  it('installNavigationGuard_urlDelRenderer_noCancela', () => {
    const { contents, listeners } = fakeContents();
    const onBlocked = vi.fn();
    const navigate = { url: `${DEV}/`, preventDefault: vi.fn() };

    installNavigationGuard(contents, () => true, onBlocked);
    listeners.get('will-navigate')?.(navigate);
    listeners.get('will-redirect')?.(navigate);

    expect(navigate.preventDefault).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });
});

describe('originForLog', () => {
  it('originForLog_urlHttp_soloElOrigen', () => {
    expect(originForLog('https://example.com/ruta?token=secreto')).toBe('https://example.com');
    expect(originForLog(pathToFileURL(join(DIR, 'x.html')).href)).toBe('file:');
    expect(originForLog('basura')).toBe('(no es una URL)');
  });
});
