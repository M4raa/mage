import { describe, expect, it, vi } from 'vitest';
import { decodeUserFacingMessage } from '@shared/i18n/localizedText';
import { IpcChannel } from '@shared/ipc';
import { registerBrowserIpc } from './browserIpc';
import { BrowserRegistry, type BrowserHandle } from './browserRegistry';
import { PenCaptureExpiredError, type PenSessions } from './penSession';
import type { PlacementWindow, ViewPlacement } from './viewPlacement';

const OWN = { sender: { id: 1 } };
const FOREIGN = { sender: { id: 2 } };

function createHandle() {
  return {
    view: {},
    navigate: vi.fn(async (url: string) => url),
    back: vi.fn(() => true),
    reload: vi.fn(),
    close: vi.fn(async () => undefined),
    releaseControl: vi.fn(),
    isUsable: true,
    state: vi.fn(() => ({ url: 'http://localhost:4000/', title: 'Prueba', canGoBack: false, loading: false })),
    onStateChange: vi.fn(() => vi.fn()),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
  };
}

function setup(liveSessions: string[] = ['A']) {
  const handles: ReturnType<typeof createHandle>[] = [];
  const registry = new BrowserRegistry({
    createBrowser: () => {
      const handle = createHandle();
      handles.push(handle);
      return handle as unknown as BrowserHandle;
    },
    newId: () => 'id',
    isLive: (sessionId) => liveSessions.includes(sessionId),
    onChange: vi.fn(),
    onOpened: vi.fn(),
    onClosed: vi.fn(),
    log: vi.fn(),
  });
  const placement = { show: vi.fn(), hide: vi.fn() };
  const pens = { capture: vi.fn(), compose: vi.fn() };
  const window = {} as PlacementWindow;
  const handlers = new Map<string, (event: typeof OWN, arg: unknown) => unknown>();
  registerBrowserIpc({
    handle: (channel, listener) => void handlers.set(channel, listener),
    registry,
    placement: placement as unknown as ViewPlacement,
    pens: pens as unknown as PenSessions,
    windowOf: (id) => (id === 1 ? window : null),
  });
  const call = async (channel: string, arg?: unknown, event = OWN) => {
    const handler = handlers.get(channel);
    if (handler === undefined) throw new Error(`Canal sin manejador: ${channel}`);
    return handler(event, arg);
  };
  return { registry, handles, placement, pens, window, call };
}

async function keyOf(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
  } catch (error) {
    return decodeUserFacingMessage((error as Error).message)?.key;
  }
  return undefined;
}

describe('registerBrowserIpc', () => {
  it('anyChannel_foreignSender_throws', async () => {
    const { call } = setup();

    await expect(call(IpcChannel.BrowserList, undefined, FOREIGN)).rejects.toThrow('webContents que no es una ventana de Mage: 2');
  });

  it('list_noArgument_returnsStates', async () => {
    const { call, registry } = setup();
    registry.beginUserAction('A');

    const states = (await call(IpcChannel.BrowserList, undefined)) as { sessionId: string }[];

    expect(states).toEqual(registry.states());
    expect(states).toHaveLength(1);
  });

  it('open_returnsStates', async () => {
    const { call } = setup();

    const states = (await call(IpcChannel.BrowserOpen, 'A')) as { sessionId: string; control: string }[];

    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ sessionId: 'A', control: 'idle' });
  });

  it('navigate_missingUrl_throwsWithValue', async () => {
    const { call } = setup();

    await expect(call(IpcChannel.BrowserNavigate, { sessionId: 'A' })).rejects.toThrow(/inválida.*url.*"sessionId":"A"/s);
  });

  it('navigate_whileAgent_takesControl', async () => {
    const { call, registry, handles } = setup();
    registry.beginAgentAction('A', 'navigate');

    await call(IpcChannel.BrowserNavigate, { sessionId: 'A', url: 'http://localhost:4000/' });

    expect(registry.states()[0]?.control).toBe('user');
    expect(handles[0]?.releaseControl).toHaveBeenCalledTimes(1);
    expect(handles[0]?.navigate).toHaveBeenCalledWith('http://localhost:4000/');
  });

  it('navigate_loadFails_navigateFailedKey', async () => {
    const { call, registry, handles } = setup();
    registry.open('A');
    handles[0]?.navigate.mockRejectedValueOnce(new Error('ERR_NAME_NOT_RESOLVED'));

    expect(await keyOf(call(IpcChannel.BrowserNavigate, { sessionId: 'A', url: 'http://nada.invalid/' }))).toBe(
      'errors.browser.navigateFailed',
    );
  });

  it('setBounds_null_hides', async () => {
    const { call, registry, placement } = setup();
    registry.open('A');

    await call(IpcChannel.BrowserSetBounds, { sessionId: 'A', bounds: null });

    expect(placement.hide).toHaveBeenCalledTimes(1);
    expect(placement.show).not.toHaveBeenCalled();
  });

  it('setBounds_rect_showsInSenderWindow', async () => {
    const { call, registry, placement, window } = setup();
    registry.open('A');
    const bounds = { x: 1, y: 2, width: 300, height: 200 };

    await call(IpcChannel.BrowserSetBounds, { sessionId: 'A', bounds });

    expect(placement.show).toHaveBeenCalledWith(expect.anything(), window, bounds);
  });

  it('setBounds_noBrowser_noop', async () => {
    const { call, placement } = setup();

    await call(IpcChannel.BrowserSetBounds, { sessionId: 'A', bounds: { x: 0, y: 0, width: 10, height: 10 } });

    expect(placement.show).not.toHaveBeenCalled();
    expect(placement.hide).not.toHaveBeenCalled();
  });

  it('setBounds_negative_throws', async () => {
    const { call, registry } = setup();
    registry.open('A');

    await expect(
      call(IpcChannel.BrowserSetBounds, { sessionId: 'A', bounds: { x: -1, y: 0, width: 10, height: 10 } }),
    ).rejects.toThrow(/inválida.*-1/s);
  });

  it('takeControl_noBrowser_browserNotOpenKey', async () => {
    const { call } = setup();

    expect(await keyOf(call(IpcChannel.BrowserTakeControl, 'A'))).toBe('errors.browser.browserNotOpen');
  });

  it('returnControl_setsIdle', async () => {
    const { call, registry } = setup();
    registry.beginAgentAction('A', 'navigate');
    await call(IpcChannel.BrowserTakeControl, 'A');

    await call(IpcChannel.BrowserReturnControl, 'A');

    expect(registry.states()[0]?.control).toBe('idle');
  });

  it('penCapture_delegates', async () => {
    const { call, pens } = setup();
    pens.capture.mockResolvedValue({ captureId: 'c1' });

    const result = await call(IpcChannel.BrowserPenCapture, 'A');

    expect(pens.capture).toHaveBeenCalledWith('A');
    expect(result).toEqual({ captureId: 'c1' });
  });

  it('penCompose_invalidStrokes_throws', async () => {
    const { call, pens } = setup();

    await expect(
      call(IpcChannel.BrowserPenCompose, { sessionId: 'A', captureId: 'c1', strokes: [{ id: 1, kind: 'box', pointsDip: [[1, 1]] }] }),
    ).rejects.toThrow('Trazos de la pluma no válidos');
    expect(pens.compose).not.toHaveBeenCalled();
  });

  it('penCompose_expired_penCaptureExpiredKey', async () => {
    const { call, pens } = setup();
    pens.compose.mockImplementation(() => {
      throw new PenCaptureExpiredError('c1');
    });

    expect(await keyOf(call(IpcChannel.BrowserPenCompose, { sessionId: 'A', captureId: 'c1', strokes: [] }))).toBe(
      'errors.browser.penCaptureExpired',
    );
  });

  it('open_deadSession_sessionNotLiveKey', async () => {
    const { call } = setup([]);

    expect(await keyOf(call(IpcChannel.BrowserOpen, 'A'))).toBe('errors.browser.sessionNotLive');
  });
});
