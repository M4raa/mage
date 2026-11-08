import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, KEEP_ALIVE_MAX_PAUSE_MAX, KEEP_ALIVE_MIN_CONTEXT_MAX } from '@shared/settings';
import { createSettingsActions, type SettingsDeps } from './settingsActions';
import type { WorkbenchState } from './workbenchStore';

// setKeepAlive (U11, U15): valida el parche, lo fusiona con los ajustes y persiste.

function setup() {
  let state = { settings: DEFAULT_APP_SETTINGS } as unknown as WorkbenchState;
  const persistSettings = vi.fn();
  const deps = {
    mage: {},
    get: () => state,
    set: (fn: (s: WorkbenchState) => Partial<WorkbenchState>) => {
      state = { ...state, ...fn(state) };
    },
    persistSettings,
  } as unknown as SettingsDeps;
  return { actions: createSettingsActions(deps), persistSettings, current: () => state.settings.keepAlive };
}

describe('setKeepAlive', () => {
  it('setKeepAlive_validPatch_mergesAndPersists', () => {
    const { actions, persistSettings, current } = setup();

    actions.setKeepAlive({ apiKeyEnabled: true, maxPauseHours: 12 });

    expect(current()).toEqual({ ...DEFAULT_APP_SETTINGS.keepAlive, apiKeyEnabled: true, maxPauseHours: 12 });
    expect(persistSettings).toHaveBeenCalledTimes(1);
  });

  it('setKeepAlive_pauseZero_throws', () => {
    const { actions, persistSettings } = setup();

    expect(() => actions.setKeepAlive({ maxPauseHours: 0 })).toThrow('maxPauseHours');
    expect(persistSettings).not.toHaveBeenCalled();
  });

  it('setKeepAlive_contextFloat_throws', () => {
    const { actions } = setup();

    expect(() => actions.setKeepAlive({ minContextTokens: 1000.5 })).toThrow('1000.5');
  });

  it('setKeepAlive_contextAboveMax_throws', () => {
    const { actions } = setup();

    expect(() => actions.setKeepAlive({ minContextTokens: KEEP_ALIVE_MIN_CONTEXT_MAX + 1 })).toThrow('minContextTokens');
    expect(() => actions.setKeepAlive({ maxPauseHours: KEEP_ALIVE_MAX_PAUSE_MAX + 1 })).toThrow('maxPauseHours');
  });
});
