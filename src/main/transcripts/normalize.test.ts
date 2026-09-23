import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TranscriptEntry } from '@shared/transcripts';
import { classifyLineType, extractTokenUsage, parseTranscriptLine, summarize, SUMMARY_MAX_LENGTH } from './normalize';

describe('classifyLineType', () => {
  it.each([
    ['user', 'turn'],
    ['assistant', 'turn'],
    ['system', 'turn'],
    ['mode', 'metadata'],
    ['permission-mode', 'metadata'],
    ['file-history-snapshot', 'metadata'],
    ['file-history-delta', 'metadata'],
    ['attachment', 'metadata'],
    ['ai-title', 'metadata'],
    ['last-prompt', 'metadata'],
    ['queue-operation', 'metadata'],
    ['custom-title', 'metadata'],
    ['agent-name', 'metadata'],
  ] as const)('tiposCatalogados_devuelveCategoriaEsperada(%s)', (type, expected) => {
    expect(classifyLineType(type)).toBe(expected);
  });

  it('tipoNoCatalogado_devuelveUnknown', () => {
    expect(classifyLineType('future-thing-not-yet-invented')).toBe('unknown');
  });
});

describe('parseTranscriptLine', () => {
  it('lineaUserValida_devuelveOkConCategoriaTurn', () => {
    const raw = {
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      isSidechain: false,
      timestamp: '2026-07-03T08:46:54.951Z',
      message: { role: 'user', content: 'hola mundo' },
    };

    const result = parseTranscriptLine(raw, 4);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.category).toBe('turn');
    expect(result.entry.index).toBe(3);
    expect(result.entry.timestampMs).toBe(Date.parse('2026-07-03T08:46:54.951Z'));
    expect(result.entry.summary).toContain('hola mundo');
  });

  it('lineaAssistantValida_devuelveOkConCategoriaTurn', () => {
    const raw = {
      type: 'assistant',
      parentUuid: 'p1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'respuesta' }] },
    };

    const result = parseTranscriptLine(raw, 20);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.category).toBe('turn');
    expect(result.entry.parentUuid).toBe('p1');
  });

  it('tipoAttachmentGigante_devuelveOkComoRawSinValidarPayload', () => {
    const hugePayload = 'x'.repeat(1500);
    const raw = { type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: [hugePayload] } };

    const result = parseTranscriptLine(raw, 13);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.category).toBe('metadata');
    // raw conserva el payload completo (no se trunca al normalizar)
    expect(JSON.stringify(result.entry.raw)).toContain(hugePayload);
    // el resumen SI esta acotado para no reventar el alto de la fila colapsada
    expect(result.entry.summary.length).toBeLessThan(160);
  });

  it('tipoDesconocidoNoCatalogado_devuelveOkComoUnknownSinLanzar', () => {
    const raw = { type: 'future-thing-not-yet-invented', someField: 42 };

    const result = parseTranscriptLine(raw, 99);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.category).toBe('unknown');
    expect(result.entry.kind).toBe('future-thing-not-yet-invented');
  });

  it('jsonValidoSinCampoType_devuelveOkFalse', () => {
    const result = parseTranscriptLine({ uuid: 'x' }, 7);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.lineNumber).toBe(7);
  });

  it('valorNoEsObjeto_devuelveOkFalse', () => {
    const result = parseTranscriptLine('no soy un objeto', 8);

    expect(result.ok).toBe(false);
  });

  it('timestampAusente_timestampMsEsNull', () => {
    const raw = { type: 'mode', mode: 'normal' };

    const result = parseTranscriptLine(raw, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.timestampMs).toBeNull();
  });

  it('timestampNoIso_timestampMsEsNullNoLanza', () => {
    const raw = { type: 'mode', mode: 'normal', timestamp: 'no-es-una-fecha' };

    const result = parseTranscriptLine(raw, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.timestampMs).toBeNull();
  });

  it('lineaSystemFormaInesperada_seDegradaARawSinPerderLaLinea', () => {
    // "system" con `subtype` de tipo incorrecto (numero en vez de string) -> falla el schema
    // estricto pero la linea NO se pierde, se conserva como raw.
    const raw = { type: 'system', subtype: 12345 };

    const result = parseTranscriptLine(raw, 71);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.kind).toBe('system');
  });
});

describe('extractTokenUsage', () => {
  const usage = {
    input_tokens: 2,
    output_tokens: 118,
    cache_creation_input_tokens: 3809,
    cache_read_input_tokens: 221478,
  };

  it('kindNoAssistant_devuelveNull', () => {
    expect(extractTokenUsage('user', { type: 'user', message: { role: 'user', usage } })).toBeNull();
    expect(extractTokenUsage('system', { type: 'system' })).toBeNull();
    expect(extractTokenUsage('mode', { type: 'mode' })).toBeNull();
  });

  it('assistantSinUsage_devuelveNull', () => {
    const raw = { type: 'assistant', message: { role: 'assistant', content: [] } };
    expect(extractTokenUsage('assistant', raw)).toBeNull();
  });

  it('assistantSinMessage_devuelveNullNoLanza', () => {
    expect(extractTokenUsage('assistant', { type: 'assistant' })).toBeNull();
  });

  it('usageValido_devuelveObjetoExactoConEnteros', () => {
    const raw = { type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5', usage } };

    expect(extractTokenUsage('assistant', raw)).toEqual({
      inputTokens: 2,
      outputTokens: 118,
      cacheCreationInputTokens: 3809,
      cacheReadInputTokens: 221478,
      model: 'claude-sonnet-5',
    });
  });

  it('modelAusente_modelEsNull', () => {
    const raw = { type: 'assistant', message: { role: 'assistant', usage } };
    expect(extractTokenUsage('assistant', raw)?.model).toBeNull();
  });

  it('camposNegativos_seSaneanA0', () => {
    const raw = { type: 'assistant', message: { role: 'assistant', usage: { input_tokens: -5, output_tokens: -1 } } };
    const result = extractTokenUsage('assistant', raw);
    expect(result?.inputTokens).toBe(0);
    expect(result?.outputTokens).toBe(0);
  });

  it('camposNoNumericos_seSaneanA0', () => {
    const raw = { type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 'muchos', output_tokens: null, cache_read_input_tokens: NaN } } };
    const result = extractTokenUsage('assistant', raw);
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, model: null });
  });

  it('camposFloat_seTruncanAEntero', () => {
    const raw = { type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 12.9, cache_read_input_tokens: 100.001 } } };
    const result = extractTokenUsage('assistant', raw);
    expect(result?.inputTokens).toBe(12);
    expect(result?.cacheReadInputTokens).toBe(100);
  });
});

describe('parseTranscriptLine (tokenUsage)', () => {
  it('lineaAssistantConUsage_pobla tokenUsage', () => {
    const raw = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-opus-4-8',
        usage: { input_tokens: 2, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 999 },
      },
    };

    const result = parseTranscriptLine(raw, 5);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.tokenUsage).toEqual({
      inputTokens: 2,
      outputTokens: 50,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 999,
      model: 'claude-opus-4-8',
    });
  });

  it('lineaUser_tokenUsageEsNull', () => {
    const raw = { type: 'user', message: { role: 'user', content: 'hola' } };
    const result = parseTranscriptLine(raw, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.entry.tokenUsage).toBeNull();
  });
});

// Las TRES lineas REALES de la conversacion medida en PLAN-NO-TOCAR.md §2.12 (indices 5, 12 y 61 de
// 9253933c-…): el mensaje con [text, image], el aviso `isMeta` de la imagen pegada y el
// `<system-reminder>`. Se leen del fichero, no de un objeto inventado: un fixture a mano no habria
// cazado que la linea normal NO trae el campo y las inyectadas si.
const REAL_LINES = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'meta-and-image.jsonl'), 'utf-8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as unknown);

function entryFor(raw: unknown, lineNumber: number): TranscriptEntry {
  const result = parseTranscriptLine(raw, lineNumber);
  if (!result.ok) throw new Error(`La linea ${lineNumber} del fixture no parseo: ${result.error}`);
  return result.entry;
}

describe('parseTranscriptLine (isMeta)', () => {
  it('parseTranscriptLine_lineaConIsMetaTrue_loPropagaAlEntry', () => {
    const [, imagePasteNotice, systemReminder] = REAL_LINES;

    expect(entryFor(imagePasteNotice, 13).isMeta).toBe(true);
    expect(entryFor(systemReminder, 62).isMeta).toBe(true);
  });

  it('parseTranscriptLine_lineaSinIsMeta_entryIsMetaFalse', () => {
    // El mensaje REAL del usuario (texto + imagen) no trae el campo: su ausencia no puede significar
    // "es meta" o el hilo se quedaria sin la mayoria de los mensajes.
    const [userMessage] = REAL_LINES;

    expect(entryFor(userMessage, 6).isMeta).toBe(false);
  });

  it('parseTranscriptLine_lineaConIsMetaFalseExplicito_entryIsMetaFalse', () => {
    const raw = { type: 'user', isMeta: false, message: { role: 'user', content: 'hola' } };

    expect(entryFor(raw, 1).isMeta).toBe(false);
  });

  it('parseTranscriptLine_isMetaNoBooleano_noLanzaYQuedaEnFalse', () => {
    // Dato corrupto en la frontera: `isMeta` no booleano degrada la linea a entrada raw (el esquema
    // estricto no encaja), pero nunca lanza ni la esconde del panel de Logs.
    const raw = { type: 'user', isMeta: 'si', message: { role: 'user', content: 'hola' } };

    const entry = entryFor(raw, 1);

    expect(entry.isMeta).toBe(false);
    expect(entry.kind).toBe('user');
  });
});

describe('summarize', () => {
  it.each([
    ['user', { type: 'user', message: { role: 'user', content: 'hola' } }],
    ['assistant', { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }],
    ['system', { type: 'system', subtype: 'stop_hook_summary' }],
    ['mode', { type: 'mode', mode: 'normal' }],
    ['permission-mode', { type: 'permission-mode', permissionMode: 'default' }],
    ['file-history-snapshot', { type: 'file-history-snapshot' }],
    ['attachment', { type: 'attachment', attachment: { type: 'deferred_tools_delta' } }],
    ['ai-title', { type: 'ai-title', aiTitle: 'Titulo' }],
    ['last-prompt', { type: 'last-prompt', lastPrompt: 'prompt' }],
    ['queue-operation', { type: 'queue-operation', operation: 'enqueue' }],
    ['custom-title', { type: 'custom-title', customTitle: 'Titulo' }],
    ['agent-name', { type: 'agent-name', agentName: 'nombre-agente' }],
    ['future-thing-not-yet-invented', { type: 'future-thing-not-yet-invented' }],
  ] as const)('cadaKindConocido_devuelveTextoNoVacio(%s)', (kind, raw) => {
    const resumen = summarize(kind, raw);

    // `not.toBe('')` era el unico contrato de los 13 casos, y con el una implementacion que devolviera
    // la cadena "undefined" los pasaba todos. Lo que hay que fijar es que salga texto REAL: sin
    // marcadores de valor ausente, sin `[object Object]`, y acotado al limite que impone el propio
    // modulo (140 caracteres) porque este resumen se pinta en una fila de una lista.
    expect(resumen.trim().length).toBeGreaterThan(0);
    expect(resumen).not.toContain('undefined');
    expect(resumen).not.toContain('[object Object]');
    expect(resumen.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH + 1); // +1: la elipsis del truncado
  });

  it('summarize_textoLarguisimo_seTruncaAlLimite', () => {
    // El truncado no lo cubria nadie, y es el que evita que una fila de la lista se coma la pantalla.
    const largo = 'x'.repeat(SUMMARY_MAX_LENGTH * 3);

    const resumen = summarize('user', { type: 'user', message: { role: 'user', content: largo } });

    expect(resumen.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH + 1); // +1: la elipsis del truncado
  });
});
