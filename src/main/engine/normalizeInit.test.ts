import { describe, expect, it } from 'vitest';
import { normalizeRawEvent } from './normalize';

// Fase 7.12: `normalize.test.ts` era un solo `describe` de 560 lineas sin estructura. Se parte por
// AREA del protocolo, que es como se lee y como se amplia: arranque/control, turno, y resultados de
// herramienta. Ni un test cambia de contenido.
//
// Aqui: el `system/init`, las respuestas a `control_request` (contexto, hooks, initialize) y los
// catalogos que el CLI manda al arrancar (comandos y subagentes).
describe('normalizeRawEvent: arranque y protocolo de control', () => {
  it('normalize_systemInit_returnsSessionInit', () => {
    // `tools` con los NOMBRES reales: el CLI manda strings (medido en su propio codigo). El fixture
    // llevaba `[1, 2, 3]` de relleno de cuando solo se guardaba la cuenta, y ahora la lista se pinta.
    const raw = { type: 'system', subtype: 'init', session_id: 's1', model: 'haiku', tools: ['Read', 'Bash', 'Task'] };

    const events = normalizeRawEvent(raw);

    expect(events).toEqual([
      { kind: 'session_init', sessionId: 's1', model: 'haiku', tools: ['Read', 'Bash', 'Task'], mcpServers: [], slashCommands: [] },
    ]);
  });

  it('normalize_systemInitConHerramientasQueNoSonStrings_lasDescartaSinRomper', () => {
    // La lista de herramientas no puede tumbar el arranque de una sesion: perderla degrada un panel,
    // fallar deja al usuario sin conversacion. Se acepta ademas `{ name }` porque la forma de `agy`
    // no esta medida.
    const raw = { type: 'system', subtype: 'init', session_id: 's1', model: 'haiku', tools: [1, null, { name: 'read_file' }, { name: 7 }, '', 'Bash'] };

    const [event] = normalizeRawEvent(raw);

    expect(event).toMatchObject({ kind: 'session_init', tools: ['read_file', 'Bash'] });
  });

  it('normalize_systemInitConMcpYSlashCommands_losExpone', () => {
    // Forma LITERAL del stream del CLI 2.1.220 (capturada en la maquina del usuario).
    const raw = {
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      model: 'claude-sonnet-5',
      tools: ['Task', 'Bash'],
      mcp_servers: [
        { name: 'database', status: 'connected' },
        { name: 'chrome-devtools', status: 'pending' },
      ],
      slash_commands: ['caveman', 'find-skills'],
    };

    const [event] = normalizeRawEvent(raw);

    expect(event).toEqual({
      kind: 'session_init',
      sessionId: 's1',
      model: 'claude-sonnet-5',
      // Los NOMBRES, no el numero: es lo que pinta el panel de Herramientas.
      tools: ['Task', 'Bash'],
      mcpServers: [
        { name: 'database', status: 'connected' },
        { name: 'chrome-devtools', status: 'pending' },
      ],
      slashCommands: ['caveman', 'find-skills'],
    });
  });

  it('normalize_systemInitConMcpMalformado_noTumbaElArranque', () => {
    // Campo informativo: una forma inesperada se descarta a [] en vez de convertir el init en error.
    const raw = {
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      model: 'haiku',
      mcp_servers: [{ nombre: 'sin-name' }],
      slash_commands: [{ no: 'es string' }],
    };

    const [event] = normalizeRawEvent(raw);

    expect(event).toMatchObject({ kind: 'session_init', mcpServers: [], slashCommands: [] });
  });

  it('normalize_controlResponseConDesgloseDeContexto_devuelveContextUsage', () => {
    // Payload LITERAL del CLI 2.1.220 (recortado): el control_response NO dice a que subtype responde,
    // asi que se reconoce por su forma.
    const raw = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'r1',
        response: {
          totalTokens: 39_365,
          maxTokens: 967_000,
          percentage: 4,
          autocompactSource: 'model-default',
          categories: [
            { name: 'System prompt', tokens: 9_882, color: 'promptBorder' },
            { name: 'MCP tools (deferred)', tokens: 3_954, color: 'inactive', isDeferred: true },
          ],
          gridRows: [[{ color: 'x', isFilled: true, categoryName: 'y', tokens: 1, percentage: 0, squareFullness: 1 }]],
        },
      },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      {
        kind: 'context_usage',
        usage: {
          totalTokens: 39_365,
          maxTokens: 967_000,
          percentage: 4,
          categories: [
            { name: 'System prompt', tokens: 9_882, isDeferred: false },
            { name: 'MCP tools (deferred)', tokens: 3_954, isDeferred: true },
          ],
        },
      },
    ]);
  });

  it('normalize_hookCallback_devuelveHookFiredConSuRequestId', () => {
    // Payload LITERAL del CLI 2.1.220 (UserPromptSubmit), recortado. El requestId es imprescindible:
    // el CLI bloquea la sesion hasta que se le responde.
    const raw = {
      type: 'control_request',
      request_id: '3abf968d-1147-4608-a847-ba4a834d45ac',
      request: {
        subtype: 'hook_callback',
        callback_id: 'mage-observer',
        input: {
          session_id: 'c9d7a29a',
          cwd: 'C:\\sourcecode\\mage',
          hook_event_name: 'UserPromptSubmit',
          prompt: 'di ok y nada mas',
        },
      },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      {
        kind: 'hook_fired',
        requestId: '3abf968d-1147-4608-a847-ba4a834d45ac',
        event: 'UserPromptSubmit',
        detail: null,
      },
    ]);
  });

  it('normalize_hookCallbackDeNotificacion_exponeElMensajeComoDetalle', () => {
    const raw = {
      type: 'control_request',
      request_id: 'r9',
      request: {
        subtype: 'hook_callback',
        callback_id: 'mage-observer',
        input: { hook_event_name: 'Notification', message: 'Claude necesita tu atencion' },
      },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      { kind: 'hook_fired', requestId: 'r9', event: 'Notification', detail: 'Claude necesita tu atencion' },
    ]);
  });

  it('normalize_respuestaAlInitialize_devuelveLosComandosConDescripcion', () => {
    const raw = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'r1',
        response: {
          commands: [
            { name: 'compact', description: 'Compact the conversation', argumentHint: '' },
            { name: 'caveman', description: 'Ultra-compressed mode (user)', argumentHint: '' },
          ],
          agents: [],
          output_style: 'default',
        },
      },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      {
        kind: 'commands_available',
        commands: [
          { name: 'compact', description: 'Compact the conversation', argumentHint: '', aliases: [] },
          { name: 'caveman', description: 'Ultra-compressed mode (user)', argumentHint: '', aliases: [] },
        ],
      },
    ]);
  });

  it('normalize_respuestaAlInitializeSinComandos_noProduceEvento', () => {
    const raw = {
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { commands: [] } },
    };

    expect(normalizeRawEvent(raw)).toEqual([]);
  });

  it('normalize_comandoSinDescripcion_loDejaVacioSinRomper', () => {
    const raw = {
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { commands: [{ name: 'recap' }] } },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      { kind: 'commands_available', commands: [{ name: 'recap', description: '', argumentHint: null, aliases: [] }] },
    ]);
  });

  it('normalize_initializeResponse_emiteCommandsAvailableYSubagentsAvailable', () => {
    // Dos eventos de UN control_response: `commands_available` conserva su forma (y su reducer, y sus
    // tests) y los subagentes viajan en el suyo.
    const raw = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'r1',
        response: {
          commands: [{ name: 'compact', description: 'Compacta', argumentHint: '[foco]', aliases: ['c'] }],
          agents: [{ name: 'Explore', description: 'Busca en el repo', model: 'haiku' }],
        },
      },
    };

    expect(normalizeRawEvent(raw)).toEqual([
      {
        kind: 'commands_available',
        commands: [{ name: 'compact', description: 'Compacta', argumentHint: '[foco]', aliases: ['c'] }],
      },
      { kind: 'subagents_available', subagents: [{ name: 'Explore', description: 'Busca en el repo', model: 'haiku' }] },
    ]);
  });

  it('normalize_initializeResponseSinAgents_soloEmiteCommands', () => {
    const raw = {
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { commands: [{ name: 'compact' }] } },
    };

    expect(normalizeRawEvent(raw).map((e) => e.kind)).toEqual(['commands_available']);
  });
});
