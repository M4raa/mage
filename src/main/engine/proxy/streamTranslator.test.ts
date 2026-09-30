import { describe, expect, it } from 'vitest';
import {
  AnthropicStreamTranslator,
  mapFinishReason,
  parseOpenAiUsage,
  translateOpenAiResponse,
} from './streamTranslator';

// Serializa un chunk OpenAI como la linea SSE cruda que llega del proveedor.
function chunk(body: unknown): string {
  return `data: ${JSON.stringify(body)}`;
}

// Recoge los eventos Anthropic ya deserializados de las lineas que devuelve el traductor. Cada linea es
// `event: <tipo>` + `data: <json>` + linea en blanco, y el tipo de la linea `event:` tiene que casar con
// el del JSON: el SDK del CLI despacha por el primero.
function events(lines: readonly string[]): Record<string, any>[] {
  return lines.map((line) => {
    const match = /^event: (\S+)\ndata: (.+)\n\n$/s.exec(line);
    if (match === null) throw new Error(`Linea SSE sin la forma event+data: ${JSON.stringify(line)}`);
    const event = JSON.parse(match[2] ?? '');
    if (event.type !== match[1]) throw new Error(`event: ${match[1]} no casa con type ${event.type}`);
    return event;
  });
}

function drain(translator: AnthropicStreamTranslator, rawLines: string[]): Record<string, any>[] {
  const out: string[] = [];
  for (const line of rawLines) out.push(...translator.push(line).lines);
  out.push(...translator.finish().lines);
  return events(out);
}

describe('parseOpenAiUsage', () => {
  it('parse_contadoresValidos_losDevuelve', () => {
    expect(parseOpenAiUsage({ prompt_tokens: 120, completion_tokens: 45 })).toEqual({
      inputTokens: 120,
      outputTokens: 45,
    });
  });

  // La diferencia que el gateway borraba: "no mando uso" no es lo mismo que "el uso fue cero".
  it('parse_sinBloqueDeUso_devuelveNull', () => {
    expect(parseOpenAiUsage(undefined)).toBeNull();
    expect(parseOpenAiUsage(null)).toBeNull();
    expect(parseOpenAiUsage({})).toBeNull();
  });

  it('parse_ceroExplicito_noEsNull', () => {
    expect(parseOpenAiUsage({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  // Frontera externa: numeros que no son enteros positivos se descartan en vez de propagarse al panel.
  it('parse_valoresNoEnteros_losDescarta', () => {
    expect(parseOpenAiUsage({ prompt_tokens: '120', completion_tokens: '45' })).toBeNull();
    expect(parseOpenAiUsage({ prompt_tokens: 12.5, completion_tokens: -3 })).toBeNull();
    expect(parseOpenAiUsage({ prompt_tokens: Number.NaN, completion_tokens: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('parse_soloUnContador_completaElOtroACero', () => {
    expect(parseOpenAiUsage({ prompt_tokens: 7 })).toEqual({ inputTokens: 7, outputTokens: 0 });
  });
});

describe('mapFinishReason', () => {
  it('map_valoresConocidos_traduceAlVocabularioAnthropic', () => {
    expect(mapFinishReason('tool_calls')).toBe('tool_use');
    expect(mapFinishReason('function_call')).toBe('tool_use');
    expect(mapFinishReason('length')).toBe('max_tokens');
    expect(mapFinishReason('stop')).toBe('end_turn');
  });

  it('map_ausenteODesconocido_null_o_endTurn', () => {
    expect(mapFinishReason(null)).toBeNull();
    expect(mapFinishReason('')).toBeNull();
    expect(mapFinishReason('otra_cosa')).toBe('end_turn');
  });
});

describe('AnthropicStreamTranslator texto', () => {
  it('push_textoSimple_emiteMensajeYBloqueDeTexto', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    const result = drain(t, [
      chunk({ model: 'gpt-4o', choices: [{ delta: { content: 'Hola' } }] }),
      chunk({ choices: [{ delta: { content: ' mundo' } }] }),
      chunk({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } }),
      'data: [DONE]',
    ]);

    expect(result.map((e) => e.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    expect(result[2]!.delta).toEqual({ type: 'text_delta', text: 'Hola' });
    expect(result[3]!.delta).toEqual({ type: 'text_delta', text: ' mundo' });
  });

  // EL bug: el gateway escribia siempre {input_tokens: 0, output_tokens: 0}.
  it('finish_conUsoDelProveedor_reportaLosTokensReales', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    const result = drain(t, [
      chunk({ choices: [{ delta: { content: 'hey' } }] }),
      chunk({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1234, completion_tokens: 56 } }),
    ]);

    const messageDelta = result.find((e) => e.type === 'message_delta');
    expect(messageDelta!.usage).toEqual({ input_tokens: 1234, output_tokens: 56 });
    expect(t.usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
  });

  it('finish_sinUsoDelProveedor_reportaCeroPeroLoDeclaraDesconocido', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    const result = drain(t, [chunk({ choices: [{ delta: { content: 'hey' } }] })]);

    expect(result.find((e) => e.type === 'message_delta')!.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    expect(t.usage).toBeNull(); // el gateway lo detecta y lo avisa en el log
  });

  it('push_usoEnVariosChunks_seQuedaConElUltimo', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    drain(t, [
      chunk({ choices: [{ delta: { content: 'a' } }], usage: { prompt_tokens: 10, completion_tokens: 1 } }),
      chunk({ choices: [{ delta: { content: 'b' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }),
    ]);

    expect(t.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  it('finish_streamVacio_emiteUnMensajeBienFormado', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    const result = drain(t, []);

    expect(result.map((e) => e.type)).toEqual(['message_start', 'message_delta', 'message_stop']);
    expect(result[0]!.message.model).toBe('gpt-4o'); // sin chunk que diga el modelo, cae al fallback
    expect(result[1]!.delta.stop_reason).toBe('end_turn');
  });

  it('finish_dosVeces_esIdempotente', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');
    t.push(chunk({ choices: [{ delta: { content: 'x' } }] }));

    expect(t.finish().lines.length).toBeGreaterThan(0);
    expect(t.finish().lines).toEqual([]);
  });
});

describe('AnthropicStreamTranslator tool calls', () => {
  it('push_toolCall_abreBloqueYAcumulaArgumentos', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    const result = drain(t, [
      chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Bash' } }] } }] }),
      chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd"' } }] } }] }),
      chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"ls"}' } }] } }] }),
      chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ]);

    const start = result.find((e) => e.type === 'content_block_start');
    expect(start!.content_block).toEqual({ type: 'tool_use', id: 'call_1', name: 'Bash', input: {} });
    const deltas = result.filter((e) => e.type === 'content_block_delta');
    expect(deltas.map((d) => d.delta.partial_json)).toEqual(['{"cmd"', ':"ls"}']);
    expect(result.find((e) => e.type === 'message_delta')!.delta.stop_reason).toBe('tool_use');
  });

  // El codigo anterior usaba el indice del PROVEEDOR como indice de bloque Anthropic: con texto + dos
  // tools, la segunda tool reusaba el indice del texto y el mensaje quedaba corrupto.
  it('push_textoYDosToolCalls_asignaIndicesDeBloqueDistintos', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    const result = drain(t, [
      chunk({ choices: [{ delta: { content: 'voy a mirar' } }] }),
      chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read' } }] } }] }),
      chunk({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'Grep' } }] } }] }),
    ]);

    const starts = result.filter((e) => e.type === 'content_block_start');
    expect(starts.map((s) => s.index)).toEqual([0, 1, 2]);
    // El bloque de texto se cierra ANTES de abrir la primera tool (Anthropic no admite dos abiertos).
    const order = result.map((e) => `${e.type}:${e.index ?? ''}`);
    expect(order.indexOf('content_block_stop:0')).toBeLessThan(order.indexOf('content_block_start:1'));
    const stops = result.filter((e) => e.type === 'content_block_stop').map((s) => s.index);
    expect(stops.sort()).toEqual([0, 1, 2]);
  });

  it('push_argumentosSinAperturaPrevia_seIgnoranSinRomper', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    const result = drain(t, [
      chunk({ choices: [{ delta: { tool_calls: [{ index: 3, function: { arguments: '{}' } }] } }] }),
    ]);

    expect(result.filter((e) => e.type === 'content_block_delta')).toEqual([]);
    expect(t.malformed).toBe(0); // no es una linea ilegible, solo un chunk sin destino
  });
});

describe('AnthropicStreamTranslator robustez', () => {
  it('push_lineaNoJson_laCuentaComoMalformadaEnVezDeIgnorarla', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    t.push('data: {esto no es json');
    t.push('data: tampoco');

    expect(t.malformed).toBe(2);
  });

  it('push_lineasDeControlDelSse_noCuentanComoMalformadas', () => {
    const t = new AnthropicStreamTranslator('msg_1', 'gpt-4o');

    t.push('');
    t.push(': keep-alive');
    t.push('data: [DONE]');
    t.push('event: ping');

    expect(t.malformed).toBe(0);
  });
});

describe('translateOpenAiResponse (no streaming)', () => {
  it('translate_respuestaConTexto_reportaElUsoReal', () => {
    const result = translateOpenAiResponse(
      {
        model: 'gemini-2.5-flash',
        choices: [{ message: { content: 'hola' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 88, completion_tokens: 12 },
      },
      'msg_x',
      'fallback',
    ) as Record<string, any>;

    expect(result.usage).toEqual({ input_tokens: 88, output_tokens: 12 });
    expect(result.content).toEqual([{ type: 'text', text: 'hola' }]);
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.stop_reason).toBe('end_turn');
  });

  it('translate_conToolCalls_devuelveBloquesToolUse', () => {
    const result = translateOpenAiResponse(
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'c1', function: { name: 'Bash', arguments: '{"command":"ls"}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      'msg_x',
      'fallback',
    ) as Record<string, any>;

    expect(result.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'ls' } }]);
    expect(result.stop_reason).toBe('tool_use');
  });

  it('translate_argumentosDeToolInvalidos_dejaInputVacioSinRomper', () => {
    const result = translateOpenAiResponse(
      {
        choices: [
          { message: { tool_calls: [{ id: 'c1', function: { name: 'Bash', arguments: 'no-json' } }] } },
        ],
      },
      'msg_x',
      'fallback',
    ) as Record<string, any>;

    expect(result.content[0].input).toEqual({});
  });

  // Antes devolvia un 500 generico "Error parsing response"; ahora el motivo viaja en el mensaje.
  it('translate_sinChoices_lanzaConElMotivo', () => {
    expect(() => translateOpenAiResponse({ choices: [] }, 'msg_x', 'f')).toThrow(/choice/i);
    expect(() => translateOpenAiResponse(null, 'msg_x', 'f')).toThrow(/objeto/i);
  });
});
