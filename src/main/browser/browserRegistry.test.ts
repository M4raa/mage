import { describe, expect, it, vi } from 'vitest';
import {
  BrowserControlError,
  BrowserRegistry,
  type BrowserHandle,
  type BrowserRegistryDeps,
} from './browserRegistry';

function createHandle() {
  const handle = {
    view: {},
    navigate: vi.fn(async () => 'http://localhost/'),
    captureRaw: vi.fn(),
    readDom: vi.fn(),
    click: vi.fn(),
    type: vi.fn(),
    back: vi.fn(),
    reload: vi.fn(),
    close: vi.fn(async () => undefined),
    releaseControl: vi.fn(),
    state: vi.fn(() => ({ url: 'http://localhost/', title: 't', canGoBack: false, loading: false })),
    unsubscribe: vi.fn(),
    listener: undefined as (() => void) | undefined,
    onStateChange: vi.fn((listener: () => void) => {
      handle.listener = listener;
      return handle.unsubscribe;
    }),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
  };
  return handle;
}

function setup(liveSessions: string[] = ['s1']) {
  const live = new Set(liveSessions);
  const handles: ReturnType<typeof createHandle>[] = [];
  let counter = 0;
  const deps = {
    createBrowser: vi.fn((_instanceId: string) => {
      const handle = createHandle();
      handles.push(handle);
      return handle as unknown as BrowserHandle;
    }),
    newId: vi.fn(() => `id${++counter}`),
    isLive: vi.fn((sessionId: string) => live.has(sessionId)),
    onChange: vi.fn(),
    onOpened: vi.fn(),
    onClosed: vi.fn(),
    log: vi.fn(),
  } satisfies BrowserRegistryDeps;
  return { registry: new BrowserRegistry(deps), deps, handles, live };
}

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof BrowserControlError ? error.code : `otro: ${String(error)}`;
  }
  return undefined;
}

describe('BrowserRegistry open', () => {
  it('open_liveSession_createsOnceAndNotifies', () => {
    const { registry, deps, handles } = setup();

    const first = registry.open('s1');
    const second = registry.open('s1');

    expect(second).toBe(first);
    expect(handles).toHaveLength(1);
    expect(deps.onOpened).toHaveBeenCalledTimes(1);
    expect(deps.onOpened).toHaveBeenCalledWith('s1', first);
    expect(deps.onChange).toHaveBeenCalledTimes(1);
  });

  it('open_deadSession_throwsSessionNotLive', () => {
    const { registry, deps } = setup([]);

    expect(codeOf(() => registry.open('s9'))).toBe('session_not_live');
    expect(deps.createBrowser).not.toHaveBeenCalled();
  });

  it('open_usesNewIdAsInstanceId', () => {
    const { registry, deps } = setup();

    registry.open('s1');

    expect(deps.createBrowser).toHaveBeenCalledWith('id1');
  });
});

describe('BrowserRegistry beginAgentAction', () => {
  it('beginAgentAction_navigateWithoutBrowser_opens', () => {
    const { registry, deps } = setup();

    registry.beginAgentAction('s1', 'navigate');

    expect(deps.createBrowser).toHaveBeenCalledTimes(1);
  });

  it('beginAgentAction_clickWithoutBrowser_browserNotOpen', () => {
    const { registry } = setup();

    expect(codeOf(() => registry.beginAgentAction('s1', 'click'))).toBe('browser_not_open');
  });

  it('beginAgentAction_userInControl_rejected', () => {
    const { registry } = setup();
    registry.open('s1');
    registry.takeControl('s1');

    expect(codeOf(() => registry.beginAgentAction('s1', 'screenshot'))).toBe('browser_user_in_control');
  });

  it('beginAgentAction_setsAgentAndLastAction', () => {
    const { registry } = setup();
    registry.open('s1');

    registry.beginAgentAction('s1', 'read_dom');

    expect(registry.states()[0]).toMatchObject({ sessionId: 's1', control: 'agent', lastAction: 'read_dom' });
  });
});

describe('BrowserRegistry user control', () => {
  it('beginUserAction_whileAgent_takesControlAndReleasesCdp', () => {
    const { registry, handles } = setup();
    registry.open('s1');
    registry.beginAgentAction('s1', 'click');

    registry.beginUserAction('s1');

    expect(registry.states()[0]?.control).toBe('user');
    expect(handles[0]?.releaseControl).toHaveBeenCalledTimes(1);
  });

  it('beginUserAction_idle_staysIdle', () => {
    const { registry, handles } = setup();

    registry.beginUserAction('s1');

    expect(registry.states()[0]?.control).toBe('idle');
    expect(handles[0]?.releaseControl).not.toHaveBeenCalled();
  });

  it('takeControl_releasesCdpAndUser', () => {
    const { registry, handles } = setup();
    registry.open('s1');

    registry.takeControl('s1');

    expect(handles[0]?.releaseControl).toHaveBeenCalledTimes(1);
    expect(registry.states()[0]?.control).toBe('user');
  });

  it('takeControl_noBrowser_throws', () => {
    const { registry } = setup();

    expect(codeOf(() => registry.takeControl('s1'))).toBe('browser_not_open');
    expect(() => registry.takeControl('s1')).toThrow(/s1/);
  });

  it('returnControl_setsIdle', () => {
    const { registry } = setup();
    registry.open('s1');
    registry.takeControl('s1');

    registry.returnControl('s1');

    expect(registry.states()[0]?.control).toBe('idle');
  });
});

describe('BrowserRegistry close and sweep', () => {
  it('close_removesNotifiesAndClosesHandle', async () => {
    const { registry, deps, handles } = setup();
    const handle = registry.open('s1');

    const closed = await registry.close('s1');

    expect(closed).toBe(true);
    expect(deps.onClosed).toHaveBeenCalledWith('s1', handle);
    expect(handles[0]?.close).toHaveBeenCalledTimes(1);
    expect(handles[0]?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(registry.states()).toEqual([]);
    expect(deps.onChange).toHaveBeenLastCalledWith([]);
  });

  it('close_unknown_false', async () => {
    const { registry } = setup();

    expect(await registry.close('nope')).toBe(false);
  });

  it('close_handleCloseFails_loggedAndRemoved', async () => {
    const { registry, deps, handles } = setup();
    registry.open('s1');
    handles[0]?.close.mockRejectedValue(new Error('boom'));

    const closed = await registry.close('s1');

    expect(closed).toBe(true);
    expect(registry.states()).toEqual([]);
    expect(deps.log).toHaveBeenCalledWith('warn', 'No se pudo cerrar el navegador de la sesión', {
      sessionId: 's1',
      error: 'boom',
    });
  });

  it('sweep_deadSession_closed', () => {
    const { registry, deps, handles, live } = setup();
    registry.open('s1');
    live.delete('s1');

    registry.sweep();

    expect(handles[0]?.close).toHaveBeenCalledTimes(1);
    expect(deps.onClosed).toHaveBeenCalledTimes(1);
    expect(registry.states()).toEqual([]);
  });

  it('stateChange_fromHandle_emits', () => {
    const { registry, deps, handles } = setup();
    registry.open('s1');
    deps.onChange.mockClear();

    handles[0]?.listener?.();

    expect(deps.onChange).toHaveBeenCalledTimes(1);
  });

  it('closeAll_closesEvery', async () => {
    const { registry, handles } = setup(['s1', 's2']);
    registry.open('s1');
    registry.open('s2');

    await registry.closeAll();

    expect(handles.map((handle) => handle.close.mock.calls.length)).toEqual([1, 1]);
    expect(registry.states()).toEqual([]);
  });
});
