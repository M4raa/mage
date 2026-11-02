// Servidor Anthropic FALSO (API de Messages, SSE), sin cuota: lo usan T6 (MAGE_TEST_ANTHROPIC_BASE_URL, que
// apunta a el el hijo de una cuenta de Claude por clave de API), el turno local de Claude de verify:gui y los
// spikes de rewind y keep-alive (spike/steer-claude.mjs). Sirve para medir el protocolo del CLI real.
// Guion por el último texto de usuario:
//   «WRITE <fichero> <contenido>» → tool_use Write; «SHELLWRITE <fichero> <contenido>» → tool_use Bash que
//   escribe; «SLEEP» → tool_use Bash `sleep 6`; «SLOW» → texto lento (4 s); «ECO <texto>» → «ECO: <texto>»;
//   tras un tool_result → «HECHO». Registra cada petición (roles y textos) en `requests`.
// `cacheTtl` ('1h' | '5m' | null) decide en qué cubeta de `cache_creation` caen los 10 tokens de caché;
// con null el campo no se envía.
import http from 'node:http';
import path from 'node:path';

const CACHE_TOKENS = 10;

export function startFakeAnthropic({ cwd, cacheTtl = '1h' }) {
  const requests = [];
  const usage = usageOf(cacheTtl);
  let n = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404).end('{}'); return; }
    if (req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":10}'); return; }
    const json = JSON.parse(body);
    const msgs = json.messages ?? [];
    const record = { i: ++n, at: Date.now(), stream: json.stream === true, messages: msgs.map(summ), rawTail: JSON.stringify(msgs.slice(-3)).slice(0, 4000) };
    requests.push(record);
    const plan = decide(msgs, cwd);
    record.reply = plan.kind === 'text' ? `text:${plan.text}` : `tool:${plan.name}`;
    if (json.stream !== true) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(nonStream(plan, usage))); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    await stream(res, plan, usage);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) })));
}

// `usage` de message_start; con cacheTtl null, sin el campo `cache_creation`.
function usageOf(cacheTtl) {
  const base = { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  if (cacheTtl === null) return base;
  return {
    ...base,
    cache_creation: {
      ephemeral_1h_input_tokens: cacheTtl === '1h' ? CACHE_TOKENS : 0,
      ephemeral_5m_input_tokens: cacheTtl === '5m' ? CACHE_TOKENS : 0,
    },
  };
}

// Un mensaje → «rol: bloque|bloque» con los textos recortados.
function summ(m) {
  const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
  return `${m.role}: ` + blocks.map((b) => b.type === 'text' ? `T(${b.text.replace(/\s+/g, ' ').slice(0, 70)})` : b.type === 'tool_result' ? `TR[${(Array.isArray(b.content) ? b.content.map((x) => x.type === 'text' ? x.text : x.type).join(' ~ ') : String(b.content)).replace(/\s+/g, ' ').slice(0, 160)}]` : b.type === 'tool_use' ? `TU(${b.name})` : b.type).join(' | ');
}

function userTexts(m) {
  if (m.role !== 'user') return [];
  const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
  return blocks.filter((b) => b.type === 'text' && !b.text.startsWith('<system-reminder>')).map((b) => b.text);
}

function decide(msgs, cwd) {
  const last = [...msgs].reverse().find((m) => m.role === "user");
  const blocks = typeof last.content === 'string' ? [] : last.content;
  const texts = userTexts(last).map((t) => t.trim());
  const cmd = texts.find((t) => /^(WRITE|SHELLWRITE|SLEEP|SLOW|ECO)\b/.test(t)) ?? texts.at(-1) ?? '';
  if (blocks.some((b) => b.type === 'tool_result') && !/^(WRITE|SHELLWRITE|SLEEP|SLOW)\b/.test(cmd)) return { kind: 'text', text: `HECHO${texts.length ? ' + ' + texts.join(' / ').slice(0, 60) : ''}` };
  const sw = /^SHELLWRITE (\S+) (\S+)/.exec(cmd);
  if (sw) return { kind: 'tool', name: 'Bash', input: { command: `printf ${sw[2]} > ${sw[1]}`, description: 'escribe' } };
  const w = /^WRITE (\S+) (\S+)/.exec(cmd);
  if (w) return { kind: 'tool', name: 'Write', input: { file_path: path.join(cwd, w[1]), content: w[2] } };
  if (/^SLEEP\b/.test(cmd)) return { kind: 'tool', name: 'Bash', input: { command: 'sleep 6', description: 'espera' } };
  if (/^SLOW\b/.test(cmd)) return { kind: 'text', text: 'LENTO '.repeat(20), slow: true };
  return { kind: 'text', text: `ECO: ${cmd.slice(0, 60)}` };
}

const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);

async function stream(res, plan, usage) {
  sse(res, 'message_start', { message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'claude-haiku-fake', content: [], stop_reason: null, stop_sequence: null, usage } });
  if (plan.kind === 'text') {
    sse(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    const parts = plan.slow ? plan.text.match(/.{1,6}/g) : [plan.text];
    for (const p of parts) { sse(res, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: p } }); if (plan.slow) await new Promise((r) => setTimeout(r, 200)); }
    sse(res, 'content_block_stop', { index: 0 });
    sse(res, 'message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
  } else {
    sse(res, 'content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${Date.now()}`, name: plan.name, input: {} } });
    sse(res, 'content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(plan.input) } });
    sse(res, 'content_block_stop', { index: 0 });
    sse(res, 'message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } });
  }
  sse(res, 'message_stop', {});
}

function nonStream(plan, usage) {
  return { id: 'msg_ns', type: 'message', role: 'assistant', model: 'claude-haiku-fake', content: [{ type: 'text', text: plan.kind === 'text' ? plan.text : 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage };
}
