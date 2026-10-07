// Mide si el CLI de Claude expone la elicitation de MCP por stream-json y con qué forma, SIN turnos de
// pago: un servidor Anthropic local manda un tool_use del MCP artificial (spike/codex-elicitation-server.mjs)
// y el MCP responde con `elicitation/create`. Uso: node spike/claude-elicitation-spike.mjs [accept|decline|cancel]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const action = process.argv[2] ?? 'accept';
if (!['accept', 'decline', 'cancel'].includes(action)) throw new Error(`Acción inválida: ${action}`);
const here = dirname(fileURLToPath(import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'mage-claude-elic-spike-'));
const TOOL = 'mcp__elic__form';
const FORM_ANSWER = { name: 'Ana', count: 2, confirmed: true, choice: 'one' };

const sse = (response, events) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [name, body] of events) response.write(`event: ${name}\ndata: ${JSON.stringify(body)}\n\n`);
  response.end();
};
const message = (content, stop) => [
  ['message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', content: [], model: 'claude-haiku-4-5', stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 0 } } }],
  ...content.flatMap((block, index) => [
    ['content_block_start', { type: 'content_block_start', index, content_block: block.start }],
    ['content_block_delta', { type: 'content_block_delta', index, delta: block.delta }],
    ['content_block_stop', { type: 'content_block_stop', index }],
  ]),
  ['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 2 } }],
  ['message_stop', { type: 'message_stop' }],
];

const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    if (request.url?.includes('/count_tokens')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"input_tokens":9}'); return; }
    if (!request.url?.includes('/v1/messages')) { response.writeHead(404); response.end(); return; }
    const wantsTool = body.includes(TOOL) && !body.includes('"tool_result"');
    sse(response, wantsTool
      ? message([{ start: { type: 'tool_use', id: 'toolu_fake', name: TOOL, input: {} }, delta: { type: 'input_json_delta', partial_json: '{}' } }], 'tool_use')
      : message([{ start: { type: 'text', text: '' }, delta: { type: 'text_delta', text: 'OK' } }], 'end_turn'));
  });
});

const log = [];
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: profile, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'sk-ant-api03-mage-fake' };
  for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];
  const mcp = JSON.stringify({ mcpServers: { elic: { command: process.execPath, args: [join(here, 'codex-elicitation-server.mjs'), '--serve-elicitation'] } } });
  const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-prompt-tool', 'stdio', '--mcp-config', mcp, '--strict-mcp-config', '--model', 'haiku', '--effort', 'low'],
  { cwd: profile, env, windowsHide: true });
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (line.trim().length > 0) handle(JSON.parse(line));
    }
  });
  const handle = (event) => {
    log.push(event);
    if (event.type === 'result') { child.stdin.end(); return; }
    if (event.type !== 'control_request') return;
    const { subtype } = event.request;
    const payload = subtype === 'can_use_tool' ? { behavior: 'allow', updatedInput: event.request.input }
      : subtype === 'elicitation' ? { action, ...(action === 'accept' ? { content: FORM_ANSWER } : {}) } : null;
    if (payload !== null) send({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response: payload } });
  };
  send({ type: 'user', message: { role: 'user', content: 'usa la herramienta form' } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI sin terminar en 60 s')); }, 60_000);
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

const requests = log.filter((e) => e.type === 'control_request');
console.log('control_request:', JSON.stringify(requests.map((e) => e.request), null, 1));
console.log('tool_result:', JSON.stringify(log.filter((e) => e.type === 'user').map((e) => e.message?.content)));
console.log('system/otros:', JSON.stringify(log.filter((e) => e.type === 'system' && e.subtype !== 'init').map((e) => e.subtype)));
console.log('result:', JSON.stringify(log.find((e) => e.type === 'result')?.subtype));
