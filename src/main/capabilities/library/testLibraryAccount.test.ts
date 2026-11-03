import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideTestLibraryClaudeDir, TEST_LIBRARY_CLAUDE_DIR_ENV, testLibraryAccounts } from './testLibraryAccount';

const USER_DATA = resolve('/mage-test/userData');

function decide(value: string | undefined, isPackaged = false): string | null {
  const env = value === undefined ? {} : { [TEST_LIBRARY_CLAUDE_DIR_ENV]: value };
  return decideTestLibraryClaudeDir({ env, isPackaged, userDataDir: USER_DATA });
}

describe('decideTestLibraryClaudeDir', () => {
  it('decideTestLibraryClaudeDir_unpackagedInsideUserData_returnsDir', () => {
    const dir = join(USER_DATA, 'test-claude');

    expect(decide(dir)).toBe(dir);
  });

  it('decideTestLibraryClaudeDir_packaged_returnsNull', () => {
    expect(decide(join(USER_DATA, 'test-claude'), true)).toBeNull();
  });

  it('decideTestLibraryClaudeDir_outsideUserData_returnsNull', () => {
    expect(decide(join(USER_DATA, '..', '.claude'))).toBeNull();
  });

  it('decideTestLibraryClaudeDir_userDataItself_returnsNull', () => {
    expect(decide(USER_DATA)).toBeNull();
  });

  it('decideTestLibraryClaudeDir_relative_returnsNull', () => {
    expect(decide('test-claude')).toBeNull();
  });

  it('decideTestLibraryClaudeDir_unset_returnsNull', () => {
    expect(decide(undefined)).toBeNull();
  });
});

describe('testLibraryAccounts', () => {
  it('testLibraryAccounts_nullDir_returnsEmpty', () => {
    expect(testLibraryAccounts(null)).toEqual([]);
  });

  it('testLibraryAccounts_dir_returnsClaudeAccount', () => {
    expect(testLibraryAccounts('/x')).toEqual([{ configDir: '/x', engine: 'claude' }]);
  });
});
