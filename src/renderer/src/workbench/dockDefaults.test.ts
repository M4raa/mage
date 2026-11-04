import { describe, expect, it } from 'vitest';
import { DOCK_DEFAULTS_VERSION, shouldApplyDockDefaults } from './dockDefaults';

describe('shouldApplyDockDefaults', () => {
  it('shouldApplyDockDefaults_zero_true', () => {
    expect(shouldApplyDockDefaults(0)).toBe(true);
  });

  it('shouldApplyDockDefaults_current_false', () => {
    expect(shouldApplyDockDefaults(DOCK_DEFAULTS_VERSION)).toBe(false);
  });
});
