import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { localized } from '@shared/i18n/localizedText';
import type { GitSnapshot } from '@shared/git';
import { createGhService, PR_DIFF_MAX_BYTES, type GhRunner, type GhServiceDeps } from './ghService';

const PR_LIST = readFileSync(new URL('./__fixtures__/pr-list-head.json', import.meta.url), 'utf8');
const RUN_LIST = readFileSync(new URL('./__fixtures__/run-list.json', import.meta.url), 'utf8');
const PR_VIEW = JSON.stringify(JSON.parse(PR_LIST)[0]);

const REPO: GitSnapshot = { kind: 'repo', branch: 'prueba/gh-medicion', detached: false, headShort: 'abc1234', upstream: null, ahead: 0, behind: 0, dirty: false, added: 0, removed: 0, changedFiles: 0, untracked: 0 };

// Runner falso: contesta por subcomando (`pr list`, `run list`…), con salida 0 salvo que se diga otra.
function fakeGh(replies: Readonly<Record<string, { code?: number; stdout?: string }>>): ReturnType<typeof vi.fn<GhRunner>> {
  return vi.fn<GhRunner>(async (_bin, args) => {
    const reply = replies[`${args[0]} ${args[1]}`];
    if (reply === undefined) throw new Error(`no esperado: ${args.join(' ')}`);
    return { code: reply.code ?? 0, stdout: reply.stdout ?? '' };
  });
}

function deps(over: Partial<GhServiceDeps> = {}): GhServiceDeps {
  return {
    findBin: () => 'gh',
    run: fakeGh({ 'pr list': { stdout: PR_LIST }, 'pr view': { stdout: PR_VIEW }, 'run list': { stdout: RUN_LIST }, 'run rerun': {}, 'run cancel': {}, 'pr merge': {} }),
    git: { status: async () => REPO, remote: async () => ({ host: 'github.com', owner: 'acme', repo: 'demo' }) },
    baseEnv: { PATH: '/bin', GH_TOKEN: 'del-usuario' },
    now: () => 0,
    ...over,
  };
}

describe('createGhService.branchPr', () => {
  it('branchPr_conPr_loDevuelveConArgsEnArrayYEntornoSinPrompts', async () => {
    const run = fakeGh({ 'pr list': { stdout: PR_LIST } });

    const snapshot = await createGhService(deps({ run })).branchPr('/r', '/acc');

    expect(snapshot).toMatchObject({ kind: 'pr', pr: { number: 1, state: 'open' } });
    const [bin, args, options] = run.mock.calls[0]!;
    expect(bin).toBe('gh');
    expect(args.slice(0, 3)).toEqual(['pr', 'list', '--head=prueba/gh-medicion']);
    expect(args.join(' ')).not.toMatch(/token|author|commits/);
    // El entorno del usuario pasa tal cual (su GH_TOKEN incluido: es la sesion de gh), sin prompts.
    expect(options.env).toMatchObject({ GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', GH_TOKEN: 'del-usuario' });
  });

  it('branchPr_sinPr_noPr', async () => {
    const service = createGhService(deps({ run: fakeGh({ 'pr list': { stdout: '[]' } }) }));

    expect(await service.branchPr('/r', '/acc')).toEqual({ kind: 'no-pr', branch: 'prueba/gh-medicion' });
  });

  it('branchPr_sinGh_noGhSinEjecutar', async () => {
    const run = fakeGh({});

    expect(await createGhService(deps({ run, findBin: () => null })).branchPr('/r', '/acc')).toEqual({ kind: 'off', reason: 'no-gh' });
    expect(run).not.toHaveBeenCalled();
  });

  it('branchPr_sinConfianza_noRepoSinEjecutar', async () => {
    const run = fakeGh({});
    const untrusted = { status: async (): Promise<GitSnapshot> => ({ kind: 'untrusted', repoRoot: '/r' }), remote: async () => null };

    expect(await createGhService(deps({ run, git: untrusted })).branchPr('/r', '/acc')).toEqual({ kind: 'off', reason: 'no-repo' });
    expect(run).not.toHaveBeenCalled();
  });

  it('branchPr_remotoQueNoEsGithub_notGithubSinEjecutar', async () => {
    const run = fakeGh({});
    const gitlab = { status: async () => REPO, remote: async () => ({ host: 'gitlab.com', owner: 'a', repo: 'b' }) };

    expect(await createGhService(deps({ run, git: gitlab })).branchPr('/r', '/acc')).toEqual({ kind: 'off', reason: 'not-github' });
    expect(run).not.toHaveBeenCalled();
  });

  it('branchPr_sinSesion_noAuthYNoSeCachea', async () => {
    let code = 4;
    const run = vi.fn<GhRunner>(async () => ({ code, stdout: code === 0 ? PR_LIST : '' }));
    const service = createGhService(deps({ run }));

    expect(await service.branchPr('/r', '/acc')).toEqual({ kind: 'off', reason: 'no-auth' });
    code = 0;

    expect((await service.branchPr('/r', '/acc')).kind).toBe('pr');
  });

  it('branchPr_otraSalida_error', async () => {
    const service = createGhService(deps({ run: fakeGh({ 'pr list': { code: 1 } }) }));

    expect(await service.branchPr('/r', '/acc')).toEqual({ kind: 'off', reason: 'error' });
  });

  it('branchPr_dosSeguidas_unaSolaLlamada', async () => {
    const run = fakeGh({ 'pr list': { stdout: PR_LIST } });
    const service = createGhService(deps({ run }));

    await Promise.all([service.branchPr('/r', '/acc'), service.branchPr('/r', '/acc')]);

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('createGhService acciones', () => {
  it('runAction_idLeidoAntes_relanzaSoloLosFallidos', async () => {
    const run = fakeGh({ 'run list': { stdout: RUN_LIST }, 'run rerun': {} });
    const service = createGhService(deps({ run }));

    await service.runs('/r', '/acc', 'prueba/gh-medicion');
    await service.runAction('/r', '/acc', 36766441586, 'rerun');

    expect(run.mock.calls.at(-1)?.[1]).toEqual(['run', 'rerun', '36766441586', '--failed']);
  });

  it('runAction_idQueNoSeLeyo_lanzaSinEjecutar', async () => {
    const run = fakeGh({ 'run list': { stdout: RUN_LIST } });
    const service = createGhService(deps({ run }));
    await service.runs('/r', '/acc', 'prueba/gh-medicion');

    await expect(service.runAction('/r', '/acc', 99, 'cancel')).rejects.toThrow('99');
    await expect(service.runAction('/r', '/acc', 99, 'cancel')).rejects.toThrow(expect.objectContaining({ localized: localized('errors.gh.runNotListed', { runId: '99', cwd: '/r' }) }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runAction_ghFalla_lanzaConLaSalida', async () => {
    const service = createGhService(deps({ run: fakeGh({ 'run list': { stdout: RUN_LIST }, 'run cancel': { code: 1 } }) }));
    await service.runs('/r', '/acc', 'prueba/gh-medicion');

    await expect(service.runAction('/r', '/acc', 36766441586, 'cancel')).rejects.toThrow('salida 1');
    await expect(service.runAction('/r', '/acc', 36766441586, 'cancel')).rejects.toThrow(expect.objectContaining({ localized: localized('errors.gh.runActionFailed', { action: 'cancel', runId: '36766441586', code: '1' }) }));
  });

  it('runs_ramaQueParaceOpcion_lanza', async () => {
    await expect(createGhService(deps()).runs('/r', '/acc', '--help')).rejects.toThrow('--help');
  });

  it('setAutoMerge_prLeido_squashYDesactivar', async () => {
    const run = fakeGh({ 'pr view': { stdout: PR_VIEW }, 'pr merge': {} });
    const service = createGhService(deps({ run }));
    await service.prByNumber('/r', '/acc', 1);

    await service.setAutoMerge('/r', '/acc', 1, true);
    await service.setAutoMerge('/r', '/acc', 1, false);

    expect(run.mock.calls[1]?.[1]).toEqual(['pr', 'merge', '1', '--auto', '--squash']);
    expect(run.mock.calls[2]?.[1]).toEqual(['pr', 'merge', '1', '--disable-auto']);
  });

  it('setAutoMerge_prNoLeido_lanza', async () => {
    await expect(createGhService(deps()).setAutoMerge('/r', '/acc', 7, true)).rejects.toThrow('#7');
  });

  it('setAutoMerge_repoSinAutoMerge_explicaElAjuste', async () => {
    const service = createGhService(deps({ run: fakeGh({ 'pr view': { stdout: PR_VIEW }, 'pr merge': { code: 1 } }) }));
    await service.prByNumber('/r', '/acc', 1);

    await expect(service.setAutoMerge('/r', '/acc', 1, true)).rejects.toThrow('Allow auto-merge');
    await expect(service.setAutoMerge('/r', '/acc', 1, true)).rejects.toThrow(expect.objectContaining({ localized: localized('errors.gh.autoMergeRejected', { number: '1', code: '1' }) }));
  });

  it('prByNumber_numeroNoValido_lanza', async () => {
    await expect(createGhService(deps()).prByNumber('/r', '/acc', 0)).rejects.toThrow('0');
  });
});

describe('createGhService panel de PR', () => {
  const HEAD = 'a'.repeat(40);
  const OTHER_HEAD = 'b'.repeat(40);
  const REPO_LIST = readFileSync(new URL('./__fixtures__/pr-list-repo.json', import.meta.url), 'utf8');
  const DETAIL = readFileSync(new URL('./__fixtures__/pr-detail.json', import.meta.url), 'utf8');
  const DEMO = { host: 'github.com', owner: 'acme', repo: 'demo' };
  const KEY = { ...DEMO, number: 7 };
  const KEY_OTHER = { host: 'github.com', owner: 'acme', repo: 'otro', number: 7 };
  const ALL_ALLOWED = '{"mergeCommitAllowed":true,"squashMergeAllowed":true,"rebaseMergeAllowed":true}';

  interface Script {
    heads?: Record<string, string>; // head actual por `host/owner/repo`
    mergeOptions?: string;
    writeCode?: number;
    diff?: string;
  }

  // Simula gh por repo: listado, detalle, head, opciones de fusion, diff y escrituras (salida `writeCode`).
  function prGh(script: Script = {}): ReturnType<typeof vi.fn<GhRunner>> {
    return vi.fn<GhRunner>(async (_bin, args) => {
      const [group, verb] = args;
      const repo = group === 'repo' ? args[2]! : args[args.indexOf('-R') + 1]!;
      if (group === 'repo') return { code: 0, stdout: script.mergeOptions ?? ALL_ALLOWED };
      if (group === 'pr' && verb === 'list') return { code: 0, stdout: REPO_LIST };
      if (group === 'pr' && verb === 'diff') return { code: 0, stdout: script.diff ?? 'diff --git a/x b/x' };
      if (group === 'pr' && verb === 'view' && args.includes('headRefOid,state')) {
        return { code: 0, stdout: JSON.stringify({ headRefOid: script.heads?.[repo] ?? HEAD, state: 'OPEN' }) };
      }
      if (group === 'pr' && verb === 'view') return { code: 0, stdout: DETAIL };
      return { code: script.writeCode ?? 0, stdout: '' };
    });
  }

  const WRITE_VERBS = new Set(['comment', 'review', 'close', 'reopen', 'merge']);
  const writesOf = (run: ReturnType<typeof vi.fn<GhRunner>>): (readonly string[])[] =>
    run.mock.calls.map((call) => call[1]).filter((args) => args[0] === 'pr' && WRITE_VERBS.has(args[1]!));

  async function readyService(run: ReturnType<typeof vi.fn<GhRunner>>, keys = [KEY]): Promise<ReturnType<typeof createGhService>> {
    const service = createGhService(deps({ run }));
    for (const key of keys) await service.prDetail('/r', '/acc', key);
    return service;
  }

  it('listPrs_draftFilter_onlyDrafts', async () => {
    const run = prGh();

    const result = await createGhService(deps({ run })).listPrs({ cwd: '/r', accountDir: '/acc', repo: DEMO, state: 'draft', limit: 30 });

    expect(result).toMatchObject({ kind: 'list' });
    expect(result.kind === 'list' && result.prs.map((pr) => pr.number)).toEqual([13]);
    expect(run.mock.calls[0]![1]).toEqual(expect.arrayContaining(['-R', 'github.com/acme/demo', '--state', 'open', '--limit', '30']));
  });

  it('listPrs_openFilter_includesDrafts', async () => {
    const result = await createGhService(deps({ run: prGh() })).listPrs({ cwd: '/r', accountDir: '/acc', repo: DEMO, state: 'open', limit: 30 });

    expect(result.kind === 'list' && result.prs.map((pr) => pr.number)).toEqual([12, 13]);
  });

  it('listPrs_otherHost_off', async () => {
    const run = prGh();

    const result = await createGhService(deps({ run })).listPrs({ cwd: '/r', accountDir: '/acc', repo: { ...DEMO, host: 'gitlab.com' }, state: 'all', limit: 30 });

    expect(result).toEqual({ kind: 'off', reason: 'not-github' });
    expect(run).not.toHaveBeenCalled();
  });

  it('listPrs_badLimit_throwsWithValue', async () => {
    const service = createGhService(deps({ run: prGh() }));
    const list = (limit: number): Promise<unknown> => service.listPrs({ cwd: '/r', accountDir: '/acc', repo: DEMO, state: 'all', limit });

    await expect(list(0)).rejects.toThrow('0');
    await expect(list(101)).rejects.toThrow('101');
    await expect(list(1.5)).rejects.toThrow('1.5');
  });

  it('listPrs_mergeOptionsCached', async () => {
    const run = prGh();
    const service = createGhService(deps({ run }));
    const params = { cwd: '/r', accountDir: '/acc', repo: DEMO, state: 'all', limit: 30 } as const;

    const first = await service.listPrs(params);
    await service.listPrs(params);

    expect(run.mock.calls.filter((call) => call[1][0] === 'repo')).toHaveLength(1);
    expect(first.kind === 'list' && first.mergeOptions).toEqual({ merge: true, squash: true, rebase: true });
  });

  it('prDetail_remembersKey', async () => {
    const run = prGh();
    const service = createGhService(deps({ run }));
    await expect(service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'close' } })).rejects.toThrow('github.com/acme/demo#7');

    const detail = await service.prDetail('/r', '/acc', KEY);
    const written = await service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'close' } });

    expect(detail.key).toEqual({ ...KEY, number: 12 });
    expect(written).toEqual({ kind: 'ok' });
  });

  it('prDiff_overCap_truncated', async () => {
    const big = 'a'.repeat(PR_DIFF_MAX_BYTES + 10);
    const small = createGhService(deps({ run: prGh({ diff: 'x' }) }));
    const service = createGhService(deps({ run: prGh({ diff: big }) }));

    const cut = await service.prDiff('/r', '/acc', KEY);

    expect(cut.truncated).toBe(true);
    expect(Buffer.byteLength(cut.patch)).toBe(PR_DIFF_MAX_BYTES);
    expect(await small.prDiff('/r', '/acc', KEY)).toEqual({ patch: 'x', truncated: false });
  });

  it('writePr_unreadKey_throws', async () => {
    const run = prGh();

    await expect(createGhService(deps({ run })).writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'close' } })).rejects.toThrow('#7');
    expect(run).not.toHaveBeenCalled();
  });

  it('writePr_headChanged_conflictNoWrite', async () => {
    const run = prGh({ heads: { 'github.com/acme/demo': OTHER_HEAD } });
    const service = await readyService(run);

    const result = await service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'comment', body: 'hola' } });

    expect(result).toEqual({ kind: 'conflict', currentHeadSha: OTHER_HEAD });
    expect(writesOf(run)).toEqual([]);
  });

  it('writePr_badExpectedHead_throwsWithValue', async () => {
    const service = await readyService(prGh());

    await expect(service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: 'abc', action: { kind: 'close' } })).rejects.toThrow('abc');
  });

  it('writePr_mergeUsesMatchHeadCommit', async () => {
    const run = prGh();
    const service = await readyService(run);

    await service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'merge', strategy: 'squash', deleteBranch: true } });

    expect(writesOf(run)).toEqual([['pr', 'merge', '7', '-R', 'github.com/acme/demo', '--squash', '--match-head-commit', HEAD, '--delete-branch']]);
  });

  it('writePr_strategyNotAllowed_throws', async () => {
    const run = prGh({ mergeOptions: '{"mergeCommitAllowed":true,"squashMergeAllowed":true,"rebaseMergeAllowed":false}' });
    const service = await readyService(run);

    const attempt = service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'merge', strategy: 'rebase', deleteBranch: false } });

    await expect(attempt).rejects.toThrow(expect.objectContaining({ localized: localized('errors.gh.strategyNotAllowed', { key: 'github.com/acme/demo#7', strategy: 'rebase' }) }));
    expect(writesOf(run)).toEqual([]);
  });

  it('writePr_neverAdmin_allActions', async () => {
    const run = prGh();
    const service = await readyService(run);
    const actions = [
      { kind: 'comment', body: 'c' },
      { kind: 'review', event: 'approve', body: '' },
      { kind: 'review', event: 'request_changes', body: 'r' },
      { kind: 'review', event: 'comment', body: 'r' },
      { kind: 'close' },
      { kind: 'reopen' },
      { kind: 'merge', strategy: 'merge', deleteBranch: true },
      { kind: 'merge', strategy: 'squash', deleteBranch: false },
      { kind: 'merge', strategy: 'rebase', deleteBranch: false },
      { kind: 'autoMerge', enabled: true, strategy: 'squash' },
      { kind: 'autoMerge', enabled: false, strategy: 'squash' },
    ] as const;

    for (const action of actions) await service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action });

    expect(writesOf(run)).toHaveLength(actions.length);
    expect(run.mock.calls.flatMap((call) => call[1]).filter((arg) => arg.includes('admin'))).toEqual([]);
  });

  it('writePr_bodyTooLong_throwsWithLength', async () => {
    const run = prGh();
    const service = await readyService(run);
    const write = (body: string): Promise<unknown> => service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'comment', body } });

    await expect(write('x'.repeat(20_001))).rejects.toThrow('20001');
    await expect(write('')).rejects.toThrow('0 caracteres');
    expect(writesOf(run)).toEqual([]);
  });

  it('writePr_ghFails_userFacingError', async () => {
    const service = await readyService(prGh({ writeCode: 1 }));

    await expect(service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'close' } })).rejects.toThrow(
      expect.objectContaining({ localized: localized('errors.gh.prActionFailed', { action: 'close', key: 'github.com/acme/demo#7', code: '1' }) }),
    );
  });

  it('twoReposSameNumber_independentKeys', async () => {
    const run = prGh();
    const branchKey = { ...DEMO, number: 12 }; // la PR de la rama del fixture: acme/demo#12
    const service = await readyService(run, [KEY, KEY_OTHER, branchKey]);
    const lists = (): number => run.mock.calls.filter((call) => call[1][1] === 'list').length;
    await service.branchPr('/r', '/acc'); // lectura por rama cacheada

    await service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY_OTHER, expectedHeadSha: HEAD, action: { kind: 'comment', body: 'otro' } });
    await service.branchPr('/r', '/acc');
    const sameNumber = await service.writePr({ cwd: '/r', accountDir: '/acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'comment', body: 'demo' } });
    await service.branchPr('/r', '/acc');
    const listsBeforeOwn = lists();
    await service.writePr({ cwd: '/r', accountDir: '/acc', key: branchKey, expectedHeadSha: HEAD, action: { kind: 'comment', body: 'propia' } });
    await service.branchPr('/r', '/acc');

    expect(sameNumber).toEqual({ kind: 'ok' });
    expect(writesOf(run).map((args) => args[4])).toEqual(['github.com/acme/otro', 'github.com/acme/demo', 'github.com/acme/demo']);
    expect(listsBeforeOwn).toBe(1); // las escrituras de otras PR no tocan la cache de la rama
    expect(lists()).toBe(2); // la de la PR de esa rama si la vacia
    await expect(service.writePr({ cwd: '/r', accountDir: '/acc', key: { ...KEY, number: 8 }, expectedHeadSha: HEAD, action: { kind: 'close' } })).rejects.toThrow('#8');
  });
});
