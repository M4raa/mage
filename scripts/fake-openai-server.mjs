// Servidor FALSO compatible con la API de OpenAI, para verificar el runtime propio (P-032) de punta a
// punta sin gastar cuota: lo usan `verify:gui` (turno «local»), los tests y la verificacion a mano.
// Sale del servidor de `spike/runtime-spike.mjs`: cada ESCENARIO es un guion que, dada la conversacion
// recibida, decide que trozos manda. Reproduce las formas documentadas por OpenAI, Ollama y LM Studio.
//
// El escenario se elige por peticion con el MODELO: `fake:<escenario>` (p.ej. `fake:openai-troceado`), y
// si el modelo no lo dice, el de `--scenario` (por defecto `eco`). Asi un solo servidor sirve a varias
// comprobaciones. `GET /__stats` devuelve el recuento de peticiones.
//
// Uso a mano: node scripts/fake-openai-server.mjs --port 11500 [--scenario eco]
//             y un proveedor con URL base http://127.0.0.1:11500/v1

import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const FAKE_OPENAI_MODEL = 'vg-modelo-falso';
export const FAKE_OPENAI_REPLY = 'respuesta del servidor falso';
// Ventana que declara el catalogo falso (`/api/v1/models` a lo LM Studio) para `fake:contexto-2048`.
export const FAKE_SMALL_CONTEXT = 2048;
const SCENARIO_MODEL_PREFIX = 'fake:';
const CHUNK_DELAY_MS = 5;
const SLOW_CHUNK_DELAY_MS = 200;

const chunk = (model, delta, finish = null) => ({
  id: 'chatcmpl-fake',
  object: 'chat.completion.chunk',
  model,
  choices: [{ index: 0, delta, finish_reason: finish }],
});
const call = (index, id, name, args) => ({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: args } }] });
const lastRole = (body) => body.messages.at(-1)?.role;
const toolTurns = (body) => body.messages.filter((m) => m.role === 'tool').length;
const text = (value) => [{ role: 'assistant', content: '' }, ...(value.match(/.{1,6}/gsu) ?? []).map((t) => ({ content: t }))];
// Una vuelta: lista de deltas y el finish_reason final.
const round = (deltas, finish) => ({ deltas, finish });

// Cada escenario: `reply(body) -> round`, `usage` (manda trozo de uso si se pide) y opcionales `reject`
// (respuesta de error) y `delay`.
const SCENARIOS = {
  // Texto fijo en una vuelta: el turno minimo de `verify:gui`.
  eco: { reply: () => round(text(FAKE_OPENAI_REPLY), 'stop'), usage: true },
  // OpenAI de libro: id solo en el primer trozo, argumentos troceados y dos llamadas entrelazadas.
  'openai-troceado': {
    reply: (body) =>
      lastRole(body) === 'user'
        ? round(
            [
              call(0, 'call_a', 'Read', ''),
              { tool_calls: [{ index: 0, function: { arguments: '{"file_pa' } }] },
              call(1, 'call_b', 'Glob', '{"pattern"'),
              { tool_calls: [{ index: 0, function: { arguments: 'th": "hola.txt"}' } }] },
              { tool_calls: [{ index: 1, function: { arguments: ': "**/*.txt"}' } }] },
            ],
            'tool_calls',
          )
        : round(text('Leído: el fichero dice hola.'), 'stop'),
    usage: true,
  },
  // Forma Ollama /v1: cada llamada entera en un trozo; sin trozo de uso.
  'ollama-entero': {
    reply: (body) =>
      lastRole(body) === 'user' ? round([call(0, 'call_x', 'Read', '{"file_path":"hola.txt"}')], 'tool_calls') : round(text('Leído.'), 'stop'),
    usage: false,
  },
  // Modelo pequeño que se equivoca: JSON roto, herramienta inexistente y por fin la buena.
  'argumentos-rotos': {
    reply: (body) => {
      const n = toolTurns(body);
      if (n === 0) return round([call(0, 'c1', 'Read', '{"file_path": "hola.txt"')], 'tool_calls');
      if (n === 1) return round([call(0, 'c2', 'leer', '{}')], 'tool_calls');
      if (n === 2) return round([call(0, 'c3', 'Read', '{"file_path":"hola.txt"}')], 'tool_calls');
      return round(text('Por fin: hola.'), 'stop');
    },
    usage: true,
  },
  // Modelo sin herramientas: 400 con el texto de Ollama si la peticion trae `tools`.
  'sin-tools': {
    reject: (body) =>
      body.tools !== undefined ? { status: 400, body: { error: { message: `registry.ollama.ai/library/${body.model} does not support tools` } } } : null,
    reply: () => round(text('Sin herramientas no puedo leer el fichero.'), 'stop'),
    usage: false,
  },
  // Llamada escrita DENTRO del texto (modelos sin plantilla de herramientas), con `stop`.
  'tool-en-texto': {
    reply: (body) =>
      lastRole(body) === 'user'
        ? round(text('<tool_call>{"name":"Read","arguments":{"file_path":"hola.txt"}}</tool_call>'), 'stop')
        : round(text('Leído.'), 'stop'),
    usage: false,
  },
  // Trozos lentos para probar el abortar.
  abortar: { reply: () => round(text('uno dos tres cuatro cinco seis siete ocho nueve diez'), 'stop'), usage: false, delay: SLOW_CHUNK_DELAY_MS },
  // Escritura: pide un Write (lo que dispara la tarjeta de permiso en modo Manual).
  write: {
    reply: (body) =>
      lastRole(body) === 'user'
        ? round([call(0, 'call_w', 'Write', '{"file_path":"vg-runtime.txt","content":"hola desde el runtime\\n"}')], 'tool_calls')
        : round(text('Escrito.'), 'stop'),
    usage: true,
  },
  // Edicion de un fichero que ya existe (hola.txt con «hola»).
  edit: {
    reply: (body) =>
      lastRole(body) === 'user'
        ? round([call(0, 'call_e', 'Edit', '{"file_path":"hola.txt","old_string":"hola","new_string":"adiós"}')], 'tool_calls')
        : round(text('Editado.'), 'stop'),
    usage: true,
  },
  // Contesta con el numero de mensajes (sin el de sistema) que recibe: prueba que reanudar mantiene el contexto.
  'cuenta-mensajes': {
    reply: (body) => round(text(`mensajes: ${body.messages.filter((m) => m.role !== 'system').length}`), 'stop'),
    usage: true,
  },
  // Respuesta larga en un modelo de ventana pequeña (el catalogo declara FAKE_SMALL_CONTEXT).
  'contexto-2048': { reply: () => round([{ role: 'assistant', content: 'x'.repeat(1200) }], 'stop'), usage: true },
};

export const FAKE_SCENARIOS = Object.keys(SCENARIOS);

function scenarioFor(model, fallback) {
  const name = typeof model === 'string' && model.startsWith(SCENARIO_MODEL_PREFIX) ? model.slice(SCENARIO_MODEL_PREFIX.length) : fallback;
  const scenario = SCENARIOS[name];
  if (scenario === undefined) throw new Error(`escenario desconocido: ${name} (hay: ${FAKE_SCENARIOS.join(', ')})`);
  return scenario;
}

// `options.scenario`: el escenario por defecto. Devuelve { port, baseUrl, stats, close }.
export function startFakeOpenAiServer(options = {}) {
  const fallback = options.scenario ?? 'eco';
  scenarioFor(null, fallback); // falla pronto con un escenario mal escrito
  const stats = { models: 0, completions: 0, streamed: 0, requests: [] };
  const server = http.createServer((req, res) => {
    route(req, res, stats, fallback).catch((err) => sendJson(res, 500, { error: { message: String(err?.message ?? err) } }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, baseUrl: `http://127.0.0.1:${port}/v1`, stats, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

async function route(req, res, stats, fallback) {
  const path = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && path === '/__stats') return sendJson(res, 200, { ...stats, requests: stats.requests.length });
  if (req.method === 'GET' && path.endsWith('/api/v1/models')) return sendJson(res, 200, lmStudioCatalog());
  if (req.method === 'GET' && path.endsWith('/models')) {
    stats.models += 1;
    const data = [FAKE_OPENAI_MODEL, ...FAKE_SCENARIOS.map((name) => `${SCENARIO_MODEL_PREFIX}${name}`)].map((id) => ({ id, object: 'model' }));
    return sendJson(res, 200, { object: 'list', data });
  }
  if (req.method === 'POST' && path.endsWith('/chat/completions')) {
    stats.completions += 1;
    return answerCompletion(req, res, await readBody(req), stats, fallback);
  }
  return sendJson(res, 404, { error: { message: `ruta no simulada: ${req.method} ${req.url}` } });
}

// Forma de `GET /api/v1/models` de LM Studio (lmstudio.ai/docs/developer/rest/list): `fake:contexto-2048`
// declara una ventana pequeña cargada; el resto, 32k y con herramientas.
function lmStudioCatalog() {
  const entry = (key, contextLength, tools) => ({
    type: 'llm',
    key,
    max_context_length: contextLength,
    capabilities: { trained_for_tool_use: tools, vision: false },
    loaded_instances: [{ id: key, config: { context_length: contextLength } }],
  });
  return {
    models: [
      entry(FAKE_OPENAI_MODEL, 32768, true),
      ...FAKE_SCENARIOS.map((name) => entry(`${SCENARIO_MODEL_PREFIX}${name}`, name === 'contexto-2048' ? FAKE_SMALL_CONTEXT : 32768, name !== 'sin-tools')),
    ],
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (part) => (body += part));
    req.on('end', () => resolve(body));
  });
}

async function answerCompletion(req, res, rawBody, stats, fallback) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return sendJson(res, 400, { error: { message: `JSON malformado (${rawBody.length} caracteres)` } });
  }
  stats.requests.push(payload);
  const scenario = scenarioFor(payload.model, fallback);
  const rejection = scenario.reject?.(payload) ?? null;
  if (rejection !== null) return sendJson(res, rejection.status, rejection.body);
  const { deltas, finish } = scenario.reply(payload);
  // Cuenta aproximada (chars/4 del cuerpo): lo justo para que el recalibrado del runtime vea algo creible.
  const usage = { prompt_tokens: Math.max(1, Math.floor(rawBody.length / 4)), completion_tokens: 5, total_tokens: 0 };
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  if (payload.stream !== true) return sendJson(res, 200, wholeCompletion(payload.model, deltas, finish, usage));
  stats.streamed += 1;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const write = (body) => res.write(`data: ${JSON.stringify(body)}\n\n`);
  for (const delta of deltas) {
    if (res.destroyed) return undefined;
    write(chunk(payload.model, delta));
    await new Promise((done) => setTimeout(done, scenario.delay ?? CHUNK_DELAY_MS));
  }
  write(chunk(payload.model, {}, finish));
  if (scenario.usage && payload.stream_options?.include_usage === true) write({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', model: payload.model, choices: [], usage });
  res.end('data: [DONE]\n\n');
  return undefined;
}

// Lo mismo sin streaming (por si un cliente lo pide asi).
function wholeCompletion(model, deltas, finish, usage) {
  const content = deltas.map((d) => d.content ?? '').join('');
  const toolCalls = deltas.flatMap((d) => d.tool_calls ?? []).filter((c) => c.id !== undefined);
  const message = { role: 'assistant', content, ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }) };
  return { id: 'chatcmpl-fake', object: 'chat.completion', model, choices: [{ index: 0, message, finish_reason: finish }], usage };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// --- Uso desde la linea de comandos ------------------------------------------------------------------

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(argValue('--port') ?? 0);
  const fake = await startFakeOpenAiServer({ port, scenario: argValue('--scenario') ?? 'eco' });
  console.log(`servidor falso en ${fake.baseUrl} (escenarios: ${FAKE_SCENARIOS.join(', ')}; recuento en /__stats)`);
}
