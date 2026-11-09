// Spike P-038 (2026-11-09): el escenario del usuario con el MCP de Mage ACTIVADO (`mageMcpEnabled`). En la 0.1.4, sin el MCP,
// el modelo usó subagentes y luego `claude -p` desde Bash (varios intentos, sesiones sueltas). Aquí, contra un Mage SIN
// EMPAQUETAR ya abierto con `--user-data-dir <perfil>` (cliente del host, `kind: 'terminal'`), se crea UNA sesión de Claude, se
// le manda el prompt LITERAL del usuario y se mide qué herramientas elige, cuántas sesiones crea con `mage_create_session` y el
// texto final. Se contesta `allow` a todo permiso (para ver la conducta natural) y se anota cada uno.
//   node spike/mage-sessions-e2e.mjs --user-data-dir <dir> --claude-account <configDir> --cwd <carpeta> --out <fichero.json> [--claude-model <id>] [--prompt <texto>]
// Consume: el turno de la creadora (haiku por defecto, esfuerzo low) más el de cada sesión hija. Medido contra: protocolo del host 1.7.
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
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

const RESULT_TIMEOUT_MS = 420_000;
const POLL_MS = 500;
const QUIET_MS = 45_000;
const EFFORT = 'low';
// El prompt del usuario del 2026-11-08 (conversación d92fe0c9), tal cual.
const DEFAULT_PROMPT = 'otras sesiones nuevas, lanza dos , una que diga hola y otra que diga adiós, también que quiero que cada una genere un numero aleatorio de una cifra y que tu las sumes';

// `--prompt <texto>`: otro escenario con el mismo registro de herramientas (p. ej. el navegador).
const PROMPT = option('prompt') ?? DEFAULT_PROMPT;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const connectSocket = (address) => new Promise((resolve, reject) => {
  const socket = net.createConnection(address);
  socket.once('connect', () => resolve(socket));
  socket.once('error', reject);
});
const linkDeps = {
  platform: process.platform, readFile: (file) => fs.readFileSync(file, 'utf8'), lstat: fs.lstatSync,
  getuid: process.getuid?.bind(process) ?? (() => -1), connect: connectSocket, randomBytes,
};

async function main() {
  const missing = ['user-data-dir', 'claude-account', 'cwd', 'out'].filter((name) => option(name) === undefined);
  if (missing.length > 0) throw new Error(`Faltan opciones: ${missing.map((name) => `--${name}`).join(', ')}`);
  const out = path.resolve(option('out'));
  const { rpc, socket } = await connectVerified({ userDataDir: path.resolve(option('user-data-dir')), clientVersion: 'mage-sessions-e2e-spike', deps: linkDeps, client: { kind: 'terminal' } });
  const state = { sessionId: null, results: 0, lastText: '', tools: [], permissions: [], lastEventAt: Date.now() };
  rpc.onNotification((method, params) => {
    if (method !== 'event' || params.sessionId !== state.sessionId) return;
    const event = params.event;
    state.lastEventAt = Date.now();
    if (event.kind === 'assistant_text') state.lastText = event.text;
    if (event.kind === 'result') state.results += 1;
    if (event.kind === 'tool_use') state.tools.push({ name: event.tool.toolName, input: JSON.stringify(event.tool.input ?? {}).slice(0, 160) });
    if (event.kind === 'permission_request') {
      state.permissions.push(event.request.toolName);
      rpc.call('session.answerPermission', { sessionId: state.sessionId, requestId: event.request.requestId, decision: { behavior: 'allow' } }).catch(() => undefined);
    }
  });
  const report = { spike: 'mage-sessions-e2e', at: new Date().toISOString(), prompt: PROMPT };
  try {
    const created = await rpc.call('session.create', { commandId: randomUUID(), provider: 'claude', accountId: option('claude-account'), cwd: path.resolve(option('cwd')), model: option('claude-model') ?? 'claude-haiku-4-5', effort: EFFORT, trust: { acknowledged: false } });
    state.sessionId = created.sessionId;
    await rpc.call('session.subscribe', { sessionId: state.sessionId });
    await rpc.call('session.send', { sessionId: state.sessionId, text: PROMPT, commandId: randomUUID() });
    // La creadora puede abrir más de un turno (la espera de sus hijas): se espera al primer `result` y a un rato de silencio.
    const deadline = Date.now() + RESULT_TIMEOUT_MS;
    while (Date.now() < deadline && !(state.results >= 1 && Date.now() - state.lastEventAt > QUIET_MS)) await sleep(POLL_MS);
    const names = state.tools.map((tool) => tool.name.split('__').at(-1));
    report.herramientas = names;
    report.creadas = names.filter((name) => name === 'mage_create_session').length;
    report.usoAgentOBash = names.filter((name) => name === 'Agent' || name === 'Task' || name === 'Bash' || name === 'PowerShell').length;
    report.permisos = state.permissions;
    report.turnos = state.results;
    report.textoFinal = state.lastText.slice(0, 400);
    report.llamadas = state.tools;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    rpc.close();
    socket.destroy();
  }
  report.ok = report.error === undefined && report.creadas === 2 && report.usoAgentOBash === 0;
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
