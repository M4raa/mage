import { describe, expect, it } from 'vitest';
import { withTaskDirectories } from './taskLaunch';

describe('withTaskDirectories', () => {
  it('withTaskDirectories_sinExtras_mismaReferencia', () => {
    const fragment = { permissions: { allow: ['x'] } };

    expect(withTaskDirectories(fragment, [])).toBe(fragment);
    expect(withTaskDirectories(null, [])).toBeNull();
  });

  it('withTaskDirectories_fragmentoNull_creaPermissions', () => {
    expect(withTaskDirectories(null, ['/a'])).toEqual({ permissions: { additionalDirectories: ['/a'] } });
  });

  it('withTaskDirectories_conservaAllowYHooks', () => {
    const fragment = { hooks: { Stop: [] }, permissions: { allow: ['Bash(ls)'], deny: ['Read(x)'] } };

    const result = withTaskDirectories(fragment, ['/a']);

    expect(result).toEqual({ hooks: { Stop: [] }, permissions: { allow: ['Bash(ls)'], deny: ['Read(x)'], additionalDirectories: ['/a'] } });
    expect(fragment.permissions).not.toHaveProperty('additionalDirectories');
  });

  it('withTaskDirectories_unionSinDuplicados', () => {
    const result = withTaskDirectories({ permissions: { additionalDirectories: ['/a', '/b'] } }, ['/b', '/c']);

    expect(result).toEqual({ permissions: { additionalDirectories: ['/a', '/b', '/c'] } });
  });
});
