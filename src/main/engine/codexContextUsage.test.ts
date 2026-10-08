import { describe, expect, it } from 'vitest';
import { CodexAdapter } from './codexAdapter';
import { contextUsageOf } from './codexProtocol';

// Forma de `thread/tokenUsage/updated` medida con codex-cli 0.160.0 (cifras reales de un «hola»).
const updated = (over: Record<string, unknown> = {}) => ({
  threadId: 't', turnId: 'u',
  tokenUsage: {
    total: { inputTokens: 18778, cachedInputTokens: 11008, outputTokens: 13, reasoningOutputTokens: 0, totalTokens: 18791 },
    last: { inputTokens: 18778, cachedInputTokens: 11008, outputTokens: 13, reasoningOutputTokens: 0, totalTokens: 18791 },
    modelContextWindow: 258400,
    ...over,
  },
});

describe('contextUsageOf', () => {
  it('contextUsageOf_tokenUsageUpdated_ocupacionYVentanaSinDesglose', () => {
    const usage = contextUsageOf(updated());

    expect(usage).toMatchObject({ totalTokens: 18791, maxTokens: 258400, categories: [] });
    expect(usage?.percentage).toBeCloseTo(7.27, 1);
  });

  it('contextUsageOf_ventanaAusenteONula_null', () => {
    expect(contextUsageOf(updated({ modelContextWindow: null }))).toBeNull();
    expect(contextUsageOf(updated({ modelContextWindow: 0 }))).toBeNull();
    expect(contextUsageOf({ tokenUsage: {} })).toBeNull();
    expect(contextUsageOf(null)).toBeNull();
  });

  it('contextUsageOf_ocupacionMayorQueLaVentana_topaEnCien', () => {
    expect(contextUsageOf(updated({ modelContextWindow: 10000 }))?.percentage).toBe(100);
  });
});

describe('CodexAdapter: ocupación de la ventana', () => {
  it('normalize_tokenUsageUpdated_emiteContextUsage', () => {
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex' });

    const events = adapter.normalize({ jsonrpc: '2.0', method: 'thread/tokenUsage/updated', params: updated() });

    expect(events.find((e) => e.kind === 'context_usage')).toMatchObject({ usage: { maxTokens: 258400 } });
  });
});
