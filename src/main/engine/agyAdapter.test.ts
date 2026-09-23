import { describe, expect, it } from 'vitest';
import { AgyAdapter } from './agyAdapter';
import type { LaunchParams, ProviderAdapter } from './providerAdapter';

const adapter = new AgyAdapter(() => 'agy.exe');

const launch: LaunchParams = {
  sessionId: 'mage-session-1',
  accountDir: '/home/u/.claude',
  model: 'gemini-3.6-flash-medium',
  cwd: '/proj',
};

// Indice del valor que sigue a un flag en el array de argumentos (-1 si el flag no esta).
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe('AgyAdapter', () => {
  it('turnMode_esPerTurn', () => {
    expect(adapter.turnMode).toBe('perTurn');
  });

  // `agy` no tiene --input-format: no existe una sesion que arrancar sin prompt, y decirlo con un Error
  // explicito es mejor que construir un plan que no serviria para nada.
  it('buildSpawnPlan_siempre_lanzaConLaSesionPedida', () => {
    expect(() => adapter.buildSpawnPlan(launch)).toThrow(/"mage-session-1"/);
  });

  it('buildTurnSpawnPlan_turnoNormal_ponePromptModoAddDirYModelo', () => {
    const plan = adapter.buildTurnSpawnPlan(launch, 'haz algo');

    expect(plan.command).toBe('agy.exe');
    expect(valueAfter(plan.args, '--output-format')).toBe('stream-json');
    // --add-dir es OBLIGATORIO: sin el, `agy` escribe en su scratch e ignora el cwd (medido).
    expect(valueAfter(plan.args, '--add-dir')).toBe('/proj');
    expect(valueAfter(plan.args, '--model')).toBe('gemini-3.6-flash-medium');
    expect(valueAfter(plan.args, '--mode')).toBe('accept-edits');
    // El prompt va en argv, y al final (asi un prompt que empiece por '-' no se lee como flag).
    expect(plan.args[plan.args.length - 2]).toBe('--print');
    expect(plan.args[plan.args.length - 1]).toBe('haz algo');
  });

  it('buildTurnSpawnPlan_flagsQueAgyNoTiene_noSeAnaden', () => {
    const plan = adapter.buildTurnSpawnPlan(launch, 'hola');

    for (const flag of ['--input-format', '--verbose', '--permission-prompt-tool', '--session-id', '--settings', '--mcp-config']) {
      expect(plan.args, flag).not.toContain(flag);
    }
  });

  it('buildTurnSpawnPlan_primerTurno_noPasaConversation', () => {
    expect(adapter.buildTurnSpawnPlan(launch, 'hola').args).not.toContain('--conversation');
  });

  it('buildTurnSpawnPlan_conConversationId_continuaLaConversacionDelProveedor', () => {
    const plan = adapter.buildTurnSpawnPlan({ ...launch, conversationId: 'agy-conv-7' }, 'sigue');

    expect(valueAfter(plan.args, '--conversation')).toBe('agy-conv-7');
  });

  it('buildTurnSpawnPlan_conversationIdVacio_noPasaElFlag', () => {
    expect(adapter.buildTurnSpawnPlan({ ...launch, conversationId: '' }, 'hola').args).not.toContain('--conversation');
  });

  it.each(['low', 'medium', 'high'])('buildTurnSpawnPlan_effortSoportado_%s_seAnade', (effort) => {
    expect(valueAfter(adapter.buildTurnSpawnPlan({ ...launch, effort }, 'hola').args, '--effort')).toBe(effort);
  });

  // xhigh/max son niveles del CLI de Claude: pasarselos a `agy` abortaria el turno con un flag invalido.
  it.each(['xhigh', 'max', 'raro'])('buildTurnSpawnPlan_effortQueAgyNoConoce_%s_seOmite', (effort) => {
    expect(adapter.buildTurnSpawnPlan({ ...launch, effort }, 'hola').args).not.toContain('--effort');
  });

  it.each(['', '   '])('buildTurnSpawnPlan_promptVacio_lanza_%#', (prompt) => {
    expect(() => adapter.buildTurnSpawnPlan(launch, prompt)).toThrow(/Prompt vacio/);
  });

  // Invariante nº 1 del proyecto: el hijo consume la SUSCRIPCION, nunca una API facturada.
  it('buildTurnSpawnPlan_conApiKeysEnElEntorno_lasBorraDelProcesoHijo', () => {
    const previous = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      google: process.env.GOOGLE_API_KEY,
    };
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
    process.env.GEMINI_API_KEY = 'gm-xxx';
    process.env.GOOGLE_API_KEY = 'go-xxx';
    try {
      const plan = adapter.buildTurnSpawnPlan(launch, 'hola');

      expect(plan.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(plan.env.GEMINI_API_KEY).toBeUndefined();
      expect(plan.env.GOOGLE_API_KEY).toBeUndefined();
    } finally {
      restoreEnv('ANTHROPIC_API_KEY', previous.anthropic);
      restoreEnv('GEMINI_API_KEY', previous.gemini);
      restoreEnv('GOOGLE_API_KEY', previous.google);
    }
  });

  // Lo que `agy` no soporta lanza con un motivo, nunca en silencio ni con un no-op que aparente exito.
  it('encodeUserMessage_siempre_lanzaExplicandoQueElPromptVaEnArgv', () => {
    expect(() => adapter.encodeUserMessage('hola')).toThrow(/argv/);
  });

  it('encodeUserMessage_conAdjuntos_lanzaExplicandoQueEseProveedorNoLosSoporta', () => {
    expect(() => adapter.encodeUserMessage('hola', [{ mediaType: 'image/png', data: 'AAAA' }])).toThrow(/imagenes/i);
  });

  it('encodePermissionResponse_siempre_lanzaPorqueNoHayPuenteDePermisos', () => {
    expect(() => adapter.encodePermissionResponse({ requestId: 'r1', toolUseId: 't1' }, { behavior: 'allow' })).toThrow(
      /permission-prompt-tool/,
    );
  });

  it('encodeInterrupt_siempre_lanza', () => {
    expect(() => adapter.encodeInterrupt()).toThrow();
  });

  it('encodeSetModel_siempre_lanzaConElModeloPedido', () => {
    expect(() => adapter.encodeSetModel('gemini-3.1-pro-low')).toThrow(/"gemini-3.1-pro-low"/);
  });

  it('encodeSetPermissionMode_siempre_lanzaConElModoPedido', () => {
    expect(() => adapter.encodeSetPermissionMode('plan')).toThrow(/"plan"/);
  });

  // Los opcionales que `agy` no tiene simplemente NO estan: AgentSession no los pide (no hay
  // control_request, ni hooks, ni --mcp-config/--settings en este CLI).
  it('metodosOpcionalesQueAgyNoSoporta_noEstanDeclarados', () => {
    const asContract: ProviderAdapter = adapter;

    expect(asContract.encodeGetContextUsage).toBeUndefined();
    expect(asContract.encodeInitialize).toBeUndefined();
    expect(asContract.encodeHookResponse).toBeUndefined();
  });

  it('normalize_lineaDeAgy_traduceAEventosComunes', () => {
    const events = adapter.normalize({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'ok' } });

    expect(events).toEqual([{ kind: 'stream_delta', text: 'ok' }]);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
