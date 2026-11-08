import { describe, expect, it } from 'vitest';
import { inlinesToText, tableToMarkdown, tableToTsv } from './tableCopy';

describe('tableToMarkdown', () => {
  it('tableToMarkdown_headerAndSeparator', () => {
    expect(tableToMarkdown(['a', 'b'], [['1', '2']])).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('tableToMarkdown_escapesPipes', () => {
    expect(tableToMarkdown(['x|y'], [['a|b']])).toBe('| x\|y |\n| --- |\n| a\|b |');
  });
});

describe('tableToTsv', () => {
  it('tableToTsv_tabsAndNewlinesInCellBecomeSpace', () => {
    expect(tableToTsv(['a', 'b'], [['x\ty', 'l1\nl2']])).toBe('a\tb\nx y\tl1 l2');
  });

  it('tableToTsv_emptyRows_onlyHeader', () => {
    expect(tableToTsv(['a', 'b'], [])).toBe('a\tb');
  });

  it('tableToTsv_plainTable_matchesExpectedClipboard', () => {
    expect(tableToTsv(['a', 'b'], [['1', '2']])).toBe('a\tb\n1\t2');
  });
});

describe('inlinesToText', () => {
  it('inlinesToText_nestedMarks_returnsPlainText', () => {
    const nodes = [
      { type: 'text', text: 'ver ' },
      { type: 'strong', children: [{ type: 'link', href: 'u', children: [{ type: 'text', text: 'doc' }] }] },
      { type: 'code', text: ' x' },
    ] as const;

    expect(inlinesToText(nodes)).toBe('ver doc x');
  });
});
