import { describe, expect, it } from 'vitest';
import type { ContextUsage, MageEvent } from '@shared/events';
import { reduceEvent, type WorkbenchState } from './workbenchStore';
import type { Block, Tab } from './types';

const TAB = 'tab-1';

// Estado minimo con lo que el reducer lee. Se castea porque WorkbenchState incluye toda la API de
// acciones del store, que el reducer no toca (es una funcion pura sobre los mapas por pestana).
function state(overrides: Partial<WorkbenchState> = {}): WorkbenchState {
  return {
    blocksByChat: {},
    streamingIdByChat: {},
    statusByChat: {},
    pendingByChat: {},
    providerUsageByChat: {},
    prGuardByChat: {},
    slashCommandsByChat: {},
    contextUsageByChat: {},
    rateLimitByChat: {},
    // `tabs` hace falta desde 2.3b: el reducer consulta las reglas "Permitir siempre aqui" de la
    // conversacion para decidir si la peticion lleva tarjeta o se auto-aprueba.
    tabs: [],
    dismissedSubagentsByChat: {},
    ...overrides,
  } as WorkbenchState;
}

// Pestaña minima con lo que lee el reducer. Se castea por el mismo motivo que `state`.
function tab(overrides: Partial<Tab> = {}): Tab {
  return { id: TAB, ...overrides } as Tab;
}

function blocksOf(patch: Partial<WorkbenchState>): readonly Block[] {
  return patch.blocksByChat?.[TAB] ?? [];
}

describe('reduceEvent — streaming y bloques', () => {
  it('reduceEvent_streamDelta_abreBloqueDeAgenteYMarcaStreaming', () => {
    const patch = reduceEvent(state(), TAB, { kind: 'stream_delta', text: 'hola' });

    expect(blocksOf(patch)).toHaveLength(1);
    expect(patch.statusByChat?.[TAB]).toBe('streaming');
    expect(patch.streamingIdByChat?.[TAB]).not.toBeNull();
  });

  it('reduceEvent_assistantText_noTocaLaConversacionParaNoDuplicarLosDeltas', () => {
    // El CLI manda los deltas Y LUEGO el mensaje completo. Mage lanza siempre con
    // --include-partial-messages, asi que el texto ya esta pintado por los deltas: anadir tambien el
    // mensaje completo lo duplicaria. Este evento SI se usa, pero fuera del reducer (las reglas de
    // notificacion por regex de notify.ts).
    const afterDelta = reduceEvent(state(), TAB, { kind: 'stream_delta', text: 'hola mundo' });
    const withStream = state({
      blocksByChat: afterDelta.blocksByChat ?? {},
      streamingIdByChat: afterDelta.streamingIdByChat ?? {},
    });

    const patch = reduceEvent(withStream, TAB, { kind: 'assistant_text', text: 'hola mundo' });

    expect(patch).toEqual({});
  });

  it('reduceEvent_error_pintaBloqueDeErrorYDejaLaPestanaEnError', () => {
    const patch = reduceEvent(state(), TAB, { kind: 'error', message: 'boom' });

    expect(blocksOf(patch).at(-1)).toMatchObject({ kind: 'error', message: 'boom' });
    expect(patch.statusByChat?.[TAB]).toBe('error');
    expect(patch.streamingIdByChat?.[TAB]).toBeNull();
  });

  it('reduceEvent_eventoDeOtroKindNoManejado_noCambiaNada', () => {
    const patch = reduceEvent(state(), TAB, {
      kind: 'hook_fired',
      requestId: 'r1',
      event: 'UserPromptSubmit',
      detail: null,
    });

    expect(patch).toEqual({});
  });
});

describe('reduceEvent — permisos', () => {
  const request = (requestId: string) =>
    ({ requestId, toolUseId: `t-${requestId}`, toolName: 'Write', input: {}, description: null, requiresUserInteraction: false, displayName: null }) as const;
  const pendingEntry = (requestId: string) => ({
    requestId,
    input: {},
    view: { prompt: '', target: '', toolLabel: 'Write', rememberable: true, diff: [], summary: '' },
  });

  it('reduceEvent_permissionRequest_dejaLaPestanaEsperandoPermiso', () => {
    const patch = reduceEvent(state(), TAB, {
      kind: 'permission_request',
      request: { requestId: 'r1', toolUseId: 't1', toolName: 'Write', input: {}, description: null, requiresUserInteraction: false, displayName: null },
    });

    expect(patch.statusByChat?.[TAB]).toBe('needs_permission');
    expect(patch.pendingByChat?.[TAB]).toMatchObject([{ requestId: 'r1', input: {}, view: { toolLabel: 'Write' } }]);
    // 2.3b: ademas del panel, la peticion se pinta como TARJETA en el hilo.
    expect(blocksOf(patch)).toMatchObject([{ kind: 'permission', requestId: 'r1', toolName: 'Write', state: 'pending' }]);
  });

  it('reduceEvent_permissionRequestRepetido_noDuplicaLaTarjetaDePermiso', () => {
    // El CLI puede reenviar el mismo can_use_tool: dos tarjetas ofrecerian contestar dos veces lo mismo.
    const request = { requestId: 'r1', toolUseId: 't1', toolName: 'Write', input: {}, description: null, requiresUserInteraction: false, displayName: null };
    const first = reduceEvent(state(), TAB, { kind: 'permission_request', request });
    const second = reduceEvent(state({ blocksByChat: { [TAB]: blocksOf(first) } }), TAB, { kind: 'permission_request', request });

    expect(second.blocksByChat).toBeUndefined();
  });

  it('reduceEvent_permissionRequestDeToolConReglaSiempre_niTarjetaNiEstadoDePermiso', () => {
    // "Permitir siempre Write aqui": NADA en el estado — ni tarjeta, ni cola, ni panel, ni "necesita
    // permiso". La respuesta la manda `handleEvent` con el requestId del propio evento.
    const current = state({ tabs: [tab({ alwaysAllowTools: ['Write'] })] });

    const patch = reduceEvent(current, TAB, {
      kind: 'permission_request',
      request: { requestId: 'r9', toolUseId: 't9', toolName: 'Write', input: {}, description: null, requiresUserInteraction: false, displayName: null },
    });

    expect(patch).toEqual({});
  });

  it('reduceEvent_permissionCancelled_cierraLaTarjetaDePermisoComoCancelada', () => {
    const request = { requestId: 'r1', toolUseId: 't1', toolName: 'Write', input: {}, description: null, requiresUserInteraction: false, displayName: null };
    const conTarjeta = reduceEvent(state(), TAB, { kind: 'permission_request', request });
    const current = state({ blocksByChat: { [TAB]: blocksOf(conTarjeta) }, pendingByChat: conTarjeta.pendingByChat ?? {} });

    const patch = reduceEvent(current, TAB, { kind: 'permission_cancelled', requestId: 'r1' });

    expect(blocksOf(patch)).toMatchObject([{ kind: 'permission', state: 'cancelled' }]);
  });

  it('reduceEvent_permissionCancelledDelPermisoEnCurso_limpiaElDialogo', () => {
    // Es lo que emite AgentSession cuando el proceso muere con permisos en vuelo (C1): el dialogo no
    // puede quedarse esperando una respuesta que ya nadie va a leer.
    const current = state({ pendingByChat: { [TAB]: [pendingEntry('r1')] } });

    const patch = reduceEvent(current, TAB, { kind: 'permission_cancelled', requestId: 'r1' });

    expect(patch.pendingByChat?.[TAB]).toEqual([]);
    expect(patch.statusByChat?.[TAB]).toBe('idle');
  });

  it('reduceEvent_dosPermissionRequestSeguidos_encolaLosDosEnOrden', () => {
    // Tools en paralelo: el CLI manda el segundo can_use_tool sin esperar al primero. Antes el segundo
    // PISABA al primero y este se quedaba sin respuesta posible (turno colgado).
    const first = reduceEvent(state(), TAB, { kind: 'permission_request', request: request('r1') });
    const second = reduceEvent(state({ blocksByChat: first.blocksByChat ?? {}, pendingByChat: first.pendingByChat ?? {} }), TAB, {
      kind: 'permission_request',
      request: request('r2'),
    });

    expect(second.pendingByChat?.[TAB]?.map((p) => p.requestId)).toEqual(['r1', 'r2']);
    expect(blocksOf(second).filter((b) => b.kind === 'permission')).toHaveLength(2);
  });

  it('reduceEvent_permissionRequestReenviado_noSeEncolaDosVeces', () => {
    const current = state({ pendingByChat: { [TAB]: [pendingEntry('r1')] } });

    const patch = reduceEvent(current, TAB, { kind: 'permission_request', request: request('r1') });

    expect(patch.pendingByChat).toBeUndefined();
  });

  it('reduceEvent_permissionCancelledConOtroEnCola_loQuitaYSigueEsperandoPermiso', () => {
    const current = state({ pendingByChat: { [TAB]: [pendingEntry('r1'), pendingEntry('r2')] } });

    const patch = reduceEvent(current, TAB, { kind: 'permission_cancelled', requestId: 'r1' });

    expect(patch.pendingByChat?.[TAB]?.map((p) => p.requestId)).toEqual(['r2']);
    expect(patch.statusByChat?.[TAB]).toBe('needs_permission');
  });

  it('reduceEvent_permissionCancelledDeOtroPermiso_noTocaElActual', () => {
    const current = state({ pendingByChat: { [TAB]: [pendingEntry('r1')] } });

    const patch = reduceEvent(current, TAB, { kind: 'permission_cancelled', requestId: 'otro' });

    expect(patch).toEqual({});
  });
});

describe('reduceEvent — AskUserQuestion (2.3)', () => {
  // El input LITERAL medido en el control_request del CLI.
  const ASK_INPUT = {
    questions: [
      {
        question: '¿Prefieres el color rojo o el azul?',
        header: 'Preferencia de color',
        options: [{ label: 'Rojo', description: '' }, { label: 'Azul', description: '' }],
        multiSelect: false,
      },
    ],
  };

  const askRequest = (requestId = 'r1'): MageEvent => ({
    kind: 'permission_request',
    request: {
      requestId,
      toolUseId: 'u1',
      toolName: 'AskUserQuestion',
      input: ASK_INPUT,
      description: null,
      requiresUserInteraction: true,
      displayName: 'AskUserQuestion',
    },
  });

  it('reduceEvent_permissionRequestDeAskUserQuestion_anadeBloqueQuestionYDejaElPermisoPendiente', () => {
    // La tarjeta NO sustituye al permiso: es la MISMA peticion, y `pendingByChat` es lo que permite
    // contestarla (una sola vez) desde la tarjeta.
    const patch = reduceEvent(state(), TAB, askRequest());

    const question = blocksOf(patch).at(-1);
    expect(question).toMatchObject({ kind: 'question', requestId: 'r1', state: 'pending', answers: null });
    expect(patch.pendingByChat?.[TAB]).toMatchObject([{ requestId: 'r1', input: ASK_INPUT }]);
    expect(patch.statusByChat?.[TAB]).toBe('needs_permission');
  });

  it('reduceEvent_permissionRequestNormal_anadeTarjetaDePermisoYNoDePregunta', () => {
    const patch = reduceEvent(state(), TAB, {
      kind: 'permission_request',
      request: {
        requestId: 'r2',
        toolUseId: 'u2',
        toolName: 'Bash',
        input: { command: 'ls' },
        description: null,
        requiresUserInteraction: false,
        displayName: null,
      },
    });

    expect(blocksOf(patch).map((b) => b.kind)).toEqual(['permission']);
  });

  it('reduceEvent_permissionRequestRepetidoMismoRequestId_noDuplicaElBloque', () => {
    const first = reduceEvent(state(), TAB, askRequest());
    const current = state({ blocksByChat: first.blocksByChat ?? {} });

    const second = reduceEvent(current, TAB, askRequest());

    expect(second.blocksByChat).toBeUndefined();
  });

  it('reduceEvent_permissionCancelled_marcaElBloqueCancelado', () => {
    const first = reduceEvent(state(), TAB, askRequest());
    const current = state({
      blocksByChat: first.blocksByChat ?? {},
      pendingByChat: first.pendingByChat ?? {},
    });

    const patch = reduceEvent(current, TAB, { kind: 'permission_cancelled', requestId: 'r1' });

    expect(blocksOf(patch).at(-1)).toMatchObject({ kind: 'question', state: 'cancelled' });
    expect(patch.pendingByChat?.[TAB]).toEqual([]);
  });

  it('reduceEvent_subagentsAvailable_seGuardaPorPestana', () => {
    const patch = reduceEvent(state(), TAB, {
      kind: 'subagents_available',
      subagents: [{ name: 'Explore', description: 'Busca', model: null }],
    });

    expect(patch.subagentsByChat?.[TAB]).toEqual([{ name: 'Explore', description: 'Busca', model: null }]);
  });
});

describe('reduceEvent — reinicio automatico (C1)', () => {
  it('reduceEvent_sessionRestarting_avisaEnLaConversacionYVuelveAIdle', () => {
    const patch = reduceEvent(state(), TAB, { kind: 'session_restarting', attempt: 2, delayMs: 2_000 });

    const marker = blocksOf(patch).at(-1);
    expect(marker).toMatchObject({ kind: 'system' });
    expect(marker?.kind === 'system' && marker.text).toContain('2.0 s');
    expect(marker?.kind === 'system' && marker.text).toContain('intento 2');
    // Ni 'error' ni 'streaming': el motor esta reanudando por su cuenta.
    expect(patch.statusByChat?.[TAB]).toBe('idle');
    expect(patch.streamingIdByChat?.[TAB]).toBeNull();
  });

  it('reduceEvent_sessionRestartingConTextoAMedias_cierraElBloqueEnStreaming', () => {
    const afterDelta = reduceEvent(state(), TAB, { kind: 'stream_delta', text: 'a medio decir' });
    const withStream = state({
      blocksByChat: afterDelta.blocksByChat ?? {},
      streamingIdByChat: afterDelta.streamingIdByChat ?? {},
    });

    const patch = reduceEvent(withStream, TAB, { kind: 'session_restarting', attempt: 1, delayMs: 1_000 });

    const agent = blocksOf(patch).find((b) => b.kind === 'agent');
    expect(agent?.kind === 'agent' && agent.streaming).toBe(false);
  });
});

describe('reduceEvent — protocolo de control (D2/D3/D4)', () => {
  it('reduceEvent_sessionInit_guardaLosComandosSinDescripcion', () => {
    const patch = reduceEvent(state(), TAB, {
      kind: 'session_init',
      sessionId: 's1',
      model: 'sonnet',
      tools: ['Read', 'Bash', 'Task'],
      mcpServers: [],
      slashCommands: ['compact', 'recap'],
      skills: [],
      plugins: [],
      pluginErrors: [],
    });

    expect(patch.slashCommandsByChat?.[TAB]).toEqual([
      { name: 'compact', description: '', argumentHint: null, aliases: [] },
      { name: 'recap', description: '', argumentHint: null, aliases: [] },
    ]);
  });

  it('reduceEvent_commandsAvailable_pisaElCatalogoConLasDescripcionesReales', () => {
    const current = state({ slashCommandsByChat: { [TAB]: [{ name: 'compact', description: '', argumentHint: null, aliases: [] }] } });

    const patch = reduceEvent(current, TAB, {
      kind: 'commands_available',
      commands: [{ name: 'compact', description: 'Compact the conversation', argumentHint: '[instrucciones]', aliases: ['compactar'] }],
    });

    expect(patch.slashCommandsByChat?.[TAB]).toEqual([
      { name: 'compact', description: 'Compact the conversation', argumentHint: '[instrucciones]', aliases: ['compactar'] },
    ]);
  });

  it('reduceEvent_contextUsage_seGuardaPorPestana', () => {
    const usage: ContextUsage = {
      totalTokens: 39_365,
      maxTokens: 967_000,
      percentage: 4,
      categories: [{ name: 'System prompt', tokens: 9_882, isDeferred: false }],
    };

    const patch = reduceEvent(state(), TAB, { kind: 'context_usage', usage });

    expect(patch.contextUsageByChat?.[TAB]).toBe(usage);
  });

  it('reduceEvent_noPisaElEstadoDeOtrasPestanas', () => {
    const current = state({ contextUsageByChat: { otra: { totalTokens: 1, maxTokens: 2, percentage: 3, categories: [] } } });
    const usage: ContextUsage = { totalTokens: 10, maxTokens: 20, percentage: 50, categories: [] };

    const patch = reduceEvent(current, TAB, { kind: 'context_usage', usage });

    expect(patch.contextUsageByChat?.otra).toEqual({ totalTokens: 1, maxTokens: 2, percentage: 3, categories: [] });
    expect(patch.contextUsageByChat?.[TAB]).toBe(usage);
  });
});

describe('reduceEvent — estado de sesion y compactacion', () => {
  it('reduceEvent_sessionStateRunning_mapeaAStreaming', () => {
    expect(reduceEvent(state(), TAB, { kind: 'session_state', state: 'running' }).statusByChat?.[TAB]).toBe(
      'streaming',
    );
  });

  it('reduceEvent_sessionStateRequiresAction_mapeaANeedsPermission', () => {
    expect(
      reduceEvent(state(), TAB, { kind: 'session_state', state: 'requires_action' }).statusByChat?.[TAB],
    ).toBe('needs_permission');
  });

  it('reduceEvent_compacted_pintaElMarcador', () => {
    const patch = reduceEvent(state(), TAB, { kind: 'compacted', trigger: 'auto' });

    expect(blocksOf(patch).at(-1)).toMatchObject({ kind: 'system' });
  });

  it('reduceEvent_permissionModeDesconocido_seEnsenaSinCoaccionar', () => {
    // P-026 2.3: la pestaña dice el modo en el que ESTA el CLI, aunque Mage no lo ofrezca en el ciclo.
    const current = state({ tabs: [{ id: TAB, permissionMode: 'plan' }] } as unknown as Partial<WorkbenchState>);

    const patch = reduceEvent(current, TAB, { kind: 'permission_mode', mode: 'dontAsk' });

    expect(patch.tabs?.[0]?.permissionMode).toBe('dontAsk');
  });

  it('reduceEvent_permissionModeAuto_loAdopta', () => {
    const current = state({ tabs: [{ id: TAB }] } as unknown as Partial<WorkbenchState>);

    expect(reduceEvent(current, TAB, { kind: 'permission_mode', mode: 'auto' }).tabs?.[0]?.permissionMode).toBe('auto');
  });
});

// Uso real en el terminador del turno (E3, `agy`): se deja como marcador de sistema en la conversacion.
describe('reduceEvent — uso del turno (E3)', () => {
  const RESULT_BASE = { isError: false, subtype: 'success', numTurns: 1 };

  it('reduceEvent_resultConUsage_dejaUnMarcadorDeSistemaConLosTokens', () => {
    const event: MageEvent = {
      kind: 'result',
      result: {
        ...RESULT_BASE,
        usage: { inputTokens: 17533, outputTokens: 7, totalTokens: 17540, thinkingTokens: 112, cacheReadTokens: 24410 },
      },
    };

    const patch = reduceEvent(state(), TAB, event);
    const blocks = blocksOf(patch);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'system' });
    expect((blocks[0] as Extract<Block, { kind: 'system' }>).text).toContain('Tokens del turno');
    expect(patch.statusByChat?.[TAB]).toBe('idle');
  });

  // El CLI de Claude no reporta uso en su `result`: su conversacion no debe ganar ningun marcador.
  it('reduceEvent_resultSinUsage_noAnadeNingunBloque', () => {
    const patch = reduceEvent(state(), TAB, { kind: 'result', result: RESULT_BASE });

    expect(blocksOf(patch)).toEqual([]);
    expect(patch.statusByChat?.[TAB]).toBe('idle');
  });
});

// H4: el limite de uso no puede quedarse en una linea tenue del hilo. Ademas de contarlo, MARCA la
// pestana, y esa marca es lo que enciende la oferta de continuar en otra cuenta.
describe('reduceEvent — limite de uso (H4)', () => {
  it('reduceEvent_rateLimit_marcaLaPestanaYAdemasLoCuentaEnElHilo', () => {
    const patch = reduceEvent(state(), TAB, { kind: 'rate_limit', summary: "You've hit your limit", resetsAtMs: null });

    expect(patch.rateLimitByChat?.[TAB]).toEqual({ summary: "You've hit your limit", resetsAtMs: null });
    expect(blocksOf(patch)).toHaveLength(1);
  });

  it('reduceEvent_rateLimitSinTexto_marcaIgual', () => {
    // Sin resumen el CLI sigue estando limitado: la salida tiene que ofrecerse igual (el banner pone
    // su propio texto). Marcar solo cuando hay texto seria perder el caso justo por el borde.
    const patch = reduceEvent(state(), TAB, { kind: 'rate_limit', summary: '   ', resetsAtMs: null });

    expect(patch.rateLimitByChat?.[TAB]).toEqual({ summary: '', resetsAtMs: null });
  });

  it('reduceEvent_dosRateLimitMismoTurno_unaSolaLinea', () => {
    // Arrange: el `rate_limit_event` rechazado (hora, sin texto) y luego el `assistant` con error
    // (texto, sin hora) del MISMO limite (P-028, 20).
    const resetsAtMs = new Date(2026, 8, 29, 15, 0).getTime();
    const first = reduceEvent(state(), TAB, { kind: 'rate_limit', summary: '', resetsAtMs });
    const between = state({ rateLimitByChat: first.rateLimitByChat, blocksByChat: first.blocksByChat });

    // Act
    const second = reduceEvent(between, TAB, { kind: 'rate_limit', summary: "You've hit your session limit · resets 3pm", resetsAtMs: null });

    // Assert: una sola linea, en castellano con la hora, y el texto del CLI en el tooltip.
    const blocks = blocksOf(second);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'system', tip: "You've hit your session limit · resets 3pm" });
    expect((blocks[0] as { text: string }).text).toMatch(/^Límite de uso alcanzado · se restablece a las /);
    expect(second.rateLimitByChat?.[TAB]).toEqual({ summary: "You've hit your session limit · resets 3pm", resetsAtMs });
  });

  it('reduceEvent_rateLimit_noPisaLaMarcaDeOtraPestana', () => {
    const previo = { rateLimitByChat: { otra: { summary: 'antes', resetsAtMs: null } } };
    const patch = reduceEvent(state(previo), TAB, { kind: 'rate_limit', summary: 'ahora', resetsAtMs: 5 });

    expect(patch.rateLimitByChat?.otra).toEqual({ summary: 'antes', resetsAtMs: null });
    expect(patch.rateLimitByChat?.[TAB]).toEqual({ summary: 'ahora', resetsAtMs: 5 });
  });
});

// P-026 2.4: el catalogo de la sesion viva se guarda por config dir EFECTIVO (el perfil privado tiene
// el suyo) y manda sobre la cache.
describe('reduceEvent — catalogo de modelos', () => {
  const MODELS = [{ id: 'opus', label: 'Opus 5.5' }];

  it('reduceEvent_modelsAvailable_loGuardaPorLaCuenta', () => {
    const current = state({ tabs: [{ id: TAB, accountId: '/home/u/.claude' }] } as unknown as Partial<WorkbenchState>);

    expect(reduceEvent(current, TAB, { kind: 'models_available', models: MODELS }).modelCatalogByAccount).toEqual({ '/home/u/.claude': MODELS });
  });

  it('reduceEvent_modelsAvailableEnConversacionPrivada_usaElConfigDirEfectivo', () => {
    const current = state({
      tabs: [{ id: TAB, accountId: '/home/u/.claude', resolvedConfigDir: '/home/u/.claude/mage-private' }],
    } as unknown as Partial<WorkbenchState>);

    expect(Object.keys(reduceEvent(current, TAB, { kind: 'models_available', models: MODELS }).modelCatalogByAccount ?? {})).toEqual([
      '/home/u/.claude/mage-private',
    ]);
  });
});

describe('reduceEvent — subagentes en segundo plano (P-028 37a/37c)', () => {
  const sub: Block = { kind: 'subagent', id: 's', toolUseId: 'tu1', agentType: 'general-purpose', description: 'A', agentId: 'ab25', status: 'completado', elapsedMs: 10, tokens: 5, toolUses: 0, model: null };

  it('reduceEvent_subagentUpdate_actualizaElBloque', () => {
    const patch = reduceEvent(state({ blocksByChat: { [TAB]: [sub] } }), TAB, { kind: 'subagent_update', toolUseId: 'tu1', status: 'running', tokens: 99, toolUses: 1, durationMs: 3 });

    expect(blocksOf(patch)[0]).toMatchObject({ status: 'en segundo plano', tokens: 99, toolUses: 1 });
  });

  it('reduceEvent_subagentOcultoQueSeReanuda_vuelveAlDock', () => {
    const base = state({ blocksByChat: { [TAB]: [sub] }, dismissedSubagentsByChat: { [TAB]: ['tu1', 'otro'] } });

    const patch = reduceEvent(base, TAB, { kind: 'subagent_update', toolUseId: 'tu1', status: 'running', tokens: null, toolUses: null, durationMs: null });

    expect(patch.dismissedSubagentsByChat?.[TAB]).toEqual(['otro']);
  });

  it('reduceEvent_requestStartedConElTurnoEnMarcha_noCambiaNada', () => {
    const patch = reduceEvent(state({ statusByChat: { [TAB]: 'streaming' } }), TAB, { kind: 'request_started' });

    expect(patch).toEqual({});
  });

  it('reduceEvent_requestStartedConLaPestanaParada_abreTurno', () => {
    // El turno que abre el CLI solo al terminar un subagente en segundo plano.
    const patch = reduceEvent(state({ statusByChat: { [TAB]: 'idle' } }), TAB, { kind: 'request_started' });

    expect(patch.statusByChat?.[TAB]).toBe('streaming');
    expect(patch.blocksByChat).toBeUndefined();
  });

  it('reduceEvent_subagentUpdateSinBloque_noCambiaNada', () => {
    const patch = reduceEvent(state({ blocksByChat: { [TAB]: [sub] } }), TAB, { kind: 'subagent_update', toolUseId: 'nadie', status: 'completed', tokens: null, toolUses: null, durationMs: null });

    expect(patch).toEqual({});
  });
});

// P-028 (grupo C): comandos locales y `/clear`.
describe('reduceEvent — comandos locales', () => {
  it('reduceEvent_localCommandOutput_añadeBloque', () => {
    const patch = reduceEvent(state(), TAB, { kind: 'local_command_output', command: 'context', args: '', text: '| a |\n|---|' });

    expect(blocksOf(patch)).toEqual([expect.objectContaining({ kind: 'command-output', command: 'context', text: '| a |\n|---|' })]);
  });

  it('reduceEvent_localCommandOutputVacio_noAñadeNada', () => {
    const patch = reduceEvent(state(), TAB, { kind: 'local_command_output', command: 'clear', args: '', text: '  ' });

    expect(blocksOf(patch)).toEqual([]);
  });

  it('reduceEvent_conversationReset_vaciaElChatYAdoptaElIdNuevo', () => {
    const current = state({
      blocksByChat: { [TAB]: [{ kind: 'system', id: 'viejo', text: 'antes' }] },
      sessionIdByChat: { [TAB]: 'viejo-id' },
      contextUsageByChat: { [TAB]: { totalTokens: 1, maxTokens: 2, percentage: 50, categories: [] } },
      tabs: [tab({ resumeSessionId: 'viejo-id' })],
    });

    const patch = reduceEvent(current, TAB, { kind: 'conversation_reset', newSessionId: 'nuevo-id' });

    expect(blocksOf(patch)).toEqual([expect.objectContaining({ kind: 'system', text: 'Conversación reiniciada' })]);
    expect(patch.sessionIdByChat?.[TAB]).toBe('nuevo-id');
    expect(patch.contextUsageByChat?.[TAB]).toBeUndefined();
    expect(patch.tabs?.[0]?.resumeSessionId).toBe('nuevo-id');
  });

  it('reduceEvent_conversationResetSinResume_noInventaResumeSessionId', () => {
    const patch = reduceEvent(state({ sessionIdByChat: { [TAB]: 'a' }, tabs: [tab()] }), TAB, { kind: 'conversation_reset', newSessionId: 'b' });

    expect(patch.tabs?.[0]?.resumeSessionId).toBeUndefined();
  });
});

describe('reduceEvent — elicitation MCP', () => {
  const request = { requestId: 'e1', server: 'srv', message: 'm', mode: 'form', schema: { type: 'object', properties: {} } } as const;
  const asked = (): WorkbenchState => ({ ...state({ elicitationsByChat: {}, statusByChat: { [TAB]: 'streaming' } }), ...reduceEvent(state({ elicitationsByChat: {}, statusByChat: { [TAB]: 'streaming' } }), TAB, { kind: 'elicitation_request', request }) }) as WorkbenchState;

  it('reduceEvent_elicitationRequest_quedaPendienteYPideAtencion', () => {
    const next = asked();

    expect(next.elicitationsByChat[TAB]).toEqual([{ request, state: 'pending' }]);
    expect(next.statusByChat[TAB]).toBe('needs_permission');
  });

  it('reduceEvent_elicitationRequestRepetida_noDuplica', () => {
    const again = reduceEvent(asked(), TAB, { kind: 'elicitation_request', request });

    expect(again).toEqual({});
  });

  it('reduceEvent_elicitationResolved_cierraYVuelveAStreaming', () => {
    const patch = reduceEvent(asked(), TAB, { kind: 'elicitation_resolved', requestId: 'e1', action: 'decline' });

    expect(patch.elicitationsByChat?.[TAB]?.[0]?.state).toBe('decline');
    expect(patch.statusByChat?.[TAB]).toBe('streaming');
  });

  it('reduceEvent_elicitationCancelledYaResuelta_noHaceNada', () => {
    const resolved = { ...asked(), ...reduceEvent(asked(), TAB, { kind: 'elicitation_cancelled', requestId: 'e1' }) } as WorkbenchState;

    expect(reduceEvent(resolved, TAB, { kind: 'elicitation_cancelled', requestId: 'e1' })).toEqual({});
  });
});

describe('reduceEvent — hilo de Codex', () => {
  const init = { kind: 'session_init', sessionId: 'hilo-1', model: 'm', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [] } as unknown as MageEvent;

  it('reduceEvent_sessionInitDeCodex_guardaElHiloComoResumeSessionId', () => {
    const patch = reduceEvent(state({ tabs: [tab({ provider: 'codex' })] }), TAB, init);

    expect(patch.tabs?.[0]?.resumeSessionId).toBe('hilo-1');
  });

  it('reduceEvent_sessionInitDeAgy_guardaSuConversacion', () => {
    expect(reduceEvent(state({ tabs: [tab({ provider: 'agy' })] }), TAB, init).tabs?.[0]?.resumeSessionId).toBe('hilo-1');
  });

  it('reduceEvent_sessionInitDeClaudeOHiloYaConocido_noTocaLaPestana', () => {
    expect(reduceEvent(state({ tabs: [tab({ provider: 'claude' })] }), TAB, init).tabs).toBeUndefined();
    expect(reduceEvent(state({ tabs: [tab({ provider: 'codex', resumeSessionId: 'otro' })] }), TAB, init).tabs).toBeUndefined();
  });
});

describe('reduceEvent — uso acumulado de Codex y agy', () => {
  const result = (usage: Record<string, number | null>): MageEvent => ({ kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1, usage: { thinkingTokens: 0, ...usage } } }) as unknown as MageEvent;

  it('reduceEvent_resultConUsoEnPestanaDeCodex_acumulaElUso', () => {
    const base = state({ tabs: [tab({ provider: 'codex' })] });
    const first = { ...base, ...reduceEvent(base, TAB, result({ inputTokens: 100, outputTokens: 10, totalTokens: 110, cacheReadTokens: 40 })) } as WorkbenchState;
    const second = reduceEvent(first, TAB, result({ inputTokens: 200, outputTokens: 20, totalTokens: 220, cacheReadTokens: 150 }));

    expect(second.providerUsageByChat?.[TAB]).toMatchObject({ turns: 2, inputTokens: 300, cachedTokens: 190, outputTokens: 30, lastInputTokens: 200 });
  });

  it('reduceEvent_resultEnPestanaDeClaude_noAcumulaPorqueLeeSuTranscripcion', () => {
    const patch = reduceEvent(state({ tabs: [tab({ provider: 'claude' })] }), TAB, result({ inputTokens: 100, outputTokens: 10, totalTokens: 110, cacheReadTokens: 0 }));

    expect(patch.providerUsageByChat).toBeUndefined();
  });
});
