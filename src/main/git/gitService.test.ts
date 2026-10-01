import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createGitService, findRepoRootWith, type GitRunner, type GitServiceDeps } from './gitService';

const Z = '\u0000';
const OID = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';
const CLEAN_STATUS = [`# branch.oid ${OID}`, '# branch.head main', ''].join(Z);
const DIRTY_STATUS = [`# branch.oid ${OID}`, '# branch.head main', `1 .M N... 100644 100644 100644 ${OID} ${OID} a.ts`, '? b.txt', ''].join(Z);

// Runner falso: contesta por subcomando (el primer argumento que no es de `-c`).
function fakeRunner(replies: Readonly<Record<string, string>>): ReturnType<typeof vi.fn<GitRunner>> {
  return vi.fn<GitRunner>(async (_bin, args) => {
    const sub = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-c') ?? '';
    const reply = replies[sub];
    if (reply === undefined) throw new Error(`subcomando no esperado: ${sub}`);
    return reply;
  });
}

function deps(over: Partial<GitServiceDeps> = {}): GitServiceDeps {
  return {
    findBin: () => 'git',
    run: fakeRunner({ status: CLEAN_STATUS, diff: '', 'for-each-ref': 'main\nfeature\n', switch: '' }),
    isTrusted: () => true,
    findRepoRoot: (cwd) => cwd,
    baseEnv: { PATH: '/bin' },
    now: () => 0,
    ...over,
  };
}

describe('createGitService.status', () => {
  it('status_sinGit_unavailable', async () => {
    expect(await createGitService(deps({ findBin: () => null })).status('/r', '/acc')).toEqual({ kind: 'unavailable' });
  });

  it('status_sinRepo_noRepoYNoEjecutaNada', async () => {
    const run = fakeRunner({});

    expect(await createGitService(deps({ run, findRepoRoot: () => null })).status('/r', '/acc')).toEqual({ kind: 'no-repo' });
    expect(run).not.toHaveBeenCalled();
  });

  it('status_carpetaSinConfianza_untrustedYNoEjecutaNada', async () => {
    const run = fakeRunner({});

    expect(await createGitService(deps({ run, isTrusted: () => false })).status('/r', '/acc')).toEqual({ kind: 'untrusted', repoRoot: '/r' });
    expect(run).not.toHaveBeenCalled();
  });

  it('status_sucio_sumaNumstatYCuentaNoSeguidos', async () => {
    const run = fakeRunner({ status: DIRTY_STATUS, diff: ['5\t2\ta.ts', ''].join(Z) });

    const snapshot = await createGitService(deps({ run })).status('/r', '/acc');

    expect(snapshot).toMatchObject({ kind: 'repo', branch: 'main', headShort: '1a2b3c4', dirty: true, added: 5, removed: 2, changedFiles: 1, untracked: 1 });
  });

  it('status_lecturas_desactivanFsmonitorYVanEnArraySinShell', async () => {
    const run = fakeRunner({ status: DIRTY_STATUS, diff: '' });

    await createGitService(deps({ run })).status('/r', '/acc');

    for (const [, args, options] of run.mock.calls) {
      expect(args.slice(0, 2)).toEqual(['-c', 'core.fsmonitor=false']);
      expect(options).toMatchObject({ cwd: '/r', env: { PATH: '/bin', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
    }
    expect(run.mock.calls[1]?.[1]).toEqual(['-c', 'core.fsmonitor=false', 'diff', '--numstat', '-z', '--no-textconv', '--no-ext-diff', 'HEAD']);
  });

  it('status_repoSinCommits_noPideDiff', async () => {
    const run = fakeRunner({ status: ['# branch.oid (initial)', '# branch.head main', '? a.txt', ''].join(Z) });

    expect(await createGitService(deps({ run })).status('/r', '/acc')).toMatchObject({ headShort: null, added: 0, untracked: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('status_dosPeticionesSeguidas_unaSolaLectura', async () => {
    const run = fakeRunner({ status: CLEAN_STATUS, diff: '' });
    const service = createGitService(deps({ run }));

    await Promise.all([service.status('/r', '/acc'), service.status('/r', '/acc')]);

    expect(run).toHaveBeenCalledTimes(2); // status + diff, una vez
  });

  it('status_pasadaLaVentana_vuelveALeer', async () => {
    let now = 0;
    const run = fakeRunner({ status: CLEAN_STATUS, diff: '' });
    const service = createGitService(deps({ run, now: () => now }));

    await service.status('/r', '/acc');
    now = 10_000;
    await service.status('/r', '/acc');

    expect(run).toHaveBeenCalledTimes(4);
  });
});

describe('createGitService.switchBranch', () => {
  it('switchBranch_ramaValidaYLimpio_haceSwitchSinFlagsDeLectura', async () => {
    const run = fakeRunner({ status: CLEAN_STATUS, diff: '', 'for-each-ref': 'main\nfeature\n', switch: '' });

    await createGitService(deps({ run })).switchBranch('/r', '/acc', 'feature');

    expect(run.mock.calls.at(-1)?.[1]).toEqual(['switch', 'feature']);
  });

  it('switchBranch_ramaQueNoEsta_lanzaSinSwitch', async () => {
    const run = fakeRunner({ 'for-each-ref': 'main\n' });

    await expect(createGitService(deps({ run })).switchBranch('/r', '/acc', 'otra')).rejects.toThrow('"otra"');
    expect(run.mock.calls.some(([, args]) => args[0] === 'switch')).toBe(false);
  });

  it('switchBranch_conCambios_lanza', async () => {
    const run = fakeRunner({ status: DIRTY_STATUS, diff: '', 'for-each-ref': 'main\nfeature\n' });

    await expect(createGitService(deps({ run })).switchBranch('/r', '/acc', 'feature')).rejects.toThrow('cambios sin confirmar');
  });

  it('switchBranch_sinConfianza_lanza', async () => {
    await expect(createGitService(deps({ isTrusted: () => false })).switchBranch('/r', '/acc', 'main')).rejects.toThrow('untrusted');
  });
});

describe('findRepoRootWith', () => {
  const root = join('/', 'repo');

  it('findRepoRootWith_subcarpeta_devuelveLaRaiz', () => {
    expect(findRepoRootWith(join(root, 'src', 'a'), (p) => p === join(root, '.git'))).toBe(root);
  });

  it('findRepoRootWith_sinGitEnNingunPadre_null', () => {
    expect(findRepoRootWith(join(root, 'src'), () => false)).toBeNull();
  });
});

describe('createGitService.status (cache)', () => {
  it('status_sinConfianzaYLuegoConcedida_noSeQuedaCacheado', async () => {
    let trusted = false;
    const service = createGitService(deps({ isTrusted: () => trusted }));

    expect((await service.status('/r', '/acc')).kind).toBe('untrusted');
    trusted = true;

    expect((await service.status('/r', '/acc')).kind).toBe('repo');
  });
});

describe('createGitService.remote', () => {
  const REMOTES = ['origin\thttps://tok@github.com/acme/demo.git (fetch)', 'origin\thttps://tok@github.com/acme/demo.git (push)', 'fork\tgit@github.com:yo/demo.git (fetch)', ''].join('\n');

  function remoteRunner(upstream: string): ReturnType<typeof vi.fn<GitRunner>> {
    return vi.fn<GitRunner>(async (_bin, args) => {
      if (args.includes('status')) return CLEAN_STATUS;
      if (args.includes('diff')) return '';
      if (args.includes('for-each-ref')) return `${upstream}\n`;
      if (args.includes('remote')) return REMOTES;
      throw new Error(`no esperado: ${args.join(' ')}`);
    });
  }

  it('remote_ramaConUpstream_usaSuRemotoSinCredenciales', async () => {
    const run = remoteRunner('fork');

    const ref = await createGitService(deps({ run })).remote('/r', '/acc');

    expect(ref).toEqual({ host: 'github.com', owner: 'yo', repo: 'demo' });
    expect(run.mock.calls.find(([, a]) => a.includes('for-each-ref'))?.[1]).toContain('refs/heads/main');
  });

  it('remote_sinUpstream_caeAOriginYNoDevuelveElToken', async () => {
    const ref = await createGitService(deps({ run: remoteRunner('') })).remote('/r', '/acc');

    expect(ref).toEqual({ host: 'github.com', owner: 'acme', repo: 'demo' });
    expect(JSON.stringify(ref)).not.toContain('tok');
  });

  it('remote_sinConfianza_nullSinEjecutar', async () => {
    const run = remoteRunner('');

    expect(await createGitService(deps({ run, isTrusted: () => false })).remote('/r', '/acc')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
