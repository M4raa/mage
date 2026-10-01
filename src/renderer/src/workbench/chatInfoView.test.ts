import { describe, expect, it } from 'vitest';
import { diffChip, folderChip, ghNoticeView, gitChip, isInside, lastPathSegment, prBarView, privacyChip } from './chatInfoView';
import { EMPTY_CHECK_SUMMARY, type GhPullRequest } from '@shared/gh';
import type { GitRepoState } from '@shared/git';

// Estas etiquetas las lee el usuario de un vistazo, asi que lo que importa es que NO mientan: una ruta
// que se confunde con otra por prefijo, o un modelo que dice una version que la sesion no usa.

describe('lastPathSegment', () => {
  it('lastPathSegment_rutaDeWindows_devuelveElUltimo', () => {
    expect(lastPathSegment('C:\\sourcecode\\mage')).toBe('mage');
  });

  it('lastPathSegment_rutaPosix_tambien', () => {
    // Una ruta de WSL o escrita a mano llega con barras normales aunque el SO sea Windows.
    expect(lastPathSegment('/home/dev/proyectos/api')).toBe('api');
  });

  it('lastPathSegment_conBarraFinal_noDevuelveVacio', () => {
    expect(lastPathSegment('C:\\sourcecode\\mage\\')).toBe('mage');
  });

  it('lastPathSegment_rutaVacia_devuelveVacio', () => {
    expect(lastPathSegment('')).toBe('');
  });
});

describe('isInside', () => {
  it('isInside_subcarpeta_si', () => {
    expect(isInside('C:/tmp/scratch/aa69', 'C:/tmp/scratch')).toBe(true);
  });

  it('isInside_laMismaCarpeta_si', () => {
    expect(isInside('C:/tmp/scratch', 'C:/tmp/scratch')).toBe(true);
  });

  it('isInside_hermanaConPrefijoComun_NO', () => {
    // El borde de comparar rutas por prefijo de cadena: "scratch-viejo" empieza por "scratch".
    expect(isInside('C:/tmp/scratch-viejo/x', 'C:/tmp/scratch')).toBe(false);
  });

  it('isInside_separadoresMezclados_si', () => {
    expect(isInside('C:\\tmp\\scratch\\aa69', 'C:/tmp/scratch')).toBe(true);
  });

  it('isInside_mayusculasDistintas_si', () => {
    expect(isInside('c:/TMP/Scratch/aa69', 'C:/tmp/scratch')).toBe(true);
  });

  it('isInside_padreVacio_NO', () => {
    // Un scratch dir sin resolver no puede hacer que TODO parezca estar dentro de el.
    expect(isInside('C:/sourcecode/mage', '')).toBe(false);
  });

  it('isInside_alReves_NO', () => {
    expect(isInside('C:/tmp', 'C:/tmp/scratch')).toBe(false);
  });
});

describe('folderChip', () => {
  it('folderChip_proyectoNormal_etiquetaConElNombreDeLaCarpeta', () => {
    const chip = folderChip('C:\\sourcecode\\mage', 'C:\\tmp\\scratch');

    expect(chip).toEqual({ icon: 'folder', label: 'mage', title: 'C:\\sourcecode\\mage · abrir la carpeta' });
  });

  it('folderChip_dentroDelScratchpad_seLlamaScratchpad', () => {
    // Es el caso REAL de una conversacion "sin friccion": su cwd es un subdirectorio con nombre de
    // UUID, y ahi el ultimo segmento no dice absolutamente nada.
    const chip = folderChip('C:\\tmp\\scratch\\aa691438-9c76-4efe-97ab', 'C:\\tmp\\scratch');

    expect(chip?.label).toBe('Scratchpad');
    expect(chip?.title).toContain('aa691438');
  });

  it('folderChip_sinScratchDirResuelto_noConfundeConScratchpad', () => {
    const chip = folderChip('C:\\sourcecode\\mage', null);

    expect(chip?.label).toBe('mage');
  });

  it('folderChip_cwdVacio_devuelveNull', () => {
    // Sin carpeta no hay etiqueta: una que abriera "" no llevaria a ningun sitio.
    expect(folderChip('   ', null)).toBeNull();
  });
});

describe('privacyChip', () => {
  it('privacyChip_privada_loDice', () => {
    expect(privacyChip('private').label).toBe('Privado');
  });

  it('privacyChip_compartida_loDice', () => {
    expect(privacyChip('shared').label).toBe('Compartido');
  });
});

const REPO: GitRepoState = {
  kind: 'repo',
  branch: 'feature/x',
  detached: false,
  headShort: '1a2b3c4',
  upstream: 'origin/feature/x',
  ahead: 2,
  behind: 0,
  dirty: true,
  added: 3520,
  removed: 231,
  changedFiles: 4,
  untracked: 1,
};

describe('gitChip', () => {
  it('gitChip_repo_nombreDeLaRamaYSincronia', () => {
    expect(gitChip(REPO)).toEqual({ icon: 'branch', label: 'feature/x', title: 'Rama feature/x · 2 por delante y 0 por detrás de origin/feature/x' });
  });

  it('gitChip_headSuelta_enseñaElCommit', () => {
    expect(gitChip({ ...REPO, branch: null, detached: true, upstream: null })).toMatchObject({ label: '1a2b3c4', title: 'HEAD suelta en 1a2b3c4 · sin rama remota' });
  });

  it('gitChip_sinRepoOSinConfianza_null', () => {
    expect(gitChip(undefined)).toBeNull();
    expect(gitChip({ kind: 'no-repo' })).toBeNull();
    expect(gitChip({ kind: 'untrusted', repoRoot: 'C:/r' })).toBeNull();
  });
});

describe('diffChip', () => {
  it('diffChip_sucio_masYMenos', () => {
    expect(diffChip(REPO)).toEqual({ added: '+3520', removed: '−231', title: '4 ficheros cambiados y 1 sin seguir: +3520 líneas, −231' });
  });

  it('diffChip_limpio_null', () => {
    expect(diffChip({ ...REPO, dirty: false })).toBeNull();
  });

  it('diffChip_soloNoSeguidos_ceroLineas', () => {
    expect(diffChip({ ...REPO, added: 0, removed: 0, changedFiles: 0, untracked: 2 })).toMatchObject({ added: '+0', removed: '−0' });
  });
});

describe('prBarView', () => {
  const base: GhPullRequest = {
    number: 7, title: 'Arregla x', url: 'https://github.com/acme/demo/pull/7', state: 'open', isDraft: true, headRefName: 'f', headSha: 's',
    baseRefName: 'main', mergeable: 'conflicting', mergeStateStatus: 'DIRTY', reviewDecision: 'changes_requested', autoMerge: true,
    checks: [{ name: 'check', workflow: 'check', state: 'fail', url: null, startedAt: null, completedAt: null }],
    summary: { ...EMPTY_CHECK_SUMMARY, pass: 3, fail: 1 },
  };

  it('prBarView_borradorConFallos_etiquetaCuentasYDetalles', () => {
    const view = prBarView(base);

    expect(view.label).toBe('#7 · Borrador');
    expect(view.counts.map((c) => `${c.glyph}${c.count}`)).toEqual(['✓3', '✗1']);
    expect(view.details).toEqual(['Cambios pedidos', 'Conflicto de fusión', 'Auto-merge activo']);
    expect(view.failing).toEqual(['check']);
  });

  it('prBarView_fusionado_sinConflictoNiCuentasVacias', () => {
    const view = prBarView({ ...base, state: 'merged', isDraft: false, reviewDecision: null, autoMerge: false, summary: EMPTY_CHECK_SUMMARY });

    expect(view.label).toBe('#7 · Fusionado');
    expect(view.counts).toEqual([]);
    expect(view.details).toEqual([]);
  });
});

describe('ghNoticeView', () => {
  it('ghNoticeView_sinGh_enlazaAlInstalador', () => {
    expect(ghNoticeView({ kind: 'off', reason: 'no-gh' }, false)).toMatchObject({ label: 'PR: instala gh', url: 'https://cli.github.com' });
  });

  it('ghNoticeView_sinSesion_explicaElComandoSinEnlace', () => {
    expect(ghNoticeView({ kind: 'off', reason: 'no-auth' }, false)).toMatchObject({ url: null, title: expect.stringContaining('gh auth login') });
  });

  it('ghNoticeView_descartadoUOtroMotivo_null', () => {
    expect(ghNoticeView({ kind: 'off', reason: 'no-gh' }, true)).toBeNull();
    expect(ghNoticeView({ kind: 'off', reason: 'not-github' }, false)).toBeNull();
    expect(ghNoticeView({ kind: 'no-pr', branch: 'f' }, false)).toBeNull();
    expect(ghNoticeView(undefined, false)).toBeNull();
  });
});
