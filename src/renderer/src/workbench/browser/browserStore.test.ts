import { beforeEach, describe, expect, it } from 'vitest';
import type { BrowserEntryState } from '@shared/browser';
import { useBrowserStore } from './browserStore';

const stateOf = (sessionId: string): BrowserEntryState => ({
  sessionId,
  url: 'http://localhost:3000/',
  title: '',
  canGoBack: false,
  loading: false,
  control: 'idle',
  lastAction: null,
});

describe('useBrowserStore', () => {
  beforeEach(() => useBrowserStore.setState({ states: {}, penByTab: {} }));

  it('setStates_indexesBySession', () => {
    useBrowserStore.getState().setStates([stateOf('A'), stateOf('B')]);

    expect(Object.keys(useBrowserStore.getState().states)).toEqual(['A', 'B']);
    expect(useBrowserStore.getState().states.B?.sessionId).toBe('B');
  });

  it('rememberPen_perTab', () => {
    useBrowserStore.getState().rememberPen('t1', { data: 'X', caption: 'c1' });
    useBrowserStore.getState().rememberPen('t2', { data: 'Y', caption: 'c2' });

    expect(useBrowserStore.getState().penByTab).toEqual({ t1: { data: 'X', caption: 'c1' }, t2: { data: 'Y', caption: 'c2' } });
  });
});
