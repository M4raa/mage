// Mide el result del CLI con autenticación por API contra un servidor local: cero turnos de pago.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = mkdtempSync(join(tmpdir(), 'mage-claude-api-spike-'));
const server = createServer((request, response) => {
  request.resume();
  if (request.url?.includes('/v1/messages/count_tokens')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ input_tokens: 9 }));
    return;
  }
  if (!request.url?.includes('/v1/messages')) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_mage_fake', type: 'message', role: 'assistant', content: [], model: 'claude-haiku-4-5', stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  for (const [name, body] of events) response.write(`event: ${name}\ndata: ${JSON.stringify(body)}\n\n`);
  response.end();
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Servidor falso sin puerto');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: profile, ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    ANTHROPIC_API_KEY: 'sk-ant-api03-mage-fake' };
  for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];
  const child = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--effort', 'low', 'Responde OK'], {
    cwd: profile, env, windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI sin terminar en 30 s')); }, 30_000);
    child.on('exit', (exitCode) => { clearTimeout(timer); resolve(exitCode); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
  const results = stdout.split(/\r?\n/).flatMap((line) => {
    try { const event = JSON.parse(line); return event.type === 'result' ? [event] : []; }
    catch { return []; }
  });
  const result = results[0];
  console.log(JSON.stringify({ cli: 'claude', code, result: result === undefined ? null : {
    subtype: result.subtype, usage: result.usage, total_cost_usd: result.total_cost_usd, num_turns: result.num_turns },
    error: result === undefined ? stderr.slice(0, 300) : null }, null, 2));
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
