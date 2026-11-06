// Spike E1: los tres recorridos de tareas con el código REAL de Mage
// (`buildTaskInstructions`, `withTaskDirectories`, `parseDeliverables`, `checkDeliverables`; entrada `tasks-e1-entry.ts`,
// empaquetada aquí con esbuild) y el comprobador de cada recorrido (`tasks-e1-fixtures.mjs`).
//
//   node spike/tasks-e1.mjs --build-only                      solo empaqueta la entrada (comprueba que compila; sin CLI)
//   node spike/tasks-e1.mjs --engine claude [--out <fichero>]       3 TURNOS REALES con el `claude` de ~/.claude (haiku, esfuerzo low)
//   node spike/tasks-e1.mjs --engine codex-fake [--out <fichero>]   sin modelo: `scripts/fake-codex-app-server.mjs` por JSON-RPC
// `--out` por defecto: .verify-out/tasks-e1.json.
//
// Modo claude: UN mensaje de usuario por recorrido (3 turnos en total, sin reintentos), en %TEMP%\mage-r-e1-<n>-<aleatorio>.
// Corre SIN CLAUDE_CONFIG_DIR (la cuenta de ~/.claude del usuario; nunca se copian credenciales) con el entorno saneado igual
// que Mage (`scrubAgentEnv`). Cada permiso se concede solo si todas las rutas de la petición caen dentro de las carpetas
// autorizadas; si no, se deniega y se cuenta. Al acabar borra sus carpetas temporales y SOLO sus transcripciones de
// ~/.claude/projects/.
// Modo codex-fake: el falso no escribe ficheros, así que lo esperado es que el protocolo complete, no haya manifiesto
// (`parseDeliverables` -> null) y el veredicto sea 'incomplete'. Usa su escenario `approval` (único que atiende
// thread/start y turn/start) y rechaza el permiso que pide.
// Sale con 0 si cada recorrido terminó y dio lo esperado (claude: check ok y veredicto 'verified'; codex-fake: 'incomplete'
// sin manifiesto) y con 1 si no.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { linguiCatalogPlugin } from '../scripts/lib/linguiEsbuildPlugin.mjs';
import { createRecorrido } from './tasks-e1-fixtures.mjs';

const self = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(self), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const RECORRIDOS = [1, 2, 3];
const TURN_TIMEOUT_MS = 6 * 60_000;
const RPC_TIMEOUT_MS = 30_000;
const TEMP_PREFIX = 'mage-r-e1-';
const isWindows = process.platform === 'win32';
const CLAUDE = isWindows ? 'claude.exe' : 'claude';
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
const outFile = path.resolve(option('out') ?? path.join(repo, '.verify-out', 'tasks-e1.json'));

async function build(outDir) {
  const require = createRequire(path.join(repo, 'package.json'));
  const esbuild = require(path.join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
  const outfile = path.join(outDir, 'tasks-e1-bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(repo, 'spike/tasks-e1-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
    alias: { '@shared': path.join(repo, 'src/shared') }, plugins: [linguiCatalogPlugin(repo)], logLevel: 'error',
  });
  return outfile;
}

// --- Permisos de Claude: ¿caen todas las rutas dentro de las carpetas autorizadas? --------------------------------

const key = (p) => (caseInsensitive ? path.resolve(p).toLowerCase() : path.resolve(p));
function isInside(folders, candidate, base) {
  const target = key(path.resolve(base, candidate));
  return folders.some((folder) => {
    const root = key(folder);
    return target === root || target.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
  });
}

const ABSOLUTE_IN_COMMAND = /(?:[A-Za-z]:[\\/][^\s"'<>|;&]*|(?<![\w.:])\/[^\s"'<>|;&]*)/g;
const PARENT_ESCAPE = /(^|[\s"'\\/])\.\.([\\/]|$)/;

// Rutas que toca una petición de herramienta y si alguna sale de las carpetas. En `Bash` se mira cualquier ruta absoluta y
// cualquier `..` (conservador: ante la duda se deniega).
function outsideOf(folders, input) {
  const outside = [];
  for (const field of ['file_path', 'path', 'notebook_path']) {
    if (typeof input?.[field] === 'string' && !isInside(folders, input[field], folders[0])) outside.push(input[field]);
  }
  if (typeof input?.command === 'string') {
    for (const found of input.command.match(ABSOLUTE_IN_COMMAND) ?? []) if (!isInside(folders, found, folders[0])) outside.push(found);
    if (PARENT_ESCAPE.test(input.command)) outside.push('..');
  }
  return outside;
}

// --- Un turno real de Claude --------------------------------------------------------------------------------------

function textOfAssistant(event) {
  const content = event.message?.content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

function claudeArgs(spike, task) {
  const instructions = spike.buildTaskInstructions({ provider: 'claude', language: 'es', folders: task.folders, documents: task.documents, capabilities: [] });
  const settings = spike.withTaskDirectories(null, task.folders.slice(1));
  return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio',
    '--include-partial-messages', '--model', 'haiku', '--effort', 'low', '--permission-mode', 'acceptEdits',
    '--append-system-prompt', instructions, ...(settings === null ? [] : ['--settings', JSON.stringify(settings)])];
}

function runClaudeTurn({ spike, task, message }) {
  const env = spike.scrubAgentEnv(process.env);
  delete env.CLAUDE_CONFIG_DIR; // la cuenta de ~/.claude del usuario
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, claudeArgs(spike, task), { cwd: task.folders[0], env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const state = { finished: false, lastText: '', resultText: null, subtype: null, allowed: 0, denied: [], error: null };
    const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
    const finish = () => {
      if (state.finished) return;
      state.finished = true;
      clearTimeout(timer);
      child.kill();
      resolve(state);
    };
    const timer = setTimeout(() => { state.error = `sin result en ${TURN_TIMEOUT_MS / 1000} s`; finish(); }, TURN_TIMEOUT_MS);
    const answer = (event) => {
      const input = event.request.input ?? {};
      const outside = outsideOf(task.folders, input);
      if (outside.length === 0) {
        state.allowed += 1;
        send({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response: { behavior: 'allow', updatedInput: input } } });
        return;
      }
      state.denied.push({ tool: event.request.tool_name, outside });
      send({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response: { behavior: 'deny', message: 'fuera de las carpetas autorizadas de la tarea' } } });
    };
    const handle = (event) => {
      if (event.type === 'assistant') { const text = textOfAssistant(event); if (text.length > 0) state.lastText = text; return; }
      if (event.type === 'result') { state.subtype = event.subtype ?? null; state.resultText = typeof event.result === 'string' ? event.result : null; finish(); return; }
      if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') answer(event);
    };
    createInterface({ input: child.stdout }).on('line', (line) => { if (line.trim().length > 0) handle(JSON.parse(line)); });
    child.stderr.resume();
    child.on('error', (err) => { state.error = err.message; finish(); });
    child.on('exit', () => { if (state.subtype === null && state.error === null) state.error = 'el CLI terminó sin result'; finish(); });
    send({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', hooks: {} } });
    send({ type: 'user', message: { role: 'user', content: message } });
  });
}

function evaluate(spike, task, agentText) {
  const declared = spike.parseDeliverables(agentText);
  const checks = declared === null ? [] : spike.checkDeliverables(declared, { folders: task.folders, caseInsensitive }, spike.nodeDeliverableFs);
  return { declared, deliverables: checks.map((c) => `${c.declared} -> ${c.status}`), verdict: spike.taskVerdictOf(checks), check: task.check() };
}

function firstMessage(n, task, root) {
  if (n !== 1) return task.goal;
  // Como haría una mención de texto: el contenido de SOURCES.txt va detrás del objetivo.
  return `${task.goal}\n\n${fs.readFileSync(path.join(root, 'entrada', 'SOURCES.txt'), 'utf8')}`;
}

async function runClaudeRecorrido(spike, n) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `${TEMP_PREFIX}${n}-${randomBytes(4).toString('hex')}-`)));
  const task = createRecorrido(n, root);
  const turn = await runClaudeTurn({ spike, task, message: firstMessage(n, task, root) });
  const text = turn.lastText.length > 0 ? turn.lastText : (turn.resultText ?? '');
  const evaluation = evaluate(spike, task, text);
  const finished = turn.error === null && turn.subtype === 'success';
  const ok = finished && evaluation.check.ok && evaluation.verdict === 'verified';
  return { recorrido: n, root, folders: task.folders, ok, finished, turnos: 1, subtype: turn.subtype, error: turn.error,
    permisosConcedidos: turn.allowed, permisosDenegados: turn.denied, ...evaluation };
}

// Transcripciones de Claude de las carpetas propias: nombre = ruta con cada carácter no alfanumérico cambiado por `-`.
function cleanup(results) {
  const projects = path.join(os.homedir(), '.claude', 'projects');
  for (const result of results) {
    for (const folder of result.folders) {
      const transcripts = path.join(projects, folder.replace(/[^a-zA-Z0-9]/g, '-'));
      if (transcripts.includes(TEMP_PREFIX) && fs.existsSync(transcripts)) fs.rmSync(transcripts, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
    fs.rmSync(result.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

// --- Codex falso ---------------------------------------------------------------------------------------------------

function codexFakeSession(spike, task, home) {
  const env = { ...spike.scrubAgentEnv(process.env), CODEX_HOME: home, MAGE_FAKE_CODEX_SCENARIO: 'approval' };
  const child = spawn(process.execPath, [path.join(repo, 'scripts', 'fake-codex-app-server.mjs')], { cwd: task.folders[0], env, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const instructions = spike.buildTaskInstructions({ provider: 'codex', language: 'es', folders: task.folders, documents: task.documents, capabilities: [] });
  const state = { completed: false, threadId: null, approvals: 0, error: null };
  const send = (value) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
  const onMessage = (message) => {
    if (message.error !== undefined) { state.error = JSON.stringify(message.error); return; }
    if (message.id === 1) { send({ method: 'initialized' }); send({ id: 2, method: 'thread/start', params: { cwd: task.folders[0], developerInstructions: instructions } }); return; }
    if (message.id === 2) { state.threadId = message.result.thread.id; send({ id: 3, method: 'turn/start', params: { threadId: state.threadId, input: [{ type: 'text', text: task.goal, text_elements: [] }] } }); return; }
    if (message.method === 'item/commandExecution/requestApproval') { state.approvals += 1; send({ id: message.id, result: { decision: 'decline' } }); return; }
    if (message.method === 'turn/completed') state.completed = true;
  };
  return { child, state, send, onMessage };
}

async function runCodexFakeRecorrido(spike, n) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `${TEMP_PREFIX}${n}-${randomBytes(4).toString('hex')}-`)));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `${TEMP_PREFIX}home-`));
  const task = createRecorrido(n, root);
  const session = codexFakeSession(spike, task, home);
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(() => { session.state.error ??= `sin turn/completed en ${RPC_TIMEOUT_MS / 1000} s`; resolve(); }, RPC_TIMEOUT_MS);
      createInterface({ input: session.child.stdout }).on('line', (line) => {
        if (line.trim().length === 0) return;
        session.onMessage(JSON.parse(line));
        if (session.state.completed || session.state.error !== null) { clearTimeout(timer); resolve(); }
      });
      session.child.on('exit', () => { clearTimeout(timer); resolve(); });
      session.send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'mage-spike', version: '0' } } });
    });
  } finally {
    session.child.kill();
  }
  const evaluation = evaluate(spike, task, '');
  const finished = session.state.completed && session.state.error === null;
  const ok = finished && evaluation.declared === null && evaluation.verdict === 'incomplete';
  return { recorrido: n, root, home, folders: task.folders, ok, finished, turnos: 1, error: session.state.error, permisosPedidos: session.state.approvals, ...evaluation };
}

function printRecorrido(result) {
  console.log(`\nRecorrido ${result.recorrido}: ${result.ok ? 'OK' : 'FALLA'} (terminó: ${result.finished}, turnos: ${result.turnos}${result.error === null ? '' : `, error: ${result.error}`})`);
  console.log(`  veredicto de Mage: ${result.verdict}; manifiesto: ${JSON.stringify(result.declared)}`);
  for (const line of result.deliverables) console.log(`  entregable: ${line}`);
  console.log(`  check del recorrido: ${result.check.ok ? 'ok' : 'FALLA'} — ${result.check.details.join('; ')}`);
  const asked = result.permisosConcedidos === undefined ? `${result.permisosPedidos} pedidos` : `${result.permisosConcedidos} concedidos, ${result.permisosDenegados.length} denegados`;
  console.log(`  permisos: ${asked}${result.permisosDenegados?.length ? ` ${JSON.stringify(result.permisosDenegados)}` : ''}`);
}

async function runEngine(spike, engine) {
  const runOne = engine === 'claude' ? runClaudeRecorrido : runCodexFakeRecorrido;
  const results = [];
  try {
    for (const n of RECORRIDOS) {
      const result = await runOne(spike, n);
      printRecorrido(result);
      results.push(result);
    }
  } finally {
    cleanup(results);
    for (const result of results) if (result.home !== undefined) fs.rmSync(result.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
  return results;
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-r-e1-bundle-'));
try {
  const bundle = await build(outDir);
  if (args.includes('--build-only')) {
    console.log('bundle ok');
  } else {
    const engine = option('engine');
    if (engine !== 'claude' && engine !== 'codex-fake') throw new Error(`Falta --engine claude|codex-fake, recibido ${JSON.stringify(engine)}`);
    const spike = createRequire(import.meta.url)(bundle);
    const results = await runEngine(spike, engine);
    const ok = results.length === RECORRIDOS.length && results.every((result) => result.ok);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify({ engine, ok, results: results.map(({ home, ...rest }) => rest) }, null, 2)}\n`);
    console.log(`\nJSON: ${outFile} — ${ok ? 'TODO OK' : 'HAY FALLOS'}`);
    process.exitCode = ok ? 0 : 1;
  }
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
