import { describe, expect, it } from 'vitest';
import { lineDiff } from './lineDiff';

// Aplica los hunks al texto original: si el diff es correcto, reconstruye el nuevo.
function apply(before: string, hunks: ReturnType<typeof lineDiff>): string {
  const lines = before.length === 0 ? [] : before.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    out.push(...lines.slice(cursor, hunk.oldStart - 1));
    cursor = hunk.oldStart - 1;
    for (const line of hunk.lines) {
      if (line.startsWith('+')) out.push(line.slice(1));
      else if (line.startsWith('-')) cursor++;
      else {
        out.push(line.slice(1));
        cursor++;
      }
    }
  }
  out.push(...lines.slice(cursor));
  return out.join('\n');
}

describe('lineDiff', () => {
  it('diff_identical_noHunks', () => {
    expect(lineDiff('a\nb\n', 'a\nb\n')).toEqual([]);
  });

  it('diff_oneChange_oneHunkWithContext', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
    const after = ['1', '2', '3', 'X', '5', '6', '7'].join('\n');

    const hunks = lineDiff(before, after);

    expect(hunks).toEqual([{ oldStart: 1, oldLines: 7, newStart: 1, newLines: 7, lines: [' 1', ' 2', ' 3', '-4', '+X', ' 5', ' 6', ' 7'] }]);
  });

  it('diff_farApartChanges_twoHunks', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
    const after = [...before];
    after[1] = 'A';
    after[17] = 'B';

    const hunks = lineDiff(before.join('\n'), after.join('\n'));

    expect(hunks).toHaveLength(2);
    expect(hunks[1]).toMatchObject({ oldStart: 15, newStart: 15 });
  });

  it('diff_fromEmpty_allAdded', () => {
    expect(lineDiff('', 'a\nb')).toEqual([{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] }]);
  });

  it('diff_insertionsAndDeletions_reconstructsTarget', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh';
    const after = 'a\nx\nc\nd\ny\nz\ne\nh\ni';

    expect(apply(before, lineDiff(before, after))).toBe(after);
  });

  it('diff_thousandLines_reconstructsTarget', () => {
    const before = Array.from({ length: 1000 }, (_, i) => `linea ${i}`).join('\n');
    const after = before.replace('linea 500', 'cambiada').replace('linea 10\n', '');

    expect(apply(before, lineDiff(before, after))).toBe(after);
  });
});
