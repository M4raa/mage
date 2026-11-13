import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@shared/settings';
import { createSettingsActions, type SettingsDeps } from './settingsActions';
import type { WorkbenchState } from './workbenchStore';

// setIdleCloseMinutes (punto 23): valida el entero y su rango, lo guarda y persiste.

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
  return { actions: createSettingsActions(deps), persistSettings, current: () => state.settings.idleCloseMinutes };
}

describe('setIdleCloseMinutes', () => {
  it('setIdleCloseMinutes_cero_guarda', () => {
    const { actions, persistSettings, current } = setup();

    actions.setIdleCloseMinutes(0);

    expect(current()).toBe(0);
    expect(persistSettings).toHaveBeenCalledTimes(1);
  });

  it('setIdleCloseMinutes_negativo_lanza', () => {
    const { actions, persistSettings } = setup();

    expect(() => actions.setIdleCloseMinutes(-1)).toThrow('-1');
    expect(persistSettings).not.toHaveBeenCalled();
  });

  it('setIdleCloseMinutes_decimal_lanza', () => {
    const { actions, persistSettings } = setup();

    expect(() => actions.setIdleCloseMinutes(2.5)).toThrow('2.5');
    expect(persistSettings).not.toHaveBeenCalled();
  });
});
