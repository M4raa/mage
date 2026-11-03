import { describe, expect, it } from 'vitest';
import { applyOptions, excerpt, parseRewindCommand, pickPoint } from './rewindFlow.mjs';

const POINTS = [
  { userIndex: 0, text: 'uno', nativeId: 'u1', rewindable: true },
  { userIndex: 1, text: 'dos', nativeId: 'u2', rewindable: false },
];

describe('rewindFlow', () => {
  it('parseRewindCommand_plain_returnsNoFlags', () => {
    expect(parseRewindCommand(' /rewind ')).toEqual({ files: false, copy: false });
  });

  it('parseRewindCommand_filesAndCopy_returnsBothFlags', () => {
    expect(parseRewindCommand('/rewind --copy --files')).toEqual({ files: true, copy: true });
  });

  it('parseRewindCommand_unknownWord_returnsError', () => {
    expect(parseRewindCommand('/rewind --all')).toEqual({ error: '--all' });
  });

  it.each(['/rewindx', 'hola', ''])('parseRewindCommand_otherText_returnsNull (%j)', (text) => {
    expect(parseRewindCommand(text)).toBeNull();
  });

  it('pickPoint_empty_cancels', () => {
    expect(pickPoint(POINTS, '  ')).toEqual({ kind: 'cancel' });
  });

  it('pickPoint_validNumber_returnsPointRef', () => {
    expect(pickPoint(POINTS, '1')).toEqual({ kind: 'point', point: { userIndex: 0, text: 'uno', nativeId: 'u1' } });
  });

  it.each(['0', '3'])('pickPoint_outOfRange_invalid (%s)', (answer) => {
    expect(pickPoint(POINTS, answer)).toEqual({ kind: 'invalid' });
  });

  it('pickPoint_midTurn_notRewindable', () => {
    expect(pickPoint(POINTS, '2')).toEqual({ kind: 'notRewindable' });
  });

  it.each(['1a', '-1'])('pickPoint_nonDigits_invalid (%s)', (answer) => {
    expect(pickPoint(POINTS, answer)).toEqual({ kind: 'invalid' });
  });

  it('applyOptions_filesWithoutPlanFiles_marksUnavailable', () => {
    const options = applyOptions({ files: null, canSaveCopy: false }, { files: true, copy: false });

    expect(options).toEqual({ restoreFiles: false, saveCopy: false, filesUnavailable: true, copyUnavailable: false });
  });

  it('applyOptions_copyOnCodex_saveCopyTrue', () => {
    const options = applyOptions({ files: null, canSaveCopy: true }, { files: false, copy: true });

    expect(options).toEqual({ restoreFiles: false, saveCopy: true, filesUnavailable: false, copyUnavailable: false });
  });

  it('excerpt_longMultiline_oneLineWithEllipsis', () => {
    const result = excerpt(`primera\nsegunda ${'x'.repeat(200)}`, 20);

    expect(result).toHaveLength(20);
    expect(result.startsWith('primera segunda')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toContain('\n');
  });
});
