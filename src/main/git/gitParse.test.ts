import { describe, expect, it } from 'vitest';
import { parseBranches, parseNumstat, parseStatusV2, switchTargetError } from './gitParse';

const Z = '\u0000';
const OID = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';
const ENTRY_1 = `1 .M N... 100644 100644 100644 ${OID} ${OID} src/a b.ts`;
const ENTRY_2 = `2 R. N... 100644 100644 100644 ${OID} ${OID} R100 nuevo.ts`;

describe('parseStatusV2', () => {
  it('parseStatusV2_ramaNormalConUpstream_leeTodo', () => {
    const out = [`# branch.oid ${OID}`, '# branch.head main', '# branch.upstream origin/main', '# branch.ab +3 -1', ENTRY_1, '? nuevo.txt', ''].join(Z);

    expect(parseStatusV2(out)).toEqual({ branch: 'main', detached: false, oid: OID, upstream: 'origin/main', ahead: 3, behind: 1, changed: 1, untracked: 1 });
  });

  it('parseStatusV2_detached_sinRama', () => {
    const out = [`# branch.oid ${OID}`, '# branch.head (detached)', ''].join(Z);

    expect(parseStatusV2(out)).toMatchObject({ branch: null, detached: true, upstream: null, ahead: 0, behind: 0 });
  });

  it('parseStatusV2_sinUpstream_ceroAdelanteYAtras', () => {
    const out = [`# branch.oid ${OID}`, '# branch.head feature/x', ''].join(Z);

    expect(parseStatusV2(out)).toMatchObject({ branch: 'feature/x', upstream: null, ahead: 0, behind: 0, changed: 0, untracked: 0 });
  });

  it('parseStatusV2_renombrado_saltaLaRutaDeOrigen', () => {
    // El origen `? raro.txt` imita una entrada: si no se saltara, contaria como no seguido.
    const out = ['# branch.head main', ENTRY_2, '? raro.txt', ''].join(Z);

    expect(parseStatusV2(out)).toMatchObject({ changed: 1, untracked: 0 });
  });

  it('parseStatusV2_repoSinCommits_oidNull', () => {
    expect(parseStatusV2(['# branch.oid (initial)', '# branch.head main', ''].join(Z)).oid).toBeNull();
  });

  it('parseStatusV2_vacia_todoACero', () => {
    expect(parseStatusV2('')).toEqual({ branch: null, detached: false, oid: null, upstream: null, ahead: 0, behind: 0, changed: 0, untracked: 0 });
  });

  it('parseStatusV2_abMalFormado_lanzaConElValor', () => {
    expect(() => parseStatusV2(['# branch.ab tres', ''].join(Z))).toThrow('"tres"');
  });
});

describe('parseNumstat', () => {
  it('parseNumstat_sumaLineasYCuentaFicheros', () => {
    const out = ['12\t3\tsrc/a.ts', '0\t7\tsrc/con\ttab.ts', ''].join(Z);

    expect(parseNumstat(out)).toEqual({ added: 12, removed: 10, files: 2, binaryFiles: 0 });
  });

  it('parseNumstat_binario_vaAparte', () => {
    expect(parseNumstat(['-\t-\tlogo.png', '1\t1\ta.ts', ''].join(Z))).toEqual({ added: 1, removed: 1, files: 2, binaryFiles: 1 });
  });

  it('parseNumstat_renombrado_consumeOrigenYDestino', () => {
    // Con -z un renombrado deja la ruta vacia y trae origen y destino en dos campos aparte.
    const out = ['4\t2\t', 'viejo.ts', 'nuevo.ts', '1\t0\totro.ts', ''].join(Z);

    expect(parseNumstat(out)).toEqual({ added: 5, removed: 2, files: 2, binaryFiles: 0 });
  });

  it('parseNumstat_vacia_ceros', () => {
    expect(parseNumstat('')).toEqual({ added: 0, removed: 0, files: 0, binaryFiles: 0 });
  });
});

describe('parseBranches', () => {
  it('parseBranches_unaPorLinea_sinVacias', () => {
    expect(parseBranches('main\r\nfeature/x\n\n')).toEqual(['main', 'feature/x']);
  });
});

describe('switchTargetError', () => {
  it('switchTargetError_ramaDeLaLista_null', () => {
    expect(switchTargetError('feature/x', ['main', 'feature/x'])).toBeNull();
  });

  it('switchTargetError_empiezaPorGuion_rechaza', () => {
    expect(switchTargetError('-f', ['-f'])).toContain('"-f"');
  });

  it('switchTargetError_fueraDeLaLista_rechaza', () => {
    expect(switchTargetError('otra', ['main'])).toContain('"otra"');
  });

  it('switchTargetError_vacia_rechaza', () => {
    expect(switchTargetError('', [''])).toBe('rama vacía');
  });
});
