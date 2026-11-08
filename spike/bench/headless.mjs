// Benchmark F0-B, ruta R2: el protocolo headless DIRECTO de Claude, sin Mage, con los mismos BASE_ARGS que
// claudeAdapter (stream-json). Mismo modelo y esfuerzo que R3 (haiku/low), permisos concedidos por el
// conductor igual que los concede el harness en R3, y perfil desechable sin credenciales del usuario.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const CLAUDE_MODEL = { model: 'haiku', effort: 'low' };
export const CODEX_MODEL = { model: 'gpt-6-luna', effort: 'low' };
const CLAUDE_BASE_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--permission-prompt-tool', 'stdio', '--include-partial-messages', '--allow-dangerously-skip-permissions'];
const TASK_TIMEOUT_MS = 300_000;
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

export function runClaude({ bin, profile, cwd, task, env = {} }) {
  const run = { ...newRun(), sessionId: crypto.randomUUID() };
  const args = [...CLAUDE_BASE_ARGS, '--session-id', run.sessionId, '--model', CLAUDE_MODEL.model, '--effort', CLAUDE_MODEL.effort, '--permission-mode', 'acceptEdits'];
  const child = spawn(bin, args, { cwd, env: scrubbedEnv({ CLAUDE_CONFIG_DIR: profile, CLAUDE_CODE_ARTIFACT: '0', ...env }), windowsHide: true, stdio: 'pipe' });
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', (line) => onClaudeLine(run, child, line));
  const send = (text) => child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }) + '\n');
  return driveTurns({ run, child, task, send, done: () => finishedTurns(run, task, task.turns), finish: () => child.stdin.end() });
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
