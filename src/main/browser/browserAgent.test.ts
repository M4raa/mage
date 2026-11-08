import { describe, expect, it, vi } from 'vitest';
import type { CaptureImage, ImageDeps } from './annotatedCapture';
import { createBrowserAgent } from './browserAgent';
import { BrowserRegistry, type BrowserHandle } from './browserRegistry';

const BUTTON = { id: 1, role: 'button', name: 'Enviar', rectDip: [10, 20, 30, 40] };

function fakeImage(width: number, height: number): CaptureImage {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: vi.fn(() => fakeImage(width, height)),
    toBitmap: vi.fn(() => Buffer.alloc(width * height * 4)),
    toPNG: () => Buffer.from(`png-${width}x${height}`),
  };
}

function createHandle() {
  return {
    view: {},
    navigate: vi.fn(async () => 'http://localhost:4000/'),
    captureRaw: vi.fn(async () => ({
      image: fakeImage(900, 600),
      widthDip: 900,
      heightDip: 600,
      url: 'http://localhost:4000/',
      capturedAt: '2026-11-04T10:00:00.000Z',
    })),
    readDom: vi.fn(async () => [BUTTON]),
    click: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    back: vi.fn(() => true),
    reload: vi.fn(),
    close: vi.fn(async () => undefined),
    releaseControl: vi.fn(),
    isUsable: true,
    state: vi.fn(() => ({ url: 'http://localhost:4000/', title: 'Prueba', canGoBack: true, loading: false })),
    onStateChange: vi.fn(() => vi.fn()),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
  };
}

function setup(sessions: string[] = ['A']) {
  const handles: ReturnType<typeof createHandle>[] = [];
  let counter = 0;
  const registry = new BrowserRegistry({
    createBrowser: () => {
      const handle = createHandle();
      handles.push(handle);
      return handle as unknown as BrowserHandle;
    },
    newId: () => `id${++counter}`,
    isLive: (sessionId) => sessions.includes(sessionId),
    onChange: vi.fn(),
    onOpened: vi.fn(),
    onClosed: vi.fn(),
    log: vi.fn(),
  });
  const imageDeps: ImageDeps = { fromBitmap: (_data, size) => fakeImage(size.width, size.height) };
  const agentFor = (sessionId: string) => createBrowserAgent({ registry, sessionId, imageDeps });
  return { registry, handles, agentFor, agent: agentFor('A') };
}

async function codeOf(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('createBrowserAgent', () => {
  it('navigate_opensBrowserAndReturnsUrlTitle', async () => {
    const { agent, handles, registry } = setup();

    const result = await agent.navigate('localhost:4000');

    expect(handles[0]?.navigate).toHaveBeenCalledWith('localhost:4000');
    expect(result).toEqual({ url: 'http://localhost:4000/', title: 'Prueba' });
    expect(registry.states()).toHaveLength(1);
  });

  it('navigate_userInControl_throwsControlError', async () => {
    const { agent, registry } = setup();
    await agent.navigate('localhost:4000');
    registry.takeControl('A');

    expect(await codeOf(agent.navigate('localhost:4000'))).toBe('browser_user_in_control');
  });

  it('screenshot_annotate_readsDomBeforeCapture', async () => {
    const { agent, handles } = setup();
    await agent.navigate('localhost:4000');

    const result = await agent.screenshot(true);

    const [handle] = handles;
    expect(handle!.readDom.mock.invocationCallOrder[0]).toBeLessThan(handle!.captureRaw.mock.invocationCallOrder[0]!);
    expect(result.elementsText).toBe('1: button "Enviar" (10,20,30,40)');
    expect(result).toMatchObject({ annotated: true, url: 'http://localhost:4000/' });
    expect(result.png).toBe(Buffer.from('png-900x600').toString('base64'));
  });

  it('screenshot_noAnnotate_noDomRead', async () => {
    const { agent, handles } = setup();
    await agent.navigate('localhost:4000');

    const result = await agent.screenshot(false);

    expect(handles[0]?.readDom).not.toHaveBeenCalled();
    expect(result).toMatchObject({ annotated: false, elementsText: '' });
  });

  it('click_withoutBrowser_browserNotOpen', async () => {
    const { agent } = setup();

    expect(await codeOf(agent.click({ elementId: 1 }))).toBe('browser_not_open');
  });

  it('click_elementId_passesTargetAndReturnsUrl', async () => {
    const { agent, handles } = setup();
    await agent.navigate('localhost:4000');

    const result = await agent.click({ elementId: 1 });

    expect(handles[0]?.click).toHaveBeenCalledWith({ elementId: 1 });
    expect(result).toEqual({ url: 'http://localhost:4000/' });
  });

  it('type_passesInput', async () => {
    const { agent, handles } = setup();
    await agent.navigate('localhost:4000');

    const result = await agent.type({ elementId: 1, text: 'hola' });

    expect(handles[0]?.type).toHaveBeenCalledWith({ elementId: 1, text: 'hola' });
    expect(result).toEqual({ url: 'http://localhost:4000/' });
  });

  it('back_returnsNavigated', async () => {
    const { agent, handles } = setup();
    await agent.navigate('localhost:4000');
    handles[0]!.back.mockReturnValueOnce(false);

    expect(await agent.back()).toEqual({ navigated: false });
    expect(await agent.back()).toEqual({ navigated: true });
  });

  it('close_noBrowser_closedFalse', async () => {
    const { agent } = setup();

    expect(await agent.close()).toEqual({ closed: false });
  });

  it('close_open_closesAndRegistryEmpty', async () => {
    const { agent, handles, registry } = setup();
    await agent.navigate('localhost:4000');

    expect(await agent.close()).toEqual({ closed: true });

    expect(handles[0]?.close).toHaveBeenCalledTimes(1);
    expect(registry.states()).toEqual([]);
  });

  it('otherSession_cannotReachBrowser', async () => {
    const { agentFor, registry } = setup(['A', 'B']);
    await agentFor('A').navigate('localhost:4000');

    expect(await codeOf(agentFor('B').click({ elementId: 1 }))).toBe('browser_not_open');

    expect(registry.states().map((state) => state.sessionId)).toEqual(['A']);
  });
});
