import { describe, expect, it } from 'vitest';
import type { BrowserEntryState } from '@shared/browser';
import { browserPanelViewOf, indexStates, sameBounds, shouldRevealBrowser, toWindowBounds } from './browserPanelModel';

const stateOf = (sessionId: string, control: BrowserEntryState['control'] = 'idle'): BrowserEntryState => ({
  sessionId,
  url: 'http://localhost:3000/',
  title: '',
  canGoBack: false,
  loading: false,
  control,
  lastAction: null,
});

describe('browserPanelViewOf', () => {
  it('browserPanelViewOf_noSession_noSession', () => {
    expect(browserPanelViewOf(undefined, {})).toEqual({ kind: 'noSession' });
    expect(browserPanelViewOf('', {})).toEqual({ kind: 'noSession' });
  });

  it('browserPanelViewOf_withoutState_closed', () => {
    expect(browserPanelViewOf('A', {})).toEqual({ kind: 'closed', sessionId: 'A' });
  });

  it('browserPanelViewOf_withState_open', () => {
    const state = stateOf('A');

    expect(browserPanelViewOf('A', indexStates([state]))).toEqual({ kind: 'open', state });
  });
});

describe('toWindowBounds', () => {
  it('toWindowBounds_zoom125_scaledRounded', () => {
    expect(toWindowBounds({ left: 10.4, top: 20, width: 300, height: 200.2 }, 1.25)).toEqual({ x: 13, y: 25, width: 375, height: 250 });
  });

  it('toWindowBounds_negative_clampedZero', () => {
    expect(toWindowBounds({ left: -5, top: -1, width: 10, height: 10 }, 1)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('toWindowBounds_invalidZoom_throws', () => {
    const rect = { left: 0, top: 0, width: 1, height: 1 };

    expect(() => toWindowBounds(rect, 0)).toThrow('0');
    expect(() => toWindowBounds(rect, Number.NaN)).toThrow('NaN');
  });
});

describe('sameBounds', () => {
  it('sameBounds_cases', () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 };

    expect(sameBounds(null, null)).toBe(true);
    expect(sameBounds(null, rect)).toBe(false);
    expect(sameBounds(rect, { ...rect })).toBe(true);
    expect(sameBounds(rect, { ...rect, width: 5 })).toBe(false);
  });
});

describe('shouldRevealBrowser', () => {
  it('shouldRevealBrowser_agentStartsOnActive_true', () => {
    expect(shouldRevealBrowser({}, indexStates([stateOf('A', 'agent')]), 'A')).toBe(true);
    expect(shouldRevealBrowser(indexStates([stateOf('A', 'idle')]), indexStates([stateOf('A', 'agent')]), 'A')).toBe(true);
  });

  it('shouldRevealBrowser_alreadyAgent_false', () => {
    const states = indexStates([stateOf('A', 'agent')]);

    expect(shouldRevealBrowser(states, states, 'A')).toBe(false);
  });

  it('shouldRevealBrowser_otherSession_false', () => {
    expect(shouldRevealBrowser({}, indexStates([stateOf('B', 'agent')]), 'A')).toBe(false);
  });

  it('shouldRevealBrowser_noActive_false', () => {
    expect(shouldRevealBrowser({}, indexStates([stateOf('A', 'agent')]), undefined)).toBe(false);
  });

  it('shouldRevealBrowser_userControl_false', () => {
    expect(shouldRevealBrowser({}, indexStates([stateOf('A', 'user')]), 'A')).toBe(false);
  });
});
