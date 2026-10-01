import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { GitSnapshot } from '@shared/git';
import { createGhService, type GhRunner, type GhServiceDeps } from './ghService';

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
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runAction_ghFalla_lanzaConLaSalida', async () => {
    const service = createGhService(deps({ run: fakeGh({ 'run list': { stdout: RUN_LIST }, 'run cancel': { code: 1 } }) }));
    await service.runs('/r', '/acc', 'prueba/gh-medicion');

    await expect(service.runAction('/r', '/acc', 36766441586, 'cancel')).rejects.toThrow('salida 1');
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
  });

  it('prByNumber_numeroNoValido_lanza', async () => {
    await expect(createGhService(deps()).prByNumber('/r', '/acc', 0)).rejects.toThrow('0');
  });
});
