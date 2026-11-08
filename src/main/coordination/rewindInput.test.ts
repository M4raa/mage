import { describe, expect, it } from 'vitest';
import { parseRewindApply, parseRewindPlan } from './rewindInput';

const POINT = { userIndex: 0, text: 'hola', nativeId: '11111111-1111-4111-8111-111111111111' };
const APPLY = { sessionId: 's1', point: POINT, action: 'rewind', restoreFiles: false, saveCopy: false };

describe('rewindInput', () => {
  it('parseRewindApply_valid_ok', () => {
    const parsed = parseRewindApply(APPLY, 'session:rewindApply');

    expect(parsed).toEqual(APPLY);
  });

  it('parseRewindApply_extraField_throws', () => {
    expect(() => parseRewindApply({ ...APPLY, extra: 1 }, 'session:rewindApply')).toThrow(/session:rewindApply/);
  });

  it('parsePoint_negativeIndex_throws', () => {
    const bad = { sessionId: 's1', action: 'rewind', point: { ...POINT, userIndex: -1 } };

    expect(() => parseRewindPlan(bad, 'session:rewindPlan')).toThrow(/point\.userIndex/);
  });

  it('parseRewindApply_adjuntoPdf_loAcepta', () => {
    const input = { ...APPLY, point: { userIndex: 0, text: 'x', nativeId: null }, attachments: [{ mediaType: 'application/pdf', data: 'JVBERg==' }] };

    const parsed = parseRewindApply(input, 'session:rewindApply');

    expect(parsed.attachments?.[0]?.mediaType).toBe('application/pdf');
  });

  it('parseRewindApply_adjuntoZip_lanza', () => {
    const input = { ...APPLY, point: { userIndex: 0, text: 'x', nativeId: null }, attachments: [{ mediaType: 'application/zip', data: 'x' }] };

    expect(() => parseRewindApply(input, 'session:rewindApply')).toThrow(/attachments\.0\.mediaType/);
  });
});
