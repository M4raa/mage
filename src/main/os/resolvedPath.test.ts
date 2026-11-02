import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localized } from '@shared/i18n/localizedText';
import { resolvedPath } from './resolvedPath';

const roots: string[] = [];
function fixture(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'mage-resolved-path-')));
  roots.push(root); return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('resolvedPath — F1.9b', () => {
  it.skipIf(process.platform === 'win32')('enlaceRotoRelativo_resuelveElDestinoYElAncestroExistente', () => {
    const root = fixture(); mkdirSync(join(root, 'inside')); mkdirSync(join(root, 'outside'));
    const link = join(root, 'inside', 'broken');
    // Junctions Windows absolutizan el destino; este caso usa un symlink POSIX real en Ubuntu.
    symlinkSync('../outside/missing', link, 'dir');
    expect(resolvedPath(join(link, 'new.txt'))).toBe(join(root, 'outside', 'missing', 'new.txt'));
  });

  it('enlaceRoto_limiteExplicitoNoSeConvierteEnRutaAutorizada', () => {
    const root = fixture(); const link = join(root, 'broken');
    symlinkSync(join(root, 'missing'), link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => resolvedPath(link, 0)).toThrow(/Demasiados enlaces/);
    expect(() => resolvedPath(link, 0)).toThrow(expect.objectContaining({ localized: localized('errors.os.tooManyLinks') }));
  });

  it('cicloDeEnlaces_lanzaSinRecursionInfinita', () => {
    const root = fixture(); const a = join(root, 'a'), b = join(root, 'b');
    symlinkSync(b, a, process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(a, b, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => resolvedPath(a)).toThrow();
  });

  it.each(['EACCES', 'EPERM'])('%s_sePropagaSinFallbackLexico', code => {
    const error = Object.assign(new Error(code), { code });
    vi.spyOn(realpathSync, 'native').mockImplementation(() => { throw error; });
    expect(() => resolvedPath(resolve('blocked'))).toThrow(error);
  });
});
