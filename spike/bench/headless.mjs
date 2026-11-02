// Benchmark F0-B, ruta R2: el protocolo headless DIRECTO de cada CLI, sin Mage. Claude con los mismos
// BASE_ARGS que claudeAdapter (stream-json); Codex con `codex app-server` (JSON-RPC). Mismo modelo y
// esfuerzo que R3 (haiku/low; el minimo medido de Codex), permisos concedidos por el conductor igual que
// los concede el harness en R3, y perfil desechable con copia de credenciales retirado en finally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { codexMcpConfig } from './tasks.mjs';

export const CLAUDE_MODEL = { model: 'haiku', effort: 'low' };
export const CODEX_MODEL = { model: 'gpt-6-luna', effort: 'low' };
const CLAUDE_BASE_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--permission-prompt-tool', 'stdio', '--include-partial-messages', '--allow-dangerously-skip-permissions'];
const TASK_TIMEOUT_MS = 300_000;
const RPC_TIMEOUT_MS = 30_000;
const SCRUB = /^(ANTHROPIC_|OPENAI_|CODEX_API_KEY|MAGE_CODEX_API_KEY|CLAUDECODE|CLAUDE_CODE_)/;

export function scrubbedEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (SCRUB.test(key)) delete env[key];
  return { ...env, ...extra };
}

// Metricas comunes a las dos rutas y los dos proveedores.
function newRun() {
  return { startedAt: Date.now(), firstUsefulAt: null, endedAt: null, text: '', tools: [], init: '', tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, costUsd: null, permissions: 0, errors: [] };
}

const markUseful = (run) => { if (run.firstUsefulAt === null) run.firstUsefulAt = Date.now(); };

// --- Claude -------------------------------------------------------------------------------------------

function onClaudeLine(run, child, line) {
  let m;
  try { m = JSON.parse(line); } catch { return; } // linea no JSON del CLI: se ignora, no es un evento
  if (m.type === 'system' && m.subtype === 'init') run.init = JSON.stringify(m);
  if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') markUseful(run);
  if (m.type === 'assistant') for (const block of m.message?.content ?? []) {
    if (block.type === 'text') run.text += block.text;
    if (block.type === 'tool_use') { markUseful(run); run.tools.push(block.name); }
  }
  if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
    run.permissions += 1;
    const response = { behavior: 'allow', updatedInput: m.request.input ?? {}, toolUseID: m.request.tool_use_id };
    child.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response } }) + '\n');
  }
  if (m.type === 'result') {
    run.results = (run.results ?? 0) + 1;
    run.costUsd = (run.costUsd ?? 0) + (m.total_cost_usd ?? 0);
    const u = m.usage ?? {};
    run.tokens.input += u.input_tokens ?? 0; run.tokens.output += u.output_tokens ?? 0;
    run.tokens.cacheRead += u.cache_read_input_tokens ?? 0; run.tokens.cacheCreate += u.cache_creation_input_tokens ?? 0;
    if (m.is_error) run.errors.push(String(m.subtype ?? 'error'));
  }
}

export function runClaude({ bin, profile, cwd, task }) {
  const run = { ...newRun(), sessionId: crypto.randomUUID() };
  const args = [...CLAUDE_BASE_ARGS, '--session-id', run.sessionId, '--model', CLAUDE_MODEL.model, '--effort', CLAUDE_MODEL.effort, '--permission-mode', 'acceptEdits'];
  const child = spawn(bin, args, { cwd, env: scrubbedEnv({ CLAUDE_CONFIG_DIR: profile, CLAUDE_CODE_ARTIFACT: '0' }), windowsHide: true, stdio: 'pipe' });
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', (line) => onClaudeLine(run, child, line));
  const send = (text) => child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }) + '\n');
  return driveTurns({ run, child, task, send, done: () => finishedTurns(run, task, task.turns), finish: () => child.stdin.end() });
}

// Uso de la suscripcion de Claude (ventanas de 5 h y 7 d, %) con la credencial COPIADA del perfil.
export async function claudeUsage(credential) {
  const auth = JSON.parse(fs.readFileSync(credential, 'utf8'));
  const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${auth.claudeAiOauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'user-agent': 'claude-code/2.1.309' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`uso de Claude no disponible: HTTP ${response.status}`);
  const data = await response.json();
  return ['five_hour', 'seven_day'].map((name) => ({ window: name, percent: data[name]?.utilization }));
}

// Guarda de uso con caché: el endpoint limita la frecuencia (429 medido con una lectura por tarea). Se
// reutiliza la última lectura buena durante `ttlMs`; un fallo se reintenta una vez y, si sigue, cuenta
// como «por encima» (regla del proyecto: un uso que no se puede leer no autoriza turnos).
const USAGE_TTL_MS = 120_000;
const USAGE_RETRY_MS = 30_000;

export function guardedUsage(read, ttlMs = USAGE_TTL_MS) {
  let last = null;
  return async () => {
    if (last !== null && Date.now() - last.at < ttlMs) return last.result;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const usage = await read();
        last = { at: Date.now(), result: { usage, allowed: usageWithinLimit(usage) } };
        return last.result;
      } catch (error) {
        if (attempt === 0) await new Promise((r) => setTimeout(r, USAGE_RETRY_MS));
        else return { usage: [], allowed: false, error: String(error.message).slice(0, 120) };
      }
    }
    return { usage: [], allowed: false };
  };
}

export const USAGE_LIMIT_PERCENT = 70;
export const usageWithinLimit = (usage) => usage.length > 0 && usage.every((w) => typeof w.percent === 'number' && w.percent <= USAGE_LIMIT_PERCENT);

// --- Codex --------------------------------------------------------------------------------------------

// El ejecutable real de Codex (no un shim): sin `shell`, `kill()` alcanza al proceso que hay que parar.
// Con `shell: true` se mataba el cmd.exe y `codex app-server` quedaba vivo reteniendo su CODEX_HOME.
let codexPath = null;
function codexBinary() {
  if (codexPath !== null) return codexPath;
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  codexPath = execFileSync(command, ['codex'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? null;
  if (codexPath === null) throw new Error('No se encuentra el ejecutable de codex en el PATH');
  return codexPath;
}

export function prepareCodexHome(home) {
  fs.mkdirSync(home, { recursive: true });
  fs.copyFileSync(path.join(os.homedir(), '.codex', 'auth.json'), path.join(home, 'auth.json'));
  fs.writeFileSync(path.join(home, 'config.toml'), codexMcpConfig());
}

function codexClient(child, run) {
  const pending = new Map();
  let seq = 0;
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
  const notifications = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; } // ruido no JSON del servidor
    if (m.id !== undefined && !m.method) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
    if (m.id !== undefined && m.method) {
      run.permissions += 1;
      (run.serverRequests ??= []).push(m.method);
      // La aprobación de una herramienta MCP llega como elicitation (en Mage, el formulario que acepta el
      // usuario): se acepta con contenido vacío; el resto de aprobaciones, con `decision`.
      const elicitation = m.method === 'mcpServer/elicitation/request';
      send({ id: m.id, result: elicitation ? { action: 'accept', content: m.params?.mode === 'url' ? null : {} } : { decision: 'accept' } });
      return;
    }
    notifications.push(m);
    onCodexNotification(run, m);
  });
  // Cada petición tiene plazo y, si el proceso sale, las pendientes se rechazan con el final de su stderr:
  // antes, un `codex app-server` muerto dejaba la promesa colgada para siempre (medido en el baseline).
  let stderrTail = '';
  child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-400); });
  const rejectAll = (reason) => { for (const [id, settle] of pending) { settle({ error: { code: 'client', message: reason } }); pending.delete(id); } };
  child.on('exit', (code) => rejectAll(`codex app-server salió (${code}): ${stderrTail.trim().slice(-200)}`));
  const rpc = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); resolve({ error: { code: 'timeout', message: `sin respuesta a ${method} en ${RPC_TIMEOUT_MS} ms` } }); }, RPC_TIMEOUT_MS);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    send({ id, method, params });
  });
  return { rpc, send, notifications };
}

function onCodexNotification(run, m) {
  const item = m.params?.item;
  if (m.method === 'item/agentMessage/delta') markUseful(run);
  if (m.method === 'item/started' && item?.type !== 'agentMessage' && item?.type !== 'userMessage' && item?.type !== 'reasoning') { markUseful(run); run.tools.push(item?.type === 'mcpToolCall' ? `${item.server}/${item.tool}` : String(item?.type)); }
  if (m.method === 'item/completed' && item?.type === 'agentMessage') run.text += item.text ?? '';
  // R2 lee el TOTAL del hilo (todos los turnos de la tarea); R3 suma el uso del `result` de cada turno, que
  // desde F2.1 es lo que crece ese total durante el turno. Por eso coinciden: antes R3 tomaba solo la
  // última llamada al modelo (`last`) de cada turno.
  if (m.method === 'thread/tokenUsage/updated') {
    const u = m.params?.tokenUsage?.total ?? {};
    run.tokens = { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, cacheRead: u.cachedInputTokens ?? 0, cacheCreate: 0 };
  }
  if (m.method === 'turn/completed') {
    run.results = (run.results ?? 0) + 1;
    if (m.params?.turn?.status !== 'completed') run.errors.push(String(m.params?.turn?.status));
  }
}

export async function codexRateLimits(home) {
  const child = spawn(codexBinary(), ['app-server'], { env: scrubbedEnv({ CODEX_HOME: home }), windowsHide: true, stdio: 'pipe' });
  const client = codexClient(child, newRun());
  try {
    await client.rpc('initialize', { clientInfo: { name: 'mage-bench', version: '0.1.3' }, capabilities: { experimentalApi: true } });
    const limits = await client.rpc('account/rateLimits/read');
    if (limits.error) throw new Error(`límites de Codex no disponibles: ${limits.error.message}`);
    const windows = [limits.result?.rateLimits?.primary, limits.result?.rateLimits?.secondary].filter(Boolean);
    return windows.map((w) => ({ minutes: w.windowDurationMins, percent: w.usedPercent }));
  } finally {
    child.kill();
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
  }
}

export async function runCodex({ home, cwd, task }) {
  const run = newRun();
  const child = spawn(codexBinary(), ['app-server'], { cwd, env: scrubbedEnv({ CODEX_HOME: home }), windowsHide: true, stdio: 'pipe' });
  const client = codexClient(child, run);
  await client.rpc('initialize', { clientInfo: { name: 'mage-bench', version: '0.1.3' }, capabilities: { experimentalApi: true } });
  client.send({ method: 'initialized' });
  const thread = await client.rpc('thread/start', { cwd, model: CODEX_MODEL.model, approvalPolicy: 'on-request', sandbox: 'workspace-write', config: { model_reasoning_effort: CODEX_MODEL.effort } });
  if (thread.error) throw new Error(`thread/start: ${thread.error.message}`);
  const threadId = thread.result.thread.id;
  let turnId = null;
  let turnStarts = 0;
  const send = async (text) => {
    const input = [{ type: 'text', text }];
    const running = turnId !== null && (run.results ?? 0) < turnStarts;
    // Con un turno en marcha, el camino nativo del protocolo es `turn/steer`; si no, un turno nuevo.
    const r = running
      ? await client.rpc('turn/steer', { threadId, expectedTurnId: turnId, input })
      : await client.rpc('turn/start', { threadId, model: CODEX_MODEL.model, effort: CODEX_MODEL.effort, input });
    if (!running && r.result?.turn?.id) { turnId = r.result.turn.id; turnStarts += 1; }
    if (r.error) run.errors.push(`${running ? 'steer' : 'start'}:${r.error.code}`);
  };
  return driveTurns({ run, child, task, send, done: () => finishedTurns(run, task, turnStarts), finish: () => child.kill() });
}

// Terminado: los turnos abiertos ya cerraron. T5 tambien termina si el texto ya trae su marca final
// (un segundo mensaje inyectado en el turno en marcha no abre turno propio).
function finishedTurns(run, task, expected) {
  const results = run.results ?? 0;
  if (task.doneText !== undefined && results >= 1 && run.text.includes(task.doneText)) return true;
  return expected > 0 && results >= expected;
}

// Envia los prompts de la tarea (el segundo, a mitad del primero si la tarea lo pide), espera a que
// acabe y cierra el proceso. Nunca cuelga: el plazo de la tarea lo corta y se registra como error.
async function driveTurns({ run, child, task, send, done, finish }) {
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.on('error', (error) => run.errors.push(`spawn: ${error.code ?? error.message}`));
  await send(task.prompts[0]);
  for (const prompt of task.prompts.slice(1)) {
    if (task.midTurnDelayMs !== undefined) await new Promise((r) => setTimeout(r, task.midTurnDelayMs));
    else await waitUntil(() => (run.results ?? 0) >= 1, TASK_TIMEOUT_MS);
    await send(prompt);
  }
  const finished = await waitUntil(done, TASK_TIMEOUT_MS);
  if (!finished) run.errors.push('timeout');
  run.endedAt = Date.now();
  finish();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  if (child.exitCode === null) child.kill();
  return run;
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
