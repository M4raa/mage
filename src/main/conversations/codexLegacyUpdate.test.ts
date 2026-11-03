import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@shared/i18n/localizedText';
import { updateLegacyCodexThread, type CodexLegacyUpdateDeps } from './codexLegacyUpdate';

const HOME = join('C:', 'home', '.codex-x');
const ID = '11111111-2222-3333-4444-555555555555';
const FILES = [join(HOME, 'sessions', 'a', 'rollout-1.jsonl'), join(HOME, 'sessions', 'a', 'rollout-2.jsonl')];
const NOW = Date.UTC(2026, 10, 2, 12, 30, 15, 123);
const BACKUP_DIR = join('backups', `${ID}-2026-11-02T12-30-15-123Z`);

interface Overrides {
  readonly modes?: readonly ('legacy' | 'paginated' | null)[];
  readonly files?: readonly string[];
  readonly copyFile?: (from: string, to: string) => void;
  readonly runCodex?: CodexLegacyUpdateDeps['runCodex'];
}

function makeDeps(o: Overrides = {}) {
  const calls: string[] = [];
  const modes = [...(o.modes ?? ['legacy', 'paginated'])];
  const deps: CodexLegacyUpdateDeps = {
    history: { threadFiles: () => o.files ?? FILES, historyModeOf: () => modes.shift() ?? null },
    backupRoot: 'backups',
    mkdir: vi.fn((dir: string) => { calls.push(`mkdir:${dir}`); }),
    copyFile: vi.fn((from: string, to: string) => { calls.push(`copy:${from}`); o.copyFile?.(from, to); }),
    runCodex: vi.fn(async (home: string, args: readonly string[]) => {
      calls.push('run');
      return o.runCodex === undefined ? { exitCode: 0, stderr: '' } : o.runCodex(home, args);
    }),
    now: () => NOW,
  };
  return { deps, calls };
}

const textOf = (failure: unknown): string => JSON.stringify(failure);

describe('updateLegacyCodexThread', () => {
  it('updateLegacy_notLegacy_throws', async () => {
    const { deps } = makeDeps({ modes: ['paginated'] });

    const failure = await updateLegacyCodexThread(deps, HOME, ID).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(UserFacingError);
    expect(textOf(failure)).toContain('errors.rewind.notLegacy');
    expect(deps.runCodex).not.toHaveBeenCalled();
  });

  it('updateLegacy_noFiles_throwsNotFound', async () => {
    const { deps } = makeDeps({ files: [] });

    expect(textOf(await updateLegacyCodexThread(deps, HOME, ID).catch((e: unknown) => e))).toContain('errors.rewind.notFound');
  });

  it('updateLegacy_copiesEveryFileBeforeMigrating', async () => {
    const { deps, calls } = makeDeps();

    await updateLegacyCodexThread(deps, HOME, ID);

    expect(calls).toEqual([`mkdir:${BACKUP_DIR}`, `copy:${FILES[0]}`, `copy:${FILES[1]}`, 'run']);
    expect(deps.copyFile).toHaveBeenCalledWith(FILES[1], join(BACKUP_DIR, 'rollout-2.jsonl'));
  });

  it('updateLegacy_copyFails_doesNotMigrate', async () => {
    const { deps } = makeDeps({ copyFile: () => { throw new Error('ENOSPC'); } });

    await expect(updateLegacyCodexThread(deps, HOME, ID)).rejects.toThrow('ENOSPC');
    expect(deps.runCodex).not.toHaveBeenCalled();
  });

  it('updateLegacy_exitNonZero_throwsWithStderrTail', async () => {
    const stderr = `${'x'.repeat(600)}FIN`;
    const { deps } = makeDeps({ runCodex: () => Promise.resolve({ exitCode: 1, stderr }) });

    const failure = await updateLegacyCodexThread(deps, HOME, ID).catch((e: unknown) => e);

    expect(textOf(failure)).toContain('errors.rewind.legacyUpdateFailed');
    expect(textOf(failure)).toContain(`${'x'.repeat(497)}FIN`);
    expect(textOf(failure)).not.toContain('x'.repeat(498));
  });

  it('updateLegacy_stillLegacy_throwsUnverified', async () => {
    const { deps } = makeDeps({ modes: ['legacy', 'legacy'] });

    const failure = await updateLegacyCodexThread(deps, HOME, ID).catch((e: unknown) => e);

    expect(textOf(failure)).toContain('errors.rewind.legacyUpdateUnverified');
    expect(textOf(failure)).toContain('backupDir');
  });

  it('updateLegacy_ok_returnsBackupDir', async () => {
    const { deps } = makeDeps();

    await expect(updateLegacyCodexThread(deps, HOME, ID)).resolves.toEqual({ backupDir: BACKUP_DIR });
  });

  it('updateLegacy_argsExact', async () => {
    const { deps } = makeDeps();

    await updateLegacyCodexThread(deps, HOME, ID);

    expect(deps.runCodex).toHaveBeenCalledWith(HOME, ['migrate-rollouts', '--apply', '--thread', ID]);
  });
});
