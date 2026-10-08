// Desglosa lo que Codex manda al modelo en el PRIMER turno («hola»), sin gastar un token: el CODEX_HOME es temporal y
// el modelo es un endpoint Responses local que rechaza la petición. Responde a «¿por qué 18.000 tokens de entrada
// con un “hola”?»: cuánto es de Codex (instrucciones base, definición de herramientas, contexto de entorno) y cuánto de
// Mage (instrucciones del desarrollador). Tokens estimados a 4 caracteres cada uno. Uso: node spike/codex-prompt-size-spike.mjs
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'mage-codex-size-'));
const cwd = mkdtempSync(join(tmpdir(), 'mage-codex-size-cwd-'));
const bodies = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => { try { bodies.push(JSON.parse(raw)); } catch { /* sin JSON */ } res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Mage: medicion local","type":"invalid_request_error"}}'); });
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const env = { ...process.env, CODEX_HOME: home, MAGE_FAKE_KEY: 'k' };
for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[name];
const child = spawn('codex', ['app-server', '-c', `model_providers.mage-fake={name="Fake",base_url="http://127.0.0.1:${port}/v1",env_key="MAGE_FAKE_KEY",wire_api="responses"}`, '-c', 'model_provider="mage-fake"'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const replies = new Map();
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const l of lines) { if (l.trim().length === 0) continue; const m = JSON.parse(l); if (m.id !== undefined && m.method === undefined) replies.get(m.id)?.(m); }
});
child.stderr.resume();
let id = 0;
const call = (method, params) => new Promise((done, fail) => {
  const mine = (id += 1);
  const timer = setTimeout(() => fail(new Error(`sin respuesta a ${method}`)), 30_000);
  replies.set(mine, (m) => { clearTimeout(timer); done(m); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: mine, method, params })}\n`);
});
const tokens = (value) => Math.round(JSON.stringify(value ?? '').length / 4);

try {
  await call('initialize', { clientInfo: { name: 'mage', version: '0.1.2' }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
  const started = await call('thread/start', { cwd, model: 'gpt-5.6-luna', approvalPolicy: 'on-request' });
  const threadId = started.result?.thread?.id;
  await call('turn/start', { threadId, input: [{ type: 'text', text: 'hola', text_elements: [] }] });
  for (let i = 0; i < 150 && bodies.length === 0; i += 1) await new Promise((done) => setTimeout(done, 200));
  const body = bodies[0];
  if (body === undefined) throw new Error('Codex no mando ninguna peticion');
  console.log('~tokens (4 car/token) de lo que Codex envía con un «hola», SIN cuenta ni apps:');
  console.log(`  instrucciones base (instructions): ${tokens(body.instructions)}`);
  console.log(`  definición de herramientas (tools): ${tokens(body.tools)}  (${(body.tools ?? []).length} herramientas)`);
  for (const [index, item] of (body.input ?? []).entries()) console.log(`  input[${index}] ${item.type}${item.role === undefined ? '' : `:${item.role}`}: ${tokens(item)}`);
  console.log(`  TOTAL estimado: ${tokens(body)}`);
} finally {
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  server.closeAllConnections();
  server.close();
  await new Promise((done) => setTimeout(done, 500));
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  rmSync(cwd, { recursive: true, force: true });
}
