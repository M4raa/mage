// Mide si Codex reanuda un rollout ESCRITO POR MAGE (no copiado de otro CODEX_HOME), sin turnos de pago: el
// CODEX_HOME es temporal, el modelo es un endpoint Responses local que rechaza la petición, y se comprueba que el
// historial escrito llega en `input`. Uso: node spike/codex-synth-rollout-spike.mjs [--minimal]
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const minimal = process.argv.includes('--minimal');
const home = mkdtempSync(join(tmpdir(), 'mage-codex-synth-'));
const cwd = mkdtempSync(join(tmpdir(), 'mage-codex-synth-cwd-'));
const threadId = randomUUID();
let ordinal = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 7, 10, 0, ordinal)).toISOString();
const line = (type, payload) => JSON.stringify({ timestamp: stamp(), ordinal: ordinal++, type, payload });
const message = (role, partType, text) => line('response_item', { type: 'message', role, content: [{ type: partType, text }] });

const rollout = [
  line('session_meta', { id: threadId, session_id: threadId, timestamp: stamp(), cwd, originator: 'mage', cli_version: '0.160.0', source: 'cli', model_provider: 'openai',
    ...(minimal ? {} : { thread_source: 'user' }) }),
  message('user', 'input_text', 'Recuerda la palabra CIRUELA y lista los ficheros.'),
  line('response_item', { type: 'function_call', call_id: 'call_spike1', name: process.env.SPIKE_TOOL ?? 'shell', arguments: JSON.stringify({ command: ['ls'] }) }),
  line('response_item', { type: 'function_call_output', call_id: 'call_spike1', output: 'a.txt\nb.txt' }),
  message('assistant', 'output_text', 'Hay dos ficheros: a.txt y b.txt.'),
];
const day = join(home, 'sessions', '2026', '10', '07');
mkdirSync(day, { recursive: true });
writeFileSync(join(day, `rollout-2026-10-07T10-00-00-${threadId}.jsonl`), `${rollout.join('\n')}\n`);

const bodies = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    try { bodies.push(JSON.parse(raw)); } catch { /* petición sin JSON */ }
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Mage: medicion local', type: 'invalid_request_error' } }));
  });
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const env = { ...process.env, CODEX_HOME: home, MAGE_FAKE_KEY: 'mage-artificial-key' };
for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[name];
const args = ['app-server',
  '-c', `model_providers.mage-fake={name="Fake",base_url="http://127.0.0.1:${port}/v1",env_key="MAGE_FAKE_KEY",wire_api="responses"}`,
  '-c', 'model_provider="mage-fake"'];
const child = spawn('codex', args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const replies = new Map();
const notifications = [];
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const raw of lines) {
    if (raw.trim().length === 0) continue;
    const parsed = JSON.parse(raw);
    if (parsed.id !== undefined && parsed.method === undefined) replies.get(parsed.id)?.(parsed);
    else notifications.push(parsed);
  }
});
child.stderr.resume();
let nextId = 0;
const call = (method, params) => new Promise((resolve, reject) => {
  const id = (nextId += 1);
  const timer = setTimeout(() => reject(new Error(`sin respuesta a ${method}`)), 30_000);
  replies.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
});

try {
  console.log(minimal ? '== rollout MÍNIMO ==' : '== rollout COMPLETO ==');
  await call('initialize', { clientInfo: { name: 'mage-spike', version: '0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
  const resume = await call('thread/resume', { threadId, cwd, model: 'gpt-5.6-luna' });
  console.log('thread/resume:', resume.error === undefined ? `ok (${resume.result?.thread?.turns?.length ?? '?'} turnos)` : `ERROR ${JSON.stringify(resume.error)}`);
  const read = await call('thread/read', { threadId, includeTurns: true });
  console.log('thread/read:', read.error === undefined ? `ok (${read.result?.thread?.turns?.length ?? '?'} turnos)` : `ERROR ${JSON.stringify(read.error)}`);
  if (resume.error === undefined) {
    await call('turn/start', { threadId, input: [{ type: 'text', text: '¿Qué palabra te pedí recordar?', text_elements: [] }] });
    const deadline = Date.now() + 30_000;
    while (bodies.length === 0 && Date.now() < deadline) await new Promise((done) => setTimeout(done, 200));
    const input = JSON.stringify(bodies[0]?.input ?? []);
    const types = (bodies[0]?.input ?? []).map((item) => `${item.type}${item.role === undefined ? '' : `:${item.role}`}`);
    console.log('input enviado al modelo:', JSON.stringify(types.filter((t) => !t.startsWith('message:developer'))));
    console.log('historial recibido:', input.includes('CIRUELA') ? 'SÍ (llegó CIRUELA)' : 'NO', '| llamada a herramienta:', input.includes('call_spike1') ? 'SÍ' : 'NO');
  }
  console.log('hilos en el home:', readdirSync(join(home, 'sessions')).join(','));
} finally {
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  server.closeAllConnections();
  server.close();
  await new Promise((done) => setTimeout(done, 500));
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  rmSync(cwd, { recursive: true, force: true });
}
