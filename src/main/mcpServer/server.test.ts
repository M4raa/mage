import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ASK_CREATOR_DESCRIPTION, CREATE_SESSION_DESCRIPTION, SESSIONS_INSTRUCTIONS, startMageMcpServer } from './server';
import { createInputSchema } from './schemas';
import { MemorySessionsPort } from './memorySessionsPort';
import { MemoryIdempotencyStore } from './idempotencyStore';
import type { ConnectionScope } from './scope';
import type { SessionMetadata } from './sessionsPort';
import { MagePolicyError, callPort } from './errors';
import { authorizeTarget, isSessionAllowed, scopeIdentity, snapshotScope } from './scope';

const NOW = '2026-10-31T12:00:00.000Z';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const SECRET = 'SECRET_SENTINEL_MCP';
const defaultScope = (): ConnectionScope => ({ projectIds: ['p'], accountIds: ['a'] });
const createArgs = (overrides = {}) => ({ requestId: REQUEST, provider: 'claude', cwd: '/synthetic', prompt: 'synthetic prompt', ...overrides });
function metadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return { conversationId: 'historical-id', title: 'Public', provider: 'claude', state: 'working', projectId: 'p', accountId: 'a', isPrivate: false, creatorChain: [], ...overrides };
}
function makePort() {
  let next = 0;
  return new MemorySessionsPort({
    targets: [
      { projectId: 'p', accountId: 'a', provider: 'claude', cwd: '/synthetic' },
      { projectId: 'p', accountId: 'a', provider: 'codex', cwd: '/synthetic' },
      { projectId: 'foreign', accountId: 'a', provider: 'claude', cwd: '/foreign' },
      { projectId: 'p', accountId: 'foreign', provider: 'claude', cwd: '/default-foreign' },
    ],
    sessions: [
      { metadata: metadata(), status: { state: 'working', turnCount: 0, lastEventAt: NOW }, messages: [{ seq: 1, role: 'assistant', text: 'á🙂' }] },
      { metadata: metadata({ conversationId: 'private', title: SECRET, isPrivate: true }), status: { state: 'working', turnCount: 0, lastEventAt: NOW }, messages: [{ seq: 1, role: 'assistant', text: SECRET }] },
      { metadata: metadata({ conversationId: 'foreign', projectId: 'other', title: SECRET }), status: { state: 'working', turnCount: 0, lastEventAt: NOW } },
    ],
    now: () => NOW, newConversationId: () => `created-${++next}`,
  });
}
const connections: { client: Client; server: McpServer }[] = [];
async function connect(options: { port?: MemorySessionsPort; scope?: ConnectionScope; store?: MemoryIdempotencyStore; now?: () => string; maxDepth?: number } = {}) {
  const port = options.port ?? makePort();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = await startMageMcpServer({
    port, scope: options.scope ?? defaultScope(), store: options.store ?? new MemoryIdempotencyStore(),
    now: options.now ?? (() => NOW), maxDepth: options.maxDepth, transport: serverTransport,
  });
  const client = new Client({ name: 'mage-test', version: '1' });
  connections.push({ client, server });
  await client.connect(clientTransport);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name: `mage_${name}`, arguments: args });
  return { port, client, call };
}
afterEach(async () => {
  for (const { client, server } of connections.splice(0)) {
    await client.close();
    await server.close();
  }
  vi.restoreAllMocks();
});

describe('Mage MCP server', () => {
  it('listTools_conexionReal_sieteHerramientasConAmbosEsquemas', async () => {
    const { client } = await connect();
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).toEqual(['mage_ask_creator', 'mage_cancel', 'mage_create_session', 'mage_get_status', 'mage_list_sessions', 'mage_read_result', 'mage_send']);
    for (const tool of result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema?.type).toBe('object');
    }
    expect(client.getServerVersion()).toEqual({ name: 'mage', version: '1' });
  });
  // P-038: sin instrucciones, «lanza dos sesiones nuevas» acababa en subagentes aun con el MCP cargado.
  it('initialize_sinNavegador_instruccionesDeSesionesSinLasDelNavegador', async () => {
    const { client } = await connect();
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toBe(SESSIONS_INSTRUCTIONS);
    expect(instructions).toContain('mage_create_session');
    expect(instructions).not.toContain('mage_browser_');
  });
  it('listTools_todasLasHerramientas_tienenDescripcion', async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools;
    expect(tools.filter((tool) => (tool.description ?? '').length === 0).map((tool) => tool.name)).toEqual([]);
  });
  it('listTools_askCreator_descripcionPideTerminarElTurno', async () => {
    const { client } = await connect();
    const tool = (await client.listTools()).tools.find((item) => item.name === 'mage_ask_creator');
    expect(tool?.description).toBe(ASK_CREATOR_DESCRIPTION);
    expect(tool?.description).toContain('termina tu turno');
  });
  it('mage_create_session_tieneDescripcionYLosTresCamposOpcionales', async () => {
    const { client } = await connect();
    const tool = (await client.listTools()).tools.find((item) => item.name === 'mage_create_session');
    expect(tool?.description).toBe(CREATE_SESSION_DESCRIPTION);
    expect(tool?.description).toContain('hereda');
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['model', 'effort', 'permissionMode']));
    expect(tool?.inputSchema.required ?? []).not.toEqual(expect.arrayContaining(['model']));
    expect(tool?.inputSchema.required ?? []).not.toContain('effort');
    expect(tool?.inputSchema.required ?? []).not.toContain('permissionMode');
  });
  it('createInputSchema_esfuerzoFueraDeLaLista_rechaza', () => {
    const base = { requestId: REQUEST, provider: 'claude', cwd: '/x', prompt: 'p' };
    expect(createInputSchema.safeParse({ ...base, effort: 'turbo' }).success).toBe(false);
  });
  it('createInputSchema_esfuerzoValido_acepta', () => {
    const base = { requestId: REQUEST, provider: 'claude', cwd: '/x', prompt: 'p' };
    expect(createInputSchema.safeParse({ ...base, effort: 'high' }).success).toBe(true);
  });
  it('callTool_askCreator_memoryPort_acceptedYRegistrada', async () => {
    const { call, port } = await connect();
    const result = await call('ask_creator', { requestId: REQUEST, text: 'hola' });
    expect(result.structuredContent).toEqual({ receipt: 'accepted' });
    expect(port.questions).toEqual([{ requestId: REQUEST, text: 'hola' }]);
  });
  it('callTool_askCreator_textoVacio_isError', async () => {
    const { call, port } = await connect();
    const result = await call('ask_creator', { requestId: REQUEST, text: '' });
    expect(result.isError).toBe(true);
    expect(port.questions).toEqual([]);
  });
  it('callTool_requestIdTexto_createAceptado', async () => {
    const { call } = await connect();
    const result = await call('create_session', createArgs({ requestId: 'claude-pref-num-20261104' }));
    expect(result.isError).not.toBe(true);
  });
  it('callTool_requestIdTexto_askCreatorAceptado', async () => {
    const { call, port } = await connect();
    const result = await call('ask_creator', { requestId: 'preferred-integer-1-to-9', text: 'hola' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ receipt: 'accepted' });
    expect(port.questions).toEqual([{ requestId: 'preferred-integer-1-to-9', text: 'hola' }]);
  });
  it('callTool_requestId128_aceptado', async () => {
    const { call } = await connect();
    const result = await call('ask_creator', { requestId: 'a'.repeat(128), text: 'hola' });
    expect(result.isError).not.toBe(true);
  });
  it('callTool_requestId129_isErrorConCampo', async () => {
    const { call } = await connect();
    const result = await call('ask_creator', { requestId: 'a'.repeat(129), text: 'hola' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('requestId');
  });
  it('callTool_requestIdVacio_isErrorConCampo', async () => {
    const { call } = await connect();
    const result = await call('ask_creator', { requestId: '', text: 'hola' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('requestId');
  });
  it('tools_caminosNominales_devuelvenContratoH1', async () => {
    const { call } = await connect();
    expect((await call('list_sessions')).structuredContent).toEqual({ sessions: [{ conversationId: 'historical-id', title: 'Public', provider: 'claude', state: 'working' }] });
    expect((await call('get_status', { conversationId: 'historical-id' })).structuredContent).toEqual({ state: 'working', turnCount: 0, lastEventAt: NOW });
    expect((await call('read_result', { conversationId: 'historical-id' })).structuredContent).toEqual({ messages: [{ seq: 1, role: 'assistant', text: 'á🙂' }], nextSeq: 1, truncated: false });
    expect((await call('cancel', { conversationId: 'historical-id', scope: 'turn' })).structuredContent).toEqual({ cancelled: true });
    expect((await call('cancel', { conversationId: 'historical-id', scope: 'turn' })).structuredContent).toEqual({ cancelled: false });
  });
  it.each(['claude', 'codex'])('create_proveedor_%s_acepta', async (provider) => {
    const { call, port } = await connect();
    expect((await call('create_session', createArgs({ provider }))).structuredContent).toEqual({ conversationId: 'created-1', state: 'running' });
    expect((await port.getSession('created-1')).createdBy).toBeUndefined();
    expect(await port.readResult({ conversationId: 'created-1', afterSeq: 0 })).toEqual([{ seq: 1, role: 'user', text: 'synthetic prompt' }]);
  });
  it.each([['direct', 'accepted'], ['queue', 'queued']])('send_modo_%s_retornanAlAceptar', async (mode, receipt) => {
    const { call } = await connect();
    expect((await call('send', { requestId: REQUEST, conversationId: 'historical-id', text: 'synthetic text', mode })).structuredContent).toEqual({ receipt });
  });
  it('create_reintentosConcurrentesYSecuenciales_unaSesion', async () => {
    const port = makePort();
    const effect = vi.spyOn(port, 'createSession');
    const { call } = await connect({ port });
    const results = await Promise.all([call('create_session', createArgs()), call('create_session', createArgs())]);
    expect(results[0]).toEqual(results[1]);
    expect(await call('create_session', createArgs())).toEqual(results[0]);
    expect(effect).toHaveBeenCalledTimes(1);
    const conflict = await call('create_session', createArgs({ prompt: SECRET }));
    expect(conflict.isError).toBe(true);
    expect(JSON.stringify(conflict)).toContain(`idempotency_conflict: requestId ${REQUEST}`);
    expect(JSON.stringify(conflict)).not.toContain(SECRET);
  });
  it('send_mismoRequestId_unaEntregaYConflictoSeguro', async () => {
    const port = makePort();
    const effect = vi.spyOn(port, 'send');
    const { call } = await connect({ port });
    const args = { requestId: REQUEST, conversationId: 'historical-id', text: 'hello', mode: 'queue' };
    const results = await Promise.all([call('send', args), call('send', args)]);
    expect(results[0]).toEqual(results[1]);
    expect(effect).toHaveBeenCalledTimes(1);
    const conflict = await call('send', { ...args, text: SECRET });
    expect(JSON.stringify(conflict)).toContain(REQUEST);
    expect(JSON.stringify(conflict)).toContain('idempotency_conflict');
    expect(JSON.stringify(conflict)).not.toContain(SECRET);
  });
  it('idempotencia_herramientasYScopesDiferentes_aislados', async () => {
    const port = makePort();
    const effect = vi.spyOn(port, 'createSession');
    const store = new MemoryIdempotencyStore();
    const first = await connect({ port, store });
    const second = await connect({ port, store, scope: { ...defaultScope(), caller: { conversationId: 'creator', creatorChain: [] } } });
    expect((await first.call('create_session', createArgs())).structuredContent).toEqual({ conversationId: 'created-1', state: 'running' });
    expect((await second.call('create_session', createArgs())).structuredContent).toEqual({ conversationId: 'created-2', state: 'running' });
    expect((await first.call('send', { requestId: REQUEST, conversationId: 'historical-id', text: 'hello', mode: 'direct' })).isError).not.toBe(true);
    expect(effect).toHaveBeenCalledTimes(2);
  });
  it.each(['createSession', 'send'] as const)('idempotencia_puertoFalla_%s_noRepiteNiFiltra', async (operation) => {
    const port = makePort();
    const effect = vi.spyOn(port, operation).mockRejectedValue(new Error(SECRET));
    const { call } = await connect({ port });
    const tool = operation === 'createSession' ? 'create_session' : 'send';
    const args = operation === 'createSession' ? createArgs() : { requestId: REQUEST, conversationId: 'historical-id', text: 'hello', mode: 'direct' };
    const first = await call(tool, args);
    expect(await call(tool, args)).toEqual(first);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(first.isError).toBe(true);
    expect(JSON.stringify(first)).toContain(`port_error: ${operation}`);
    expect(JSON.stringify(first)).not.toContain(SECRET);
  });
  it('create_puertoRechazaConLaunchFailed_elAgenteVeElMotivoYNoPortError', async () => {
    const port = makePort();
    vi.spyOn(port, 'createSession').mockRejectedValue(new MagePolicyError('launch_failed: x'));
    const { call } = await connect({ port });

    const result = await call('create_session', createArgs());

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('launch_failed: x');
    expect(JSON.stringify(result)).not.toContain('port_error');
  });
  it('list_filtroProyectoAjeno_rechazaSinListar', async () => {
    const port = makePort();
    const list = vi.spyOn(port, 'listSessions');
    const { call } = await connect({ port });
    expect((await call('list_sessions', { projectId: 'foreign' })).isError).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });
  it.each([
    { cwd: '/foreign' }, { accountId: 'foreign' }, { cwd: '/default-foreign' },
  ])('create_targetFueraDeAlcance_sinEfectos_%j', async (overrides) => {
    const port = makePort();
    const create = vi.spyOn(port, 'createSession');
    const { call } = await connect({ port });
    const result = await call('create_session', createArgs(overrides));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('scope_denied');
    expect(create).not.toHaveBeenCalled();
  });
  it('create_proveedorResueltoDistinto_rechazaAntesDeEfecto', async () => {
    const port = makePort();
    vi.spyOn(port, 'resolveCreationTarget').mockResolvedValue({ projectId: 'p', accountId: 'a', provider: 'codex', cwd: '/synthetic' });
    const create = vi.spyOn(port, 'createSession');
    const { call } = await connect({ port });
    expect(JSON.stringify(await call('create_session', createArgs()))).toContain('scope_denied');
    expect(create).not.toHaveBeenCalled();
  });
  it.each(['private', 'foreign', 'historical-id'])('tools_conversacionDenegada_%s_noAccedeADatosNiEfectos', async (conversationId) => {
    const port = makePort();
    const spies = ['getStatus', 'readResult', 'send', 'cancel'].map((method) => vi.spyOn(port, method as 'getStatus'));
    const scope = conversationId === 'historical-id' ? { ...defaultScope(), conversationIds: [] } : defaultScope();
    const { call } = await connect({ port, scope });
    const inputs = [
      ['get_status', { conversationId }], ['read_result', { conversationId }],
      ['send', { conversationId, requestId: REQUEST, text: 'hi', mode: 'direct' }], ['cancel', { conversationId, scope: 'turn' }],
    ] as const;
    for (const [name, args] of inputs) {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('scope_denied');
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(JSON.stringify(await call('list_sessions'))).not.toContain(SECRET);
  });
  it('scope_includePrivateExplicito_permiteOperaciones', async () => {
    const { call } = await connect({ scope: { ...defaultScope(), includePrivate: true } });
    expect(JSON.stringify(await call('list_sessions'))).toContain(SECRET);
    for (const [tool, args] of [
      ['get_status', { conversationId: 'private' }], ['read_result', { conversationId: 'private' }],
      ['send', { conversationId: 'private', requestId: REQUEST, text: 'hi', mode: 'direct' }],
      ['cancel', { conversationId: 'private', scope: 'turn' }],
    ] as const) expect((await call(tool, args)).isError).not.toBe(true);
  });
  it('scope_mutacionOriginal_noAmpliaPermisos', async () => {
    const projectIds = ['p'];
    const accountIds = ['a'];
    const conversationIds = ['historical-id'];
    const scope = { projectIds, accountIds, conversationIds, includePrivate: false };
    const { call } = await connect({ scope });
    projectIds.push('other'); accountIds.push('foreign'); conversationIds.push('private', 'foreign'); scope.includePrivate = true;
    expect(JSON.stringify(await call('list_sessions'))).not.toContain(SECRET);
    expect(JSON.stringify(await call('get_status', { conversationId: 'private' }))).toContain('scope_denied');
    expect(JSON.stringify(await call('get_status', { conversationId: 'foreign' }))).toContain('scope_denied');
  });
  it.each([{ projectIds: [], accountIds: ['a'] }, { projectIds: ['p'], accountIds: [] }])('scope_listasVacias_noAutorizan_%j', async (scope) => {
    const { call } = await connect({ scope });
    expect((await call('list_sessions')).structuredContent).toEqual({ sessions: [] });
    expect(JSON.stringify(await call('create_session', createArgs()))).toContain('scope_denied');
  });
  it('send_respuestaCacheada_reautorizaAntesDeConsultarCache', async () => {
    const port = makePort();
    const send = vi.spyOn(port, 'send');
    const { call } = await connect({ port });
    const args = { conversationId: 'historical-id', requestId: REQUEST, text: 'hi', mode: 'direct' };
    expect((await call('send', args)).isError).not.toBe(true);
    port.seedSession({ metadata: metadata({ isPrivate: true }), status: { state: 'working', turnCount: 0, lastEventAt: NOW } });
    expect(JSON.stringify(await call('send', args))).toContain('scope_denied');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('create_procedenciaConfiable_recibeCadenaYTimestamp', async () => {
    const port = makePort();
    const create = vi.spyOn(port, 'createSession');
    const creatorChain = ['A'];
    const caller = { conversationId: 'B', creatorChain };
    const { call } = await connect({ port, scope: { ...defaultScope(), caller } });
    caller.conversationId = 'forged'; creatorChain.push('forged');
    await call('create_session', createArgs());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ creatorChain: ['A', 'B'], createdBy: { conversationId: 'B', requestId: REQUEST, at: NOW } }));
    expect(JSON.stringify(await call('list_sessions'))).toContain('"createdBy":"B"');
  });
  it('create_cadenaEnEntrada_noPermiteSuplantacion', async () => {
    const { call } = await connect();
    expect((await call('create_session', createArgs({ creatorChain: [], callerId: 'forged' }))).isError).toBe(true);
  });
  it('create_profundidadAgotada_sinEfectoConCadena', async () => {
    const port = makePort();
    const create = vi.spyOn(port, 'createSession');
    const { call } = await connect({ port, scope: { ...defaultScope(), caller: { conversationId: 'C', creatorChain: ['A', 'B'] } } });
    const result = await call('create_session', createArgs());
    expect(JSON.stringify(result)).toContain('delegation_depth_exceeded');
    expect(JSON.stringify(result)).toContain('A→B→C');
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    ['create_session', createArgs({ requestId: 12345 }), 'requestId', '12345'],
    ['create_session', { provider: 'claude', cwd: '/synthetic', prompt: SECRET }, 'requestId', 'undefined'],
    ['get_status', {}, 'conversationId', 'undefined'],
    ['create_session', { requestId: REQUEST, provider: 'claude', prompt: SECRET }, 'cwd', 'undefined'],
    ['create_session', createArgs({ provider: 'bad-provider' }), 'provider', 'bad-provider'],
    ['read_result', { conversationId: 'historical-id', afterSeq: -1 }, 'afterSeq', '-1'],
    ['read_result', { conversationId: 'historical-id', maxBytes: 0 }, 'maxBytes', '0'],
    ['read_result', { conversationId: 'historical-id', maxBytes: 65_537 }, 'maxBytes', '65537'],
  ] as const)('validation_%s_%j_diagnosticoSeguro', async (tool, args, field, value) => {
    const { call } = await connect();
    const result = await call(tool, args);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(field);
    expect(JSON.stringify(result)).toContain(value);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
  it('create_nowInvalida_noEfectoNiDatosFueraDeEsquema', async () => {
    const port = makePort();
    const create = vi.spyOn(port, 'createSession');
    const { call } = await connect({ port, now: () => SECRET });
    const result = await call('create_session', createArgs());
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(create).not.toHaveBeenCalled();
  });
  it('projection_metadataExtraPuerto_noSalePorMCP', async () => {
    const port = makePort();
    const extras = { apiKey: SECRET, oauthAccount: SECRET };
    vi.spyOn(port, 'listSessions').mockResolvedValue([{ ...metadata(), ...extras }]);
    vi.spyOn(port, 'getStatus').mockResolvedValue({ state: 'working', turnCount: 0, lastEventAt: NOW, ...extras });
    vi.spyOn(port, 'readResult').mockResolvedValue([{ seq: 1, role: 'assistant', text: 'public', ...extras }]);
    const { call } = await connect({ port });
    for (const [tool, args] of [['list_sessions', {}], ['get_status', { conversationId: 'historical-id' }], ['read_result', { conversationId: 'historical-id' }]] as const) {
      const result = await call(tool, args);
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/SECRET_SENTINEL_MCP|apiKey|oauthAccount/);
    }
  });
  it('create_send_soloEsperanAceptacion_sinEsperarTurno', async () => {
    const port = makePort();
    let acceptCreate!: (value: { conversationId: string; state: 'running' }) => void;
    let acceptSend!: (value: { receipt: 'accepted' }) => void;
    vi.spyOn(port, 'createSession').mockImplementation(() => new Promise((resolve) => { acceptCreate = resolve; }));
    vi.spyOn(port, 'send').mockImplementation(() => new Promise((resolve) => { acceptSend = resolve; }));
    const { call } = await connect({ port });
    const creation = call('create_session', createArgs());
    await vi.waitFor(() => expect(acceptCreate).toBeTypeOf('function'));
    acceptCreate({ conversationId: 'accepted-session', state: 'running' });
    expect((await creation).structuredContent).toEqual({ conversationId: 'accepted-session', state: 'running' });
    const delivery = call('send', { conversationId: 'historical-id', requestId: SECOND, text: 'hi', mode: 'direct' });
    await vi.waitFor(() => expect(acceptSend).toBeTypeOf('function'));
    acceptSend({ receipt: 'accepted' });
    expect((await delivery).structuredContent).toEqual({ receipt: 'accepted' });
  });
});

describe('alcance sin restricción de proyecto (D-M7)', () => {
  const anyProject = () => snapshotScope({ accountIds: ['a'] });
  it('isSessionAllowed_nullProjects_anyProject', () => {
    expect(isSessionAllowed(anyProject(), metadata({ projectId: 'whatever' }))).toBe(true);
    expect(isSessionAllowed(anyProject(), metadata({ accountId: 'foreign' }))).toBe(false);
  });
  it('authorizeTarget_nullProjects_onlyAccountAndProvider', () => {
    const target = { projectId: 'x', accountId: 'a', provider: 'claude' as const, cwd: '/c' };
    expect(() => authorizeTarget(anyProject(), target, 'claude')).not.toThrow();
    expect(() => authorizeTarget(anyProject(), { ...target, accountId: 'b' }, 'claude')).toThrow('scope_denied');
    expect(() => authorizeTarget(anyProject(), target, 'codex')).toThrow('scope_denied');
  });
  it('scopeIdentity_nullProjects_keepsNull', () => {
    expect(scopeIdentity(anyProject())).toMatchObject({ projectIds: null });
    expect(scopeIdentity(snapshotScope({ projectIds: ['b', 'a'], accountIds: ['a'] }))).toMatchObject({ projectIds: ['a', 'b'] });
  });
});

describe('callPort', () => {
  it('callPort_policyError_rethrownAsIs', async () => {
    const policy = new MagePolicyError('trust_required: /c');
    await expect(callPort('op', () => Promise.reject(policy))).rejects.toBe(policy);
  });
  it('callPort_otherError_portError', async () => {
    await expect(callPort('op', () => Promise.reject(new Error('boom')))).rejects.toThrow('port_error: op');
  });
});
