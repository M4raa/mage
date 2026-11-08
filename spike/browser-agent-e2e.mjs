// Spike del carril S (S05): el TURNO REAL de Claude con las herramientas `mage_browser_*` de Mage (navegar, leer, pulsar, escribir
// y capturar) y sus permisos. NO lanza Mage: se usa contra un Mage SIN EMPAQUETAR ya abierto con `--user-data-dir <perfil>`, con una
// cuenta de Claude (la de la verificación: clave de API desechable o suscripción, sin copiar credenciales) y «Registrar en todas las
// cuentas» del servidor MCP de Mage hecho en Ajustes. Es un cliente del host (`scripts/mage-cli/hostLink.mjs`, `kind: 'terminal'`):
// crea UNA sesión de Claude, le manda UN prompt, contesta `allow` SOLO a los permisos de las herramientas `mage_browser_*` (cualquier
// otro se deniega y se anota) y mide contra un servidor local con la página de prueba (`spike/__fixtures__/browser-test-page.html`).
//   node spike/browser-agent-e2e.mjs --user-data-dir <dir> --claude-account <configDir> --cwd <carpeta> [--claude-model <id>] --out <fichero.json>
// Medidas: b1 (permiso una vez por llamada para navigate, read_dom, click y type, todos allow), b2 (el servidor recibió el clic),
// b3 (el último input vale «hola mage»), b4 (el resultado de mage_browser_screenshot no es error), b5 (el último texto contiene HECHO),
// b6 (ninguna línea con la credencial), `turnos` (esperado 1) y `denegados` (esperado vacío). La salida solo lleva booleanos, recuentos
// e ids. Sale con 0 solo si b1-b6 se cumplen y `turnos` vale 1.
// Consume: 1 turno real de Claude (modelo por defecto claude-haiku-4-5, esfuerzo low). Tope total: 300 s de espera al `result`.
// Medido contra: protocolo del host 1.5.
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { connectVerified } = await import(pathToFileURL(path.join(repo, 'scripts', 'mage-cli', 'hostLink.mjs')).href);

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  const value = index === -1 ? undefined : args[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
};

const RESULT_TIMEOUT_MS = 300_000;
const POLL_MS = 500;
const SETTLE_MS = 2_000;
const CLAUDE_MODEL_DEFAULT = 'claude-haiku-4-5';
const EFFORT = 'low';
const EXPECTED_TURNS = 1;
const TYPED_TEXT = 'hola mage';
const FINAL_WORD = 'HECHO';
const REQUIRED_PERMISSIONS = ['navigate', 'read_dom', 'click', 'type'];
const BROWSER_TOOL = /(^|__|\.|\/)mage_browser_(navigate|screenshot|read_dom|click|type|back|close)$/;
const CALLER_LEAK = /MAGE_MCP_CALLER|\b[0-9a-f]{64}\b/;
const FIXTURE = path.join(repo, 'spike', '__fixtures__', 'browser-test-page.html');
const SECOND_PAGE = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Segunda</title></head><body><p>Segunda</p></body></html>';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const shortName = (toolName) => toolName.split(/__|\.|\//).at(-1).replace(/^mage_browser_/, '');

// El prompt EXACTO de la devolución S05 (con la URL de la página de prueba).
function promptFor(url) {
  return `Usa SOLO las herramientas mage_browser_* de Mage, en este orden: 1) mage_browser_navigate a ${url}. 2) mage_browser_read_dom. `
    + '3) mage_browser_click en el botón «Pulsar». 4) mage_browser_type en el campo «Nombre» con el texto «hola mage». '
    + '5) mage_browser_screenshot con annotate: true. Después contesta solo «HECHO».';
}

// Servidor de la página de prueba: `/` y `/segunda`, y cada `POST /evento` (JSON) a la lista `events`.
function startFixtureServer(events) {
  const page = fs.readFileSync(FIXTURE, 'utf8');
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/evento') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          events.push(JSON.parse(body));
        } catch (error) {
          events.push({ kind: 'invalid', error: error.message });
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }
    const known = { '/': page, '/segunda': SECOND_PAGE }[req.url];
    res.writeHead(known === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(known);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
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

// Estado acumulado de la sesión: permisos pedidos y contestados, tool_use por id, tool_result y el último texto del asistente.
class Spike {
  constructor(rpc, sessionRef) {
    this.rpc = rpc;
    this.sessionRef = sessionRef;
    this.results = 0;
    this.lastText = '';
    this.leakedLines = 0;
    this.permissions = [];
    this.denied = [];
    this.toolNameById = new Map();
    this.toolResults = [];
    rpc.onNotification((method, params) => this.onNotification(method, params));
  }

  onNotification(method, params) {
    if (method !== 'event' || params.sessionId !== this.sessionRef.id) return;
    if (CALLER_LEAK.test(JSON.stringify(params))) this.leakedLines += 1;
    this.apply(params.event);
  }

  apply(event) {
    if (event.kind === 'assistant_text') this.lastText = event.text;
    if (event.kind === 'result') this.results += 1;
    if (event.kind === 'tool_use') this.toolNameById.set(event.tool.toolUseId, event.tool.toolName);
    if (event.kind === 'tool_result') this.toolResults.push({ toolUseId: event.result.toolUseId, isError: event.result.isError, output: event.result.output });
    if (event.kind === 'permission_request') this.answerPermission(event.request);
  }

  // SOLO las herramientas `mage_browser_*` reciben `allow`; cualquier otra se deniega y se anota.
  answerPermission(request) {
    const allowed = BROWSER_TOOL.test(request.toolName);
    if (!allowed) this.denied.push({ toolName: request.toolName });
    const decision = allowed ? { behavior: 'allow' } : { behavior: 'deny', message: 'El spike solo permite las herramientas mage_browser_*' };
    this.permissions.push({ tool: allowed ? shortName(request.toolName) : request.toolName, behavior: decision.behavior });
    this.rpc.call('session.answerPermission', { sessionId: this.sessionRef.id, requestId: request.requestId, decision }).catch((error) => this.denied.push({ error: error.message }));
  }

  async subscribe() {
    const { snapshot } = await this.rpc.call('session.subscribe', { sessionId: this.sessionRef.id });
    for (const pending of snapshot.pending) {
      if (pending.kind === 'permission') this.apply({ kind: 'permission_request', request: pending.request });
    }
  }
}

async function waitUntil(deadline, label, check) {
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(POLL_MS);
  }
  throw new Error(`Plazo agotado esperando: ${label}`);
}

function requireOptions() {
  const missing = ['user-data-dir', 'claude-account', 'cwd', 'out'].filter((name) => option(name) === undefined);
  if (missing.length > 0) throw new Error(`Faltan opciones: ${missing.map((name) => `--${name}`).join(', ')}`);
  return {
    userDataDir: path.resolve(option('user-data-dir')), claudeAccount: option('claude-account'),
    cwd: path.resolve(option('cwd')), out: path.resolve(option('out')), claudeModel: option('claude-model') ?? CLAUDE_MODEL_DEFAULT,
  };
}

async function assertAccount(rpc, accountId) {
  const { accounts } = await rpc.call('accounts.list');
  const found = accounts.find((account) => account.id === accountId && account.provider === 'claude');
  if (found === undefined) throw new Error(`accounts.list no tiene la cuenta de Claude ${accountId}`);
  return { provider: found.provider, billing: found.billing };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

// b1: un permiso por llamada (tantos permisos como tool_use de cada herramienta), todos allow, y los cuatro nombres exigidos presentes.
function measurePermissions(spike) {
  const asked = countBy(spike.permissions.filter((p) => p.behavior === 'allow').map((p) => p.tool));
  const called = countBy([...spike.toolNameById.values()].filter((name) => BROWSER_TOOL.test(name)).map(shortName));
  const everyAllowed = spike.permissions.length > 0 && spike.permissions.every((p) => p.behavior === 'allow');
  const oncePerCall = Object.keys(called).every((tool) => asked[tool] === called[tool]);
  return { ok: everyAllowed && oncePerCall && REQUIRED_PERMISSIONS.every((tool) => (asked[tool] ?? 0) >= 1), pedidos: asked, llamadas: called };
}

// b4: el tool_result de la llamada a mage_browser_screenshot, sin error. La forma exacta se anota (`isError` del ToolResult de Mage y largo de la salida).
function measureScreenshot(spike) {
  const ids = [...spike.toolNameById].filter(([, name]) => BROWSER_TOOL.test(name) && shortName(name) === 'screenshot').map(([id]) => id);
  const results = spike.toolResults.filter((result) => ids.includes(result.toolUseId));
  return {
    ok: results.length > 0 && results.every((result) => result.isError !== true),
    resultados: results.map((result) => ({ isError: result.isError, caracteres: String(result.output).length, empiezaPor: String(result.output).slice(0, 40) })),
  };
}

function measureServer(events) {
  const lastInput = events.filter((event) => event.kind === 'input').at(-1);
  return {
    b2: { ok: events.some((event) => event.kind === 'click'), clics: events.filter((event) => event.kind === 'click').length },
    b3: { ok: lastInput?.value === TYPED_TEXT, ultimoInput: lastInput?.value ?? null },
  };
}

async function runTurn(rpc, spike, options, url, deadline) {
  const created = await rpc.call('session.create', {
    commandId: randomUUID(), provider: 'claude', accountId: options.claudeAccount, cwd: options.cwd, model: options.claudeModel, effort: EFFORT, trust: { acknowledged: false },
  });
  spike.sessionRef.id = created.sessionId;
  await spike.subscribe();
  await rpc.call('session.send', { sessionId: created.sessionId, text: promptFor(url), commandId: randomUUID() });
  await waitUntil(deadline, 'el result de la sesión de Claude', () => spike.results >= 1);
  await sleep(SETTLE_MS);
  return created.sessionId;
}

async function main() {
  const options = requireOptions();
  const events = [];
  const server = await startFixtureServer(events);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { rpc, socket } = await connectVerified({ userDataDir: options.userDataDir, clientVersion: 'browser-agent-e2e-spike', deps: linkDeps, client: { kind: 'terminal' } });
  const spike = new Spike(rpc, { id: null });
  const report = { spike: 'browser-agent-e2e', at: new Date().toISOString(), modelo: options.claudeModel, esfuerzo: EFFORT, url };
  try {
    report.cuenta = await assertAccount(rpc, options.claudeAccount);
    report.sessionId = await runTurn(rpc, spike, options, url, Date.now() + RESULT_TIMEOUT_MS);
    Object.assign(report, measureServer(events));
    report.b1 = measurePermissions(spike);
    report.b4 = measureScreenshot(spike);
    report.b5 = { ok: spike.lastText.includes(FINAL_WORD), textoFinal: spike.lastText.slice(0, 200) };
    report.b6 = { ok: spike.leakedLines === 0, lineasConCredencial: spike.leakedLines };
    report.eventosDelServidor = events.map((event) => event.kind);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    rpc.close();
    socket.destroy();
    server.close();
  }
  report.turnos = spike.results;
  report.denegados = spike.denied;
  report.ok = report.error === undefined && ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].every((key) => report[key]?.ok === true)
    && report.turnos === EXPECTED_TURNS && spike.denied.length === 0;
  fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
