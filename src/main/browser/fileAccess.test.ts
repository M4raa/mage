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

const SCRATCH = path.resolve('/tmp/claude/slug/sesion/scratchpad/informe.html');
const SCRATCH_CSS = path.resolve('/tmp/claude/slug/sesion/scratchpad/estilo.css');

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
  [SCRATCH, SCRATCH],
  [SCRATCH_CSS, SCRATCH_CSS],
]);

const deps: FileAccessDeps = {
  realpath: (target) => {
    const real = REAL.get(target);
    if (real === undefined) throw new Error(`ENOENT: ${target}`);
    return real;
  },
};

const depsWithScratch: FileAccessDeps = {
  ...deps,
  isAllowedOutsideRoot: (real) => real.startsWith(path.resolve('/tmp/claude')),
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

  it('allowsPage_scratchpadConSegundaRaiz_true', () => {
    const access = createFileAccess(ROOT, depsWithScratch)!;

    expect(access.allowsPage(url(SCRATCH))).toBe(true);
  });

  it('allowsPage_scratchpadSinSegundaRaiz_false', () => {
    const access = createFileAccess(ROOT, deps)!;

    expect(access.allowsPage(url(SCRATCH))).toBe(false);
  });

  it('resolve_recursoDelScratchpad_devuelveRutaReal', () => {
    const access = createFileAccess(ROOT, depsWithScratch)!;

    expect(access.resolve(url(SCRATCH_CSS))).toBe(SCRATCH_CSS);
  });

  it('allowsPage_fueraYSegundaRaizDiceQueNo_false', () => {
    const access = createFileAccess(ROOT, depsWithScratch)!;

    expect(access.allowsPage(url(OUTSIDE))).toBe(false);
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
