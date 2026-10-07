// Mide si Claude Code reanuda (`--resume`) una transcripción ESCRITA POR MAGE, sin turnos de pago: un servidor
// Anthropic local registra la petición del turno y se comprueba que el historial escrito llega en `messages`.
// Uso: node spike/claude-resume-spike.mjs [--minimal]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const profile = mkdtempSync(join(tmpdir(), 'mage-claude-resume-'));
const cwd = mkdtempSync(join(tmpdir(), 'mage-claude-resume-cwd-'));
const sessionId = randomUUID();
const minimal = process.argv.includes('--minimal');

// Conversación sintética: usuario → herramienta (Bash) con su resultado → respuesta → usuario.
const ids = { u1: randomUUID(), a1: randomUUID(), r1: randomUUID(), a2: randomUUID(), u2: randomUUID() };
const base = (uuid, parent, extra) => ({
  parentUuid: parent, isSidechain: false, uuid, timestamp: '2026-10-07T10:00:00.000Z', sessionId, cwd,
  ...(minimal ? {} : { userType: 'external', entrypoint: 'cli', version: '2.1.292', gitBranch: 'main' }), ...extra,
});
const assistant = (uuid, parent, content, stop) => base(uuid, parent, { type: 'assistant', message: {
  id: `msg_${uuid.slice(0, 8)}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content, stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 } } });
const lines = [
  base(ids.u1, null, { type: 'user', message: { role: 'user', content: 'Recuerda la palabra CIRUELA y lista los ficheros.' } }),
  assistant(ids.a1, ids.u1, [{ type: 'tool_use', id: 'toolu_spike1', name: process.env.SPIKE_TOOL ?? 'Bash', input: { command: 'ls' } }], 'tool_use'),
  base(ids.r1, ids.a1, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_spike1', content: 'a.txt\nb.txt' }] } }),
  assistant(ids.a2, ids.r1, [{ type: 'text', text: 'Hay dos ficheros: a.txt y b.txt.' }], 'end_turn'),
];
const folder = cwd.replace(/[^a-zA-Z0-9]/g, '-');
mkdirSync(join(profile, 'projects', folder), { recursive: true });
writeFileSync(join(profile, 'projects', folder, `${sessionId}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);

const requests = [];
const sse = (response, text) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', content: [], model: 'claude-haiku-4-5', stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  for (const [name, body] of events) response.write(`event: ${name}\ndata: ${JSON.stringify(body)}\n\n`);
  response.end();
};
const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    if (request.url?.includes('/count_tokens')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"input_tokens":9}'); return; }
    if (!request.url?.includes('/v1/messages')) { response.writeHead(404); response.end(); return; }
    try { requests.push(JSON.parse(body)); } catch { /* petición auxiliar sin JSON */ }
    sse(response, 'OK');
  });
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: profile, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'sk-ant-api03-mage-fake' };
  for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];
  const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--resume', sessionId, '--model', 'haiku'],
    { cwd, env, windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: '¿Qué palabra te pedí recordar?' } })}\n`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI sin terminar en 60 s')); }, 60_000);
    const watch = setInterval(() => { if (stdout.includes('"type":"result"')) { clearInterval(watch); clearTimeout(timer); child.stdin.end(); } }, 200);
    child.on('exit', () => { clearInterval(watch); clearTimeout(timer); resolve(); });
  });
  const turn = requests.find((r) => Array.isArray(r.messages) && r.messages.some((m) => JSON.stringify(m).includes('palabra')));
  const summary = (turn?.messages ?? []).map((m) => `${m.role}:${typeof m.content === 'string' ? 'texto' : m.content.map((b) => b.type).join('+')}`);
  const result = stdout.split('\n').filter((l) => l.includes('"type":"result"')).map((l) => JSON.parse(l))[0];
  console.log(minimal ? '== forma MÍNIMA ==' : '== forma COMPLETA ==');
  console.log('mensajes enviados al modelo:', JSON.stringify(summary));
  console.log('historial recibido:', JSON.stringify(turn?.messages ?? []).includes('CIRUELA') ? 'SÍ (llegó CIRUELA)' : 'NO');
  console.log('result:', result?.subtype, result?.is_error ? `error: ${String(result.result).slice(0, 200)}` : 'ok');
  if (turn === undefined) console.log('stderr:', stderr.slice(0, 400));
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
}
