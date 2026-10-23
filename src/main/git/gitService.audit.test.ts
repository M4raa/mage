import { describe, expect, it } from 'vitest';
import { createGitService } from './gitService';

describe('A08 — autorización ante caché de estado git', () => {
  it('A08_status_cacheDeCuentaAutorizada_noAutorizaOtraCuenta', async () => {
    const service = createGitService({
      findBin: () => 'git', findRepoRoot: (cwd) => cwd, baseEnv: {}, now: () => 0,
      isTrusted: (_cwd, account) => account === 'trusted',
      run: async (_bin, args) => args.includes('status') ? '# branch.oid abc\0# branch.head main\0' : '',
    });
    expect((await service.status('/repo', 'trusted')).kind).toBe('repo');
    expect((await service.status('/repo', 'untrusted')).kind).toBe('untrusted');
  });
});


it('A08_revocarConfianza_noReutilizaCacheYSuConcesionEsInmediata', async () => {
  let trusted = true;
  let commands = 0;
  const service = createGitService({ findBin: () => 'git', findRepoRoot: cwd => cwd, baseEnv: {}, now: () => 0,
    isTrusted: () => trusted, run: async () => { commands++; return '# branch.oid (initial)\0# branch.head main\0'; } });
  expect((await service.status('/repo', 'cuenta')).kind).toBe('repo');
  trusted = false;
  expect((await service.status('/repo', 'cuenta')).kind).toBe('untrusted');
  expect(commands).toBe(1);
  trusted = true;
  expect((await service.status('/repo', 'cuenta')).kind).toBe('repo');
  expect(commands).toBe(1);
});

it('A08_lecturaEnVuelo_noEntregaLaPromesaAOtraCuentaSinConfianza', async () => {
  let release!: (value: string) => void;
  const pending = new Promise<string>(resolve => { release = resolve; });
  let commands = 0;
  const service = createGitService({ findBin: () => 'git', findRepoRoot: cwd => cwd, baseEnv: {}, now: () => 0,
    isTrusted: (_cwd, account) => account === 'permitida', run: async () => { commands++; return pending; } });
  const allowed = service.status('/repo', 'permitida');
  const denied = service.status('/repo', 'denegada');
  release('# branch.oid (initial)\0# branch.head main\0');
  expect((await allowed).kind).toBe('repo');
  expect((await denied).kind).toBe('untrusted');
  expect(commands).toBe(1);
});
