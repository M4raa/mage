import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@shared/i18n/localizedText';
import type { LibraryActionResult, LibraryTarget } from '@shared/ipc';
import { bundledContents, loadBundledCatalog } from '../catalog/libraryCatalog';
import type { CommandResult, CommandRunner } from '../commandRunner';
import { createMemoryCapabilityFs } from '../memoryCapabilityFs';
import { NativeCommandError } from '../nativeRunner';
import { LibraryService, type LibraryAccount, type LibraryServiceDeps } from './libraryService';
import { EMPTY_LIBRARY_STATE, libraryStatePath, saveLibraryState, type LibraryInstallRecord } from './libraryState';

const ROOT = resolve('/mage-test');
const USER_DATA = join(ROOT, 'userData');
const CLAUDE_A = join(ROOT, '.claude');
const CLAUDE_B = join(ROOT, '.claude-b');
const CODEX_A = join(ROOT, '.codex');
const ACCOUNTS: readonly LibraryAccount[] = [
  { configDir: CLAUDE_A, engine: 'claude' },
  { configDir: CLAUDE_B, engine: 'claude' },
  { configDir: CODEX_A, engine: 'codex' },
];
const OK: CommandResult = { exitCode: 0, stdout: '', stderr: '' };
const SKILL = 'ecc-tdd-workflow';
const MCP_ARGS_NEW = ['-y', '@upstash/context7-mcp@4.4.2'];
const CODEX_LIST_WITH_CONTEXT7 = JSON.stringify([
  {
    name: 'context7',
    enabled: true,
    disabled_reason: null,
    transport: { type: 'stdio', command: 'node', args: ['server.js'], env: null, cwd: null },
    auth_status: 'unsupported',
  },
]);

type RunnerCall = { bin: string; args: readonly string[]; env: NodeJS.ProcessEnv };

interface Harness {
  readonly service: LibraryService;
  readonly mem: ReturnType<typeof createMemoryCapabilityFs>;
  readonly runner: ReturnType<typeof vi.fn<CommandRunner>>;
  readonly calls: () => RunnerCall[];
  readonly deps: LibraryServiceDeps;
}

function setup(overrides: Partial<LibraryServiceDeps> = {}, handler?: (args: readonly string[]) => Promise<CommandResult> | CommandResult): Harness {
  const mem = createMemoryCapabilityFs();
  const runner = vi.fn<CommandRunner>(async (_bin, args) => {
    if (handler !== undefined) return handler(args);
    return args[0] === 'mcp' && args[1] === 'list' ? { ...OK, stdout: '[]' } : OK;
  });
  const deps: LibraryServiceDeps = {
    catalog: loadBundledCatalog(),
    contentsOf: bundledContents,
    fs: mem.fs,
    userDataDir: USER_DATA,
    platform: 'linux',
    caseInsensitivePaths: false,
    listAccounts: () => ACCOUNTS,
    binaryFor: (engine) => `/bin/${engine}`,
    runner,
    baseEnv: () => ({ PATH: 'x' }),
    isCommandAvailable: () => true,
    ...overrides,
  };
  const calls = (): RunnerCall[] => runner.mock.calls.map(([bin, args, opts]) => ({ bin, args, env: opts.env }));
  return { service: new LibraryService(deps), mem, runner, calls, deps };
}

const target = (packageId: string, accountDir: string, engine: 'claude' | 'codex' = 'claude'): LibraryTarget => ({
  packageId,
  engine,
  accountDir,
});

function seedContext7(h: Harness, version: string, accounts: readonly { dir: string; enabled: boolean }[]): void {
  const entry = h.deps.catalog.find((e) => e.id === 'context7');
  if (entry === undefined || entry.package.native?.type !== 'mcpStdio') throw new Error('Falta context7 en el catálogo');
  const old = { ...entry.package, version, native: { ...entry.package.native, args: ['-y', `@upstash/context7-mcp@${version}`] } };
  const installs: LibraryInstallRecord[] = accounts.map((a) => ({
    packageId: 'context7',
    engine: 'claude',
    accountDir: a.dir,
    version,
    enabled: a.enabled,
    package: old,
  }));
  saveLibraryState(h.mem.fs, libraryStatePath(USER_DATA), { ...EMPTY_LIBRARY_STATE, installs });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un rechazo y la promesa se resolvió');
}

function keyOf(error: unknown): string | undefined {
  return error instanceof UserFacingError ? error.localized.key : undefined;
}

const skillPath = (dir: string, file: string): string => resolve(join(dir, 'skills', SKILL, file));

describe('LibraryService.preview', () => {
  it('preview_claudeSkill_hasNoSideEffects', () => {
    const h = setup();

    const result = h.service.preview(target(SKILL, CLAUDE_A));

    expect(result.route).toBe('ownedFiles');
    expect(result.files).toHaveLength(2);
    expect(h.runner).not.toHaveBeenCalled();
    expect(h.mem.files.size).toBe(0);
  });

  it('preview_unknownAccount_throwsUserFacing', () => {
    const h = setup();

    const error = (() => {
      try {
        h.service.preview(target(SKILL, join(ROOT, '.claude-x')));
      } catch (e) {
        return e;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(UserFacingError);
    expect(keyOf(error)).toBe('errors.capabilities.unknownAccount');
  });

  it('preview_accountOfOtherEngine_throws', () => {
    const h = setup();

    expect(() => h.service.preview(target(SKILL, CLAUDE_A, 'codex'))).toThrow(/cuenta de codex/);
  });
});

describe('LibraryService.apply (skills copiadas)', () => {
  it('apply_installSkill_writesFilesAndRecord', async () => {
    const h = setup();

    const result = await h.service.apply('install', target(SKILL, CLAUDE_A));

    expect(result).toEqual({ status: 'done', appliesOnNextSession: true });
    expect(h.mem.files.has(skillPath(CLAUDE_A, 'SKILL.md'))).toBe(true);
    expect(h.mem.files.has(skillPath(CLAUDE_A, 'LICENSE'))).toBe(true);
    expect(h.service.view().installs).toEqual([
      expect.objectContaining({ packageId: SKILL, enabled: true, version: '2.2.3', accountDir: CLAUDE_A }),
    ]);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('apply_installSkillTwiceSameAccount_throwsAlreadyInstalled', async () => {
    const h = setup();
    await h.service.apply('install', target(SKILL, CLAUDE_A));

    const error = await rejection(h.service.apply('install', target(SKILL, CLAUDE_A)));

    expect(keyOf(error)).toBe('errors.capabilities.alreadyInstalled');
  });

  it('apply_sameSkillTwoAccounts_removeOneKeepsOther', async () => {
    const h = setup();
    await h.service.apply('install', target(SKILL, CLAUDE_A));
    await h.service.apply('install', target(SKILL, CLAUDE_B));

    const result = await h.service.apply('remove', target(SKILL, CLAUDE_B));

    expect(result.status).toBe('done');
    expect(h.mem.files.has(skillPath(CLAUDE_A, 'SKILL.md'))).toBe(true);
    expect(h.mem.files.has(skillPath(CLAUDE_B, 'SKILL.md'))).toBe(false);
    expect(h.service.view().installs.map((i) => i.accountDir)).toEqual([CLAUDE_A]);
  });

  it('apply_disableThenEnableSkill_removesAndRestoresFiles', async () => {
    const h = setup();
    await h.service.apply('install', target(SKILL, CLAUDE_A));

    await h.service.apply('disable', target(SKILL, CLAUDE_A));
    const afterDisable = { exists: h.mem.files.has(skillPath(CLAUDE_A, 'SKILL.md')), installs: h.service.view().installs };
    await h.service.apply('enable', target(SKILL, CLAUDE_A));

    expect(afterDisable.exists).toBe(false);
    expect(afterDisable.installs).toEqual([expect.objectContaining({ enabled: false })]);
    expect(h.mem.files.has(skillPath(CLAUDE_A, 'SKILL.md'))).toBe(true);
    expect(h.service.view().installs).toEqual([expect.objectContaining({ enabled: true })]);
  });

  it('apply_removeSkillModifiedByUser_returnsModifiedAndKeepsRecord', async () => {
    const h = setup();
    await h.service.apply('install', target(SKILL, CLAUDE_A));
    h.mem.put(skillPath(CLAUDE_A, 'SKILL.md'), 'cambiado por el usuario');

    const result = await h.service.apply('remove', target(SKILL, CLAUDE_A));

    expect(result).toEqual({ status: 'modifiedByUser', items: [skillPath(CLAUDE_A, 'SKILL.md')] });
    expect(h.service.view().installs).toHaveLength(1);
  });

  it('apply_installSkillOverForeignFile_returnsCollision', async () => {
    const h = setup();
    h.mem.put(skillPath(CLAUDE_A, 'notas.md'), 'mías');

    const result = await h.service.apply('install', target(SKILL, CLAUDE_A));

    expect(result).toEqual({ status: 'collision', items: [skillPath(CLAUDE_A, 'notas.md')] });
    expect(h.service.view().installs).toEqual([]);
  });
});

describe('LibraryService.apply (MCP y plugins)', () => {
  it('apply_installContext7Claude_runsMcpAddWithScrubbedEnv', async () => {
    const h = setup({ baseEnv: () => ({ PATH: 'x', ANTHROPIC_API_KEY: 'sk-secreta' }) });

    await h.service.apply('install', target('context7', CLAUDE_A));

    const [call, ...rest] = h.calls();
    expect(rest).toEqual([]);
    expect(call?.bin).toBe('/bin/claude');
    expect(call?.args).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'context7', '--', 'npx', ...MCP_ARGS_NEW]);
    expect(call?.env.CLAUDE_CONFIG_DIR).toBe(CLAUDE_A);
    expect(call?.env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('apply_installContext7OnWindows_wrapsNpx', async () => {
    const h = setup({ platform: 'win32' });

    await h.service.apply('install', target('context7', CLAUDE_A));

    expect(h.calls()[0]?.args.slice(-6)).toEqual(['--', 'cmd', '/c', 'npx', '-y', '@upstash/context7-mcp@4.4.2']);
  });

  it('apply_installContext7Codex_existingForeignName_returnsCollision', async () => {
    const h = setup({}, (args) => (args[1] === 'list' ? { ...OK, stdout: CODEX_LIST_WITH_CONTEXT7 } : OK));

    const result = await h.service.apply('install', target('context7', CODEX_A, 'codex'));

    expect(result).toEqual({ status: 'collision', items: ['codex mcp: context7'] });
    expect(h.calls().some((c) => c.args[1] === 'add')).toBe(false);
    expect(h.service.view().installs).toEqual([]);
  });

  it('apply_installContext7Codex_freeName_runsListThenAdd', async () => {
    const h = setup();

    await h.service.apply('install', target('context7', CODEX_A, 'codex'));

    const calls = h.calls();
    expect(calls.map((c) => c.args)).toEqual([
      ['mcp', 'list', '--json'],
      ['mcp', 'add', 'context7', '--', 'npx', ...MCP_ARGS_NEW],
    ]);
    expect(calls.every((c) => c.env.CODEX_HOME === CODEX_A)).toBe(true);
  });

  it('apply_installMcpWithSecrets_throwsBlocked', async () => {
    const h = setup();

    const error = await rejection(h.service.apply('install', target('exa-mcp', CLAUDE_A)));

    expect(keyOf(error)).toBe('errors.capabilities.blocked');
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('apply_installCodexSkill_throwsBlocked', async () => {
    const h = setup();

    const error = await rejection(h.service.apply('install', target(SKILL, CODEX_A, 'codex')));

    expect(keyOf(error)).toBe('errors.capabilities.blocked');
  });

  it('apply_installWithoutNpx_throwsMissingCommand', async () => {
    const h = setup({ isCommandAvailable: () => false });

    const error = await rejection(h.service.apply('install', target('context7', CLAUDE_A)));

    expect(keyOf(error)).toBe('errors.capabilities.missingCommand');
    expect((error as UserFacingError).localized.values).toMatchObject({ command: 'npx' });
  });

  it('apply_installPluginFails_keepsStateUnchanged', async () => {
    const h = setup({}, (args) => (args[1] === 'install' ? { exitCode: 1, stdout: '', stderr: 'no' } : OK));

    const error = await rejection(h.service.apply('install', target('ecc', CLAUDE_A)));

    expect(error).toBeInstanceOf(NativeCommandError);
    expect(h.service.view().installs).toEqual([]);
  });
});

describe('LibraryService.apply (actualizar y quitar)', () => {
  it('apply_updateNative_newFails_restoresOldAndReturnsRolledBack', async () => {
    const h = setup({}, (args) => (args.includes('@upstash/context7-mcp@4.4.2') ? { exitCode: 1, stdout: '', stderr: 'boom' } : OK));
    seedContext7(h, '4.4.1', [{ dir: CLAUDE_A, enabled: true }]);

    const result = await h.service.apply('update', target('context7', CLAUDE_A));

    expect(result.status).toBe('rolledBack');
    expect((result as { detail: string }).detail).toContain('código 1');
    expect(h.calls().map((c) => c.args.slice(0, 2).concat(c.args.slice(-1)))).toEqual([
      ['mcp', 'remove', 'user'],
      ['mcp', 'add', '@upstash/context7-mcp@4.4.2'],
      ['mcp', 'add', '@upstash/context7-mcp@4.4.1'],
    ]);
    expect(h.service.view().installs).toEqual([expect.objectContaining({ version: '4.4.1' })]);
  });

  it('apply_updateNative_succeeds_recordsNewVersion', async () => {
    const h = setup();
    seedContext7(h, '4.4.1', [{ dir: CLAUDE_A, enabled: true }]);

    const result = await h.service.apply('update', target('context7', CLAUDE_A));

    expect(result.status).toBe('done');
    expect(h.calls().map((c) => c.args.slice(0, 2).concat(c.args.slice(-1)))).toEqual([
      ['mcp', 'remove', 'user'],
      ['mcp', 'add', '@upstash/context7-mcp@4.4.2'],
    ]);
    expect(h.service.view().installs).toEqual([expect.objectContaining({ version: '4.4.2' })]);
  });

  it('apply_updateUpToDate_throwsUpToDate', async () => {
    const h = setup();
    await h.service.apply('install', target('context7', CLAUDE_A));

    const error = await rejection(h.service.apply('update', target('context7', CLAUDE_A)));

    expect(keyOf(error)).toBe('errors.capabilities.upToDate');
  });

  it('apply_removeDisabled_doesNotCallCli', async () => {
    const h = setup();
    seedContext7(h, '4.4.2', [{ dir: CLAUDE_A, enabled: false }]);

    const result = await h.service.apply('remove', target('context7', CLAUDE_A));

    expect(result.status).toBe('done');
    expect(h.runner).not.toHaveBeenCalled();
    expect(h.service.view().installs).toEqual([]);
  });
});

describe('LibraryService.apply (cola)', () => {
  it('apply_twoConcurrentInstalls_runSequentially', async () => {
    let releaseFirst: (r: CommandResult) => void = () => undefined;
    let first = true;
    const h = setup({}, () => {
      if (!first) return OK;
      first = false;
      return new Promise<CommandResult>((resolveFirst) => {
        releaseFirst = resolveFirst;
      });
    });

    const a = h.service.apply('install', target('context7', CLAUDE_A));
    const b = h.service.apply('install', target('context7', CLAUDE_B));
    await new Promise((r) => setTimeout(r, 10));
    const whileBlocked = h.runner.mock.calls.length;
    releaseFirst(OK);
    await Promise.all([a, b]);

    expect(whileBlocked).toBe(1);
    expect(h.runner.mock.calls).toHaveLength(2);
  });

  it('apply_failingAction_doesNotBlockQueue', async () => {
    const h = setup();

    const failing = rejection(h.service.apply('install', target(SKILL, join(ROOT, '.claude-x'))));
    const next: Promise<LibraryActionResult> = h.service.apply('install', target(SKILL, CLAUDE_A));

    expect(keyOf(await failing)).toBe('errors.capabilities.unknownAccount');
    expect((await next).status).toBe('done');
  });
});

describe('LibraryService.view', () => {
  it('view_updateAvailable_onlyForEnabledOutdated', () => {
    const h = setup();
    seedContext7(h, '4.4.1', [
      { dir: CLAUDE_A, enabled: true },
      { dir: CLAUDE_B, enabled: false },
    ]);

    const installs = h.service.view().installs;

    expect(installs.map((i) => [i.accountDir, i.updateAvailable])).toEqual([
      [CLAUDE_A, true],
      [CLAUDE_B, false],
    ]);
  });

  it('view_blocks_reportPerEngine', () => {
    const h = setup();

    const entries = h.service.view().entries;

    expect(entries.find((e) => e.id === SKILL)?.blocks).toEqual({ claude: null, codex: 'codexSkillsUnmeasured' });
    expect(entries.find((e) => e.id === 'exa-mcp')?.blocks).toEqual({ claude: 'needsSecrets', codex: 'needsSecrets' });
  });

  it('view_accounts_listsEligibleWithLabel', () => {
    const h = setup();

    const accounts = h.service.view().accounts;

    expect(accounts.map((a) => a.label)).toEqual(['.claude', '.claude-b', '.codex']);
    expect(h.runner).not.toHaveBeenCalled();
  });
});
