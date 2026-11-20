// Spike: ¿una regla `permissions.ask` pasada por `--settings` hace que el CLI de Claude pida permiso
// (`can_use_tool` por stdio) en cada modo, también en `auto` y `acceptEdits`? Es la medición en la que se
// apoya `withExternalActionAsk` (src/shared/externalActionAsk.ts).
//
// Qué mide: modo (default, acceptEdits, auto, bypassPermissions) × herramienta (Bash `git push`, Bash
// `gh pr create`, Artifact) × con y sin `--settings {"permissions":{"ask":[<regla>]}}`. Por cada caso anota si
// llegó `can_use_tool` y, si no llegó, si la herramienta se ejecutó. A todo `can_use_tool` contesta «deny».
//
// CERO turnos reales y NINGUNA cuenta real: el CLI habla con un servidor Messages FALSO en 127.0.0.1 con una
// clave inventada y un `CLAUDE_CONFIG_DIR` desechable de la carpeta temporal, que se borra al acabar. `git push`
// corre en un repositorio desechable sin remoto y `gh` con un `GH_CONFIG_DIR` vacío (sin sesión): fallan en local.
// Artifact se pide con `action: "list"`, que no publica nada.
//
// Uso: node spike/permission-ask-rules-spike.mjs [--out <carpeta>]   (por defecto .verify-out/permission-ask-rules)
// Escribe la tabla en Markdown por stdout y el stream de cada caso (rutas de la máquina redactadas) en la carpeta.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { listenLoopback } from '../scripts/lib/loopbackListen.mjs';

const MODES = ['default', 'acceptEdits', 'auto', 'bypassPermissions'];
const TOOLS = [
  { id: 'git-push', name: 'Bash', input: { command: 'git push origin main', description: 'push' }, rule: 'Bash(git push:*)' },
  { id: 'gh-pr-create', name: 'Bash', input: { command: 'gh pr create --title x --body y', description: 'pr' }, rule: 'Bash(gh pr create:*)' },
  // Con clave de API el CLI rechaza Artifact ANTES de mirar permisos («Artifacts need a claude.ai login»): se mide
  // también con un token OAuth inventado, que no es de ninguna cuenta (lo que llegue a claude.ai responde 401).
  { id: 'artifact', name: 'Artifact', input: { action: 'list' }, rule: 'Artifact' },
  { id: 'artifact-oauth', name: 'Artifact', input: { action: 'list' }, rule: 'Artifact', auth: 'oauth' },
  // Sustituto de Artifact: una regla por NOMBRE de herramienta (la forma de `Artifact`) sobre una que `acceptEdits`
  // aprueba sola. Escribe un fichero dentro del repositorio desechable.
  { id: 'write-proxy', name: 'Write', input: (repo) => ({ file_path: path.join(repo, 'proxy.txt'), content: 'x' }), rule: 'Write' },
];
const RUN_TIMEOUT_MS = 90_000;
const FAKE_KEY = 'sk-ant-api03-mage-spike-fake';
const FAKE_OAUTH_TOKEN = 'sk-ant-oat01-mage-spike-fake';
const DENY_MESSAGE = 'denegado por el spike';
const CREDENTIAL_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN'];

function resolveClaudeBinary() {
  if (process.env.MAGE_CLAUDE_BIN) return process.env.MAGE_CLAUDE_BIN;
  const winLocal = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (process.platform === 'win32' && fs.existsSync(winLocal)) return winLocal;
  return 'claude';
}

// --- Servidor falso: la petición del bucle principal (la que trae la herramienta del caso) recibe un tool_use;
// tras un tool_result, un texto final. Cualquier otra petición (título, clasificador…) recibe «ok» y se anota.
function startFakeServer(state) {
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":10}'); return; }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404).end('{}'); return; }
    const json = JSON.parse(body);
    const reply = decideReply(json, state);
    state.requests.push({ stream: json.stream === true, tools: (json.tools ?? []).length, reply: reply.kind === 'text' ? `text:${reply.text}` : `tool:${reply.name}` });
    writeReply(res, json.stream === true, reply);
  });
  return listenLoopback(server).then((port) => ({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) }));
}

function decideReply(json, state) {
  const toolNames = (json.tools ?? []).map((tool) => tool.name);
  if (state.tool === null || !toolNames.includes('Bash')) return { kind: 'text', text: 'ok' };
  state.toolOffered ||= toolNames.includes(state.tool.name);
  const last = json.messages.at(-1);
  const blocks = typeof last.content === 'string' ? [] : last.content;
  if (blocks.some((block) => block.type === 'tool_result')) return { kind: 'text', text: 'HECHO' };
  return { kind: 'tool', name: state.tool.name, input: state.tool.input };
}

const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
const USAGE = { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

function writeReply(res, isStream, reply) {
  const block = reply.kind === 'text' ? { type: 'text', text: reply.text } : { type: 'tool_use', id: `toolu_${Date.now()}`, name: reply.name, input: reply.input };
  const stopReason = reply.kind === 'text' ? 'end_turn' : 'tool_use';
  if (!isStream) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'msg_spike', type: 'message', role: 'assistant', model: 'claude-sonnet-fake', content: [block], stop_reason: stopReason, stop_sequence: null, usage: USAGE }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  sse(res, 'message_start', { message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-fake', content: [], stop_reason: null, stop_sequence: null, usage: USAGE } });
  const start = reply.kind === 'text' ? { type: 'text', text: '' } : { ...block, input: {} };
  const delta = reply.kind === 'text' ? { type: 'text_delta', text: reply.text } : { type: 'input_json_delta', partial_json: JSON.stringify(reply.input) };
  sse(res, 'content_block_start', { index: 0, content_block: start });
  sse(res, 'content_block_delta', { index: 0, delta });
  sse(res, 'content_block_stop', { index: 0 });
  sse(res, 'message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } });
  sse(res, 'message_stop', {});
  res.end();
}

// --- Un caso: lanza el CLI, manda un mensaje, deniega todo `can_use_tool` y espera al `result`.
function childEnv(profile, serverUrl, tool) {
  const env = { ...process.env };
  for (const name of CREDENTIAL_ENV) delete env[name];
  const credential = tool.auth === 'oauth' ? { CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH_TOKEN } : { ANTHROPIC_API_KEY: FAKE_KEY };
  return { ...env, ...credential, CLAUDE_CONFIG_DIR: profile.config, GH_CONFIG_DIR: profile.gh, ANTHROPIC_BASE_URL: serverUrl, CLAUDE_CODE_ARTIFACT: '1', GIT_TERMINAL_PROMPT: '0' };
}

function argsFor(mode, tool, withRule) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio',
    '--include-partial-messages', '--allow-dangerously-skip-permissions', '--model', 'sonnet', '--permission-mode', mode];
  if (withRule) args.push('--settings', JSON.stringify({ permissions: { ask: [tool.rule] } }));
  return args;
}

function handleLine(child, line, outcome) {
  const event = JSON.parse(line);
  if (event.type === 'system' && event.subtype === 'init') outcome.initMode = event.permissionMode;
  if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
    outcome.canUseTool += 1;
    const response = { behavior: 'deny', message: DENY_MESSAGE, toolUseID: event.request.tool_use_id };
    child.stdin.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response } })}\n`);
  }
  if (event.type === 'user') collectToolResults(event, outcome);
  return event.type === 'result';
}

function collectToolResults(event, outcome) {
  const content = event.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content.filter((b) => b.type === 'tool_result')) {
    const text = Array.isArray(block.content) ? block.content.map((part) => part.text ?? '').join(' ') : String(block.content);
    outcome.toolResults.push(text.replace(/\s+/g, ' ').slice(0, 200));
  }
}

function runCase({ bin, profile, serverUrl, mode, tool, withRule }) {
  const outcome = { initMode: null, canUseTool: 0, toolResults: [], code: null, timedOut: false };
  const child = spawn(bin, argsFor(mode, tool, withRule), { cwd: profile.repo, env: childEnv(profile, serverUrl, tool), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let raw = '';
  let pending = '';
  child.stderr.on('data', (chunk) => { raw += `[stderr] ${chunk}`; });
  child.stdout.setEncoding('utf8');
  return new Promise((resolve) => {
    const timer = setTimeout(() => { outcome.timedOut = true; child.kill(); }, RUN_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      raw += chunk;
      const lines = (pending + chunk).split('\n');
      pending = lines.pop() ?? '';
      if (lines.filter((l) => l.trim().startsWith('{')).some((l) => handleLine(child, l, outcome))) child.stdin.end();
    });
    child.on('exit', (code) => { clearTimeout(timer); outcome.code = code; resolve({ outcome, raw }); });
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Ejecuta la herramienta' }, parent_tool_use_id: null })}\n`);
  });
}

// --- Perfil desechable: config del CLI, config de gh vacía y un repo git sin remoto.
function makeProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-ask-rules-'));
  const profile = { root, config: path.join(root, 'config'), gh: path.join(root, 'gh'), repo: path.join(root, 'repo') };
  for (const dir of [profile.config, profile.gh, profile.repo]) fs.mkdirSync(dir);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: profile.repo, windowsHide: true });
  return profile;
}

function verdictOf(outcome, state) {
  if (!state.toolOffered) return 'herramienta no ofrecida';
  if (outcome.timedOut) return 'sin result (timeout)';
  if (outcome.canUseTool > 0) return 'can_use_tool → denegada';
  if (outcome.toolResults.length === 0) return 'sin tool_result';
  const text = outcome.toolResults.join(' ');
  if (text.includes('Auto mode could not evaluate')) return 'bloqueada por el clasificador de auto (servidor falso)';
  if (text.includes('<tool_use_error>')) return 'rechazada antes de permisos';
  return 'ejecutada sin preguntar';
}

function redact(text, profile) {
  return text.split(profile.root).join('<perfil>').split(profile.root.replace(/\\/g, '\\\\')).join('<perfil>')
    .split(os.homedir()).join('<home>').split(os.homedir().replace(/\\/g, '\\\\')).join('<home>');
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outDir = outIndex > 0 ? process.argv[outIndex + 1] : path.join('.verify-out', 'permission-ask-rules');
  const onlyIndex = process.argv.indexOf('--only');
  const tools = onlyIndex > 0 ? TOOLS.filter((tool) => tool.id === process.argv[onlyIndex + 1]) : TOOLS;
  fs.mkdirSync(outDir, { recursive: true });
  const bin = resolveClaudeBinary();
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  const state = { tool: null, toolOffered: false, requests: [] };
  const server = await startFakeServer(state);
  const rows = [];
  try {
    for (const tool of tools) for (const mode of MODES) for (const withRule of [false, true]) {
      rows.push(await measureCase({ bin, serverUrl: server.url, mode, tool, withRule, state, outDir }));
    }
  } finally {
    await server.close();
  }
  printTable(version, rows);
}

async function measureCase({ bin, serverUrl, mode, tool, withRule, state, outDir }) {
  const profile = makeProfile();
  const input = typeof tool.input === 'function' ? tool.input(profile.repo) : tool.input;
  Object.assign(state, { tool: { ...tool, input }, toolOffered: false, requests: [] });
  try {
    const { outcome, raw } = await runCase({ bin, profile, serverUrl, mode, tool, withRule });
    const name = `${tool.id}-${mode}-${withRule ? 'con-regla' : 'sin-regla'}`;
    fs.writeFileSync(path.join(outDir, `${name}.ndjson`), redact(raw, profile));
    fs.writeFileSync(path.join(outDir, `${name}.requests.json`), JSON.stringify(state.requests, null, 2));
    return { tool: tool.id, mode, rule: withRule ? tool.rule : '—', initMode: outcome.initMode, canUseTool: outcome.canUseTool, verdict: verdictOf(outcome, state), detail: redact(outcome.toolResults.join(' | '), profile).slice(0, 120) };
  } finally {
    fs.rmSync(profile.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

function printTable(version, rows) {
  console.log(`CLI: ${version}\n`);
  console.log('| Herramienta | Modo | Regla ask | Modo en init | can_use_tool | Resultado | tool_result |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.tool} | ${r.mode} | \`${r.rule}\` | ${r.initMode} | ${r.canUseTool} | ${r.verdict} | ${r.detail.replace(/\|/g, '/')} |`);
}

await main();
