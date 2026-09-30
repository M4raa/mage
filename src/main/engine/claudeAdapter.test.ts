import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claudeAdapter';

const launch = { sessionId: 's1', accountDir: '/home/u/.claude-p', model: 'haiku', cwd: '/proj' };

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter(() => 'claude');

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

    it('buildSpawnPlan_conSharedConfigArgs_seAnadenAlFinal', () => {
      const sharedConfigArgs = ['--mcp-config', '/shared/mcp-common.json', '--settings', '{"hooks":{}}'];
      const plan = adapter.buildSpawnPlan({ ...launch, sharedConfigArgs });

      expect(plan.args.slice(-sharedConfigArgs.length)).toEqual(sharedConfigArgs);
    });

    it('buildSpawnPlan_sinSharedConfigArgs_noAnadeNiMcpConfigNiSettings', () => {
      const plan = adapter.buildSpawnPlan(launch);

      expect(plan.args).not.toContain('--mcp-config');
      expect(plan.args).not.toContain('--settings');
    });
  });
});
