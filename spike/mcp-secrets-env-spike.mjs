// Mide si los secretos de un servidor MCP que Mage pone en el ENTORNO del CLI de Claude llegan a los
// comandos que lanza el agente con su herramienta Bash (y, por tanto, si el modelo o un prompt inyectado
// podria leerlos con `env`).
//
// Dos variantes, cada una con un servidor MCP stdio minimo (un .cjs que solo contesta `initialize` y
// `tools/list` y apunta en un fichero si le llego el secreto):
//   entorno  — lo que hace Mage hoy (`toClaudeArgs`): el `--mcp-config` lleva `${MAGE_MCP_SECRET_…}` y el
//              valor viaja en el entorno del proceso del CLI.
//   fichero  — la alternativa: el valor escrito literal en el `env` del servidor dentro del fichero.
// El servidor Messages falso contesta al primer turno con un `tool_use` de Bash que imprime VISIBLE o
// AUSENTE para cada variable, y con un texto al recibir el `tool_result`.
//
// Ejecucion: `node spike/mcp-secrets-env-spike.mjs` (MAGE_CLAUDE_BIN para otro binario).
// CERO turnos reales: el CLI habla con un servidor falso en 127.0.0.1, con una clave inventada y un
// CLAUDE_CONFIG_DIR desechable de la carpeta temporal. No usa cuentas ni secretos reales: el secreto es
// un valor aleatorio inventado que nunca se imprime. El CLI se para por su PID, nunca por nombre.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_NAME = 'probe';
const SERVER_ENV_KEY = 'PROBE_TOKEN';
// Mismo nombre que da `secretVarName(server, 'ENV', key)` en mcpResolved.ts.
const CLI_SECRET_VAR = 'MAGE_MCP_SECRET_PROBE_ENV_PROBE_TOKEN';
const TURN_TIMEOUT_MS = 90_000;
const SECRET = `mage-fake-secret-${randomBytes(8).toString('hex')}`;

// Servidor MCP: si recibe el secreto esperado lo apunta (sin el valor) y contesta lo minimo del protocolo.
const MCP_PROBE_SOURCE = `
const fs = require('node:fs');
const [marker, expected] = process.argv.slice(2);
fs.writeFileSync(marker, process.env.${SERVER_ENV_KEY} === expected ? 'RECIBIDO' : 'NO RECIBIDO');
let buffer = '';
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length === 0) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') reply(message.id, { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: '${SERVER_NAME}', version: '0.0.0' } });
    else if (message.method === 'tools/list') reply(message.id, { tools: [] });
    else if (message.id !== undefined) reply(message.id, {});
  }
});
`;

const BASH_PROBE = `node -e "for (const n of ['${CLI_SECRET_VAR}', '${SERVER_ENV_KEY}']) console.log(n + '=' + (process.env[n] ? 'VISIBLE' : 'AUSENTE'))"`;

function resolveClaudeBinary() {
  if (process.env.MAGE_CLAUDE_BIN) return process.env.MAGE_CLAUDE_BIN;
  const winLocal = join(homedir(), '.local', 'bin', 'claude.exe');
  if (process.platform === 'win32' && existsSync(winLocal)) return winLocal;
  return 'claude';
}

// --- Servidor Messages falso ---------------------------------------------------------------------

function sse(response, type, data) {
  response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

function toolResultText(messages) {
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    const result = message.content.find((block) => block.type === 'tool_result');
    if (result === undefined) continue;
    return Array.isArray(result.content) ? result.content.map((block) => block.text ?? '').join('\n') : String(result.content);
  }
  return null;
}

// Primer turno con herramientas: tool_use de Bash. Tras el tool_result (o sin Bash): un texto.
function planFor(body, seen) {
  const result = toolResultText(body.messages ?? []);
  if (result !== null) seen.toolResult = result;
  const offersBash = (body.tools ?? []).some((tool) => tool.name === 'Bash');
  if (result !== null || !offersBash) return { kind: 'text', text: 'FIN' };
  return { kind: 'tool', input: { command: BASH_PROBE, description: 'mide el entorno' } };
}

function streamPlan(response, plan) {
  const usage = { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  sse(response, 'message_start', { message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'claude-haiku-fake', content: [], stop_reason: null, stop_sequence: null, usage } });
  const block = plan.kind === 'text' ? { type: 'text', text: '' } : { type: 'tool_use', id: `toolu_${Date.now()}`, name: 'Bash', input: {} };
  sse(response, 'content_block_start', { index: 0, content_block: block });
  const delta = plan.kind === 'text' ? { type: 'text_delta', text: plan.text } : { type: 'input_json_delta', partial_json: JSON.stringify(plan.input) };
  sse(response, 'content_block_delta', { index: 0, delta });
  sse(response, 'content_block_stop', { index: 0 });
  sse(response, 'message_delta', { delta: { stop_reason: plan.kind === 'text' ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } });
  sse(response, 'message_stop', {});
  response.end();
}

async function startFakeMessages(seen) {
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    if (request.method !== 'POST' || !request.url.startsWith('/v1/messages')) return void response.writeHead(404).end('{}');
    if (request.url.includes('count_tokens')) return void response.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":10}');
    const body = JSON.parse(raw);
    const plan = planFor(body, seen);
    if (body.stream !== true) {
      const text = plan.kind === 'text' ? plan.text : 'ok';
      return void response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'msg_ns', type: 'message', role: 'assistant', model: 'claude-haiku-fake', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } }));
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    streamPlan(response, plan);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}

// --- Una variante ----------------------------------------------------------------------------------

function mcpConfigFor(variant, probePath, marker) {
  const value = variant === 'entorno' ? '${' + CLI_SECRET_VAR + '}' : SECRET;
  return { mcpServers: { [SERVER_NAME]: { type: 'stdio', command: process.execPath, args: [probePath, marker, SECRET], env: { [SERVER_ENV_KEY]: value } } } };
}

function childEnv(variant, configDir, baseUrl) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_API_KEY: 'sk-ant-api03-mage-fake' };
  for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', CLI_SECRET_VAR, SERVER_ENV_KEY]) delete env[name];
  if (variant === 'entorno') env[CLI_SECRET_VAR] = SECRET;
  return env;
}

// Lee el NDJSON del CLI: aprueba cualquier permiso (por si el bypass no aplicara) y resuelve con el init y el result.
function driveChild(child) {
  return new Promise((resolve, reject) => {
    const state = { init: null, result: null, permissionAsks: 0 };
    let pending = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI sin terminar en ${TURN_TIMEOUT_MS} ms`)); }, TURN_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) handleLine(child, line, state);
      if (state.result !== null) { clearTimeout(timer); resolve(state); }
    });
    child.on('exit', (code) => { clearTimeout(timer); if (state.result === null) reject(new Error(`CLI salio con ${code} sin result`)); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function handleLine(child, line, state) {
  if (!line.startsWith('{')) return;
  const event = JSON.parse(line);
  if (event.type === 'system' && event.subtype === 'init') state.init = event;
  if (event.type === 'result') state.result = event;
  if (event.type !== 'control_request' || event.request?.subtype !== 'can_use_tool') return;
  state.permissionAsks += 1;
  const response = { subtype: 'success', request_id: event.request_id, response: { behavior: 'allow', updatedInput: event.request.input } };
  child.stdin.write(`${JSON.stringify({ type: 'control_response', response })}\n`);
}

async function runVariant(variant, profile, cli) {
  const seen = { toolResult: null };
  const fake = await startFakeMessages(seen);
  const configDir = join(profile, `config-${variant}`);
  const workDir = join(profile, `work-${variant}`);
  mkdirSync(configDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const probePath = join(profile, 'mcp-probe.cjs');
  const marker = join(profile, `recibido-${variant}.txt`);
  const configPath = join(profile, `mcp-${variant}.json`);
  writeFileSync(configPath, JSON.stringify(mcpConfigFor(variant, probePath, marker), null, 2));
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio',
    '--include-partial-messages', '--allow-dangerously-skip-permissions', '--permission-mode', 'bypassPermissions',
    '--model', 'claude-haiku-4-5', '--mcp-config', configPath];
  const child = spawn(cli, args, { cwd: workDir, env: childEnv(variant, configDir, fake.url), windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'MIDE' }] } })}\n`);
  try {
    const state = await driveChild(child);
    const mcpStatus = state.init?.mcp_servers?.find((entry) => entry.name === SERVER_NAME)?.status ?? 'sin init';
    const received = existsSync(marker) ? readFileSync(marker, 'utf8') : 'NO ARRANCO';
    return { variant, mcpStatus, permissionMode: state.init?.permissionMode ?? null, permissionAsks: state.permissionAsks,
      bash: seen.toolResult, serverReceived: received, resultSubtype: state.result.subtype, leakedInOutput: (seen.toolResult ?? '').includes(SECRET) };
  } catch (error) {
    return { variant, error: `${error.message} ${stderr.slice(0, 300)}` };
  } finally {
    child.stdin.end();
    if (child.exitCode === null) child.kill(); // por su PID: el proceso que lanzo este spike
    await fake.close();
  }
}

const cli = resolveClaudeBinary();
const version = spawnSync(cli, ['--version'], { encoding: 'utf8' }).stdout.trim();
const profile = mkdtempSync(join(tmpdir(), 'mage-mcp-secrets-spike-'));
try {
  writeFileSync(join(profile, 'mcp-probe.cjs'), MCP_PROBE_SOURCE);
  const results = [];
  for (const variant of ['entorno', 'fichero']) results.push(await runVariant(variant, profile, cli));
  console.log(JSON.stringify({ cli: version, results }, null, 2));
} finally {
  rmSync(profile, { recursive: true, force: true });
}
