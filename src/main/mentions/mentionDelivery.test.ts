import { describe, expect, it } from 'vitest';
import { inlineBlock, MENTION_INLINE_MAX_BYTES, pathOnlyNote, planDelivery } from './mentionDelivery';

describe('planDelivery', () => {
  it('planDelivery_imageRuntime_pathOnly', () => expect(planDelivery('image', 10, 'ollama-local')).toBe('pathOnly'));
  it('planDelivery_imageCodex_attach', () => expect(planDelivery('image', 10, 'codex')).toBe('attach'));
  it('planDelivery_pdfClaude_attach', () => expect(planDelivery('pdf', 10, 'claude')).toBe('attach'));
  it('planDelivery_pdfCodex_pathOnly', () => expect(planDelivery('pdf', 10, 'codex')).toBe('pathOnly'));
  it('planDelivery_textUnderLimit_inline', () => expect(planDelivery('text', MENTION_INLINE_MAX_BYTES, 'claude')).toBe('inline'));
  it('planDelivery_textOverLimit_pathOnly', () => expect(planDelivery('text', MENTION_INLINE_MAX_BYTES + 1, 'claude')).toBe('pathOnly'));
  it('planDelivery_binaryClaude_pathOnly', () => expect(planDelivery('binary', 10, 'claude')).toBe('pathOnly'));
});

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
