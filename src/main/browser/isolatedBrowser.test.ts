import type { Session, WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { IsolatedBrowser } from './isolatedBrowser';
import { DEFAULT_DOM_SELECTOR } from './domSnapshot';

type Handler = (...args: unknown[]) => unknown;

const okButton = { role: 'button', name: 'ok', rectDip: [178, 67, 29, 21] };

// Fakes nuevos en cada test: sin estado compartido. Sin vi.mock('electron'): todo entra por inyección.
function createFakes() {
  const handlers = {
    permissionRequest: undefined as Handler | undefined,
    permissionCheck: undefined as Handler | undefined,
    download: undefined as Handler | undefined,
    windowOpen: undefined as Handler | undefined,
    contentsEvents: new Map<string, Handler>(),
  };
  const fakeSession = {
    isPersistent: vi.fn(() => false),
    setPermissionRequestHandler: vi.fn((handler: Handler) => {
      handlers.permissionRequest = handler;
    }),
    setPermissionCheckHandler: vi.fn((handler: Handler) => {
      handlers.permissionCheck = handler;
    }),
    on: vi.fn((event: string, handler: Handler) => {
      if (event === 'will-download') handlers.download = handler;
    }),
    clearData: vi.fn(async () => undefined),
  };
  const debuggerFake = {
    attached: false,
    isAttached: vi.fn(() => debuggerFake.attached),
    attach: vi.fn((_version: string) => {
      debuggerFake.attached = true;
    }),
    detach: vi.fn(() => {
      debuggerFake.attached = false;
    }),
    sendCommand: vi.fn(async (_method: string, _params: unknown) => ({})),
  };
  const history = { canGoBack: vi.fn(() => true), goBack: vi.fn() };
  const image = {
    isEmpty: vi.fn(() => false),
    getSize: () => ({ width: 1125, height: 750 }),
    toPNG: () => Buffer.from('png'),
  };
  const contents = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.contentsEvents.set(event, handler);
    }),
    setWindowOpenHandler: vi.fn((handler: Handler) => {
      handlers.windowOpen = handler;
    }),
    loadURL: vi.fn(async (_url: string) => undefined),
    getURL: vi.fn(() => 'http://localhost:5173/'),
    getTitle: vi.fn(() => 'Título'),
    isLoading: vi.fn(() => false),
    reload: vi.fn(),
    capturePage: vi.fn(async (_rect?: unknown, _options?: unknown) => image),
    executeJavaScript: vi.fn(async (_script: string): Promise<unknown> => []),
    debugger: debuggerFake,
    navigationHistory: history,
    close: vi.fn(),
  };
  const view = {
    webContents: contents,
    getBounds: () => ({ x: 0, y: 0, width: 900, height: 600 }),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
  };
  const deps = {
    createSession: vi.fn((_partition: string) => fakeSession as unknown as Session),
    createView: vi.fn((_session: Session) => view as unknown as WebContentsView),
    now: () => new Date('2026-10-31T12:00:00.000Z'),
  };
  return { handlers, fakeSession, debuggerFake, history, image, contents, view, deps };
}

function createBrowser() {
  const fakes = createFakes();
  return { ...fakes, browser: new IsolatedBrowser('t1', fakes.deps) };
}

async function browserWithElement() {
  const setup = createBrowser();
  setup.contents.executeJavaScript.mockResolvedValue([okButton]);
  await setup.browser.readDom();
  return setup;
}

const mousePressed = ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 192.5, y: 77.5, button: 'left', clickCount: 1 }];
const mouseReleased = ['Input.dispatchMouseEvent', { type: 'mouseReleased', x: 192.5, y: 77.5, button: 'left', clickCount: 1 }];

describe('IsolatedBrowser constructor', () => {
  it('constructor_validId_usesInMemoryPartition', () => {
    const fakes = createFakes();

    new IsolatedBrowser('t1', fakes.deps);

    expect(fakes.deps.createSession).toHaveBeenCalledWith('mage-browser-t1');
  });

  it('constructor_persistentSession_throws', () => {
    const fakes = createFakes();
    fakes.fakeSession.isPersistent.mockReturnValue(true);

    expect(() => new IsolatedBrowser('t1', fakes.deps)).toThrow(/persistente/);
    expect(fakes.deps.createView).not.toHaveBeenCalled();
  });

  it('constructor_invalidId_throwsBeforeCreatingSession', () => {
    const fakes = createFakes();

    expect(() => new IsolatedBrowser('a/b', fakes.deps)).toThrow(/no válido/);
    expect(fakes.deps.createSession).not.toHaveBeenCalled();
  });
});

describe('IsolatedBrowser hardening', () => {
  it('hardening_permissionRequest_isDenied', () => {
    const { handlers, contents } = createBrowser();
    const callback = vi.fn();

    handlers.permissionRequest?.(contents, 'geolocation', callback, {});

    expect(callback).toHaveBeenCalledWith(false);
  });

  it('hardening_permissionCheck_isDenied', () => {
    const { handlers, contents } = createBrowser();

    const result = handlers.permissionCheck?.(contents, 'media', 'http://localhost', {});

    expect(result).toBe(false);
  });

  it('hardening_download_isCancelled', () => {
    const { handlers, contents } = createBrowser();
    const event = { preventDefault: vi.fn() };

    handlers.download?.(event, {}, contents);

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it.each(['https://example.com/', 'file:///etc/passwd'])('hardening_windowOpen_isAlwaysDenied (%s)', (url) => {
    const { handlers } = createBrowser();

    expect(handlers.windowOpen?.({ url })).toEqual({ action: 'deny' });
  });

  it.each([
    ['will-navigate', 'file:///etc/passwd', true],
    ['will-navigate', 'https://example.com/', false],
    ['will-redirect', 'chrome://gpu', true],
    ['will-redirect', 'http://localhost:3000/', false],
  ])('hardening_navigationEvents_blockDisallowed (%s %s)', (eventName, url, blocked) => {
    const { handlers } = createBrowser();
    const details = { url, preventDefault: vi.fn() };

    handlers.contentsEvents.get(eventName)?.(details);

    expect(details.preventDefault.mock.calls.length > 0).toBe(blocked);
  });
});

describe('IsolatedBrowser navigate', () => {
  it('navigate_bareLocalhost_loadsNormalizedUrl', async () => {
    const { browser, contents } = createBrowser();

    const result = await browser.navigate('localhost:5173');

    expect(contents.loadURL).toHaveBeenCalledWith('http://localhost:5173/');
    expect(result).toBe('http://localhost:5173/');
  });

  it('navigate_deniedScheme_throwsWithoutLoading', async () => {
    const { browser, contents } = createBrowser();

    await expect(browser.navigate('file:///C:/x')).rejects.toThrow(/file:/);
    expect(contents.loadURL).not.toHaveBeenCalled();
  });

  it('navigate_loadFails_throwsWithUrl', async () => {
    const { browser, contents } = createBrowser();
    contents.loadURL.mockRejectedValue(new Error('ERR_CONNECTION_REFUSED'));

    await expect(browser.navigate('http://localhost:1')).rejects.toThrow(
      /No se pudo cargar http:\/\/localhost:1\/: ERR_CONNECTION_REFUSED/,
    );
  });
});

describe('IsolatedBrowser screenshot', () => {
  it('screenshot_scaledCapture_returnsPhysicalAndDipSizes', async () => {
    const { browser } = createBrowser();

    const result = await browser.screenshot();

    expect(result).toEqual({
      mime: 'image/png',
      base64: Buffer.from('png').toString('base64'),
      widthPx: 1125,
      heightPx: 750,
      widthDip: 900,
      heightDip: 600,
      deviceScale: 1.25,
      url: 'http://localhost:5173/',
      capturedAt: '2026-10-31T12:00:00.000Z',
    });
  });

  it('screenshot_emptyImage_throws', async () => {
    const { browser, image } = createBrowser();
    image.isEmpty.mockReturnValue(true);

    await expect(browser.screenshot()).rejects.toThrow(/vacía/);
  });
});

describe('IsolatedBrowser readDom', () => {
  it('readDom_validOutput_assignsIds', async () => {
    const { browser, contents } = createBrowser();
    contents.executeJavaScript.mockResolvedValue([okButton]);

    const result = await browser.readDom();

    expect(result).toEqual([{ id: 1, ...okButton }]);
    expect(contents.executeJavaScript.mock.calls[0]?.[0]).toContain(JSON.stringify(DEFAULT_DOM_SELECTOR));
  });

  it('readDom_invalidOutput_throws', async () => {
    const { browser, contents } = createBrowser();
    contents.executeJavaScript.mockResolvedValue([{ role: 'button' }]);

    await expect(browser.readDom()).rejects.toThrow(/forma esperada/);
  });

  it('readDom_invalidOptions_throwsWithoutRunningScript', async () => {
    const { browser, contents } = createBrowser();

    await expect(browser.readDom({ maxNodes: 201 })).rejects.toThrow(/maxNodes/);
    expect(contents.executeJavaScript).not.toHaveBeenCalled();
  });
});

describe('IsolatedBrowser click', () => {
  it('click_elementId_dispatchesAtCenterAfterAttaching', async () => {
    const { browser, debuggerFake } = await browserWithElement();

    await browser.click({ elementId: 1 });
    await browser.click({ elementId: 1 });

    expect(debuggerFake.attach).toHaveBeenCalledTimes(1);
    expect(debuggerFake.attach).toHaveBeenCalledWith('1.3');
    expect(debuggerFake.sendCommand).toHaveBeenNthCalledWith(1, ...mousePressed);
    expect(debuggerFake.sendCommand).toHaveBeenNthCalledWith(2, ...mouseReleased);
  });

  it('click_coordinates_dispatchesThere', async () => {
    const { browser, debuggerFake } = createBrowser();

    await browser.click({ x: 10, y: 20 });

    expect(debuggerFake.sendCommand).toHaveBeenNthCalledWith(1, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 10,
      y: 20,
      button: 'left',
      clickCount: 1,
    });
  });

  it.each([
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: Number.NaN, y: 0 },
    { x: 0, y: Number.POSITIVE_INFINITY },
  ])('click_invalidCoordinates_throws (%j)', async (target) => {
    const { browser, debuggerFake } = createBrowser();

    await expect(browser.click(target)).rejects.toThrow(/Coordenadas no válidas/);
    expect(debuggerFake.sendCommand).not.toHaveBeenCalled();
  });

  it('click_staleElementId_throws', async () => {
    const { browser, contents, debuggerFake } = createBrowser();
    contents.executeJavaScript.mockResolvedValue([okButton]);
    await browser.readDom();
    await browser.readDom();

    await expect(browser.click({ elementId: 1 })).rejects.toThrow(/El elemento 1 no existe o ha caducado/);
    expect(debuggerFake.sendCommand).not.toHaveBeenCalled();
    await expect(browser.click({ elementId: 2 })).resolves.toBeUndefined();
  });

  it('click_afterNavigate_idsExpire', async () => {
    const { browser } = await browserWithElement();
    await browser.navigate('https://example.com');

    await expect(browser.click({ elementId: 1 })).rejects.toThrow(/caducado/);
  });
});

describe('IsolatedBrowser type', () => {
  it('type_elementId_clicksThenInsertsText', async () => {
    const { browser, debuggerFake } = await browserWithElement();

    await browser.type({ elementId: 1, text: 'hola' });

    expect(debuggerFake.sendCommand).toHaveBeenNthCalledWith(3, 'Input.insertText', { text: 'hola' });
  });

  it('type_emptyText_throws', async () => {
    const { browser, debuggerFake } = await browserWithElement();

    await expect(browser.type({ elementId: 1, text: '' })).rejects.toThrow(/Texto vacío/);
    expect(debuggerFake.sendCommand).not.toHaveBeenCalled();
  });
});

describe('IsolatedBrowser back', () => {
  it('back_withHistory_goesBackAndExpiresIds', async () => {
    const { browser, history } = await browserWithElement();

    expect(browser.back()).toBe(true);

    expect(history.goBack).toHaveBeenCalled();
    await expect(browser.click({ elementId: 1 })).rejects.toThrow(/caducado/);
  });

  it('back_withoutHistory_returnsFalse', () => {
    const { browser, history } = createBrowser();
    history.canGoBack.mockReturnValue(false);

    expect(browser.back()).toBe(false);
    expect(history.goBack).not.toHaveBeenCalled();
  });
});

describe('IsolatedBrowser close', () => {
  it('close_afterClick_detachesClosesAndClearsPartition', async () => {
    const { browser, debuggerFake, contents, fakeSession } = await browserWithElement();
    await browser.click({ elementId: 1 });

    await browser.close();

    expect(debuggerFake.detach).toHaveBeenCalledTimes(1);
    expect(contents.close).toHaveBeenCalledTimes(1);
    expect(fakeSession.clearData).toHaveBeenCalledTimes(1);
  });

  it('close_twice_isIdempotent', async () => {
    const { browser, contents, fakeSession } = createBrowser();

    await browser.close();
    await browser.close();

    expect(contents.close).toHaveBeenCalledTimes(1);
    expect(fakeSession.clearData).toHaveBeenCalledTimes(1);
  });

  it('operations_afterClose_throw', async () => {
    const { browser } = createBrowser();
    await browser.close();

    await expect(browser.navigate('https://example.com')).rejects.toThrow(/ya está cerrado/);
    await expect(browser.screenshot()).rejects.toThrow(/ya está cerrado/);
    await expect(browser.readDom()).rejects.toThrow(/ya está cerrado/);
    await expect(browser.click({ x: 1, y: 1 })).rejects.toThrow(/ya está cerrado/);
    await expect(browser.type({ elementId: 1, text: 'a' })).rejects.toThrow(/ya está cerrado/);
    expect(() => browser.back()).toThrow(/ya está cerrado/);
  });
});

describe('IsolatedBrowser captureRaw', () => {
  it('captureRaw_capturesWithStayHidden', async () => {
    const { browser, contents, image } = createBrowser();

    const raw = await browser.captureRaw();

    expect(contents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true });
    expect(raw).toEqual({
      image,
      widthDip: 900,
      heightDip: 600,
      url: 'http://localhost:5173/',
      capturedAt: '2026-10-31T12:00:00.000Z',
    });
  });

  it('captureRaw_emptyImage_throws', async () => {
    const { browser, image } = createBrowser();
    image.isEmpty.mockReturnValue(true);

    await expect(browser.captureRaw()).rejects.toThrow(/vacía/);
  });
});

describe('IsolatedBrowser control and state', () => {
  it('releaseControl_attached_detaches', async () => {
    const { browser, debuggerFake } = await browserWithElement();
    await browser.click({ elementId: 1 });

    browser.releaseControl();

    expect(debuggerFake.detach).toHaveBeenCalledTimes(1);
  });

  it('releaseControl_notAttached_noop', () => {
    const { browser, debuggerFake } = createBrowser();

    browser.releaseControl();

    expect(debuggerFake.detach).not.toHaveBeenCalled();
  });

  it('releaseControl_closed_noop', async () => {
    const { browser, debuggerFake } = createBrowser();
    await browser.close();
    debuggerFake.attached = true;
    debuggerFake.detach.mockClear();

    browser.releaseControl();

    expect(debuggerFake.detach).not.toHaveBeenCalled();
  });

  it('reload_expiresElementsAndReloads', async () => {
    const { browser, contents } = await browserWithElement();

    browser.reload();

    expect(contents.reload).toHaveBeenCalledTimes(1);
    await expect(browser.click({ elementId: 1 })).rejects.toThrow(/caducado/);
  });

  it('state_returnsUrlTitleBackLoading', () => {
    const { browser, contents } = createBrowser();
    contents.isLoading.mockReturnValue(true);

    expect(browser.state()).toEqual({ url: 'http://localhost:5173/', title: 'Título', canGoBack: true, loading: true });
  });

  it('onStateChange_navigateEvent_notifiesUntilUnsubscribed', () => {
    const { browser, handlers } = createBrowser();
    const listener = vi.fn();
    const unsubscribe = browser.onStateChange(listener);

    handlers.contentsEvents.get('did-navigate')?.();
    unsubscribe();
    handlers.contentsEvents.get('did-navigate')?.();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('setBoundsAndVisible_passToView', () => {
    const { browser, view } = createBrowser();
    const bounds = { x: 1, y: 2, width: 300, height: 200 };

    browser.setBounds(bounds);
    browser.setVisible(false);

    expect(view.setBounds).toHaveBeenCalledWith(bounds);
    expect(view.setVisible).toHaveBeenCalledWith(false);
  });

  it('setVisible_afterClose_throws', async () => {
    const { browser } = createBrowser();
    await browser.close();

    expect(browser.isClosed).toBe(true);
    expect(() => browser.setVisible(true)).toThrow(/ya está cerrado/);
  });
});
