// Spike P-038 (2026-11-09): «The SDK host reconnected before its prompt hook answered, so this prompt was not
// submitted» al volver a un chat tras un rato. Reproduce lo que hace Mage con el CLI REAL de Claude:
//   1. Proceso A (sesion S): `initialize` con los hooks de Mage, un turno que deja una tarea de Bash en segundo
//      plano (`sleep 600`) y se mata el proceso (lo que hace Mage al relanzar: `killForRelaunch`).
//   2. Proceso B: `--resume S`, `initialize` + el mensaje del usuario, tal cual `launch` + `sendUserMessage`.
//      Se contesta a cada hook_callback al instante, como `answerHook`.
// Mide: si B emite `blocked_by_hook`/«SDK host reconnected», si el mensaje llega a tener `result`, y el orden de
// lo que pasa (hook_callback, control_response del initialize, mensajes). Variante `--wait-init`: el mensaje se
// escribe SOLO tras la respuesta del `initialize`.
//   node spike/resume-hook-spike.mjs [--wait-init] [--mage-refresh] [--model haiku]
// `--mage-refresh` añade el refresco del catalogo que Mage manda en cada `result`.
// Consume: 2 o 3 turnos minimos de haiku.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const WAIT_INIT = process.argv.includes('--wait-init');
// Como `agentSession.correlate`: al leer un `result`, un `initialize` para refrescar el catalogo de comandos.
const MAGE_REFRESH = process.argv.includes('--mage-refresh');
const MODEL = process.argv[process.argv.indexOf('--model') + 1] && process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'haiku';
const TURN_TIMEOUT_MS = 120_000;
const HOOKS = ['UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop', 'PreCompact', 'SessionEnd'];
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-resume-hook-'));
const sessionId = randomUUID();

const initialize = () => ({
  type: 'control_request',
  request_id: randomUUID(),
  request: { subtype: 'initialize', hooks: Object.fromEntries(HOOKS.map((h) => [h, [{ hookCallbackIds: ['mage-observer'], timeout: 5 }]])) },
});
const userMessage = (text) => ({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });

function start(extra) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--model', MODEL, '--allowedTools', 'Bash', ...extra];
  const child = spawn('claude', args, { cwd, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  const log = [];
  const t0 = Date.now();
  const waiters = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let o;
    try { o = JSON.parse(line); } catch { return; }
    const tag = o.type === 'control_request' ? `control_request/${o.request?.subtype}${o.request?.subtype === 'hook_callback' ? `:${o.request?.input?.hook_event_name}` : ''}`
      : o.type === 'control_response' ? `control_response/${o.response?.subtype}` : `${o.type}/${o.subtype ?? ''}`;
    const extraInfo = o.type === 'system' && o.subtype === 'informational' ? ` ${String(o.content ?? '').slice(0, 120)}` : '';
    if (o.type !== 'stream_event') log.push(`${String(Date.now() - t0).padStart(6)} ms ${tag}${extraInfo}`);
    if (o.type === 'control_request' && o.request?.subtype === 'hook_callback') {
      child.stdin.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: { continue: true } } })}\n`);
    }
    if (MAGE_REFRESH && o.type === 'result' && child.stdin.writable) child.stdin.write(`${JSON.stringify(initialize())}
`);
    for (const w of [...waiters]) if (w.test(o)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(o); }
  });
  const waitFor = (test, ms = TURN_TIMEOUT_MS) => new Promise((resolve) => {
    const w = { test, resolve };
    waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, ms);
  });
  const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
  return { child, log, send, waitFor };
}

const kill = (child) => new Promise((resolve) => {
  child.once('exit', resolve);
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill('SIGKILL');
});

// --- 1. Proceso A: deja una tarea de Bash en segundo plano y muere ---
const a = start(['--session-id', sessionId]);
a.send(initialize());
a.send(userMessage('Usa Bash con run_in_background=true para ejecutar exactamente: sleep 600. No esperes a que termine: responde solo «lanzada».'));
const resultA = await a.waitFor((o) => o.type === 'result');
await new Promise((r) => setTimeout(r, 1500));
await kill(a.child);

// --- 2. Proceso B: reanuda como Mage (initialize + mensaje) ---
const b = start(['--resume', sessionId]);
const init = initialize();
b.send(init);
if (WAIT_INIT) await b.waitFor((o) => o.type === 'control_response' && o.response?.request_id === init.request_id, 30_000);
b.send(userMessage('Responde solo: hola'));
const resultB = await b.waitFor((o) => o.type === 'result');
const blocked = b.log.some((l) => /reconnected|blocked/i.test(l));
await new Promise((r) => setTimeout(r, 1500));
await kill(b.child);

const summary = { refrescoAlResult: MAGE_REFRESH, variante: WAIT_INIT ? 'mensaje tras la respuesta del initialize' : 'initialize + mensaje seguidos (como Mage)', resultadoA: resultA?.subtype ?? null, resultadoB: resultB?.subtype ?? null, bloqueado: blocked, procesoA: a.log, procesoB: b.log };
console.log(JSON.stringify(summary, null, 2));
fs.rmSync(cwd, { recursive: true, force: true });
