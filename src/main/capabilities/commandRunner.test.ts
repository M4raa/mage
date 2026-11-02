import { describe, expect, it } from 'vitest';
import { toCommandResult } from './commandRunner';

describe('toCommandResult', () => {
  it('toCommandResult_noError_returnsExitZero', () => {
    // Arrange / Act
    const result = toCommandResult(null, 'out', 'err', 'claude');
    // Assert
    expect(result).toEqual({ exitCode: 0, stdout: 'out', stderr: 'err' });
  });

  it('toCommandResult_nonZeroExit_returnsCodeAndOutput', () => {
    // Arrange
    const error = Object.assign(new Error('x'), { code: 3 });
    // Act
    const result = toCommandResult(error, 'o', 'e', 'claude');
    // Assert
    expect(result).toEqual({ exitCode: 3, stdout: 'o', stderr: 'e' });
  });

  it('toCommandResult_spawnFailure_throwsWithBinary', () => {
    // Arrange
    const error = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    // Act / Assert
    expect(() => toCommandResult(error, '', '', '/no/claude')).toThrow(/\/no\/claude/);
  });

  it('toCommandResult_killedBySignal_returnsNullExitWithNote', () => {
    // Arrange
    const error = Object.assign(new Error('Command failed'), { code: null, killed: true, signal: 'SIGTERM' });
    // Act
    const result = toCommandResult(error, '', 'parcial', 'claude');
    // Assert
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toBe('parcial\n[proceso terminado: Command failed]');
  });
});
