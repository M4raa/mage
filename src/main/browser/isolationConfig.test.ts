import { describe, expect, it } from 'vitest';
import { ISOLATED_WEB_PREFERENCES, partitionNameFor } from './isolationConfig';

describe('ISOLATED_WEB_PREFERENCES', () => {
  it('isolatedWebPreferences_always_isLockedDown', () => {
    // Act y Assert
    expect(ISOLATED_WEB_PREFERENCES).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      backgroundThrottling: false,
    });
    expect('preload' in ISOLATED_WEB_PREFERENCES).toBe(false);
    expect(Object.isFrozen(ISOLATED_WEB_PREFERENCES)).toBe(true);
  });
});

describe('partitionNameFor', () => {
  it('partitionNameFor_validId_returnsInMemoryName', () => {
    // Act
    const name = partitionNameFor('abc-123');

    // Assert
    expect(name).toBe('mage-browser-abc-123');
    expect(name.startsWith('persist:')).toBe(false);
  });

  it.each(['', 'persist:x', 'a/b', 'a b', 'x'.repeat(65)])(
    'partitionNameFor_invalidId_throws: «%s»',
    (instanceId) => {
      // Act y Assert
      expect(() => partitionNameFor(instanceId)).toThrow(/no válido/);
    },
  );
});
