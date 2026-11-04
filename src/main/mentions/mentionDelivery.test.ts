import { describe, expect, it } from 'vitest';
import { inlineBlock, pathOnlyNote } from './mentionDelivery';

describe('inlineBlock', () => {
  it('inlineBlock_contentWithFence_usesLongerFence', () => {
    const fence5 = '`'.repeat(5);
    const block = inlineBlock('a.md', `x\n${fence5}\ny`);

    expect(block.startsWith(`\n\n${'`'.repeat(6)}\n// a.md\n`)).toBe(true);
    expect(block.endsWith(`\n${'`'.repeat(6)}`)).toBe(true);
  });

  it('inlineBlock_plain_threeBackticks', () => {
    const fence = '`'.repeat(3);

    expect(inlineBlock('src/a.ts', 'let a;')).toBe(`\n\n${fence}\n// src/a.ts\nlet a;\n${fence}`);
  });
});

describe('pathOnlyNote', () => {
  it('pathOnlyNote_containsPath', () => expect(pathOnlyNote('/p/a.docx')).toContain('/p/a.docx'));
});
