// Servidor FALSO compatible con la API de OpenAI, para verificar un turno de punta a punta sin gastar
// cuota: `verify:gui` lo arranca cuando la guarda de uso elige «local», y Mage lo usa como un
// proveedor del usuario mas (gateway -> este servidor). Responde siempre el mismo texto.
//
// Solo lo que un turno necesita: `GET /v1/models` y `POST /v1/chat/completions` (con y sin stream).
// Cuenta las peticiones en `stats` para que la comprobacion afirme que el turno paso POR AQUI y no por
// la API de verdad.

import http from 'node:http';

export const FAKE_OPENAI_MODEL = 'vg-modelo-falso';
export const FAKE_OPENAI_REPLY = 'respuesta del servidor falso';

export function startFakeOpenAiServer() {
  const stats = { models: 0, completions: 0, streamed: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      stats.models += 1;
      sendJson(res, 200, { object: 'list', data: [{ id: FAKE_OPENAI_MODEL, object: 'model' }] });
      return;
    }
    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
      stats.completions += 1;
      readBody(req).then((body) => answerCompletion(res, body, stats));
      return;
    }
    sendJson(res, 404, { error: { message: `ruta no simulada: ${req.method} ${req.url}` } });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, baseUrl: `http://127.0.0.1:${port}/v1`, stats, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

function answerCompletion(res, rawBody, stats) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: { message: `JSON malformado (${rawBody.length} caracteres)` } });
    return;
  }
  const usage = { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 };
  if (payload.stream !== true) {
    sendJson(res, 200, {
      id: 'vg-1',
      object: 'chat.completion',
      model: payload.model,
      choices: [{ index: 0, message: { role: 'assistant', content: FAKE_OPENAI_REPLY }, finish_reason: 'stop' }],
      usage,
    });
    return;
  }
  stats.streamed += 1;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const chunk = (body) => res.write(`data: ${JSON.stringify({ id: 'vg-1', object: 'chat.completion.chunk', model: payload.model, ...body })}\n\n`);
  chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: FAKE_OPENAI_REPLY }, finish_reason: null }] });
  chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  chunk({ choices: [], usage });
  res.end('data: [DONE]\n\n');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
