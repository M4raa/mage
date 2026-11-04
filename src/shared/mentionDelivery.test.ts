import { describe, expect, it } from 'vitest';
import { MENTION_INLINE_MAX_BYTES, planDelivery } from './mentionDelivery';

describe('planDelivery', () => {
  it('planDelivery_imageRuntime_pathOnly', () => expect(planDelivery('image', 10, 'ollama-local')).toBe('pathOnly'));
  it('planDelivery_imageCodex_attach', () => expect(planDelivery('image', 10, 'codex')).toBe('attach'));
  it('planDelivery_pdfClaude_attach', () => expect(planDelivery('pdf', 10, 'claude')).toBe('attach'));
  it('planDelivery_pdfCodex_pathOnly', () => expect(planDelivery('pdf', 10, 'codex')).toBe('pathOnly'));
  it('planDelivery_textUnderLimit_inline', () => expect(planDelivery('text', MENTION_INLINE_MAX_BYTES, 'claude')).toBe('inline'));
  it('planDelivery_textOverLimit_pathOnly', () => expect(planDelivery('text', MENTION_INLINE_MAX_BYTES + 1, 'claude')).toBe('pathOnly'));
  it('planDelivery_binaryClaude_pathOnly', () => expect(planDelivery('binary', 10, 'claude')).toBe('pathOnly'));
});
