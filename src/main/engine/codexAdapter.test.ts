import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODEX_API_KEY_ENV, CodexAdapter } from './codexAdapter';
import type { LaunchParams } from './providerAdapter';

// Fixtures generados por `node spike/codex-spike.mjs --app-server` (codex-cli 0.144.4, sin cuenta,
// rutas anonimizadas). Lo que no esta en un fixture (un turno que responde de verdad) sale del esquema
// de `codex app-server generate-json-schema`: SIN VERIFICAR.
function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'codex', `${name}.json`), 'utf8')) as Record<string, unknown>;
}

const launch: LaunchParams = { sessionId: 's1', accountDir: '/home/u/.claude', model: 'gpt-5.6-sol', cwd: 'C:\\proyecto' };

type Rpc = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };

const codex = (): CodexAdapter => new CodexAdapter({ resolveBinary: () => 'codex' });

// Arranca el adapter y contesta al `initialize` con la respuesta medida. Devuelve lo que pidio despues.
function handshake(adapter: CodexAdapter, params: LaunchParams = launch): Rpc[] {
  adapter.buildSpawnPlan(params);
  const [init] = adapter.takeOutgoing() as Rpc[];
  adapter.normalize({ ...fixture('initialize'), id: init!.id });
  return adapter.takeOutgoing() as Rpc[];
}

// Contesta a la peticion `method` de la cola con `response` (cambiando el id por el de la peticion).
function answer(adapter: CodexAdapter, requests: readonly Rpc[], method: string, response: Record<string, unknown>): ReturnType<CodexAdapter['normalize']> {
  const request = requests.find((r) => r.method === method);
  if (request === undefined) throw new Error(`no se pidio ${method}`);
  return adapter.normalize({ ...response, id: request.id });
}

const notification = (method: string, params: Record<string, unknown>): unknown => ({ jsonrpc: '2.0', method, params });

describe('CodexAdapter: arranque (codex app-server, sin verificar)', () => {
  it('enviaReglasDelProyectoEnLasInstruccionesDeDesarrollo', () => {
    const adapter = codex();
    const requests = handshake(adapter, { ...launch, projectInstructions: 'Eres experto en Python' });
    expect(requests.find((request) => request.method === 'thread/start')?.params?.developerInstructions).toContain('Eres experto en Python');
  });
  it('buildSpawnPlan_perfilesDePermiso_habilitaApiExperimentalAntesDeAbrirHilo', () => {
    const adapter = codex();
    adapter.buildSpawnPlan({ ...launch, permissionMode: ':read-only' });
    expect(adapter.takeOutgoing()).toEqual([expect.objectContaining({
      method: 'initialize', params: expect.objectContaining({ capabilities: { experimentalApi: true } }),
    })]);
  });

  it('buildSpawnPlan_suscripcionPorDefecto_appServerSinCodexHomeNiClaves', () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-del-usuario';
    try {
      const plan = new CodexAdapter({ resolveBinary: () => 'codex.exe' }).buildSpawnPlan(launch);

      expect(plan.command).toBe('codex.exe');
      expect(plan.args[0]).toBe('app-server');
      expect(plan.env.CODEX_HOME).toBeUndefined();
      expect(plan.env.OPENAI_API_KEY).toBeUndefined();
      expect(plan.env[CODEX_API_KEY_ENV]).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  // Medido: el app-server no lee CODEX_API_KEY del entorno; un proveedor con env_key si.
  it('buildSpawnPlan_cuentaDeApi_proveedorConEnvKeySuClaveYSuCodexHome', () => {
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex.exe', resolveAccount: () => ({ home: 'C:\\Users\\u\\.codex-api', apiKey: 'sk-cuenta' }) });

    const plan = adapter.buildSpawnPlan(launch);

    expect(plan.env.CODEX_HOME).toBe('C:\\Users\\u\\.codex-api');
    expect(plan.env[CODEX_API_KEY_ENV]).toBe('sk-cuenta');
    expect(plan.args.join(' ')).toContain(`env_key="${CODEX_API_KEY_ENV}"`);
    expect(plan.args).toContain('model_provider="mage-openai"');
    expect(plan.args.join(' ')).not.toContain('sk-cuenta');
  });

  it('buildSpawnPlan_siempre_encolaInitializeConClientInfo', () => {
    const adapter = codex();
    adapter.buildSpawnPlan(launch);

    const [init] = adapter.takeOutgoing() as Rpc[];
    expect(init).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'mage' } } });
  });

  it('normalize_respuestaAInitialize_mandaInitializedThreadStartYCatalogo', () => {
    const requests = handshake(codex());

    expect(requests.map((r) => r.method)).toEqual(['initialized', 'thread/start', 'model/list', 'account/rateLimits/read']);
    expect(requests[1]?.params).toMatchObject({ cwd: 'C:\\proyecto', model: 'gpt-5.6-sol', approvalPolicy: 'on-request' });
  });

  it('normalize_relanzadoConConversationId_pideThreadResume', () => {
    const requests = handshake(codex(), { ...launch, resume: true, conversationId: 'thread-9' });

    expect(requests.find((r) => r.method === 'thread/resume')?.params).toMatchObject({ threadId: 'thread-9' });
  });

  it('encodeUserMessage_antesDelHilo_esperaYSaleComoTurnStartConElHilo', () => {
    const adapter = codex();
    const requests = handshake(adapter);

    expect(adapter.encodeUserMessage('hola')).toBeNull();
    expect(adapter.takeOutgoing()).toEqual([]);
    const events = answer(adapter, requests, 'thread/start', fixture('thread-start'));

    const threadId = (fixture('thread-start').result as { thread: { id: string } }).thread.id;
    expect(events[0]).toMatchObject({ kind: 'session_init', sessionId: threadId, model: 'gpt-5.6-sol' });
    const [turn] = adapter.takeOutgoing() as Rpc[];
    expect(turn).toMatchObject({ method: 'turn/start', params: { threadId, input: [{ type: 'text', text: 'hola', text_elements: [] }] } });
  });

  it('normalize_modelList_emiteElCatalogoSinOcultos', () => {
    const adapter = codex();
    const events = answer(adapter, handshake(adapter), 'model/list', fixture('model-list'));

    const models = (events[0] as unknown as { models: { id: string }[] }).models.map((m) => m.id);
    expect(events[0]?.kind).toBe('models_available');
    expect(models).toContain('gpt-5.6-sol');
  });

  // Medido sin cuenta: «authentication required». Es telemetria: no ensucia la conversacion.
  it('normalize_rateLimitsSinCuenta_noEmiteError', () => {
    const adapter = codex();
    expect(answer(adapter, handshake(adapter), 'account/rateLimits/read', fixture('rate-limits-read'))).toEqual([]);
  });

  it('normalize_rateLimitsConVentanas_usageLimitsDe5hY7d', () => {
    const adapter = codex();
    const events = answer(adapter, handshake(adapter), 'account/rateLimits/read', {
      result: { rateLimits: { primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_790_000_000 }, secondary: { usedPercent: 7, windowDurationMins: 10_080 } } },
    });

    expect(events).toEqual([{ kind: 'usage_limits', fiveHour: { utilization: 42, resetsAt: 1_790_000_000_000 }, sevenDay: { utilization: 7, resetsAt: null } }]);
  });
});

describe('CodexAdapter: turno', () => {
  it('normalize_contenidoMcpConClaveConocida_ocultaElValorEnTodoElEvento', () => {
    const key = 'clave-artificial-de-regresion';
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex', resolveAccount: () => ({ home: 'h', apiKey: key }) });
    adapter.buildSpawnPlan(launch);
    const raw = notification('item/completed', { item: { id: 'm', type: 'mcpToolCall', server: 's', tool: 't',
      status: 'completed', result: { content: [{ type: 'text', text: `respuesta ${key}` }] },
    } });

    const serialized = JSON.stringify(adapter.normalize(raw));

    expect(serialized.includes(key)).toBe(false);
    expect(serialized).toContain('[clave oculta]');
  });

  it('normalize_errorMcpConCredencial_excluyeMensajeCrudo', () => {
    const adapter = codex();
    const raw = notification('item/completed', { item: {
      type: 'mcpToolCall', id: 'm', status: 'failed', server: 's', tool: 't', error: { message: 'detalle privado artificial' },
    } });

    const events = adapter.normalize(raw);

    expect(events).toMatchObject([{ result: { isError: true, output: 'La llamada MCP de Codex falló.' } }]);
  });

  it('encodeUserMessage_esfuerzoBajo_enviaLowEnTurnStart', () => {
    const adapter = codex();
    const requests = handshake(adapter, { ...launch, effort: 'low' });
    answer(adapter, requests, 'thread/start', fixture('thread-start'));

    adapter.encodeUserMessage('hola');

    expect((adapter.takeOutgoing() as Rpc[])[0]?.params?.effort).toBe('low');
    expect(requests.find((r) => r.method === 'thread/start')?.params?.effort).toBeUndefined();
  });

  it.each([undefined, ''])('encodeUserMessage_sinEsfuerzoConservaElDelCli_%s', (effort) => {
    const adapter = codex();
    const requests = handshake(adapter, { ...launch, effort });
    answer(adapter, requests, 'thread/start', fixture('thread-start'));

    adapter.encodeUserMessage('hola');

    expect((adapter.takeOutgoing() as Rpc[])[0]?.params).not.toHaveProperty('effort');
  });

  // Secuencia medida de un turno sin credencial: errores con willRetry (no se pintan) y el turno
  // interrumpido termina con su `result`.
  it('normalize_turnoMedidoInterrumpido_soloElResultInterrupted', () => {
    const adapter = codex();
    answer(adapter, handshake(adapter), 'thread/start', fixture('thread-start'));
    const notifications = fixture('turn-notifications') as unknown as Record<string, unknown>[];

    const events = notifications.flatMap((n) => adapter.normalize(n));

    expect(events).toEqual([{ kind: 'result', result: { isError: false, subtype: 'interrupted', numTurns: null } }]);
  });

  it('encodeInterrupt_conTurnoEnCurso_pideTurnInterrupt', () => {
    const adapter = codex();
    answer(adapter, handshake(adapter), 'thread/start', fixture('thread-start'));
    adapter.encodeUserMessage('hola');
    const [turnStart] = adapter.takeOutgoing() as Rpc[];
    adapter.normalize({ ...fixture('turn-start'), id: turnStart!.id });

    const turnId = (fixture('turn-start').result as { turn: { id: string } }).turn.id;
    expect(adapter.encodeInterrupt()).toMatchObject({ method: 'turn/interrupt', params: { turnId } });
  });

  it('encodeInterrupt_sinTurno_null', () => {
    expect(codex().encodeInterrupt()).toBeNull();
  });

  it('normalize_turnoCompletoDelEsquema_deltaToolsUsoYResult', () => {
    const adapter = codex();
    const command = { id: 'c1', type: 'commandExecution', command: 'ls', cwd: 'C:\\p', commandActions: [] };
    const events = [
      notification('item/agentMessage/delta', { delta: 'Hola', itemId: 'm', threadId: 't', turnId: 'u' }),
      notification('item/started', { item: { ...command, status: 'inProgress' }, threadId: 't', turnId: 'u', startedAtMs: 1 }),
      notification('item/completed', { item: { ...command, status: 'completed', exitCode: 0, aggregatedOutput: 'a.txt' }, threadId: 't', turnId: 'u', completedAtMs: 2 }),
      notification('thread/tokenUsage/updated', {
        threadId: 't',
        turnId: 'u',
        tokenUsage: { last: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 12 }, total: {} },
      }),
      notification('turn/completed', { threadId: 't', turn: { id: 'u', items: [], status: 'completed', error: null } }),
    ].flatMap((raw) => adapter.normalize(raw));

    expect(events.map((e) => e.kind)).toEqual(['stream_delta', 'tool_use', 'tool_result', 'result']);
    expect(events[2]).toMatchObject({ result: { toolUseId: 'c1', isError: false, output: 'a.txt' } });
    expect(events[3]).toMatchObject({ result: { usage: { inputTokens: 10, outputTokens: 2, thinkingTokens: 1, cacheReadTokens: 4 } } });
  });

  it('normalize_turnoFallido_errorVisibleYResultDeError', () => {
    const events = codex().normalize(notification('turn/completed', { threadId: 't', turn: { id: 'u', items: [], status: 'failed', error: { message: 'cuota' } } }));

    expect(events[0]).toMatchObject({ kind: 'error', message: expect.stringContaining('cuota') as unknown as string });
    expect(events[1]).toMatchObject({ kind: 'result', result: { isError: true, subtype: 'failed' } });
  });

  it('normalize_mcpMedido0160_conservaContenidoTextualDelResultado', () => {
    const raw = notification('item/completed', { threadId: 't', turnId: 'u', item: fixture('real-mcp-0160') });
    expect(codex().normalize(raw)).toMatchObject([{ kind: 'tool_result', result: {
      toolUseId: 'mcp-measured', isError: false, output: 'MAGE_MCP_ENV_OK',
    } }]);
  });

  it('normalize_mcpFallido_muestraErrorYOmiteContenidoBinario', () => {
    const events = codex().normalize(notification('item/completed', { item: {
      type: 'mcpToolCall', id: 'm', server: 's', tool: 't', status: 'failed', result: null, error: { message: 'rechazado' },
    } }));

    expect(events).toMatchObject([{ result: { isError: true, output: 'La llamada MCP de Codex falló.' } }]);
  });

  it('normalize_mcpConImagenYTextos_omiteBinarioYConservaTextos', () => {
    const events = codex().normalize(notification('item/completed', { item: {
      type: 'mcpToolCall', id: 'm', server: 's', tool: 't', status: 'completed',
      result: { content: [{ type: 'image', data: 'binario' }, { type: 'text', text: 'uno' }, null, { type: 'text', text: 'dos' }] },
    } }));

    expect(events).toMatchObject([{ result: { output: 'uno\ndos' } }]);
  });

  it('normalize_errorDefinitivoConLaClaveDentro_laOculta', () => {
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex', resolveAccount: () => ({ home: 'h', apiKey: 'sk-mage-spike-falsa' }) });
    adapter.buildSpawnPlan(launch);

    const events = adapter.normalize(
      notification('error', { willRetry: false, error: { message: 'unauthorized', additionalDetails: 'Incorrect API key provided: sk-mage-spike-falsa.' }, threadId: 't', turnId: 'u' }),
    );

    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('sk-mage-spike-falsa');
  });

  it('encodeSetModelYPermisos_aplicanAlSiguienteTurno', () => {
    const adapter = codex();
    answer(adapter, handshake(adapter), 'thread/start', fixture('thread-start'));

    expect(adapter.encodeSetModel('gpt-5.5')).toBeNull();
    expect(adapter.encodeSetPermissionMode(':workspace')).toBeNull();
    adapter.encodeUserMessage('hola');

    expect((adapter.takeOutgoing() as Rpc[])[0]?.params).toMatchObject({ model: 'gpt-5.5', permissions: ':workspace' });
  });

  it('encodeSetPermissionMode_presetAuto_aplicaPerfilYPoliticaEnElTurno', () => {
    const adapter = codex();
    answer(adapter, handshake(adapter), 'thread/start', fixture('thread-start'));

    adapter.encodeSetPermissionMode(':workspace|never');
    adapter.encodeUserMessage('hola');

    expect((adapter.takeOutgoing() as Rpc[])[0]?.params).toMatchObject({ permissions: ':workspace', approvalPolicy: 'never' });
  });

  it('encodeSetEffort_sesionViva_aplicaAlSiguienteTurno', () => {
    const adapter = codex();
    answer(adapter, handshake(adapter), 'thread/start', fixture('thread-start'));

    expect(adapter.encodeSetEffort('ultra')).toBeNull();
    adapter.encodeUserMessage('hola');

    expect((adapter.takeOutgoing() as Rpc[])[0]?.params).toMatchObject({ effort: 'ultra' });
    expect(() => adapter.encodeSetEffort('imposible')).toThrow(/imposible/);
  });
});

describe('CodexAdapter: aprobaciones (forma del esquema)', () => {
  it('normalize_aprobacionDeEdicionMedida_incluyeDiffDelItemPendiente', () => {
    const adapter = codex();
    const changes = fixture('real-file-change-0160').changes;
    adapter.normalize(notification('item/started', { item: { type: 'fileChange', id: 'edit-1', status: 'inProgress', changes } }));
    const approval = { id: 9, method: 'item/fileChange/requestApproval', params: { itemId: 'edit-1', threadId: 't', turnId: 'u', grantRoot: null } };
    const events = adapter.normalize(approval);

    expect(events).toMatchObject([{ request: { input: { changes } } }]);
  });

  it('normalize_edicionCompletada_limpiaElDiffPendiente', () => {
    const adapter = codex();
    const changes = fixture('real-file-change-0160').changes;
    adapter.normalize(notification('item/started', { item: { type: 'fileChange', id: 'edit-1', status: 'inProgress', changes } }));
    adapter.normalize(notification('item/completed', { item: { type: 'fileChange', id: 'edit-1', status: 'completed', changes } }));
    const approval = { id: 10, method: 'item/fileChange/requestApproval', params: { itemId: 'edit-1', threadId: 't', turnId: 'u', grantRoot: null } };

    const events = adapter.normalize(approval);

    expect(events).toMatchObject([{ request: { input: { grantRoot: null } } }]);
    expect(JSON.stringify(events)).not.toContain('MAGE_EDIT_OK');
  });

  it('normalize_peticionDeAprobacionDeComando_permissionRequestYRespuestaAccept', () => {
    const adapter = codex();
    const events = adapter.normalize({
      jsonrpc: '2.0',
      id: 7,
      method: 'item/commandExecution/requestApproval',
      params: { itemId: 'item-1', threadId: 't', turnId: 'u', startedAtMs: 1, command: 'git push', cwd: 'C:\\proyecto', reason: 'red' },
    });

    expect(events[0]).toMatchObject({ kind: 'permission_request', request: { requestId: 'codex-7', toolUseId: 'item-1', toolName: 'Bash', input: { command: 'git push' } } });
    expect(adapter.encodePermissionResponse({ requestId: 'codex-7', toolUseId: 'item-1' }, { behavior: 'allow' })).toEqual({ jsonrpc: '2.0', id: 7, result: { decision: 'accept' } });
  });

  it('encodePermissionResponse_denegar_decline', () => {
    const adapter = codex();
    adapter.normalize({ jsonrpc: '2.0', id: 'x', method: 'item/fileChange/requestApproval', params: { itemId: 'i', threadId: 't', turnId: 'u', startedAtMs: 1 } });

    expect(adapter.encodePermissionResponse({ requestId: 'codex-x', toolUseId: 'i' }, { behavior: 'deny', message: 'no' })).toEqual({ jsonrpc: '2.0', id: 'x', result: { decision: 'decline' } });
  });

  it('encodePermissionResponse_desconocida_lanzaConElId', () => {
    expect(() => codex().encodePermissionResponse({ requestId: 'codex-99', toolUseId: 'i' }, { behavior: 'allow' })).toThrow(/codex-99/);
  });

  it('normalize_peticionQueMageNoImplementa_contestaConError', () => {
    const adapter = codex();

    expect(adapter.normalize({ jsonrpc: '2.0', id: 3, method: 'item/tool/requestUserInput', params: {} })).toEqual([]);
    expect(adapter.takeOutgoing()).toEqual([{ jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'Mage no implementa item/tool/requestUserInput' } }]);
  });

  it('normalize_serverRequestResolved_cancelaLaTarjeta', () => {
    const adapter = codex();
    adapter.normalize({ jsonrpc: '2.0', id: 4, method: 'item/fileChange/requestApproval', params: { itemId: 'i', threadId: 't', turnId: 'u', startedAtMs: 1 } });

    expect(adapter.normalize(notification('serverRequest/resolved', { requestId: 4, threadId: 't' }))).toEqual([{ kind: 'permission_cancelled', requestId: 'codex-4' }]);
  });
});

// Puente de instrucciones (grupo H), medido con `spike/codex-spike.mjs --instructions`.
describe('CodexAdapter: puente de instrucciones', () => {
  const PROJECT = { scope: 'project', path: 'C:\\proyecto\\CLAUDE.md', content: '# Proyecto' } as const;
  const USER = { scope: 'user', path: 'C:\\Users\\u\\.claude\\CLAUDE.md', content: '# Global' } as const;
  const FALLBACK = 'project_doc_fallback_filenames=["CLAUDE.md"]';

  it('buildSpawnPlan_claudeMdDelProyecto_pasaElFallbackDeCodex', () => {
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex', resolveInstructions: () => [PROJECT] });

    const plan = adapter.buildSpawnPlan(launch);

    expect(plan.args).toContain(FALLBACK);
  });

  it('buildSpawnPlan_sinNadaQuePuentear_niFallbackNiDeveloperInstructions', () => {
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex', resolveInstructions: () => [] });

    const requests = handshake(adapter);

    expect(requests.find((r) => r.method === 'thread/start')?.params?.developerInstructions).toBeUndefined();
    expect(adapter.buildSpawnPlan(launch).args).not.toContain(FALLBACK);
  });

  it('normalize_claudeMdGlobal_vaEnDeveloperInstructionsDelThreadStart', () => {
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex', resolveInstructions: () => [USER] });

    const requests = handshake(adapter);

    const instructions = requests.find((r) => r.method === 'thread/start')?.params?.developerInstructions;
    expect(instructions).toContain('# Global');
    expect(instructions).toContain(USER.path);
  });

  it('buildSpawnPlan_soloGlobal_noPasaElFallback', () => {
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex', resolveInstructions: () => [USER] });

    expect(adapter.buildSpawnPlan(launch).args).not.toContain(FALLBACK);
  });

  // Medido: en thread/resume el hilo conserva las del inicio y las nuevas se ignoran.
  it('normalize_relanzadoConConversationId_resumeSinDeveloperInstructions', () => {
    const adapter = new CodexAdapter({ resolveBinary: () => 'codex', resolveInstructions: () => [USER] });

    const requests = handshake(adapter, { ...launch, resume: true, conversationId: 'thread-9' });

    expect(requests.find((r) => r.method === 'thread/resume')?.params?.developerInstructions).toBeUndefined();
  });

  it('buildSpawnPlan_conYSinCuentaPropia_resuelveConSuCodexHomeONull', () => {
    const seen: (string | null)[] = [];
    const record = (_cwd: string, home: string | null): readonly [] => {
      seen.push(home);
      return [];
    };
    const withAccount = new CodexAdapter({ resolveBinary: () => 'codex', resolveAccount: () => ({ home: 'C:\\Users\\u\\.codex-b', apiKey: null }), resolveInstructions: record });

    withAccount.buildSpawnPlan(launch);
    new CodexAdapter({ resolveBinary: () => 'codex', resolveInstructions: record }).buildSpawnPlan(launch);

    expect(seen).toEqual(['C:\\Users\\u\\.codex-b', null]);
  });
});
