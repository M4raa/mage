import { describe, expect, it } from 'vitest';
import { GatewayAdapter } from './gatewayAdapter';

// Refunde los tests de los cuatro adapters gemelos borrados (openai/gemini/ollama/lmstudio): eran el
// mismo caso repetido cuatro veces, asi que aqui se recorren los ids en un it.each.
const launch = { sessionId: 's1', accountDir: '/home/u/.claude', model: 'llama3', cwd: '/proj' };
const PROVIDER_IDS = ['openai', 'gemini', 'custom:ollama', 'custom:lm-studio'] as const;
// Puerto del gateway inyectado: `buildSpawnPlan` exige uno vivo (un 0 significa "el gateway no arranco"
// y ahi lanzar el CLI solo produce un error de red que no dice la causa).
const PORT = () => 4242;

describe('GatewayAdapter', () => {
  it.each(PROVIDER_IDS)('buildSpawnPlan_%s_apuntaAlGatewayConElTicketDeSesion', (providerId) => {
    const plan = new GatewayAdapter(providerId, () => 'claude', PORT).buildSpawnPlan(launch);

    expect(plan.command).toBe('claude');
    expect(plan.args.join(' ')).toContain('--session-id s1');
    expect(plan.args.join(' ')).toContain('--model llama3');
    expect(plan.env.CLAUDE_CONFIG_DIR).toBe('/home/u/.claude');
    expect(plan.env.ANTHROPIC_BASE_URL).toContain('/v1');
    expect(plan.env.ANTHROPIC_BASE_URL).toContain('127.0.0.1');
    expect(plan.env.ANTHROPIC_API_KEY).toBe('sk-mage-s1');
  });

  it.each(PROVIDER_IDS)('encodeSetModel_%s_lanzaNombrandoAlProveedor', (providerId) => {
    expect(() => new GatewayAdapter(providerId, () => 'claude').encodeSetModel('mistral')).toThrow(
      `set_model no soportado por ${providerId}`,
    );
  });

  it.each(PROVIDER_IDS)('encodeSetPermissionMode_%s_lanzaNombrandoAlProveedor', (providerId) => {
    expect(() => new GatewayAdapter(providerId, () => 'claude').encodeSetPermissionMode('plan')).toThrow(
      /set_permission_mode no soportado/,
    );
  });

  const adapter = new GatewayAdapter('custom:ollama', () => 'claude', PORT);

  it('buildSpawnPlan_conCompartido_mismoMcpConfigQueElNativoAlFinal', () => {
    const withWriter = new GatewayAdapter('custom:ollama', () => 'claude', PORT, () => '/gen/claude.mcp.json');
    const server = { name: 'db', source: 'common', onlyIn: null, extra: {}, secrets: {}, transport: 'stdio', command: 'db', args: [], env: {}, cwd: null } as const;

    const plan = withWriter.buildSpawnPlan({ ...launch, shared: { mcpServers: [server], settingsFragment: { hooks: {} }, claudeAiConnectors: false } });

    expect(plan.args.slice(-4)).toEqual(['--mcp-config', '/gen/claude.mcp.json', '--settings', '{"hooks":{}}']);
    expect(plan.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false');
  });

  it('buildSpawnPlan_sinSharedConfigArgs_noAnadeNiMcpConfigNiSettings', () => {
    const plan = adapter.buildSpawnPlan(launch);

    expect(plan.args).not.toContain('--mcp-config');
    expect(plan.args).not.toContain('--settings');
  });

  // La credencial del proveedor NUNCA viaja al CLI hijo: el gateway la pone al reenviar. Si se colara
  // aqui, quedaria en el entorno de un proceso que Mage no controla.
  it('buildSpawnPlan_env_noLlevaNingunaKeyDeProveedor', () => {
    const plan = adapter.buildSpawnPlan(launch);

    expect(plan.env.OPENAI_API_KEY).toBeUndefined();
    expect(plan.env.GEMINI_API_KEY).toBeUndefined();
  });

  it('constructor_sinIdDeProveedor_lanzaConElValorRecibido', () => {
    expect(() => new GatewayAdapter('  ', () => 'claude')).toThrow(/"  "/);
  });

  it('buildSpawnPlan_gatewaySinArrancar_lanzaNombrandoAlProveedor', () => {
    const sinGateway = new GatewayAdapter('custom:ollama', () => 'claude', () => 0);

    expect(() => sinGateway.buildSpawnPlan(launch)).toThrow(/gateway local no esta activo.*custom:ollama/);
  });

  it('buildSpawnPlan_resume_usaResumeYNoSessionId', () => {
    // El CLI RECHAZA un `--session-id` ya usado ("Session ID ... is already in use"), asi que el
    // reinicio automatico (C1) de una sesion por gateway tiene que reanudar como el adapter de Claude.
    const plan = adapter.buildSpawnPlan({ ...launch, resume: true });

    expect(plan.args.join(' ')).toContain('--resume s1');
    expect(plan.args).not.toContain('--session-id');
  });

  it('encodeUserMessage_texto_devuelveLineaNdjsonDeUsuario', () => {
    expect(adapter.encodeUserMessage('hola')).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hola' },
      parent_tool_use_id: null,
    });
  });

  it('encodePermissionResponse_allow_devuelveControlResponseDeExito', () => {
    const encoded = adapter.encodePermissionResponse({ requestId: 'r1', toolUseId: 't1' }, { behavior: 'allow' });

    expect(encoded).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput: {}, toolUseID: 't1' } },
    });
  });

  it('encodePermissionResponse_deny_arrastraElMotivo', () => {
    const encoded = adapter.encodePermissionResponse({ requestId: 'r1', toolUseId: 't1' }, { behavior: 'deny', message: 'no' });

    expect(encoded).toMatchObject({ response: { response: { behavior: 'deny', message: 'no' } } });
  });
});
