import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeRealpath, resolveToolPath } from './pathGuard';

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

describe('resolveToolPath con realpath (A3)', () => {
  it('resolve_linkInsideCwdPointingOutside_isOutside', () => {
    // `proj/h` es un enlace a la carpeta del usuario: lexicamente dentro, de verdad fuera.
    const link = '/home/u/proj/h';
    const realpath = (path: string): string => (path === link || path.startsWith(`${link}/`) ? `/home/u${path.slice(link.length)}` : path);

    expect(resolveToolPath('h/.ssh/id_rsa', { ...POSIX, realpath }).pathClass).toBe('outside');
  });

  it('resolve_missingTargetUnderLink_usesNearestExistingAncestor', () => {
    const realpath = (path: string): string | null => {
      if (path === '/home/u/proj/h') return '/home/u';
      if (path === '/home/u/proj' || path === '/home/u' || path === '/home' || path === '/') return path;
      return null; // no existe
    };

    expect(resolveToolPath('h/nuevo/.bashrc', { ...POSIX, realpath }).pathClass).toBe('outside');
  });

  it('resolve_realJunctionToOutside_isOutside', () => {
    const base = mkdtempSync(join(tmpdir(), 'mage-pathguard-'));
    try {
      const proj = join(base, 'proj');
      const outside = join(base, 'fuera');
      mkdirSync(proj);
      mkdirSync(outside);
      symlinkSync(outside, join(proj, 'enlace'), 'junction');
      const scope = { cwd: proj, extraDirs: [], platform: process.platform, realpath: nodeRealpath };

      expect(resolveToolPath(join('enlace', 'secreto.txt'), scope).pathClass).toBe('outside');
      expect(resolveToolPath(join('src', 'a.ts'), scope).pathClass).toBe('inside');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
