import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { foreignText, localized, UserFacingError } from '@shared/i18n/localizedText';
import { classifyGhExit, normalizeCheckState, parseHeadOnly, parseMergeOptions, parsePrDetail, parsePrList, parsePrView, parseRunList, pickBranchPr, summarizeChecks } from './ghParse';

// Fixtures MEDIDOS con gh 2.102.0 (`spike/gh-spike.mjs` con MAGE_GH_FIXTURES), anonimizados a acme/demo.
const PR_LIST = readFileSync(new URL('./__fixtures__/pr-list-head.json', import.meta.url), 'utf8');
const RUN_LIST = readFileSync(new URL('./__fixtures__/run-list.json', import.meta.url), 'utf8');

// El mismo PR con el check en marcha, tal y como se midio a mitad del CI el 2026-09-30: `IN_PROGRESS`,
// `conclusion: ""`, la fecha cero de Go en `completedAt` y `mergeStateStatus: UNSTABLE`.
function pendingPrJson(): string {
  const [pr] = JSON.parse(PR_LIST) as [Record<string, unknown> & { statusCheckRollup: Record<string, unknown>[] }];
  pr.mergeStateStatus = 'UNSTABLE';
  pr.statusCheckRollup[0] = { ...pr.statusCheckRollup[0], status: 'IN_PROGRESS', conclusion: '', completedAt: '0001-01-01T00:00:00Z' };
  return JSON.stringify(pr);
}

describe('pickBranchPr', () => {
  it('pickBranchPr_fixtureMedido_normalizaEstadoChecksYRevision', () => {
    const pr = pickBranchPr(PR_LIST, 'acme');

    expect(pr).toMatchObject({
      number: 1,
      state: 'open',
      isDraft: true,
      mergeable: 'mergeable',
      mergeStateStatus: 'CLEAN',
      reviewDecision: null,
      autoMerge: false,
      headSha: '2b2687300a116fa13712dbed0a4b6470cff427e3',
      summary: { pass: 2, fail: 0, pending: 0, skip: 0, cancel: 0 },
    });
    expect(pr?.checks[1]).toMatchObject({ name: 'GitGuardian Security Checks', workflow: '', state: 'pass' });
  });

  it('pickBranchPr_listaVacia_null', () => {
    expect(pickBranchPr('[]', 'acme')).toBeNull();
  });

  it('pickBranchPr_ramaDeOtroDueño_null', () => {
    expect(pickBranchPr(PR_LIST, 'otro')).toBeNull();
  });

  it('pickBranchPr_entradaRotaDelante_seSaltaYDevuelveLaBuena', () => {
    const list = JSON.stringify([{ title: 'sin numero' }, ...JSON.parse(PR_LIST)]);

    expect(pickBranchPr(list, 'ACME')?.number).toBe(1);
  });

  it('pickBranchPr_noEsJson_lanzaConElTexto', () => {
    expect(() => pickBranchPr('no json', 'acme')).toThrow('no json');
  });

  it('pickBranchPr_noEsJson_envuelveElErrorDeAnalisisComoTextoAjeno', () => {
    const thrown = (() => { try { pickBranchPr('no json', 'acme'); } catch (err) { return err; } })();

    expect(thrown).toBeInstanceOf(UserFacingError);
    const text = (thrown as UserFacingError).localized;
    expect(text.key).toBe('errors.gh.invalidJson');
    expect(text.values).toEqual({ what: 'gh pr list', output: 'no json' });
    expect(text.parts?.['detail']?.key).toBe(foreignText('x').key);
  });

  it('parseRunList_noEsLista_lanzaLaClaveConLaSalida', () => {
    expect(() => parseRunList('{}')).toThrow(expect.objectContaining({ localized: localized('errors.gh.unexpectedRunList', { output: '{}' }) }));
  });
});

describe('parsePrView', () => {
  it('parsePrView_checkEnMarcha_pendienteYFechaCeroANull', () => {
    const pr = parsePrView(pendingPrJson());

    expect(pr.summary).toMatchObject({ pending: 1, pass: 1 });
    expect(pr.checks[0]).toMatchObject({ state: 'pending', completedAt: null });
    expect(pr.mergeStateStatus).toBe('UNSTABLE');
  });

  it('parsePrView_valoresSinMedirDocumentados_seNormalizan', () => {
    const [base] = JSON.parse(PR_LIST) as [Record<string, unknown>];
    const raw = {
      ...base,
      state: 'MERGED',
      mergeable: 'CONFLICTING',
      reviewDecision: 'CHANGES_REQUESTED',
      autoMergeRequest: { mergeMethod: 'SQUASH' },
      statusCheckRollup: [
        { __typename: 'StatusContext', context: 'ci/legacy', state: 'FAILURE', targetUrl: 'https://ci.example/1' },
        { __typename: 'CheckRun', name: 'x', status: 'COMPLETED', conclusion: 'SKIPPED', detailsUrl: 'javascript:alert(1)' },
      ],
    };

    const pr = parsePrView(JSON.stringify(raw));

    expect(pr).toMatchObject({ state: 'merged', mergeable: 'conflicting', reviewDecision: 'changes_requested', autoMerge: true });
    expect(pr.checks).toEqual([
      expect.objectContaining({ name: 'ci/legacy', state: 'fail', url: 'https://ci.example/1' }),
      expect.objectContaining({ name: 'x', state: 'skip', url: null }),
    ]);
  });

  it('parsePrView_sinNumero_lanza', () => {
    expect(() => parsePrView('{"title":"x","url":"https://github.com/a/b/pull/1"}')).toThrow('forma inesperada');
  });
});

describe('parseRunList', () => {
  it('parseRunList_fixtureMedido_minusculasYId', () => {
    expect(parseRunList(RUN_LIST)).toEqual([
      { id: 36766441586, name: 'check', state: 'pass', url: 'https://github.com/acme/demo/actions/runs/36766441586', attempt: 1, event: 'pull_request' },
    ]);
  });

  it('parseRunList_vacio_listaVacia', () => {
    expect(parseRunList('[]')).toEqual([]);
  });
});

describe('normalizeCheckState / summarizeChecks / classifyGhExit', () => {
  it('normalizeCheckState_losTresVocabularios', () => {
    expect(normalizeCheckState('IN_PROGRESS', '')).toBe('pending');
    expect(normalizeCheckState('queued', '')).toBe('pending');
    expect(normalizeCheckState('completed', 'success')).toBe('pass');
    expect(normalizeCheckState('COMPLETED', 'TIMED_OUT')).toBe('fail');
    expect(normalizeCheckState('completed', 'cancelled')).toBe('cancel');
    expect(normalizeCheckState('COMPLETED', 'NEUTRAL')).toBe('skip');
    expect(normalizeCheckState('', 'PENDING')).toBe('pending');
  });

  it('summarizeChecks_vacio_todoCero', () => {
    expect(summarizeChecks([])).toEqual({ pending: 0, pass: 0, fail: 0, skip: 0, cancel: 0 });
  });

  it('classifyGhExit_soloEl4EsSinSesion', () => {
    expect(classifyGhExit(0)).toBe('ok');
    expect(classifyGhExit(4)).toBe('no-auth');
    expect(classifyGhExit(1)).toBe('error');
    expect(classifyGhExit(-1)).toBe('error');
  });
});

describe('panel de PR', () => {
  const REPO = { host: 'github.com', owner: 'acme', repo: 'demo' };
  const LIST = readFileSync(new URL('./__fixtures__/pr-list-repo.json', import.meta.url), 'utf8');
  const DETAIL = readFileSync(new URL('./__fixtures__/pr-detail.json', import.meta.url), 'utf8');

  it('parsePrList_twoPrs_keysFromRepo', () => {
    const prs = parsePrList(LIST, REPO);

    expect(prs.map((pr) => pr.key)).toEqual([
      { host: 'github.com', owner: 'acme', repo: 'demo', number: 12 },
      { host: 'github.com', owner: 'acme', repo: 'demo', number: 13 },
    ]);
    expect(prs[0]).toMatchObject({ author: 'vg-dev', updatedAt: '2026-10-01T10:00:00.000Z', reviewDecision: 'approved', headSha: '1'.repeat(40) });
    expect(prs[1]).toMatchObject({ author: 'app/vg-bot', isDraft: true, updatedAt: '' });
  });

  it('parsePrList_oneBadEntry_skipped', () => {
    const list = JSON.parse(LIST) as unknown[];

    const prs = parsePrList(JSON.stringify([{ number: 'x' }, ...list]), REPO);

    expect(prs.map((pr) => pr.number)).toEqual([12, 13]);
  });

  it('parsePrDetail_reviewsCommentsFiles', () => {
    const detail = parsePrDetail(DETAIL, REPO);

    expect(detail.body).toBe('Cuerpo de la PR\ncon dos lineas');
    expect(detail.reviews).toEqual([{ author: 'revisora', state: 'APPROVED', submittedAt: '2026-10-01T12:00:00.000Z', body: 'Bien' }]);
    expect(detail.comments).toEqual([{ author: 'vg-dev', createdAt: '2026-10-01T11:00:00.000Z', body: 'Un comentario' }]);
    expect(detail.files).toEqual([
      { path: 'src/a.ts', additions: 3, deletions: 1 },
      { path: 'README.md', additions: 10, deletions: 0 },
    ]);
  });

  it('parsePrDetail_badShape_throwsWithExcerpt', () => {
    expect(() => parsePrDetail('{"number":"no"}', REPO)).toThrow('{"number":"no"}');
  });

  it('parseMergeOptions_missing_false', () => {
    expect(parseMergeOptions('{"squashMergeAllowed":true}')).toEqual({ merge: false, squash: true, rebase: false });
  });

  it('parseHeadOnly_ok', () => {
    expect(parseHeadOnly(`{"headRefOid":"${'A'.repeat(40)}","state":"MERGED"}`)).toEqual({ headSha: 'a'.repeat(40), state: 'merged' });
  });
});
