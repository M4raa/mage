import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFileAccess, type FileAccessDeps } from './fileAccess';

const ROOT = path.resolve('/proyecto');
const PAGE = path.join(ROOT, 'index.html');
const UPPER_PAGE = path.join(ROOT, 'LEEME.HTM');
const DOTTED = path.join(ROOT, '..notas.html');
const STYLE = path.join(ROOT, 'sub', 'style.css');
const OUTSIDE = path.resolve('/fuera/secreto.html');
// Un enlace (junction) de dentro que apunta fuera, y la forma corta (8.3) de la raíz.
const LINK = path.join(ROOT, 'enlace', 'secreto.html');
const SHORT_ROOT = path.resolve('/PROYEC~1');
const SHORT_PAGE = path.join(SHORT_ROOT, 'index.html');

const REAL: ReadonlyMap<string, string> = new Map([
  [ROOT, ROOT],
  [SHORT_ROOT, ROOT],
  [PAGE, PAGE],
  [SHORT_PAGE, PAGE],
  [UPPER_PAGE, UPPER_PAGE],
  [DOTTED, DOTTED],
  [STYLE, STYLE],
  [OUTSIDE, OUTSIDE],
  [LINK, OUTSIDE],
]);

const deps: FileAccessDeps = {
  realpath: (target) => {
    const real = REAL.get(target);
    if (real === undefined) throw new Error(`ENOENT: ${target}`);
    return real;
  },
};

const url = (target: string): string => pathToFileURL(target).href;

describe('createFileAccess', () => {
  it.each([null, '', '   ', path.resolve('/no-existe')])('createFileAccess_rootMissing_returnsNull (%s)', (root) => {
    expect(createFileAccess(root, deps)).toBeNull();
  });

  it.each([
    ['html dentro', PAGE, true],
    ['htm en mayúsculas', UPPER_PAGE, true],
    ['nombre que empieza por ..', DOTTED, true],
    ['raíz en forma corta', SHORT_PAGE, true],
    ['no es html', STYLE, false],
    ['fuera', OUTSIDE, false],
    ['enlace que sale', LINK, false],
    ['no existe', path.join(ROOT, 'nada.html'), false],
  ])('allowsPage_%s_returnsExpected', (_case, target, expected) => {
    const access = createFileAccess(ROOT, deps)!;

    expect(access.allowsPage(url(target))).toBe(expected);
  });

  it('resolve_resourceInside_returnsRealPath', () => {
    expect(createFileAccess(ROOT, deps)!.resolve(url(STYLE))).toBe(STYLE);
  });

  it.each([
    ['enlace que sale', url(LINK)],
    ['http', 'http://localhost/index.html'],
    ['no es URL', 'no es url'],
  ])('resolve_notAllowed_returnsNull (%s)', (_case, value) => {
    expect(createFileAccess(ROOT, deps)!.resolve(value)).toBeNull();
  });

  it('resolve_rootGivenInShortForm_acceptsLongPaths', () => {
    expect(createFileAccess(SHORT_ROOT, deps)!.resolve(url(PAGE))).toBe(PAGE);
  });
});
