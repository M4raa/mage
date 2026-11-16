import { describe, expect, it } from 'vitest';
import type { TranscriptEntry } from './transcripts';
import { countThinkingEntries, hasThinkingBlock } from './thinkingBlocks';

type Block = Record<string, unknown>;

function entry(kind: string, uuid: string, content: string | Block[], isMeta = false): TranscriptEntry {
  return {
    index: 0, uuid, parentUuid: null, isSidechain: false, isMeta, timestampMs: null, category: 'turn', kind, summary: '', tokenUsage: null,
    raw: { type: kind, uuid, message: { role: kind, content } },
  };
}

const THINKING: Block[] = [{ type: 'thinking', thinking: '', signature: 'f' }, { type: 'text', text: 'ok' }];
const TEXT_ONLY: Block[] = [{ type: 'text', text: 'ok' }];

describe('hasThinkingBlock', () => {
  it('hasThinkingBlock_conBloqueThinking_true', () => {
    expect(hasThinkingBlock(entry('assistant', 'a', THINKING).raw)).toBe(true);
  });

  it('hasThinkingBlock_sinMessage_false', () => {
    expect(hasThinkingBlock({ type: 'assistant' })).toBe(false);
  });

  it('hasThinkingBlock_contenidoTexto_false', () => {
    expect(hasThinkingBlock(entry('assistant', 'a', 'hola').raw)).toBe(false);
  });
});

describe('countThinkingEntries', () => {
  it('countThinkingEntries_asistentesConYSinPensamiento_cuentaSoloLosQueTienen', () => {
    const entries = [entry('user', 'u', 'hola'), entry('assistant', 'a1', THINKING), entry('assistant', 'a2', TEXT_ONLY), entry('assistant', 'a3', THINKING)];

    expect(countThinkingEntries(entries)).toBe(2);
  });

  it('countThinkingEntries_entradaMeta_noCuenta', () => {
    expect(countThinkingEntries([entry('assistant', 'a', THINKING, true)])).toBe(0);
  });

  it('countThinkingEntries_vacio_cero', () => {
    expect(countThinkingEntries([])).toBe(0);
  });
});
