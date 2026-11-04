import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claudeAdapter';
import { normalizeRawEvent } from './normalize';

const launch = { sessionId: 's1', accountDir: '/home/u/.claude-p', model: 'haiku', cwd: '/proj' };

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter({ resolveBinary: () => 'claude' });

  it('aplicaReglasDelProyectoComoPromptDeSistemaAdicional', () => {
    const plan = adapter.buildSpawnPlan({ ...launch, projectInstructions: 'Eres experto en Python' });
    expect(plan.args.slice(plan.args.indexOf('--append-system-prompt'))).toContain('Eres experto en Python');
  });

  it('encodeUserMessage_text_returnsMinimalUserEnvelope', () => {
    expect(adapter.encodeUserMessage('hola')).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hola' },
      parent_tool_use_id: null,
    });
  });

  it('encodePermissionResponse_allow_returnsAllowWithEmptyUpdatedInput', () => {
    const result = adapter.encodePermissionResponse({ requestId: 'r1', toolUseId: 'u1' }, { behavior: 'allow' });

    expect(result).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput: {}, toolUseID: 'u1' } },
    });
  });

  it('encodeUserMessage_sinAdjuntos_mandaContentComoString', () => {
    // EL payload de siempre, byte a byte: la forma minima con `content` string esta validada por el
    // spike y no se rompe por añadir imagenes.
    expect(adapter.encodeUserMessage('hola', [])).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hola' },
      parent_tool_use_id: null,
    });
  });

  it('encodeUserMessage_conUnaImagen_mandaArrayDeBloquesConLaImagenDetrasDeSuToken', () => {
    const result = adapter.encodeUserMessage('mira [Imagen 1]', [{ mediaType: 'image/png', data: 'AAAA' }]);

    expect(result).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'mira [Imagen 1]' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        ],
      },
      parent_tool_use_id: null,
    });
  });

  it('encodeUserMessage_intercalado_cadaImagenDetrasDeSuToken', () => {
    // P-026 3.2, medido en S3: el CLI respeta [texto, img, texto, img] y el modelo sabe cual es cual.
    const result = adapter.encodeUserMessage('compara [Imagen 1] con [Imagen 2]', [
      { mediaType: 'image/png', data: 'AAAA' },
      { mediaType: 'image/png', data: 'BBBB' },
    ]) as { message: { content: readonly { type: string; text?: string }[] } };

    expect(result.message.content.map((b) => b.text ?? b.type)).toEqual(['compara [Imagen 1]', 'image', ' con [Imagen 2]', 'image']);
  });

  it('encodeUserMessage_conTextoVacioYUnaImagen_sinBloqueDeTextoVacio', () => {
    // Mandar solo un pantallazo es un caso real: no se cuela un bloque de texto VACIO (va con su etiqueta).
    const result = adapter.encodeUserMessage('', [{ mediaType: 'image/webp', data: 'BBBB' }]) as {
      message: { content: readonly { type: string; text?: string }[] };
    };

    expect(result.message.content).toEqual([
      { type: 'text', text: '[Imagen 1]' },
      { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'BBBB' } },
    ]);
  });

  it('encodeUserMessage_mediaTypeNoPermitido_lanza', () => {
    // Segunda validacion, la de verdad: esto es lo que llega por IPC.
    expect(() =>
      adapter.encodeUserMessage('x', [{ mediaType: 'image/svg+xml' as 'image/png', data: 'AAAA' }]),
    ).toThrow(/no admitido/i);
  });

  it('encodePermissionResponse_allowConUpdatedInput_loMandaTalCual', () => {
    // Es el canal por el que viajan las respuestas de AskUserQuestion (2.3): sin el, el CLI usa el
    // input original y el modelo recibe "no me han contestado".
    const updatedInput = { questions: [{ question: '¿Rojo o azul?' }], answers: { '¿Rojo o azul?': 'Rojo' } };

    const result = adapter.encodePermissionResponse({ requestId: 'r1', toolUseId: 'u1' }, { behavior: 'allow', updatedInput });

    expect(result).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput, toolUseID: 'u1' } },
    });
  });

  it('encodePermissionResponse_conservaToolUseIDConMayusculas', () => {
    // El campo del payload es `toolUseID` (D e ID en mayusculas): escribirlo `toolUseId` compila igual
    // y el CLI no lo reconoce.
    const result = adapter.encodePermissionResponse({ requestId: 'r1', toolUseId: 'u1' }, { behavior: 'allow' }) as {
      response: { response: Record<string, unknown> };
    };

    expect(Object.keys(result.response.response)).toContain('toolUseID');
    expect(Object.keys(result.response.response)).not.toContain('toolUseId');
  });

  it('encodePermissionResponse_deny_includesMessage', () => {
    const result = adapter.encodePermissionResponse(
      { requestId: 'r1', toolUseId: 'u1' },
      { behavior: 'deny', message: 'no' },
    );

    expect(result).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { behavior: 'deny', message: 'no', toolUseID: 'u1' } },
    });
  });

  describe('encodeSetModel', () => {
    it('encodeSetModel_modelo_devuelveControlRequestSetModel', () => {
      const result = adapter.encodeSetModel('opus') as {
        type: string;
        request_id: string;
        request: { subtype: string; model: string };
      };

      expect(result.type).toBe('control_request');
      expect(result.request_id.length).toBeGreaterThan(0);
      expect(result.request).toEqual({ subtype: 'set_model', model: 'opus' });
    });

    it('encodeSetModel_dosLlamadas_generanRequestIdsDistintos', () => {
      const first = adapter.encodeSetModel('opus') as { request_id: string };
      const second = adapter.encodeSetModel('haiku') as { request_id: string };

      expect(first.request_id).not.toBe(second.request_id);
    });

    it('encodeSetModel_modeloVacio_lanza', () => {
      expect(() => adapter.encodeSetModel('  ')).toThrow(/vacio/i);
    });
  });

  describe('encodeSetPermissionMode', () => {
    it('encodeSetPermissionMode_modo_devuelveControlRequest', () => {
      const result = adapter.encodeSetPermissionMode('plan') as {
        type: string;
        request_id: string;
        request: { subtype: string; mode: string };
      };

      expect(result.type).toBe('control_request');
      expect(result.request_id.length).toBeGreaterThan(0);
      expect(result.request).toEqual({ subtype: 'set_permission_mode', mode: 'plan' });
    });

    it('encodeSetPermissionMode_modoVacio_lanza', () => {
      expect(() => adapter.encodeSetPermissionMode('  ')).toThrow(/vacio/i);
    });
  });

  describe('encodeStopTask', () => {
    it('encodeStopTask_taskId_devuelveControlRequestStopTask', () => {
      const result = adapter.encodeStopTask('a19e1df9495a401ae') as { type: string; request_id: string; request: unknown };

      expect(result.type).toBe('control_request');
      expect(result.request_id.length).toBeGreaterThan(0);
      expect(result.request).toEqual({ subtype: 'stop_task', task_id: 'a19e1df9495a401ae' });
    });

    it('encodeStopTask_taskIdVacio_lanza', () => {
      expect(() => adapter.encodeStopTask(' ')).toThrow(/vacio/i);
    });
  });

  describe('buildSpawnPlan', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = 'sk-should-be-removed';
    });
    afterEach(() => {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    });

    it('buildSpawnPlan_child_stripsApiKeyAndSetsConfigDir', () => {
      const plan = adapter.buildSpawnPlan(launch);

      expect('ANTHROPIC_API_KEY' in plan.env).toBe(false);
      expect(plan.env.CLAUDE_CONFIG_DIR).toBe('/home/u/.claude-p');
    });

    it('buildSpawnPlan_mageCaller_setsEnvAfterScrub', () => {
      const inherited = process.env.MAGE_MCP_CALLER;
      process.env.MAGE_MCP_CALLER = 'heredada';
      try {
        const shared = { mcpServers: [], settingsFragment: null, claudeAiConnectors: true, mageCaller: { credential: 'c'.repeat(64), forwardToCodexMcp: false } };
        const plan = adapter.buildSpawnPlan({ ...launch, shared });

        expect(plan.env.MAGE_MCP_CALLER).toBe('c'.repeat(64));
      } finally {
        if (inherited === undefined) delete process.env.MAGE_MCP_CALLER;
        else process.env.MAGE_MCP_CALLER = inherited;
      }
    });

    it('buildSpawnPlan_noMageCaller_noVariable', () => {
      const inherited = process.env.MAGE_MCP_CALLER;
      process.env.MAGE_MCP_CALLER = 'heredada';
      try {
        expect('MAGE_MCP_CALLER' in adapter.buildSpawnPlan(launch).env).toBe(false);
      } finally {
        if (inherited === undefined) delete process.env.MAGE_MCP_CALLER;
        else process.env.MAGE_MCP_CALLER = inherited;
      }
    });

    // D5 (#53): Artifact es una opción del usuario, apagada por defecto. El ajuste manda sobre lo que el
    // usuario exportara en su entorno: apagado es `0` explícito (el CLI lo enciende con cualquier valor verdadero).
    const withExportedArtifact = (value: string | undefined, run: () => void): void => {
      const original = process.env.CLAUDE_CODE_ARTIFACT;
      if (value === undefined) delete process.env.CLAUDE_CODE_ARTIFACT;
      else process.env.CLAUDE_CODE_ARTIFACT = value;
      try { run(); } finally {
        if (original === undefined) delete process.env.CLAUDE_CODE_ARTIFACT;
        else process.env.CLAUDE_CODE_ARTIFACT = original;
      }
    };

    it('buildSpawnPlan_ajustePorDefecto_apagaArtifact', () => {
      withExportedArtifact(undefined, () => expect(adapter.buildSpawnPlan(launch).env.CLAUDE_CODE_ARTIFACT).toBe('0'));
    });

    it('buildSpawnPlan_ajusteApagadoYUsuarioExportaUno_sigueApagado', () => {
      withExportedArtifact('1', () => expect(adapter.buildSpawnPlan(launch).env.CLAUDE_CODE_ARTIFACT).toBe('0'));
    });

    it('buildSpawnPlan_ajusteEncendido_activaArtifact', () => {
      const enabled = new ClaudeAdapter({ resolveBinary: () => 'claude', artifactEnabled: () => true });

      withExportedArtifact('0', () => expect(enabled.buildSpawnPlan(launch).env.CLAUDE_CODE_ARTIFACT).toBe('1'));
    });

    it('buildSpawnPlan_testBaseUrlIgnored_logsReasonWithoutKey', () => {
      const logged: unknown[][] = [];
      const withKey = new ClaudeAdapter({
        resolveBinary: () => 'claude',
        resolveApiKey: () => 'sk-ant-secreta',
        testBaseUrl: () => 'http://127.0.0.1:4567',
        isPackaged: () => true,
        log: (...args) => logged.push(args),
      });

      const env = withKey.buildSpawnPlan(launch).env;

      expect(logged).toEqual([['warn', 'MAGE_TEST_ANTHROPIC_BASE_URL ignorada', { reason: 'packaged' }]]);
      expect(JSON.stringify(logged)).not.toContain('sk-ant-secreta');
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('buildSpawnPlan_args_includeSessionModelAndVerbose', () => {
      const plan = adapter.buildSpawnPlan(launch);

      expect(plan.command).toBe('claude');
      expect(plan.args).toContain('--verbose');
      expect(plan.args).toContain('stream-json');
      expect(plan.args.join(' ')).toContain('--session-id s1');
      expect(plan.args.join(' ')).toContain('--model haiku');
    });

    it('buildSpawnPlan_resume_usesResumeFlagInsteadOfSessionId', () => {
      const plan = adapter.buildSpawnPlan({ ...launch, resume: true });

      expect(plan.args.join(' ')).toContain('--resume s1');
      expect(plan.args).not.toContain('--session-id'); // mutuamente excluyentes
    });

    it('buildSpawnPlan_conEffort_anadeElFlag', () => {
      const plan = adapter.buildSpawnPlan({ ...launch, effort: 'high' });

      expect(plan.args.join(' ')).toContain('--effort high');
    });

    it('buildSpawnPlan_sinEffort_noAnadeElFlag', () => {
      const plan = adapter.buildSpawnPlan(launch);

      expect(plan.args).not.toContain('--effort');
    });

    it('buildSpawnPlan_conBudget_formateaCentavosADolares', () => {
      expect(adapter.buildSpawnPlan({ ...launch, maxBudgetUsdCents: 500 }).args.join(' ')).toContain('--max-budget-usd 5.00');
      expect(adapter.buildSpawnPlan({ ...launch, maxBudgetUsdCents: 1234 }).args.join(' ')).toContain('--max-budget-usd 12.34');
      expect(adapter.buildSpawnPlan({ ...launch, maxBudgetUsdCents: 5 }).args.join(' ')).toContain('--max-budget-usd 0.05');
    });

    it('buildSpawnPlan_conPermissionModeNoDefault_anadeElFlag', () => {
      expect(adapter.buildSpawnPlan({ ...launch, permissionMode: 'plan' }).args.join(' ')).toContain('--permission-mode plan');
    });

    it('buildSpawnPlan_permissionModeDefault_loPasaExplicito', () => {
      const args = adapter.buildSpawnPlan({ ...launch, permissionMode: 'default' }).args;
      expect(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'default']);
    });

    it('buildSpawnPlan_sinPermissionMode_noAnadeElFlag', () => {
      expect(adapter.buildSpawnPlan(launch).args).not.toContain('--permission-mode');
    });

    it('buildSpawnPlan_siempre_habilitaOmitirPermisos', () => {
      // Medido (2.1.283): sin este flag, `set_permission_mode bypassPermissions` falla.
      expect(adapter.buildSpawnPlan(launch).args).toContain('--allow-dangerously-skip-permissions');
    });

    it('buildSpawnPlan_sinBudget_noAnadeElFlag', () => {
      expect(adapter.buildSpawnPlan(launch).args).not.toContain('--max-budget-usd');
    });

    it('buildSpawnPlan_conCompartido_escribeElMcpConfigDeLaCuentaYLoAnadeAlFinal', () => {
      const written: [string, string][] = [];
      const withWriter = new ClaudeAdapter({
        resolveBinary: () => 'claude',
        writeMcpConfig: (accountDir, text) => {
          written.push([accountDir, text]);
          return '/gen/claude-p.mcp.json';
        },
      });
      const server = { name: 'db', source: 'common', onlyIn: null, extra: {}, secrets: {}, transport: 'stdio', command: 'db', args: [], env: { K: 'secreto' }, cwd: null } as const;
      const shared = { mcpServers: [server], settingsFragment: { hooks: {} }, claudeAiConnectors: true };

      const plan = withWriter.buildSpawnPlan({ ...launch, shared });

      expect(plan.args.slice(-4)).toEqual(['--mcp-config', '/gen/claude-p.mcp.json', '--settings', '{"hooks":{}}']);
      expect(written[0]![0]).toBe(launch.accountDir);
      // Ni en el fichero ni en la linea de comandos: el valor viaja en el entorno del hijo y el CLI
      // expande la referencia (medido en 2.1.286).
      expect(JSON.parse(written[0]![1]).mcpServers.db.env.K).toBe('${MAGE_MCP_SECRET_DB_ENV_K}');
      expect(written[0]![1]).not.toContain('secreto');
      expect(plan.args.join(' ')).not.toContain('secreto');
      expect(plan.env.MAGE_MCP_SECRET_DB_ENV_K).toBe('secreto');
      expect(plan.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined();
    });

    it('buildSpawnPlan_conectoresDeClaudeAiApagados_ponLaVariableEnFalse', () => {
      const shared = { mcpServers: [], settingsFragment: null, claudeAiConnectors: false };

      expect(adapter.buildSpawnPlan({ ...launch, shared }).env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false');
    });

    it('buildSpawnPlan_conServidoresSinEscritor_lanza', () => {
      const server = { name: 'db', source: 'common', onlyIn: null, extra: {}, secrets: {}, transport: 'stdio', command: 'db', args: [], env: {}, cwd: null } as const;

      expect(() => adapter.buildSpawnPlan({ ...launch, shared: { mcpServers: [server], settingsFragment: null, claudeAiConnectors: true } })).toThrow(/mcp-config/);
    });

    it('buildSpawnPlan_sinSharedConfigArgs_noAnadeNiMcpConfigNiSettings', () => {
      const plan = adapter.buildSpawnPlan(launch);

      expect(plan.args).not.toContain('--mcp-config');
      expect(plan.args).not.toContain('--settings');
    });
  });
});

describe('ClaudeAdapter: directo (F4.1)', () => {
  const U = '0b1c2d3e-4f50-4612-8a7b-9c0d1e2f3a4b';
  const RESULT = { type: 'result', subtype: 'success', num_turns: 1 };
  const lifecycle = (state: string, uuid = U) => ({ type: 'command_lifecycle', command_uuid: uuid, state });
  const fresh = () => new ClaudeAdapter({ resolveBinary: () => 'claude' });

  it('encodeSteer_uuidValido_escribeElMensajeDeUsuarioConEseUuid', () => {
    const adapter = fresh();

    const encoding = adapter.encodeSteer(U, 'hola');

    expect(encoding).toEqual({
      kind: 'write',
      payload: { type: 'user', message: { role: 'user', content: 'hola' }, parent_tool_use_id: null, uuid: U },
    });
  });

  it('encodeSteer_idQueNoEsUuid_lanzaConElValor', () => {
    const adapter = fresh();

    expect(() => adapter.encodeSteer('abc', 'hola')).toThrow('abc');
  });

  it('normalize_startedAntesDelResult_emiteActiveTurn', () => {
    const adapter = fresh();
    adapter.encodeSteer(U, 'x');

    const queued = adapter.normalize(lifecycle('queued'));
    const started = adapter.normalize(lifecycle('started'));

    expect(queued).toEqual([]);
    expect(started).toEqual([{ kind: 'steer_result', messageId: U, outcome: 'active_turn' }]);
  });

  it('normalize_startedTrasElResult_emiteNewTurn', () => {
    const adapter = fresh();
    adapter.encodeSteer(U, 'x');

    const afterResult = adapter.normalize(RESULT);
    const started = adapter.normalize(lifecycle('started'));

    expect(afterResult.some((event) => event.kind === 'steer_result')).toBe(false);
    expect(started).toEqual([{ kind: 'steer_result', messageId: U, outcome: 'new_turn' }]);
  });

  it('normalize_cancelled_emiteFailed', () => {
    const adapter = fresh();
    adapter.encodeSteer(U, 'x');

    const events = adapter.normalize(lifecycle('cancelled'));

    expect(events).toEqual([{ kind: 'steer_result', messageId: U, outcome: 'failed' }]);
  });

  it('normalize_segundoResultSinStarted_emiteNewTurnInferido', () => {
    const adapter = fresh();
    adapter.encodeSteer(U, 'x');

    adapter.normalize(RESULT);
    const second = adapter.normalize(RESULT);
    const late = adapter.normalize(lifecycle('started'));

    expect(second).toContainEqual({ kind: 'steer_result', messageId: U, outcome: 'new_turn', inferred: true });
    expect(late).toEqual([]);
  });

  it('normalize_startedRepetido_soloEmiteUnaVez', () => {
    const adapter = fresh();
    adapter.encodeSteer(U, 'x');

    const first = adapter.normalize(lifecycle('started'));
    const again = adapter.normalize(lifecycle('started'));

    expect(first).toHaveLength(1);
    expect(again).toEqual([]);
  });

  it('normalize_lifecycleDeUuidAjeno_noEmiteNada', () => {
    const adapter = fresh();

    expect(adapter.normalize(lifecycle('started'))).toEqual([]);
  });

  it('normalize_lifecycleSinCommandUuid_noEmiteNada', () => {
    const adapter = fresh();

    expect(adapter.normalize({ type: 'command_lifecycle', state: 'started' })).toEqual([]);
  });

  it('buildSpawnPlan_conDirectoEnVuelo_loOlvida', () => {
    const adapter = fresh();
    adapter.encodeSteer(U, 'x');

    adapter.buildSpawnPlan(launch);

    expect(adapter.normalize(lifecycle('started'))).toEqual([]);
  });

  it('normalize_resultSinDirectos_devuelveLoDeSiempre', () => {
    const adapter = fresh();

    expect(adapter.normalize(RESULT)).toEqual(normalizeRawEvent(RESULT));
  });
});

describe('ClaudeAdapter: id propio del mensaje (F4.4)', () => {
  const U = '0b1c2d3e-4f50-4612-8a7b-9c0d1e2f3a4b';
  const fresh = () => new ClaudeAdapter({ resolveBinary: () => 'claude' });

  it('encodeUserMessage_withUuidMessageId_addsUuid', () => {
    const payload = fresh().encodeUserMessage('hola', [], U);

    expect(payload).toEqual({ type: 'user', message: { role: 'user', content: 'hola' }, parent_tool_use_id: null, uuid: U });
  });

  it('encodeUserMessage_withNonUuidMessageId_throwsWithValue', () => {
    expect(() => fresh().encodeUserMessage('hola', [], 'no-uuid')).toThrow('"no-uuid"');
  });

  it('encodeUserMessage_withoutMessageId_payloadUnchanged', () => {
    const payload = fresh().encodeUserMessage('hola');

    expect(payload).toEqual({ type: 'user', message: { role: 'user', content: 'hola' }, parent_tool_use_id: null });
  });
});

describe('ClaudeAdapter: peticiones al motor (F4.4/F4.5)', () => {
  const U1 = '0b1c2d3e-4f50-4612-8a7b-9c0d1e2f3a4b';
  const U2 = '1c2d3e4f-5061-4723-9b8c-0d1e2f3a4b5c';
  const fresh = () => new ClaudeAdapter({ resolveBinary: () => 'claude' });
  const respond = (response: Record<string, unknown>) => ({ type: 'control_response', response });

  it('encodeEngineRequest_rewindConversation_buildsControlRequest', () => {
    const payload = fresh().encodeEngineRequest('r1', { kind: 'rewind_conversation', targetUuid: U1, lastSeenUuid: U2 });

    expect(payload).toEqual({
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'rewind_conversation', target_message_uuid: U1, last_seen_user_message_uuid: U2 },
    });
  });

  it('encodeEngineRequest_rewindFilesDryRun_buildsControlRequest', () => {
    const payload = fresh().encodeEngineRequest('r2', { kind: 'rewind_files', userMessageUuid: U1, dryRun: true });

    expect(payload).toEqual({
      type: 'control_request',
      request_id: 'r2',
      request: { subtype: 'rewind_files', user_message_id: U1, dry_run: true },
    });
  });

  it('encodeEngineRequest_nonUuidTarget_throwsWithValue', () => {
    expect(() => fresh().encodeEngineRequest('r1', { kind: 'rewind_conversation', targetUuid: 'raro', lastSeenUuid: U2 })).toThrow('"raro"');
  });

  it('encodeEngineRequest_threadRevert_throws', () => {
    expect(() => fresh().encodeEngineRequest('r1', { kind: 'thread_revert', beforeTurnId: 't1' })).toThrow('thread_revert');
  });

  it('normalize_successResponseOfEngineRequest_emitsEngineResponseOk', () => {
    const adapter = fresh();
    adapter.encodeEngineRequest('r1', { kind: 'rewind_conversation', targetUuid: U1, lastSeenUuid: U2 });
    const body = { rewound: true, targetMessageUuid: U1, prefillText: 'x', precedingAssistantUuid: U2 };

    const events = adapter.normalize(respond({ subtype: 'success', request_id: 'r1', response: body }));

    expect(events).toEqual([{ kind: 'engine_response', requestId: 'r1', ok: true, result: body, error: null }]);
  });

  it('normalize_errorResponseOfEngineRequest_emitsEngineResponseErrorAndNoControlError', () => {
    const adapter = fresh();
    adapter.encodeEngineRequest('r1', { kind: 'rewind_conversation', targetUuid: U1, lastSeenUuid: U2 });

    const events = adapter.normalize(respond({ subtype: 'error', request_id: 'r1', error: 'stale_target' }));

    expect(events).toEqual([{ kind: 'engine_response', requestId: 'r1', ok: false, result: null, error: 'stale_target' }]);
  });

  it('normalize_controlResponseOfOtherRequest_unchanged', () => {
    const adapter = fresh();
    const raw = respond({ subtype: 'error', request_id: 'otra', error: 'x' });

    expect(adapter.normalize(raw)).toEqual(normalizeRawEvent(raw));
  });

  it('buildSpawnPlan_afterEngineRequest_forgetsPending', () => {
    const adapter = fresh();
    adapter.encodeEngineRequest('r1', { kind: 'rewind_files', userMessageUuid: U1, dryRun: false });
    adapter.buildSpawnPlan(launch);
    const raw = respond({ subtype: 'success', request_id: 'r1', response: {} });

    expect(adapter.normalize(raw)).toEqual(normalizeRawEvent(raw));
  });
});

describe('ClaudeAdapter: checkpoints de ficheros y fork (T1, A2)', () => {
  const ORIGIN = '0b1c2d3e-4f50-4612-8a7b-9c0d1e2f3a4b';
  const AT = '1c2d3e4f-5061-4723-9b8c-0d1e2f3a4b5c';
  const NEW = '2d3e4f50-6172-4834-8c9d-1e2f3a4b5c6d';
  const adapter = new ClaudeAdapter({ resolveBinary: () => 'claude' });
  const fork = { sessionId: ORIGIN, atUuid: AT };
  const base = { ...launch, sessionId: NEW };

  it('buildSpawnPlan_setsFileCheckpointingEnv', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-should-be-removed';
    try {
      const plan = adapter.buildSpawnPlan(launch);

      expect(plan.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING).toBe('true');
      expect('ANTHROPIC_API_KEY' in plan.env).toBe(false);
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it('buildSpawnPlan_forkFrom_buildsForkArgs', () => {
    const { args } = adapter.buildSpawnPlan({ ...base, forkFrom: fork });

    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 7)).toEqual([
      '--resume', ORIGIN, '--resume-session-at', AT, '--fork-session', '--session-id', NEW,
    ]);
  });

  it('buildSpawnPlan_withoutForkFrom_unchangedSessionArgs', () => {
    const { args } = adapter.buildSpawnPlan(launch);

    expect(args).toContain('--session-id');
    expect(args).not.toContain('--fork-session');
  });

  it('buildSpawnPlan_forkFromWithResume_throws', () => {
    expect(() => adapter.buildSpawnPlan({ ...base, resume: true, forkFrom: fork })).toThrow('excluyentes');
  });

  it('buildSpawnPlan_forkFromNonUuid_throwsWithValue', () => {
    expect(() => adapter.buildSpawnPlan({ ...base, forkFrom: { sessionId: ORIGIN, atUuid: 'no-uuid' } })).toThrow('"no-uuid"');
  });
});

describe('ClaudeAdapter — adjunto PDF', () => {
  it('encodeUserMessage_pdfAttachment_documentBlock', () => {
    const adapter = new ClaudeAdapter({ resolveBinary: () => 'claude' });
    const data = Buffer.from('0123456789').toString('base64');

    const result = adapter.encodeUserMessage('lee esto', [{ mediaType: 'application/pdf', data }]) as { message: { content: unknown } };

    expect(result.message.content).toEqual([
      { type: 'text', text: 'lee esto' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
    ]);
  });
});
