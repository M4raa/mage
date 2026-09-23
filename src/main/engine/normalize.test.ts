import { describe, expect, it } from 'vitest';
import { normalizeRawEvent } from './normalize';

// Lo que pasa DURANTE un turno: deltas de pensamiento y de texto, texto del asistente, peticiones
// de permiso, estado de la sesion, compactado, modo de permiso y el `result` que lo cierra.
// Al final, la frontera: lo que NO se reconoce (devuelve vacio) frente a lo que se reconoce con
// forma invalida (LANZA) — la distincion que sostiene todo el contrato de este modulo.
describe('normalizeRawEvent: el turno', () => {
  it('normalize_streamEventThinkingDelta_emiteThinkingDelta', () => {
    // 2.5: el pensamiento EN VIVO. El campo se lee de forma tolerante (`thinking` o `text`) porque su
    // nombre exacto no se ha medido contra el CLI real, y aqui adivinar ya ha salido caro tres veces.
    const conThinking = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'a ver…' } },
    };
    const conText = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', text: 'a ver…' } },
    };

    expect(normalizeRawEvent(conThinking)).toEqual([{ kind: 'thinking_delta', text: 'a ver…' }]);
    expect(normalizeRawEvent(conText)).toEqual([{ kind: 'thinking_delta', text: 'a ver…' }]);
  });

  it('normalize_thinkingDeltaSinTextoConocido_noInventaNada', () => {
    const raw = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', signature: 'abc' } },
    };

    expect(normalizeRawEvent(raw)).toEqual([]);
  });

  it('normalize_assistantSoloTexto_emiteAssistantText', () => {
    // La variante existia y la consumia notify.ts (reglas de notificacion por regex del usuario), pero
    // NADIE la emitia: esas reglas no se disparaban nunca.
    const raw = { type: 'assistant', message: { content: [{ type: 'text', text: 'listo' }] } };

    expect(normalizeRawEvent(raw)).toEqual([{ kind: 'assistant_text', text: 'listo' }]);
  });

  it('normalize_assistantSinTexto_noEmiteAssistantText', () => {
    const raw = { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } };

    expect(normalizeRawEvent(raw)).toEqual([]);
  });

  it('normalize_canUseToolDeAskUserQuestion_propagaRequiresUserInteractionYDisplayName', () => {
    const raw = {
      type: 'control_request',
      request_id: 'r1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        display_name: 'AskUserQuestion',
        requires_user_interaction: true,
        input: { questions: [] },
        tool_use_id: 'u1',
      },
    };

    const [event] = normalizeRawEvent(raw);

    expect(event).toMatchObject({
      kind: 'permission_request',
      request: { requiresUserInteraction: true, displayName: 'AskUserQuestion' },
    });
  });

  it('normalize_controlResponseDeOtroSubtype_noProduceEvento', () => {
    // La respuesta a set_model/interrupt no aporta nada que pintar: su efecto se ve por otros mensajes.
    const raw = { type: 'control_response', response: { subtype: 'success', request_id: 'r1', response: {} } };

    expect(normalizeRawEvent(raw)).toEqual([]);
  });

  it('normalize_controlResponseDeError_devuelveControlErrorConSuRequestId', () => {
    // No se decide aqui si el usuario debe verlo: se propaga con el request_id y AgentSession, que sabe
    // que peticiones son suyas, distingue la telemetria propia de lo que pidio el usuario.
    const raw = {
      type: 'control_response',
      response: { subtype: 'error', request_id: 'r1', error: 'subtype no soportado' },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      { kind: 'control_error', requestId: 'r1', message: 'subtype no soportado' },
    ]);
  });

  it('normalize_controlResponseDeErrorSinRequestId_devuelveIdVacio', () => {
    const raw = { type: 'control_response', response: { subtype: 'error', error: 'vaya' } };

    expect(normalizeRawEvent(raw)).toEqual([{ kind: 'control_error', requestId: '', message: 'vaya' }]);
  });

  it('normalize_sessionStateChanged_returnsSessionState', () => {
    const raw = { type: 'system', subtype: 'session_state_changed', state: 'running' };

    expect(normalizeRawEvent(raw)).toEqual([{ kind: 'session_state', state: 'running' }]);
  });

  it('normalize_compactBoundaryManual_devuelveCompacted', () => {
    const raw = { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 12000 } };

    expect(normalizeRawEvent(raw)).toEqual([{ kind: 'compacted', trigger: 'manual' }]);
  });

  it('normalize_compactBoundaryAuto_devuelveCompactedAuto', () => {
    const raw = { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto' } };

    expect(normalizeRawEvent(raw)).toEqual([{ kind: 'compacted', trigger: 'auto' }]);
  });

  it('normalize_compactBoundarySinMetadata_usaFallbackManual', () => {
    const raw = { type: 'system', subtype: 'compact_boundary' };

    expect(normalizeRawEvent(raw)).toEqual([{ kind: 'compacted', trigger: 'manual' }]);
  });

  it('normalize_systemStatusConPermissionMode_devuelvePermissionMode', () => {
    const raw = { type: 'system', subtype: 'status', permissionMode: 'plan', uuid: 'u1', session_id: 's1' };

    expect(normalizeRawEvent(raw)).toEqual([{ kind: 'permission_mode', mode: 'plan' }]);
  });

  it('normalize_systemStatusSinPermissionMode_devuelveVacio', () => {
    const raw = { type: 'system', subtype: 'status', status: null };

    expect(normalizeRawEvent(raw)).toEqual([]);
  });

  it('normalize_textDelta_returnsStreamDelta', () => {
    const raw = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hola' } } };

    expect(normalizeRawEvent(raw)).toEqual([{ kind: 'stream_delta', text: 'hola' }]);
  });

  it('normalize_nonTextDelta_returnsEmpty', () => {
    const raw = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } } };

    expect(normalizeRawEvent(raw)).toEqual([]);
  });

  it('normalize_assistantWithToolUse_returnsToolUseEvents', () => {
    const raw = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      // El texto del mensaje va como `assistant_text` (lo consumen las reglas de notificacion por
      // regex; el chat lo ignora porque los deltas ya lo pintaron).
      { kind: 'assistant_text', text: 'ok' },
      { kind: 'tool_use', tool: { toolUseId: 't1', toolName: 'Bash', input: { command: 'ls' } } },
    ]);
  });

  it('normalize_canUseTool_returnsPermissionRequest', () => {
    const raw = {
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'can_use_tool', tool_name: 'Write', input: { path: 'a.txt' }, tool_use_id: 'u1' },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      {
        kind: 'permission_request',
        request: {
          requestId: 'r1',
          toolUseId: 'u1',
          toolName: 'Write',
          input: { path: 'a.txt' },
          description: null,
          requiresUserInteraction: false,
          displayName: null,
        },
      },
    ]);
  });

  it('normalize_cancelRequest_returnsPermissionCancelled', () => {
    const raw = { type: 'control_cancel_request', request_id: 'r1' };

    expect(normalizeRawEvent(raw)).toEqual([{ kind: 'permission_cancelled', requestId: 'r1' }]);
  });

  it('normalize_resultSuccess_returnsResultNotError', () => {
    const raw = { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 2 };

    expect(normalizeRawEvent(raw)).toEqual([
      { kind: 'result', result: { isError: false, subtype: 'success', costUsd: 0.01, numTurns: 2 } },
    ]);
  });

  it('normalize_resultErrorSubtype_returnsResultIsError', () => {
    const raw = { type: 'result', subtype: 'error_max_turns' };

    expect(normalizeRawEvent(raw)).toEqual([
      { kind: 'result', result: { isError: true, subtype: 'error_max_turns', costUsd: null, numTurns: null } },
    ]);
  });

  it('normalize_unknownType_returnsEmpty', () => {
    // `user` malformado (sin role/content) -> [] via safeParse (no lanza).
    expect(normalizeRawEvent({ type: 'user', message: {} })).toEqual([]);
    expect(normalizeRawEvent({ type: 'keep_alive' })).toEqual([]);
    expect(normalizeRawEvent({ type: 'system', subtype: 'status' })).toEqual([]);
  });

  it('normalize_nonObject_returnsEmpty', () => {
    expect(normalizeRawEvent(null)).toEqual([]);
    expect(normalizeRawEvent('texto')).toEqual([]);
    expect(normalizeRawEvent(42)).toEqual([]);
  });

  it('normalize_recognizedButInvalidShape_throws', () => {
    // result reconocido pero sin subtype (campo del que dependemos) -> error en la frontera.
    expect(() => normalizeRawEvent({ type: 'result' })).toThrow();
  });
});
