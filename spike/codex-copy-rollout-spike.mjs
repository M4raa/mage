// Mide si un rollout de Codex COPIADO a otro CODEX_HOME se puede reanudar (`thread/resume`) sin turnos de pago:
// el CODEX_HOME de destino es una carpeta temporal vacía (sin auth.json ni bases internas) y solo se pide
// reanudar y leer el hilo; nunca se manda un turno. Uso: node spike/codex-copy-rollout-spike.mjs [rollout.jsonl]
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

function smallestRollout() {
  const root = join(homedir(), '.codex', 'sessions');
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : name.startsWith('rollout-') && files.push(path); } };
  walk(root);
  return files.sort((a, b) => statSync(a).size - statSync(b).size)[0];
}

const source = process.argv[2] ?? smallestRollout();
const meta = JSON.parse(readFileSync(source, 'utf8').split('\n')[0]).payload;
const home = mkdtempSync(join(tmpdir(), 'mage-codex-copy-'));
const day = join(home, 'sessions', '2026', '10', '05');
mkdirSync(day, { recursive: true });
copyFileSync(source, join(day, basename(source)));
console.log('rollout copiado:', basename(source), `(${statSync(source).size} bytes), hilo ${meta.id}, cwd ${meta.cwd}`);

const env = { ...process.env, CODEX_HOME: home };
for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[name];
const child = spawn('codex', ['app-server'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const replies = new Map();
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined && message.method === undefined) replies.get(message.id)?.(message);
  }
});
child.stderr.resume();
let nextId = 0;
const call = (method, params) => new Promise((resolve, reject) => {
  const id = (nextId += 1);
  const timer = setTimeout(() => reject(new Error(`sin respuesta a ${method}`)), 30_000);
  replies.set(id, (message) => { clearTimeout(timer); resolve(message); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
});

try {
  const init = await call('initialize', { clientInfo: { name: 'mage-spike', version: '0' }, capabilities: { experimentalApi: true } });
  console.log('initialize:', init.error === undefined ? 'ok' : JSON.stringify(init.error));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
  const resume = await call('thread/resume', { threadId: meta.id, cwd: meta.cwd });
  console.log('thread/resume:', resume.error === undefined ? `ok (hilo ${resume.result?.thread?.id}, ${resume.result?.thread?.turns?.length ?? '?'} turnos)` : `ERROR ${JSON.stringify(resume.error)}`);
  const read = await call('thread/read', { threadId: meta.id, includeTurns: true });
  console.log('thread/read:', read.error === undefined ? `ok (${read.result?.thread?.turns?.length ?? '?'} turnos)` : `ERROR ${JSON.stringify(read.error)}`);
  console.log('ficheros creados en el home destino:', readdirSync(home).join(', '));
} finally {
  // Con `shell: true` en Windows `kill()` solo mata al cmd; el árbol entero libera los ficheros del home temporal.
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
