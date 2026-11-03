// Spike del punto de control cp/M-05 (carril M): la «Salida» de F11 con TURNOS REALES (modelo más bajo, contabilizados).
// NO lanza Mage: lo usa la sesión de verificación contra un Mage SIN EMPAQUETAR ya abierto con un perfil propio
// (`--user-data-dir`), con dos cuentas (Claude por suscripción, sin copiar credenciales, y Codex con un CODEX_HOME desechable con
// `codex login` del usuario) y con «Registrar en todas las cuentas» hecho en Ajustes (cp/M-04 en verde). Es un cliente del host
// (`scripts/mage-cli/hostLink.mjs`, `kind: 'terminal'`): crea una sesión, le manda UN prompt que le pide delegar con `mage_create_session`,
// contesta `allow` a los permisos de las herramientas `mage_*` (y SOLO a esas: cualquier otra se deniega y se anota) y mide.
//   node spike/delegation-e2e.mjs --user-data-dir <dir> --claude-account <configDir> --codex-account <configDir> --cwd <carpeta> [--reverse]
//        [--expect-depth-rejection] [--claude-model <id>] --out <fichero.json>
// Caso normal: Claude (haiku, esfuerzo low) crea una sesión de Codex (gpt-6-luna). `--reverse`: Codex (gpt-6-luna, low) crea una de Claude
// (cubre el reenvío `env_vars` de la M05). `--expect-depth-rejection`: con la profundidad puesta en 1 en Ajustes ANTES de lanzar, el mismo
// prompt; se espera `delegation_depth_exceeded` en la herramienta y NINGUNA sesión nueva. El CICLO no se puede provocar con agentes reales
// (una sesión solo crea sesiones NUEVAS): lo cubren los tests unitarios de `src/main/mcpServer/delegation.test.ts`.
// Medidas (e1-e5, `turnos`; en el modo de rechazo, d1-d2): ver `failures`. La salida solo lleva booleanos, recuentos, ids de sesión y los
// textos de ESTE spike. Turnos reales: los de `turnos` (típicamente haiku 1 + gpt-6-luna 2). Medido contra: protocolo del host 1.5.
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { connectVerified } = await import(pathToFileURL(path.join(repo, 'scripts', 'mage-cli', 'hostLink.mjs')).href);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  const value = index === -1 ? undefined : args[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
};

const TOTAL_TIMEOUT_MS = 600_000;
const POLL_MS = 500;
const SETTLE_MS = 3_000;
const INDEX_WAIT_MS = 20_000;
const EXCERPT_CHARS = 300;
const CLAUDE_MODEL_DEFAULT = 'claude-haiku-4-5';
const CODEX_MODEL = 'gpt-6-luna';
const EFFORT = 'low';
const EXPECTED_CHILD_TURNS = 2;
const EXPECTED_FINAL_NUMBER = '8';
const MAGE_TOOL = /(^|__|\.|\/)mage_(create_session|get_status|read_result|send|list_sessions|cancel)$/;
const CALLER_LEAK = /MAGE_MCP_CALLER|\b[0-9a-f]{64}\b/;
const DEPTH_TEXT = 'delegation_depth_exceeded';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// El prompt EXACTO de la devolución (con el proveedor, el modelo y la carpeta del hijo).
function promptFor({ provider, model, cwd }) {
  const providerName = provider === 'codex' ? 'Codex' : 'Claude';
  return `Usa la herramienta mage_create_session para crear una sesión de ${providerName} (provider ${provider}, model ${model}, cwd ${cwd}) con este prompt: `
    + '"Antes de hacer nada, pregúntale a quien te encargó esto qué número entero del 1 al 9 prefiere, y termina tu respuesta con esa pregunta. '
    + 'Cuando te conteste, responde solo con ese número multiplicado por 2." '
    + 'Después consulta mage_get_status y mage_read_result hasta que la sesión de ' + providerName + ' termine su turno, contéstale con mage_send (mode queue) '
    + 'que prefieres el 4, espera a que vuelva a terminar y dime solo el número final.';
}

function connectSocket(address) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

const linkDeps = {
  platform: process.platform, readFile: (file) => fs.readFileSync(file, 'utf8'), lstat: fs.lstatSync,
  getuid: process.getuid?.bind(process) ?? (() => -1), connect: connectSocket, randomBytes,
};

// Estado acumulado por sesión suscrita: eventos de interés, `result` contados y el último texto del asistente.
class Watch {
  constructor(sessionId, role, model) {
    Object.assign(this, { sessionId, role, model, results: 0, lastText: '', kinds: new Set(), delegation: [], toolTexts: [] });
  }
}

class Spike {
  constructor(rpc) {
    this.rpc = rpc;
    this.watches = new Map();
    this.denied = [];
    this.answered = [];
    this.leakedLines = 0;
    this.conversationBySession = new Map();
    rpc.onNotification((method, params) => this.onNotification(method, params));
  }

  onNotification(method, params) {
    if (method !== 'event') return;
    if (CALLER_LEAK.test(JSON.stringify(params))) this.leakedLines += 1;
    if (params.conversationId) this.conversationBySession.set(params.sessionId, params.conversationId);
    this.apply(params.sessionId, params.event);
  }

  apply(sessionId, event) {
    const watch = this.watches.get(sessionId);
    if (watch === undefined) return;
    watch.kinds.add(event.kind);
    if (event.kind === 'assistant_text') watch.lastText = event.text;
    if (event.kind === 'result') watch.results += 1;
    if (event.kind.startsWith('delegation_')) watch.delegation.push(event);
    if (event.kind === 'tool_result') watch.toolTexts.push(JSON.stringify(event.result));
    if (event.kind === 'permission_request') this.answerPermission(sessionId, event.request);
    if (event.kind === 'elicitation_request') this.answerElicitation(sessionId, event.request);
  }

  // SOLO las herramientas `mage_*` reciben `allow`; cualquier otra se deniega y se anota.
  answerPermission(sessionId, request) {
    const allowed = MAGE_TOOL.test(request.toolName);
    if (!allowed) this.denied.push({ sessionId, toolName: request.toolName });
    const decision = allowed ? { behavior: 'allow' } : { behavior: 'deny', message: 'El spike solo permite las herramientas mage_*' };
    this.answered.push({ sessionId, toolName: request.toolName, behavior: decision.behavior });
    this.rpc.call('session.answerPermission', { sessionId, requestId: request.requestId, decision }).catch((error) => this.denied.push({ sessionId, error: error.message }));
  }

  // Codex pide la aprobación de una herramienta MCP como elicitación: solo la del servidor `mage`.
  answerElicitation(sessionId, request) {
    const action = request.server === 'mage' ? 'accept' : 'decline';
    if (action === 'decline') this.denied.push({ sessionId, elicitationServer: request.server });
    this.answered.push({ sessionId, elicitationServer: request.server, action });
    this.rpc.call('session.answerElicitation', { sessionId, requestId: request.requestId, action }).catch((error) => this.denied.push({ sessionId, error: error.message }));
  }

  async watch(sessionId, role, model) {
    const watch = new Watch(sessionId, role, model);
    this.watches.set(sessionId, watch);
    const { snapshot } = await this.rpc.call('session.subscribe', { sessionId });
    if (snapshot.conversationId) this.conversationBySession.set(sessionId, snapshot.conversationId);
    for (const pending of snapshot.pending) {
      this.apply(sessionId, pending.kind === 'permission' ? { kind: 'permission_request', request: pending.request } : { kind: 'elicitation_request', request: pending.request });
    }
    return watch;
  }

  async sessionIds() {
    const { sessions } = await this.rpc.call('sessions.list');
    return sessions;
  }
}

async function waitUntil(deadline, label, check) {
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(POLL_MS);
  }
  throw new Error(`Plazo agotado esperando: ${label}`);
}

// `conversation-index.json` del perfil: SOLO `createdBy` y `creatorChain` de la conversación hija (puede tardar en volcarse a disco).
async function readDelegation(userDataDir, conversationId, deadline) {
  const file = path.join(userDataDir, 'conversation-index.json');
  const limit = Math.min(deadline, Date.now() + INDEX_WAIT_MS);
  while (Date.now() < limit) {
    const entry = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).conversations?.[conversationId] : undefined;
    if (entry?.createdBy !== undefined) return { createdBy: entry.createdBy, creatorChain: entry.creatorChain ?? [] };
    await sleep(POLL_MS);
  }
  return null;
}

function requireOptions() {
  const missing = ['user-data-dir', 'claude-account', 'codex-account', 'cwd', 'out'].filter((name) => option(name) === undefined);
  if (missing.length > 0) throw new Error(`Faltan opciones: ${missing.map((name) => `--${name}`).join(', ')}`);
  return {
    userDataDir: path.resolve(option('user-data-dir')), claudeAccount: option('claude-account'), codexAccount: option('codex-account'),
    cwd: path.resolve(option('cwd')), out: path.resolve(option('out')), claudeModel: option('claude-model') ?? CLAUDE_MODEL_DEFAULT,
    reverse: flag('reverse'), expectDepthRejection: flag('expect-depth-rejection'),
  };
}

// Padre e hijo según el sentido: normal = Claude crea Codex; `--reverse` = Codex crea Claude.
function roles(options) {
  const claude = { provider: 'claude', accountId: options.claudeAccount, model: options.claudeModel };
  const codex = { provider: 'codex', accountId: options.codexAccount, model: CODEX_MODEL };
  return options.reverse ? { parent: codex, child: claude } : { parent: claude, child: codex };
}

async function assertAccounts(spike, { parent, child }) {
  const { accounts } = await spike.rpc.call('accounts.list');
  const found = [parent, child].map((role) => accounts.find((account) => account.id === role.accountId && account.provider === role.provider));
  const missing = [parent, child].filter((_, index) => found[index] === undefined).map((role) => `${role.provider}:${role.accountId}`);
  if (missing.length > 0) throw new Error(`accounts.list no tiene las cuentas ${missing.join(', ')}`);
  return found.map((account) => ({ provider: account.provider, billing: account.billing }));
}

async function runParent(spike, options, { parent, child }, deadline) {
  const before = new Set((await spike.sessionIds()).map((snapshot) => snapshot.sessionId));
  const created = await spike.rpc.call('session.create', {
    commandId: randomUUID(), provider: parent.provider, accountId: parent.accountId, cwd: options.cwd, model: parent.model, effort: EFFORT, trust: { acknowledged: false },
  });
  const parentWatch = await spike.watch(created.sessionId, 'parent', parent.model);
  await spike.rpc.call('session.send', { sessionId: created.sessionId, text: promptFor({ provider: child.provider, model: child.model, cwd: options.cwd }), commandId: randomUUID() });
  let childWatch = null;
  await waitUntil(deadline, 'el result de la sesión creadora', async () => {
    if (!options.expectDepthRejection && childWatch === null) {
      const fresh = (await spike.sessionIds()).find((snapshot) => !before.has(snapshot.sessionId) && snapshot.provider === child.provider);
      if (fresh !== undefined) childWatch = await spike.watch(fresh.sessionId, 'child', child.model);
    }
    return parentWatch.results >= 1;
  });
  await sleep(SETTLE_MS);
  const newSessions = (await spike.sessionIds()).filter((snapshot) => !before.has(snapshot.sessionId) && snapshot.provider === child.provider);
  return { parentWatch, childWatch, newSessions };
}

function countTurns(watches) {
  const turns = {};
  for (const watch of watches) turns[watch.model] = (turns[watch.model] ?? 0) + watch.results;
  return turns;
}

async function measureNormal(spike, options, run, deadline) {
  const { parentWatch, childWatch, newSessions } = run;
  const report = { e1: { ok: newSessions.length === 1 && childWatch !== null, nuevasSesiones: newSessions.length } };
  const childConversation = childWatch === null ? undefined : spike.conversationBySession.get(childWatch.sessionId);
  const parentConversation = spike.conversationBySession.get(parentWatch.sessionId);
  const delegation = childConversation === undefined ? null : await readDelegation(options.userDataDir, childConversation, deadline);
  report.e2 = {
    ok: delegation !== null && delegation.createdBy.conversationId === parentConversation && delegation.creatorChain.includes(parentConversation),
    createdByConversationId: delegation?.createdBy.conversationId ?? null, creatorChain: delegation?.creatorChain ?? null, creadora: parentConversation ?? null,
  };
  const finalText = parentWatch.lastText;
  report.e3 = { ok: childWatch?.results === EXPECTED_CHILD_TURNS && finalText.includes(EXPECTED_FINAL_NUMBER), turnosDelHijo: childWatch?.results ?? 0, textoFinalCreadora: finalText.slice(0, EXCERPT_CHARS) };
  const delegationEvents = parentWatch.delegation;
  const messageKinds = delegationEvents.filter((event) => event.kind === 'delegation_message').map((event) => event.messageKind);
  report.e4 = {
    ok: ['delegation_created', 'delegation_state'].every((kind) => delegationEvents.some((event) => event.kind === kind)) && ['question', 'result'].every((kind) => messageKinds.includes(kind)),
    kinds: [...new Set(delegationEvents.map((event) => event.kind))], messageKinds,
  };
  return report;
}

function measureDepthRejection(spike, run) {
  const text = run.parentWatch.toolTexts.find((candidate) => candidate.includes(DEPTH_TEXT));
  const at = text === undefined ? -1 : text.indexOf(DEPTH_TEXT);
  return {
    d1: { ok: text !== undefined, texto: at === -1 ? null : text.slice(Math.max(0, at - 40), at + EXCERPT_CHARS) },
    d2: { ok: run.newSessions.length === 0, nuevasSesiones: run.newSessions.length },
  };
}

async function main() {
  const options = requireOptions();
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const { rpc, socket } = await connectVerified({ userDataDir: options.userDataDir, clientVersion: 'delegation-e2e-spike', deps: linkDeps, client: { kind: 'terminal' } });
  const spike = new Spike(rpc);
  const pair = roles(options);
  const report = {
    spike: 'delegation-e2e', checkpoint: 'cp/M-05', at: new Date().toISOString(), sentido: options.reverse ? 'reverse' : 'normal',
    modo: options.expectDepthRejection ? 'depth-rejection' : 'salida', modelos: { creadora: pair.parent.model, hija: pair.child.model },
  };
  try {
    report.cuentas = await assertAccounts(spike, pair);
    const run = await runParent(spike, options, pair, deadline);
    Object.assign(report, options.expectDepthRejection ? measureDepthRejection(spike, run) : await measureNormal(spike, options, run, deadline));
    report.e5 = { ok: spike.leakedLines === 0, lineasConCredencial: spike.leakedLines };
    report.turnos = countTurns([...spike.watches.values()]);
    report.permisosContestados = spike.answered;
    report.denegados = spike.denied;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.turnos = countTurns([...spike.watches.values()]);
    report.denegados = spike.denied;
  } finally {
    rpc.close();
    socket.destroy();
  }
  const keys = options.expectDepthRejection ? ['d1', 'd2', 'e5'] : ['e1', 'e2', 'e3', 'e4', 'e5'];
  report.ok = report.error === undefined && keys.every((key) => report[key]?.ok === true);
  fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
