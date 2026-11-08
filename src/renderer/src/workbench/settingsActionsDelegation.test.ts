import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import { createSettingsActions, type SettingsDeps } from './settingsActions';
import type { WorkbenchState } from './workbenchStore';

// setDelegationDepth (U10): valida el entero y su rango, lo guarda y persiste.

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
  return { actions: createSettingsActions(deps), persistSettings, current: () => state.settings.delegation };
}

describe('setDelegationDepth', () => {
  it('setDelegationDepth_valid_persists', () => {
    const { actions, persistSettings, current } = setup();

    actions.setDelegationDepth(5);

    expect(current()).toEqual({ maxDepth: 5 });
    expect(persistSettings).toHaveBeenCalledTimes(1);
  });

  it('setDelegationDepth_0or6orFraction_throws', () => {
    const { actions, persistSettings } = setup();

    expect(() => actions.setDelegationDepth(0)).toThrow('0');
    expect(() => actions.setDelegationDepth(6)).toThrow('6');
    expect(() => actions.setDelegationDepth(2.5)).toThrow('2.5');
    expect(persistSettings).not.toHaveBeenCalled();
  });
});
