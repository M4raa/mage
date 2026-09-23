import { describe, expect, it } from 'vitest';
import {
  TranscriptAssistantLineSchema,
  TranscriptLineEnvelopeSchema,
  TranscriptSystemLineSchema,
  TranscriptUserLineSchema,
} from './schemas';

describe('TranscriptUserLineSchema', () => {
  it('lineaValida_parseaOk', () => {
    const line = {
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content: 'hola' },
      uuid: 'edc29370-8516-4cf3-884c-14720fdc4288',
      timestamp: '2026-07-03T08:46:54.951Z',
      cwd: 'C:\\sourcecode\\itb.sysMonitor',
      sessionId: '1b6e1e6e-37e9-4747-abe5-80593eb2d05f',
    };

    const result = TranscriptUserLineSchema.safeParse(line);

    expect(result.success).toBe(true);
  });
});

describe('TranscriptAssistantLineSchema', () => {
  it('contentArrayConToolUse_parseaOk', () => {
    const line = {
      parentUuid: '53d3cfe4-96c6-454f-a939-e4209ebe580c',
      isSidechain: false,
      type: 'assistant',
      message: { model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text: 'hola' }] },
      uuid: 'x',
    };

    const result = TranscriptAssistantLineSchema.safeParse(line);

    expect(result.success).toBe(true);
  });
});

describe('TranscriptSystemLineSchema', () => {
  it('sinSubtype_parseaOk', () => {
    const line = { type: 'system', parentUuid: 'a', isSidechain: false };

    const result = TranscriptSystemLineSchema.safeParse(line);

    expect(result.success).toBe(true);
  });

  it('conHookInfos_parseaOk', () => {
    const line = {
      type: 'system',
      subtype: 'stop_hook_summary',
      hookCount: 1,
      hookInfos: [{ command: 'echo hola', durationMs: 10 }],
      toolUseID: '27d63781-132e-4f73-aed9-31b5d5980fe4',
    };

    const result = TranscriptSystemLineSchema.safeParse(line);

    expect(result.success).toBe(true);
  });
});

describe('TranscriptLineEnvelopeSchema', () => {
  it('camposDesconocidosExtra_noRompePorPassthrough', () => {
    const line = { type: 'mode', mode: 'normal', sessionId: 'abc' };

    const result = TranscriptLineEnvelopeSchema.safeParse(line);

    expect(result.success).toBe(true);
  });

  it('tipoFuturoNoCatalogado_parseaComoEnvelope', () => {
    const line = { type: 'future-thing-not-yet-invented', someField: 42 };

    const result = TranscriptLineEnvelopeSchema.safeParse(line);

    expect(result.success).toBe(true);
  });

  it('isMetaOpcional_aceptaAusenteYBooleano_yRechazaOtroTipo', () => {
    // Aditivo: el campo es opcional, asi que NO invalida ninguna linea de las que ya se leian (la
    // mayoria no lo traen). Con otro tipo el envelope no encaja —como con cualquier otro campo
    // tipado— y `parseTranscriptLine` degrada la linea a entrada raw sin perderla (ver normalize.test).
    expect(TranscriptLineEnvelopeSchema.safeParse({ type: 'user' }).success).toBe(true);
    expect(TranscriptLineEnvelopeSchema.safeParse({ type: 'user', isMeta: true }).success).toBe(true);
    expect(TranscriptLineEnvelopeSchema.safeParse({ type: 'user', isMeta: false }).success).toBe(true);
    expect(TranscriptLineEnvelopeSchema.safeParse({ type: 'user', isMeta: 'si' }).success).toBe(false);
  });

  it('sinCampoType_fallaValidacion', () => {
    const line = { uuid: 'x' };

    const result = TranscriptLineEnvelopeSchema.safeParse(line);

    expect(result.success).toBe(false);
  });
});
