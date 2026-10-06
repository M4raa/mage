// Medicion segura de app-server. Solo temporales propios; nunca lee ~/.codex ni imprime respuestas
// de autenticacion, stderr, urls OAuth, ids personales o contenidos de credenciales.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { projectVerificationFile, projectVerificationMcp } from './codex-fixtures.mjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jsonLines, parseExternalJson, RPC_MESSAGE, THREAD_MARKER, RESPONSES_BODY, validatedResult,
  ACCOUNT_RESULT, MODELS_RESULT, PROFILES_RESULT, APPS_RESULT, RATE_RESULT, THREAD_RESULT, THREAD_READ } from './codex-wire.mjs';

const RPC_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 600_000;
const MANIFEST_FILE = 'mage-verification.json';
const OWNER_FILE = '.mage-verification-owner';
const MANIFEST = z.object({ format: z.literal(1), owner: z.string().uuid(), workspace: z.string().min(1) }).strict();
export function isolatedEnv(home, deps) {
  const env = deps.scrubAgentEnv(deps.baseEnv);
  delete env.MAGE_CODEX_API_KEY;
  return { ...env, CODEX_HOME: home };
}

export function loginEnvironment(home, url, deps) {
  return { ...isolatedEnv(home, deps), MAGE_CODEX_LOGIN_URL: url };
}

export function rpcSession({ bin, home, workspace, args = [], env = {}, deps }) {
  const child = deps.spawn(bin, ['app-server', ...args], {
    env: { ...isolatedEnv(home, deps), ...env }, cwd: workspace, stdio: 'pipe', windowsHide: true,
  });
  const pending = new Map();
  const messages = [];
  let nextId = 0;
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  wireRpc(child, { pending, messages });
  const request = (method, params = {}) => new Promise((resolveReply, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout de ${method}`));
    }, RPC_TIMEOUT_MS);
    pending.set(id, { resolve: resolveReply, reject, timer });
    try { send({ jsonrpc: '2.0', id, method, params }); } catch {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error('Falló la escritura RPC'));
    }
  });
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise((done) => child.once('close', done));
    child.kill();
    await closed;
  };
  return { child, request, send, messages, close };
}

function wireRpc(child, { pending, messages }) {
  // stderr puede contener datos de autenticacion: se consume sin registrarlo.
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  const receive = (message) => {
      const waiter = pending.get(message.id);
      if (waiter && message.method === undefined) {
        clearTimeout(waiter.timer);
        pending.delete(message.id);
        waiter.resolve(message);
      } else messages.push(message);
  };
  const rejectPending = (error = new Error('app-server terminó antes de contestar')) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  child.stdout.on('data', jsonLines({ schema: RPC_MESSAGE, receive, fail: (error) => { rejectPending(error); child.kill(); } }));
  child.on('error', () => rejectPending());
  child.stdin.on('error', () => rejectPending());
  child.on('exit', () => rejectPending());
}

async function initialized(session) {
  const reply = await session.request('initialize', {
    clientInfo: { name: 'mage-verification', version: '0.1.2' },
    capabilities: { experimentalApi: true },
  });
  if (reply.error) throw new Error(`initialize fallo: codigo ${reply.error.code}`);
  session.send({ jsonrpc: '2.0', method: 'initialized' });
  console.log('initialize: OK');
}

async function inventory(session) {
  const account = await session.request('account/read');
  const accountType = account.error ? 'sin confirmar' : validatedResult(account, ACCOUNT_RESULT, 'account/read').account?.type ?? 'sin cuenta';
  console.log(`account/read: tipo=${accountType} error=${account.error?.code ?? 'ninguno'}`);
  const models = await session.request('model/list');
  console.log('model/list:', JSON.stringify(models.error ? { errorCode: models.error.code } : validatedResult(models, MODELS_RESULT, 'model/list').data.map((m) => ({
    id: m.id, model: m.model, hidden: m.hidden,
    efforts: m.supportedReasoningEfforts?.map((e) => e.reasoningEffort),
  }))));
  const profiles = await session.request('permissionProfile/list');
  console.log('permissionProfile/list:', JSON.stringify(profiles.error ? { errorCode: profiles.error.code } : validatedResult(profiles, PROFILES_RESULT, 'permissionProfile/list').data));
  for (const method of ['account/rateLimits/read', 'account/usage/read', 'app/list']) {
    const reply = await session.request(method);
    console.log(`${method}: campos=${JSON.stringify(Object.keys(reply.result ?? {}))} error=${reply.error?.code ?? 'ninguno'}`);
    if (method === 'account/rateLimits/read' && reply.result) {
      const limits = validatedResult(reply, RATE_RESULT, method).rateLimits;
      console.log('Ventanas:', JSON.stringify({ primary: limits?.primary, secondary: limits?.secondary }));
    }
    if (method === 'app/list' && !reply.error) {
      const apps = validatedResult(reply, APPS_RESULT, method);
      console.log(`Apps: ${apps.data.length}; hay pagina siguiente=${apps.nextCursor !== null && apps.nextCursor !== undefined}`);
    }
  }
}

async function login(session, context) {
  const reply = await session.request('account/login/start', { type: 'chatgpt' });
  if (reply.error) throw new Error(`account/login/start fallo: codigo ${reply.error.code}`);
  const url = validatedResult(reply, z.object({ authUrl: z.string() }), 'account/login/start').authUrl;
  const parsedUrl = URL.canParse(url) ? new URL(url) : null;
  if (parsedUrl === null || parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'auth.openai.com' || parsedUrl.username !== '' || parsedUrl.password !== '') {
    throw new Error('El login no devolvio una URL OAuth de auth.openai.com');
  }
  // URL solo en el entorno del navegador, nunca en la consola ni en disco.
  const browser = browserCommand(url);
  const opener = context.deps.spawn(browser.command, browser.args, {
    env: loginEnvironment(context.home, url, context.deps), windowsHide: true, stdio: 'ignore',
  });
  await new Promise((done, reject) => {
    opener.once('error', () => reject(new Error('No se pudo abrir el navegador del login')));
    opener.once('exit', (code) => code === 0 ? done() : reject(new Error(`Abrir navegador: exit ${code}`)));
  });
  console.log('Login abierto en el navegador; esperando account/login/completed.');
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const completed = session.messages.find((m) => m.method === 'account/login/completed');
    if (completed) {
      if (completed.params?.success !== true) {
        throw new Error(`Login no completado: ${loginFailureCategory(completed.params?.error)} (detalle omitido por privacidad)`);
      }
      console.log('account/login/completed: success=true');
      return;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('Timeout esperando que termine el login del navegador');
}

function browserCommand(url) {
  if (process.platform === 'win32') return {
    command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command',
      // Login interactivo pedido por el usuario: el navegador debe poder verse y manejarse.
      'Start-Process -FilePath $env:MAGE_CODEX_LOGIN_URL'],
  };
  return { command: process.platform === 'darwin' ? 'open' : 'xdg-open', args: [url] };
}

function loginFailureCategory(error) {
  const text = typeof error === 'string' ? error : '';
  const categories = [
    ['timeout', /timed?\s*out|timeout|expired/i],
    ['port_in_use', /address.*in use|port.*in use/i],
    ['access_denied', /access.denied|denied|cancel/i],
    ['network', /connect|network|dns|resolve host/i],
    ['token_exchange', /token exchange|oauth\/token/i],
    ['state_mismatch', /state.*mismatch|invalid.*state/i],
  ];
  return categories.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}

export async function verifyCodex() {
  if (process.argv.includes('--login') && (process.argv.includes('--offline') || process.argv.includes('--mcp'))) {
    throw new Error('--login debe ejecutarse separado de --offline y --mcp');
  }
  const deps = await verificationDependencies();
  const context = verificationContext(deps);
  const { home, workspace, version } = context;
  console.log(version);
  console.log(`CODEX_HOME temporal: ${home}`);
  const session = rpcSession(context);
  try {
    await initialized(session);
    await inventory(session);
    if (process.argv.includes('--contract')) await probeThreadContract(session, workspace);
    if (process.argv.includes('--apps')) await probeApps(context);
    if (process.argv.includes('--inspect-thread')) await inspectThread(session, workspace);
    await standaloneModes(session, context);
    if (process.argv.includes('--login')) {
      await login(session, context);
      console.log('Ficheros tras login:', readdirSync(home).filter((name) => !name.startsWith('.')));
      await inventory(session);
    }
  } finally {
    await session.close();
    cleanupContext(context);
  }
}

async function standaloneModes(session, context) {
  if (process.argv.includes('--real')) {
    const account = await session.request('account/read');
    if (validatedResult(account, ACCOUNT_RESULT, 'account/read').account?.type !== 'chatgpt') throw new Error('--real exige login oficial en el temporal');
    await session.close();
    const { verifyReal } = await import('./codex-real-verification.mjs');
    await verifyReal(context);
  }
  if (process.argv.includes('--offline')) {
    await session.close();
    await probeEffort(context);
  }
  if (process.argv.includes('--mcp')) {
    await session.close();
    await probeMcp(context);
  }
}

async function inspectThread(session, workspace) {
  const { threadId } = parseExternalJson(readFileSync(join(workspace, 'mage-thread.json'), 'utf8'), THREAD_MARKER, 'Marcador de hilo');
  const reply = await session.request('thread/read', { threadId, includeTurns: true });
  if (reply.error) throw new Error(`thread/read: codigo ${reply.error.code}`);
  const items = validatedResult(reply, THREAD_READ, 'thread/read').thread.turns.flatMap((turn) => turn.items);
  const file = items.findLast((item) => item.type === 'fileChange');
  const mcp = items.find((item) => item.type === 'mcpToolCall' && item.server === 'mage_verify' && JSON.stringify(item.result).includes('MAGE_MCP_ENV_OK'));
  console.log('Hilo persistido:', JSON.stringify({ itemTypes: [...new Set(items.map((item) => item.type))],
    fileFields: Object.keys(file ?? {}), changeFields: Object.keys(file?.changes?.[0] ?? {}),
    diffIsUnified: /^---|^@@/m.test(file?.changes?.[0]?.diff ?? ''), mcpResultFields: Object.keys(mcp?.result ?? {}) }));
  // Solo proyecciones del contenido ARTIFICIAL conocido; jamas serializar el hilo entero ni su metadata.
  if (file?.changes?.length === 1 && file.changes[0].diff.includes('MAGE_EDIT_OK')) {
    writeFileSync('src/main/engine/__fixtures__/codex/real-file-change-0160.json', JSON.stringify(projectVerificationFile(file, workspace), null, 2) + '\n');
  }
  if (mcp?.result?.content?.every((block) => block.type === 'text' && block.text === 'MAGE_MCP_ENV_OK')) {
    writeFileSync('src/main/engine/__fixtures__/codex/real-mcp-0160.json', JSON.stringify(projectVerificationMcp(mcp), null, 2) + '\n');
  }
}

async function probeApps(context) {
  const session = rpcSession({ ...context, args: ['-c', 'features.apps=true'] });
  try {
    await initialized(session);
    const thread = await session.request('thread/start', { cwd: context.workspace, ephemeral: true });
    const threadId = validatedResult(thread, THREAD_RESULT, 'thread/start').thread.id;
    for (const params of [{ limit: 50 }, { limit: 50, threadId, forceRefetch: true }]) {
      const reply = await session.request('app/list', params);
      const errorText = reply.error?.message ?? '';
      const category = /unauthorized|auth|401/i.test(errorText) ? 'auth'
        : /connect|network|fetch|dns|resolve|request|load|502|503/i.test(errorText) ? 'network_or_upstream' : 'other';
      const apps = reply.error ? null : validatedResult(reply, APPS_RESULT, 'app/list');
      console.log('Apps con features.apps:', JSON.stringify({ withThread: !!params.threadId,
        errorCode: reply.error?.code, errorCategory: reply.error ? category : undefined,
        count: apps?.data.length, fields: Object.keys(reply.result ?? {}),
        accessible: apps?.data.filter((app) => app.isAccessible).length,
        enabled: apps?.data.filter((app) => app.isEnabled).length }));
    }
  } finally {
    await session.close();
  }
}

export function verificationContext(deps) {
  const explicit = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  const bin = deps.resolveBinary(explicit);
  const suppliedHome = process.env.MAGE_CODEX_VERIFY_HOME;
  const home = suppliedHome === undefined ? mkdtempSync(join(tmpdir(), 'mage-codex-verify-home-')) : suppliedHome;
  assertTemporary(home, 'mage-codex-verify-home-');
  const workspace = suppliedHome === undefined ? createWorkspace(home) : readOwnedWorkspace(home);
  assertTemporary(workspace, 'mage-codex-verify-ws-');
  const version = deps.spawnSync(bin, ['--version'], { encoding: 'utf8', env: isolatedEnv(home, deps), windowsHide: true });
  if (version.status !== 0) throw new Error('No se pudo consultar la version del binario Codex');
  return { bin, home, workspace, version: version.stdout.trim(), deps };
}

// Raíz de composición: las dependencias reales se crean una vez, fuera de los helpers de medición.
async function verificationDependencies() {
  const { createServer: createLoader } = await import('vite');
  const loader = await createLoader({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { scrubAgentEnv } = await loader.ssrLoadModule('/src/main/os/agentEnv.ts');
    const { resolveCodexBinary } = await loader.ssrLoadModule('/src/main/os/codexBinaryResolver.ts');
    return { spawn, spawnSync, createServer, createLoader, scrubAgentEnv, baseEnv: process.env, platform: process.platform,
      resolveBinary: (explicit) => explicit ?? resolveCodexBinary(),
      createAdapter: (Adapter, params) => new Adapter(params), createSession: (Session, params) => new Session(params) };
  } finally { await loader.close(); }
}

function cleanupContext({ home, workspace }) {
    if (readOwnedWorkspace(home) !== workspace) throw new Error('Contexto temporal de verificación inconsistente');
    if (process.argv.includes('--keep-home')) {
      console.log('Perfil temporal conservado para medir turnos; borrar al finalizar.');
    }
    // Validacion de las rutas antes de cualquier borrado recursivo en Windows.
    for (const dir of process.argv.includes('--keep-home') ? [] : [home, workspace]) {
      assertTemporary(dir, dir === home ? 'mage-codex-verify-home-' : 'mage-codex-verify-ws-');
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
}

export function assertTemporary(dir, prefix) {
  if (typeof dir !== 'string') throw new Error('Ruta temporal invalida');
  const rel = relative(resolve(tmpdir()), resolve(dir));
  if (isAbsolute(rel) || rel.startsWith('..') || !basename(dir).startsWith(prefix) || rel.includes('/') || rel.includes('\\')) {
    throw new Error('La verificacion solo admite sus carpetas directas del temporal del SO');
  }
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error('El temporal de verificación no puede ser un enlace.');
  if (!stat.isDirectory()) throw new Error('El temporal de verificación debe ser un directorio.');
  const expected = join(realpathSync(tmpdir()), basename(resolve(dir)));
  if (realpathSync(dir) !== expected) throw new Error('El temporal de verificación tiene un destino inesperado.');
}

function createWorkspace(home) {
  const workspace = mkdtempSync(join(tmpdir(), 'mage-codex-verify-ws-'));
  const owner = randomUUID();
  writeFileSync(join(workspace, OWNER_FILE), owner, { flag: 'wx' });
  writeFileSync(join(home, MANIFEST_FILE), JSON.stringify({ format: 1, owner, workspace }), { flag: 'wx' });
  return workspace;
}

export function readOwnedWorkspace(home) {
  assertTemporary(home, 'mage-codex-verify-home-');
  let manifest;
  try {
    const path = join(home, MANIFEST_FILE);
    if (lstatSync(path).isSymbolicLink()) throw new Error('Enlace de manifiesto');
    manifest = MANIFEST.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch { throw new Error('El perfil temporal no tiene un manifiesto propio válido.'); }
  assertTemporary(manifest.workspace, 'mage-codex-verify-ws-');
  try {
    const marker = join(manifest.workspace, OWNER_FILE);
    if (lstatSync(marker).isSymbolicLink() || readFileSync(marker, 'utf8') !== manifest.owner) throw new Error('Propiedad inconsistente');
  } catch { throw new Error('El workspace temporal no pertenece a este perfil.'); }
  return manifest.workspace;
}

async function probeThreadContract(session, workspace) {
  for (const permissions of [':read-only', ':workspace']) {
    const reply = await session.request('thread/start', {
      cwd: workspace, model: 'gpt-5.6-luna', effort: 'low', permissions,
      approvalPolicy: 'on-request', ephemeral: true,
    });
    console.log('thread/start:', JSON.stringify({ permissions, errorCode: reply.error?.code,
      model: reply.result?.model, reasoningEffort: reply.result?.reasoningEffort,
      sandbox: reply.result?.sandbox, activePermissionProfile: reply.result?.activePermissionProfile }));
  }
}

// El binario REAL manda Responses a un endpoint LOCAL que rechaza la peticion. Ningun modelo real
// recibe un turno: el cuerpo solo se inspecciona en memoria y se imprime su esfuerzo, nunca el resto.
async function probeEffort(context) {
  writeFileSync(join(context.workspace, 'CLAUDE.md'), 'Instruccion de prueba: MAGE_VERIFY_PROJECT\n');
  const capture = await captureResponses(context.deps);
  const session = rpcSession({ ...context, args: [
    '-c', `model_providers.mage-fake={name="Fake",base_url="http://127.0.0.1:${capture.port}/v1",env_key="MAGE_VERIFY_FAKE_KEY",wire_api="responses"}`,
    '-c', 'model_provider="mage-fake"',
    '-c', 'project_doc_fallback_filenames=["CLAUDE.md"]',
  ], env: { MAGE_VERIFY_FAKE_KEY: 'mage-artificial-key' } });
  try {
    await initialized(session);
    const thread = await session.request('thread/start', {
      cwd: context.workspace, model: 'gpt-5.6-luna', ephemeral: true,
      developerInstructions: 'MAGE_VERIFY_GLOBAL',
    });
    if (!thread.result?.thread?.id) throw new Error('No se pudo abrir el hilo de medicion local');
    for (const effort of [undefined, 'low']) {
      await measureEffortTurn(session, { threadId: thread.result.thread.id, effort, capture });
    }
  } finally {
    await session.close();
    capture.server.closeAllConnections();
    await new Promise((done) => capture.server.close(done));
  }
}

export async function captureResponses(deps) {
  const bodies = [];
  const authorizations = [];
  const server = deps.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { bodies.push(parseExternalJson(raw, RESPONSES_BODY, 'Responses local')); } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'JSON de Responses inválido' } }));
        return;
      }
      authorizations.push(req.headers.authorization === 'Bearer mage-artificial-key');
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Mage: medicion local', type: 'invalid_request_error' } }));
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: server.address().port, bodies, authorizations };
}

async function measureEffortTurn(session, { threadId, effort, capture }) {
      const offset = capture.bodies.length;
      const turn = await session.request('turn/start', {
        threadId, input: [{ type: 'text', text: 'hi', text_elements: [] }],
        ...(effort === undefined ? {} : { effort }),
      });
      if (!turn.result?.turn?.id) throw new Error('No se pudo abrir el turno de medicion local');
      const deadline = Date.now() + RPC_TIMEOUT_MS;
      while (!session.messages.some((m) => m.method === 'turn/completed' && m.params?.turn?.id === turn.result.turn.id)) {
        if (Date.now() >= deadline) throw new Error('El turno local no termino dentro del plazo');
        await new Promise((done) => setTimeout(done, 100));
      }
      console.log(`Responses local: esfuerzo enviado=${effort ?? 'omitido'}, recibido=${capture.bodies[offset]?.reasoning?.effort ?? 'omitido'}`);
      const body = JSON.stringify(capture.bodies[offset]);
      console.log(`Responses local: env_key correcto=${capture.authorizations[offset] === true}; CLAUDE.md recibido=${body?.includes('MAGE_VERIFY_PROJECT') === true}; global recibido=${body?.includes('MAGE_VERIFY_GLOBAL') === true}`);
}

async function probeMcp(context) {
  const args = ['-c', `mcp_servers.mage_verify.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.mage_verify.args=${JSON.stringify([fileURLToPath(import.meta.url), '--mcp-server'])}`,
    '-c', 'mcp_servers.mage_verify.env_vars=["MAGE_VERIFY_MCP_SECRET"]'];
  const fakeSecret = 'mage-artificial-mcp-secret';
  if (args.join(' ').includes(fakeSecret)) throw new Error('El secreto artificial aparece en argv');
  const session = rpcSession({ ...context, args, env: { MAGE_VERIFY_MCP_SECRET: fakeSecret } });
  try {
    await initialized(session);
    const thread = await session.request('thread/start', { cwd: context.workspace, model: 'gpt-5.6-luna', ephemeral: true });
    const threadId = thread.result?.thread?.id;
    if (!threadId) throw new Error('No se pudo abrir el hilo de medicion MCP');
    const status = await session.request('mcpServerStatus/list', { threadId });
    const entry = status.result?.data?.find((s) => s.name === 'mage_verify');
    console.log(`MCP: servidor descubierto=${entry !== undefined}; herramientas=${Object.keys(entry?.tools ?? {}).length}`);
    const called = await session.request('mcpServer/tool/call', { threadId, server: 'mage_verify', tool: 'probe', arguments: {} });
    const text = JSON.stringify(called.result);
    console.log(`MCP: llamada correcta=${text?.includes('MAGE_MCP_ENV_OK') === true}; error=${called.error?.code ?? 'ninguno'}; secreto en argv=false`);
    if (!text?.includes('MAGE_MCP_ENV_OK')) throw new Error('La herramienta MCP no confirmo el entorno esperado');
  } finally {
    await session.close();
  }
}

function serveMcp() {
  const input = createInterface({ input: process.stdin });
  input.on('line', (line) => {
    let request;
    try { request = parseExternalJson(line, RPC_MESSAGE, 'MCP'); } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Petición MCP inválida' } })}\n`);
      return;
    }
    if (request.id === undefined) return;
    let result = {};
    if (request.method === 'initialize') {
      const params = z.object({ protocolVersion: z.string() }).safeParse(request.params);
      if (!params.success) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'Parámetros MCP inválidos' } })}\n`); return; }
      result = { protocolVersion: params.data.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Mage verification', version: '1' } };
    }
    if (request.method === 'tools/list') result = { tools: [{ name: 'probe', description: 'Confirma la entrega del entorno sin revelar su valor', annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, inputSchema: { type: 'object', properties: {} } }] };
    if (request.method === 'tools/call') result = { content: [{ type: 'text', text: process.env.MAGE_VERIFY_MCP_SECRET === 'mage-artificial-mcp-secret' ? 'MAGE_MCP_ENV_OK' : 'MAGE_MCP_ENV_MISSING' }] };
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  });
}

if (process.argv.includes('--mcp-server')) serveMcp();
