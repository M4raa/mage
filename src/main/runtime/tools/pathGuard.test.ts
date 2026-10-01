import { describe, expect, it } from 'vitest';
import { resolveToolPath } from './pathGuard';

const WIN = { cwd: 'C:\\proj', extraDirs: ['D:\\extra'], platform: 'win32' };
const POSIX = { cwd: '/home/u/proj', extraDirs: [], platform: 'linux' };

describe('resolveToolPath', () => {
  it('resolve_relativeInside_isInside', () => {
    expect(resolveToolPath('src/a.ts', POSIX)).toEqual({ absolute: '/home/u/proj/src/a.ts', pathClass: 'inside' });
  });

  it('resolve_dotDotEscape_isOutside', () => {
    expect(resolveToolPath('../secreto', POSIX).pathClass).toBe('outside');
  });

  it('resolve_siblingWithSamePrefix_isOutside', () => {
    expect(resolveToolPath('/home/u/proj-otro/x', POSIX).pathClass).toBe('outside');
  });

  it('resolve_cwdItself_isInside', () => {
    expect(resolveToolPath('.', POSIX).pathClass).toBe('inside');
  });

  it('resolve_win32DifferentCase_isInside', () => {
    expect(resolveToolPath('c:\\PROJ\\Src\\a.ts', WIN).pathClass).toBe('inside');
  });

  it('resolve_win32OtherDrive_isOutside', () => {
    expect(resolveToolPath('E:\\proj\\a.ts', WIN).pathClass).toBe('outside');
  });

  it('resolve_win32ExtraDir_isInside', () => {
    expect(resolveToolPath('D:\\extra\\b.txt', WIN).pathClass).toBe('inside');
  });

  it('resolve_empty_throws', () => {
    expect(() => resolveToolPath('  ', POSIX)).toThrow(/vacia/);
  });
});
