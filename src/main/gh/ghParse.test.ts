import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyGhExit, normalizeCheckState, parsePrView, parseRunList, pickBranchPr, summarizeChecks } from './ghParse';

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
