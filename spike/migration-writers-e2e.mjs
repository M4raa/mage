// Comprueba el CÓDIGO DE PRODUCCIÓN de la migración (los escritores de `src/main/conversations/nativeWriters.ts` y la
// escritura SQLite de agy) contra los CLI reales: cada destino reanuda la conversación escrita por Mage y su modelo
// recibe el historial. Claude y Codex no gastan nada (servidores falsos); agy gasta UN turno de suscripción (autorizado).
// Uso: node spike/migration-writers-e2e.mjs [claude|codex|agy ...]   (sin argumentos: los tres)
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRepo = createRequire(join(repo, 'package.json'));
const esbuild = createRequire(requireFromRepo.resolve('vite/package.json'))('esbuild');

// Compila los módulos TS de producción a un .mjs temporal (alias @shared como en el proyecto).
const workdir = mkdtempSync(join(tmpdir(), 'mage-e2e-'));
const bundle = join(workdir, 'writers.mjs');
esbuild.buildSync({
  stdin: { contents: `export * from './src/main/conversations/nativeWriters.ts'; export * from './src/main/conversations/agySqliteStore.ts'; export * from './src/main/conversations/neutralReader.ts';`, resolveDir: repo, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, alias: { '@shared': join(repo, 'src', 'shared') }, external: ['node:*'], logLevel: 'error',
});
const w = await import(pathToFileURL(bundle).href);

const secret = 'CIRUELA';
const cwd = mkdtempSync(join(tmpdir(), 'mage-e2e-cwd-'));
const conversation = {
  cwd, title: 'e2e',
  items: [
    { kind: 'user', text: `Recuerda la palabra secreta ${secret} y lista los ficheros.`, atMs: null },
    { kind: 'tool', id: 'call_e2e1', name: 'exec', input: { command: 'ls' }, output: 'a.txt\nb.txt', isError: false, atMs: null },
    { kind: 'assistant', text: 'Hay dos ficheros: a.txt y b.txt.', atMs: null },
  ],
};
const clock = { baseMs: Date.now() };
const question = '¿Qué palabra secreta te pedí recordar? Responde solo esa palabra.';
const results = [];
const cleanups = [];

async function withFakeAnthropic(handler) {
  const bodies = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => handler(req, res, raw, bodies));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, bodies, port: server.address().port };
}

async function claudeCase() {
  const profile = mkdtempSync(join(tmpdir(), 'mage-e2e-claude-'));
  cleanups.push(profile);
  const sessionId = randomUUID();
  let n = 0;
  const text = w.claudeTranscriptText(conversation, { sessionId, newId: () => randomUUID(), clock });
  const file = join(profile, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  const { server, bodies, port } = await withFakeAnthropic((req, res, raw, all) => {
    if (req.url?.includes('/count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":9}'); return; }
    if (!req.url?.includes('/v1/messages')) { res.writeHead(404); res.end(); return; }
    try { all.push(JSON.parse(raw)); } catch { /* sin JSON */ }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [name, body] of [['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'claude-haiku-4-5', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }], ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }], ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }], ['message_stop', { type: 'message_stop' }]]) res.write(`event: ${name}\ndata: ${JSON.stringify(body)}\n\n`);
    res.end();
    n += 1;
  });
  try {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: profile, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'sk-ant-api03-mage-fake' };
    for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];
    const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--resume', sessionId, '--model', 'haiku'], { cwd, env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.resume();
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: question } })}\n`);
    await new Promise((done) => {
      const timer = setTimeout(() => { child.kill(); done(); }, 60_000);
      const watch = setInterval(() => { if (out.includes('"type":"result"')) { clearInterval(watch); clearTimeout(timer); child.stdin.end(); } }, 200);
      child.on('exit', () => { clearInterval(watch); clearTimeout(timer); done(); });
    });
    const turn = bodies.find((b) => JSON.stringify(b.messages ?? []).includes(secret));
    return { provider: 'claude', ok: turn !== undefined && JSON.stringify(turn.messages).includes('tool_use') && JSON.stringify(turn.messages).includes('a.txt'), detail: `${n} peticiones` };
  } finally {
    server.close();
  }
}

async function codexCase() {
  const home = mkdtempSync(join(tmpdir(), 'mage-e2e-codex-'));
  cleanups.push(home);
  const threadId = randomUUID();
  const rel = w.codexRolloutRelativePath(threadId, clock.baseMs);
  mkdirSync(dirname(join(home, ...rel)), { recursive: true });
  writeFileSync(join(home, ...rel), w.codexRolloutText(conversation, { threadId, clock }));
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
  try {
    await call('initialize', { clientInfo: { name: 'mage-e2e', version: '0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
    const resume = await call('thread/resume', { threadId, cwd, model: 'gpt-5.6-luna' });
    if (resume.error !== undefined) return { provider: 'codex', ok: false, detail: `thread/resume: ${JSON.stringify(resume.error)}` };
    await call('turn/start', { threadId, input: [{ type: 'text', text: question, text_elements: [] }] });
    for (let i = 0; i < 150 && bodies.length === 0; i += 1) await new Promise((done) => setTimeout(done, 200));
    const input = JSON.stringify(bodies[0]?.input ?? []);
    return { provider: 'codex', ok: input.includes(secret) && input.includes('function_call') && input.includes('a.txt'), detail: 'thread/resume ok' };
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    server.closeAllConnections();
    server.close();
  }
}

function agyCase() {
  const profile = mkdtempSync(join(tmpdir(), 'mage-e2e-agy-'));
  cleanups.push(profile);
  const conversationId = randomUUID();
  const content = w.agyDbContent(conversation, { conversationId, trajectoryId: randomUUID(), newId: () => randomUUID(), clock });
  w.writeAgyConversationDb(join(profile, '.gemini', 'antigravity-cli', 'conversations', `${conversationId}.db`), content);
  const run = spawnSync('agy', ['--conversation', conversationId, '--print', question, '--output-format', 'text'], { cwd: profile, env: { ...process.env, USERPROFILE: profile }, encoding: 'utf8', timeout: 180_000, windowsHide: true });
  const answer = (run.stdout ?? '').trim();
  return { provider: 'agy', ok: answer.toUpperCase().includes(secret), detail: `respuesta ${JSON.stringify(answer.slice(0, 80))} (código ${run.status})` };
}

const wanted = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['claude', 'codex', 'agy'];
try {
  for (const name of wanted) results.push(await ({ claude: claudeCase, codex: codexCase, agy: agyCase })[name]());
} finally {
  for (const dir of [...cleanups, cwd, workdir]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.provider}: ${r.detail}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
