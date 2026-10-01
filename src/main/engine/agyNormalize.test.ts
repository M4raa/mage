import { describe, expect, it } from 'vitest';
import { normalizeAgyEvent } from './agyNormalize';

// Las lineas de estos tests son COPIA de lo que emitio `agy` 1.1.11 el 2026-08-11 (4 turnos reales en
// un workspace temporal), no una forma inventada: es lo que hace que el traductor valga algo.

describe('normalizeAgyEvent', () => {
  it('normalizeAgyEvent_init_devuelveSessionInitConElConversationIdDeAgy', () => {
    const raw = {
      event: 'init',
      conversation_id: '9bfd4bbe-9297-4985-9b7e-e5ad16ce0d26',
      init: { model: 'gemini-3.6-flash-low', cwd: 'C:\\tmp\\ws', tools: new Array(56).fill({}), permission_mode: 'request-review' },
    };

    const events = normalizeAgyEvent(raw);

    expect(events).toEqual([
      {
        kind: 'session_init',
        sessionId: '9bfd4bbe-9297-4985-9b7e-e5ad16ce0d26',
        model: 'gemini-3.6-flash-low',
        // El spike de E3 conto 56 entradas pero NO miro dentro, asi que la forma de cada una sigue sin
        // medirse y el fixture usa objetos vacios de relleno. `toolNames` los descarta, que es lo
        // correcto mientras no haya medida: el dia que se mida, este `[]` es lo que cambia.
        tools: [],
        mcpServers: [],
        slashCommands: [],
        skills: [],
        plugins: [],
        pluginErrors: [],
      },
    ]);
  });

  it('normalizeAgyEvent_agentResponseConTextDelta_devuelveStreamDelta', () => {
    const raw = {
      event: 'step_update',
      step_update: { conversation_id: 'c1', step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'BANANA77\n', duration_seconds: 0.89 },
    };

    expect(normalizeAgyEvent(raw)).toEqual([{ kind: 'stream_delta', text: 'BANANA77\n' }]);
  });

  it('normalizeAgyEvent_agentResponseSinTextDelta_devuelveVacio', () => {
    const raw = {
      event: 'step_update',
      step_update: { conversation_id: 'c1', step_index: 6, state: 'DONE', step_type: 'agent_response', duration_seconds: 1.2 },
    };

    expect(normalizeAgyEvent(raw)).toEqual([]);
  });

  it('normalizeAgyEvent_textDeltaVacio_devuelveVacio', () => {
    const raw = {
      event: 'step_update',
      step_update: { conversation_id: 'c1', step_index: 6, state: 'DONE', step_type: 'agent_response', text_delta: '' },
    };

    expect(normalizeAgyEvent(raw)).toEqual([]);
  });

  it('normalizeAgyEvent_toolActive_devuelveToolUseConSusParametros', () => {
    const raw = {
      event: 'step_update',
      step_update: {
        conversation_id: 'c1',
        step_index: 7,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'write_to_file',
        tool_info: { name: 'write_to_file', parameters: { TargetFile: 'C:\\tmp\\ws\\memo.txt' } },
      },
    };

    expect(normalizeAgyEvent(raw)).toEqual([
      {
        kind: 'tool_use',
        tool: { toolUseId: 'agy-step-7', toolName: 'write_to_file', input: { TargetFile: 'C:\\tmp\\ws\\memo.txt' } },
      },
    ]);
  });

  it('normalizeAgyEvent_toolDone_devuelveToolResultCorrelacionadoConSuToolUse', () => {
    const raw = {
      event: 'step_update',
      step_update: { conversation_id: 'c1', step_index: 7, state: 'DONE', step_type: 'tool', tool_name: 'write_to_file', duration_seconds: 3.4 },
    };

    expect(normalizeAgyEvent(raw)).toEqual([
      { kind: 'tool_result', result: { toolUseId: 'agy-step-7', isError: false, output: '', durationMs: null } },
    ]);
  });

  // El fallo medido de `agy`: un paso en ERROR con un `result` global que dice SUCCESS. Si esto no se
  // pinta, la UI ensena datos falsos como si fueran reales.
  it('normalizeAgyEvent_toolEnError_devuelveToolResultDeErrorYUnErrorVisible', () => {
    const raw = {
      event: 'step_update',
      step_update: { conversation_id: 'c1', step_index: 9, state: 'ERROR', step_type: 'tool', tool_name: 'write_to_file' },
    };

    const events = normalizeAgyEvent(raw);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      kind: 'tool_result',
      result: {
        toolUseId: 'agy-step-9',
        isError: true,
        output: 'agy no pudo completar esta herramienta (state ERROR).',
        durationMs: null,
      },
    });
    expect(events[1]?.kind).toBe('error');
    expect(events[1]).toMatchObject({ message: expect.stringContaining('write_to_file') as unknown as string });
  });

  it('normalizeAgyEvent_pasoNoToolEnError_devuelveSoloElError', () => {
    const raw = {
      event: 'step_update',
      step_update: { conversation_id: 'c1', step_index: 4, state: 'ERROR', step_type: 'checkpoint' },
    };

    const events = normalizeAgyEvent(raw);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('error');
  });

  it.each(['user_input', 'checkpoint', 'system_message', 'unknown'])(
    'normalizeAgyEvent_pasoIgnorable_%s_devuelveVacio',
    (stepType) => {
      const raw = { event: 'step_update', step_update: { conversation_id: 'c1', step_index: 0, state: 'DONE', step_type: stepType } };

      expect(normalizeAgyEvent(raw)).toEqual([]);
    },
  );

  it('normalizeAgyEvent_result_devuelveResultConElUsoReal', () => {
    const raw = {
      event: 'result',
      result: {
        conversation_id: 'c1',
        status: 'SUCCESS',
        response: 'BANANA77\n',
        duration_seconds: 1.57,
        num_turns: 1,
        usage: { input_tokens: 17533, output_tokens: 7, thinking_tokens: 112, cache_read_tokens: 24410, total_tokens: 17540 },
      },
    };

    expect(normalizeAgyEvent(raw)).toEqual([
      {
        kind: 'result',
        result: {
          isError: false,
          subtype: 'success',
          numTurns: 1,
          usage: { inputTokens: 17533, outputTokens: 7, totalTokens: 17540, thinkingTokens: 112, cacheReadTokens: 24410 },
        },
      },
    ]);
  });

  it('normalizeAgyEvent_resultConEstadoError_devuelveErrorVisibleAntesDelResult', () => {
    // Medido con el sondeo gratuito (prompt vacio): `agy` cierra con status ERROR y un `error` legible.
    const raw = {
      event: 'result',
      result: {
        conversation_id: '',
        status: 'ERROR',
        response: '',
        error: 'Error: empty prompt. Usage: agy --print "your prompt here"',
        num_turns: 0,
        usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
      },
    };

    const events = normalizeAgyEvent(raw);

    expect(events[0]).toMatchObject({ kind: 'error', message: expect.stringContaining('empty prompt') as unknown as string });
    expect(events[1]).toMatchObject({ kind: 'result', result: { isError: true, subtype: 'error' } });
  });

  it('normalizeAgyEvent_resultSinUsage_noInventaContadores', () => {
    const events = normalizeAgyEvent({ event: 'result', result: { status: 'SUCCESS', response: '' } });

    expect(events).toEqual([{ kind: 'result', result: { isError: false, subtype: 'success', numTurns: null } }]);
  });

  it('normalizeAgyEvent_usageParcial_loQueFaltaViajaComoNull', () => {
    const raw = { event: 'result', result: { status: 'SUCCESS', usage: { input_tokens: 10, total_tokens: 12 } } };

    const events = normalizeAgyEvent(raw);

    expect(events[0]).toMatchObject({
      result: { usage: { inputTokens: 10, outputTokens: null, totalTokens: 12, thinkingTokens: null, cacheReadTokens: null } },
    });
  });

  it.each([[null], [42], ['texto'], [{}], [{ event: 42 }], [{ event: 'otra_cosa' }]])(
    'normalizeAgyEvent_lineaNoReconocida_devuelveVacio_%#',
    (raw) => {
      expect(normalizeAgyEvent(raw)).toEqual([]);
    },
  );

  // Contrato compartido con el traductor de Claude: una linea que SI reconocemos pero con forma
  // invalida LANZA (AgentSession la convierte en un evento 'error'); nunca se traga en silencio.
  it('normalizeAgyEvent_initSinConversationId_lanza', () => {
    expect(() => normalizeAgyEvent({ event: 'init', init: { model: 'm', cwd: 'c' } })).toThrow();
  });

  it('normalizeAgyEvent_stepUpdateSinStepIndex_lanza', () => {
    expect(() => normalizeAgyEvent({ event: 'step_update', step_update: { state: 'DONE', step_type: 'tool' } })).toThrow();
  });

  it('normalizeAgyEvent_usageConTokensNegativos_lanza', () => {
    const raw = { event: 'result', result: { status: 'SUCCESS', usage: { input_tokens: -1 } } };

    expect(() => normalizeAgyEvent(raw)).toThrow();
  });
});

// Denegaciones: mensajes COPIADOS de lo que emitio agy 1.2.14 el 2026-09-30 (`agy-spike --permissions`).
describe('normalizeAgyEvent: comandos denegados', () => {
  const step = (state: string, message: string): unknown => ({
    event: 'step_update',
    step_update: { step_index: 4, state, step_type: 'tool', tool_name: 'run_command', tool_info: { error: { message } } },
  });
  const unlisted = 'permission check failed for command "whoami > unlisted.txt": user denied permission to run command: whoami > unlisted.txt';
  const denyRule = 'Permission denied for command(hostname > denied.txt). Matches user-configured deny rule.';

  it('normalizeAgyEvent_comandoSinRegla_dicePasoDoneConElComandoExacto', () => {
    const events = normalizeAgyEvent(step('DONE', unlisted));

    expect(events[0]).toMatchObject({ kind: 'tool_result', result: { isError: true } });
    expect(events[1]).toMatchObject({ kind: 'error', message: expect.stringContaining('«whoami > unlisted.txt»') as unknown as string });
    expect(events[1]).toMatchObject({ deniedCommand: 'whoami > unlisted.txt' });
  });

  // Sin comando en el mensaje no hay nada exacto que ofrecer permitir.
  it('normalizeAgyEvent_denegacionSinComando_noLlevaDeniedCommand', () => {
    const events = normalizeAgyEvent(step('ERROR', 'permission check failed for read_file "/x/y.json": user denied permission'));

    expect(events[1]).toMatchObject({ kind: 'error' });
    expect(events[1]).not.toHaveProperty('deniedCommand');
  });

  it('normalizeAgyEvent_reglaDeny_diceQueLoProhibeUnaRegla', () => {
    const events = normalizeAgyEvent(step('ERROR', denyRule));

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ kind: 'error', message: expect.stringContaining('«hostname > denied.txt»: lo prohíbe una regla deny') as unknown as string });
    expect(events[1]).toMatchObject({ deniedCommand: 'hostname > denied.txt' });
  });

  it('normalizeAgyEvent_resultConDeniedActions_avisaAunqueSeaSuccess', () => {
    const events = normalizeAgyEvent({ event: 'result', result: { status: 'SUCCESS', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } });

    expect(events[0]).toMatchObject({ kind: 'error', message: expect.stringContaining('RunCommand') as unknown as string });
    expect(events[1]).toMatchObject({ kind: 'result' });
  });

  it('normalizeAgyEvent_resultConDeniedActionsYaContado_noRepiteElAviso', () => {
    const events = normalizeAgyEvent({ event: 'result', result: { status: 'SUCCESS', denied_actions: [{ action: 'command' }] } }, true);

    expect(events.map((event) => event.kind)).toEqual(['result']);
  });
});
