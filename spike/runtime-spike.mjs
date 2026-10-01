// Spike: el bucle de un runtime propio de Mage contra un servidor OpenAI-compatible FALSO.
//
// POR QUE EXISTE: P-032 (notes/PLAN-RUNTIME-PROPIO.md) propone que Mage tenga su propio bucle de agente
// (LLM + herramientas) para los modelos sin CLI (Ollama, LM Studio, cualquier endpoint
// OpenAI-compatible) en vez del gatewayAdapter. Antes de planificar hay que ver el bucle funcionando de
// punta a punta: peticion con `tools`, `tool_calls` troceados en streaming, ejecucion, segunda vuelta y
// resultado. No hay Ollama ni LM Studio en la maquina y no se gasta cuota de nadie: el servidor es
// falso, local, y reproduce las formas de respuesta que documentan OpenAI, Ollama y LM Studio.
//
// Lo que NO demuestra: como se comporta un modelo real (eso lo mide la fase de verificacion con el
// endpoint local del usuario). Lo que SI: que el cliente reensambla bien cada forma de stream, que la
// segunda vuelta lleva los mensajes que el protocolo exige, que el uso se suma, que abortar corta la
// conexion y que los fallos tipicos (JSON roto, herramienta inexistente, modelo sin tools) se pueden
// recuperar sin romper el turno.
//
// Uso: node spike/runtime-spike.mjs            (todos los escenarios)
//      node spike/runtime-spike.mjs openai     (solo los que contengan esa subcadena)
// Sin dependencias: Node >= 22 (fetch global). No escribe fuera de un directorio temporal que borra.
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

// ---------------------------------------------------------------------------------------------
// 1. Servidor falso. Cada escenario es un guion: dada la conversacion recibida, que trozos manda.
// ---------------------------------------------------------------------------------------------

const MODEL = 'fake-coder-7b';
const CHUNK_DELAY_MS = 5;
const SLOW_CHUNK_DELAY_MS = 200;

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const chunk = (delta, finish = null) => ({
  id: 'chatcmpl-fake', object: 'chat.completion.chunk', model: MODEL,
  choices: [{ index: 0, delta, finish_reason: finish }],
});
const usageChunk = (prompt, completion) => ({
  id: 'chatcmpl-fake', object: 'chat.completion.chunk', model: MODEL, choices: [],
  usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
});
const lastRole = (body) => body.messages.at(-1)?.role;
const toolTurns = (body) => body.messages.filter((m) => m.role === 'tool').length;

// Forma OpenAI: id solo en el primer trozo de cada llamada, `arguments` troceado, dos llamadas en
// paralelo (index 0 y 1) entrelazadas, y un trozo final de uso si se pidio include_usage.
const openaiToolCalls = [
  chunk({ role: 'assistant', content: null }),
  chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '' } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] }),
  chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'glob', arguments: '{"pattern"' } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: 'th": "hola.txt"}' } }] }),
  chunk({ tool_calls: [{ index: 1, function: { arguments: ': "**/*.txt"}' } }] }),
  chunk({}, 'tool_calls'),
];
const finalText = (text) => [
  chunk({ role: 'assistant', content: '' }),
  ...text.match(/.{1,6}/g).map((t) => chunk({ content: t })),
  chunk({}, 'stop'),
];

const SCENARIOS = {
  // A. OpenAI de libro: tool_calls troceados, dos en paralelo, uso al final.
  'openai-troceado': {
    reply: (body) => lastRole(body) === 'user' ? openaiToolCalls : finalText('El fichero dice hola y hay 1 .txt.'),
    usage: true,
  },
  // B. Forma Ollama /v1: cada llamada llega ENTERA en un solo trozo; sin trozo de uso.
  'ollama-entero': {
    reply: (body) => lastRole(body) === 'user'
      ? [chunk({ role: 'assistant', content: '', tool_calls: [{ index: 0, id: 'call_x', type: 'function',
          function: { name: 'read_file', arguments: '{"path":"hola.txt"}' } }] }), chunk({}, 'tool_calls')]
      : finalText('Leido.'),
    usage: false,
  },
  // C. Modelo pequeno que se equivoca: JSON roto y herramienta inexistente; al recibir el error
  //    como resultado de la herramienta, corrige en la vuelta siguiente.
  'argumentos-rotos': {
    reply: (body) => {
      const n = toolTurns(body);
      if (n === 0) return [chunk({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path": "hola.txt"' } }] }), chunk({}, 'tool_calls')];
      if (n === 1) return [chunk({ tool_calls: [{ index: 0, id: 'c2', type: 'function', function: { name: 'leer', arguments: '{}' } }] }), chunk({}, 'tool_calls')];
      if (n === 2) return [chunk({ tool_calls: [{ index: 0, id: 'c3', type: 'function', function: { name: 'read_file', arguments: '{"path":"hola.txt"}' } }] }), chunk({}, 'tool_calls')];
      return finalText('Por fin: hola.');
    },
    usage: true,
  },
  // D. Modelo sin soporte de tools: el servidor rechaza la peticion con `tools` (texto de Ollama).
  'sin-tools': {
    reject: (body) => body.tools !== undefined
      ? { status: 400, body: { error: { message: `registry.ollama.ai/library/${MODEL} does not support tools` } } }
      : null,
    reply: () => finalText('Sin herramientas no puedo leer el fichero.'),
    usage: false,
  },
  // E. Llamada escrita DENTRO del texto (modelos sin plantilla de tools): finish_reason "stop".
  'tool-en-texto': {
    reply: (body) => lastRole(body) === 'user'
      ? finalText('<tool_call>{"name":"read_file","arguments":{"path":"hola.txt"}}</tool_call>')
      : finalText('Leido.'),
    usage: false,
  },
  // F. Abortar a mitad: trozos lentos; el cliente aborta tras el segundo.
  'abortar': {
    reply: () => finalText('uno dos tres cuatro cinco seis siete ocho nueve diez'),
    usage: false,
    delay: SLOW_CHUNK_DELAY_MS,
  },
};

function startFakeServer(scenario, log) {
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }));
      return;
    }
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    log.requests.push(body);
    const rejection = scenario.reject?.(body) ?? null;
    if (rejection !== null) {
      res.writeHead(rejection.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(rejection.body));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    req.on('close', () => { log.closedAt = Date.now(); });
    res.on('close', () => { log.closedAt ??= Date.now(); });
    const parts = scenario.reply(body);
    for (const p of parts) {
      if (res.destroyed) return;
      res.write(sse(p));
      log.chunksSent++;
      await new Promise((r) => setTimeout(r, scenario.delay ?? CHUNK_DELAY_MS));
    }
    if (scenario.usage && body.stream_options?.include_usage === true) res.write(sse(usageChunk(100 + raw.length / 10 | 0, 20)));
    res.end('data: [DONE]\n\n');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------------------------
// 2. Cliente: lo minimo que el runtime necesita. SSE -> deltas -> llamadas reensambladas por index.
// ---------------------------------------------------------------------------------------------

async function* readSse(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        yield JSON.parse(data);
      }
    }
  }
}

// Reensambla por `index`: el id y el nombre llegan una vez, los argumentos se concatenan.
function accumulateToolCall(calls, part) {
  const current = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
  if (part.id) current.id = part.id;
  if (part.function?.name) current.name += part.function.name;
  if (part.function?.arguments) current.arguments += part.function.arguments;
  calls.set(part.index, current);
}

async function streamCompletion({ baseUrl, body, signal, onText }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw Object.assign(new Error(`HTTP ${res.status}: ${detail}`), { status: res.status, detail });
  }
  const calls = new Map();
  let text = '';
  let finish = null;
  let usage = null;
  let chunks = 0;
  for await (const c of readSse(res)) {
    chunks++;
    if (c.usage) usage = c.usage;
    const choice = c.choices?.[0];
    if (!choice) continue;
    if (choice.delta?.content) { text += choice.delta.content; onText?.(choice.delta.content); }
    for (const tc of choice.delta?.tool_calls ?? []) accumulateToolCall(calls, tc);
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  return { text, calls: [...calls.values()], finish, usage, chunks };
}

// Herramientas del spike (solo lectura, sobre el directorio temporal).
const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: 'Lee un fichero de texto',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'glob', description: 'Lista ficheros por patron',
    parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
];

function runTool(cwd, call) {
  let args;
  try { args = JSON.parse(call.arguments); } catch (e) {
    return { ok: false, content: `Error: los argumentos no son JSON valido (${e.message}). Recibido: ${call.arguments}` };
  }
  if (call.name === 'read_file') {
    if (typeof args.path !== 'string') return { ok: false, content: `Error: falta "path" (recibido ${call.arguments})` };
    return { ok: true, content: readFileSync(join(cwd, args.path), 'utf8') };
  }
  if (call.name === 'glob') {
    const suffix = String(args.pattern).split('*').at(-1);
    const files = readdirSync(cwd, { recursive: true }).map(String).filter((f) => f.endsWith(suffix));
    return { ok: true, content: files.map((f) => relative(cwd, join(cwd, f))).join('\n') };
  }
  return { ok: false, content: `Error: la herramienta "${call.name}" no existe. Disponibles: ${TOOLS.map((t) => t.function.name).join(', ')}` };
}

const TEXT_TOOL_CALL = /<tool_call>([\s\S]*?)<\/tool_call>/;
const MAX_ROUNDS = 8;

// El bucle: pide, ejecuta lo que pida el modelo, devuelve resultados, repite hasta `stop`.
async function runTurn({ baseUrl, cwd, prompt, signal, report }) {
  const messages = [{ role: 'system', content: 'Eres un agente de codigo. Usa las herramientas.' }, { role: 'user', content: prompt }];
  let tools = TOOLS;
  const totals = { prompt: 0, completion: 0, rounds: 0, usageMissing: 0 };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    totals.rounds++;
    const body = { model: MODEL, messages, stream: true, stream_options: { include_usage: true }, ...(tools ? { tools } : {}) };
    let out;
    try {
      out = await streamCompletion({ baseUrl, body, signal });
    } catch (e) {
      if (tools && e.status === 400 && /does not support tools/i.test(e.detail ?? '')) {
        report.push(`vuelta ${round + 1}: 400 "no soporta tools" -> se reintenta SIN tools (modo solo chat)`);
        tools = undefined;
        continue;
      }
      throw e;
    }
    if (out.usage) { totals.prompt += out.usage.prompt_tokens; totals.completion += out.usage.completion_tokens; } else totals.usageMissing++;
    report.push(`vuelta ${round + 1}: ${out.chunks} trozos, finish=${out.finish}, llamadas=${out.calls.map((c) => `${c.name}(${c.arguments})`).join(' | ') || '-'}${out.text ? `, texto=${JSON.stringify(out.text)}` : ''}`);
    if (out.calls.length === 0) {
      const inText = TEXT_TOOL_CALL.exec(out.text);
      if (inText) report.push(`  llamada escrita en el TEXTO detectada: ${inText[1]} (finish=${out.finish}; el bucle ingenuo terminaria aqui)`);
      return { final: out.text, totals };
    }
    messages.push({ role: 'assistant', content: out.text || null,
      tool_calls: out.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) });
    for (const call of out.calls) {
      const r = runTool(cwd, call);
      report.push(`  ejecuta ${call.name} [${call.id}] -> ${r.ok ? 'ok' : 'ERROR devuelto al modelo'}: ${JSON.stringify(r.content.slice(0, 80))}`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: r.content });
    }
  }
  throw new Error(`El turno supero ${MAX_ROUNDS} vueltas sin terminar`);
}

// ---------------------------------------------------------------------------------------------
// 3. Ejecucion de cada escenario y comprobaciones.
// ---------------------------------------------------------------------------------------------

async function runScenario(name, scenario, cwd) {
  const log = { requests: [], chunksSent: 0, closedAt: null };
  const server = await startFakeServer(scenario, log);
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const report = [];
  try {
    const models = await (await fetch(`${baseUrl}/models`)).json();
    report.push(`GET /models -> ${models.data.map((m) => m.id).join(', ')}`);
    if (name === 'abortar') return await measureAbort({ baseUrl, log, report });
    const t0 = Date.now();
    const { final, totals } = await runTurn({ baseUrl, cwd, prompt: 'Lee hola.txt', report });
    report.push(`RESULTADO en ${Date.now() - t0} ms, ${totals.rounds} peticiones, uso sumado ${totals.prompt}+${totals.completion} tokens, vueltas sin uso: ${totals.usageMissing}`);
    report.push(`final: ${JSON.stringify(final)}`);
    checkSecondRound(log, report);
    return report;
  } finally {
    server.close();
  }
}

// La segunda vuelta tiene que llevar el assistant con tool_calls y un `tool` por cada id, en orden.
function checkSecondRound(log, report) {
  const second = log.requests[1];
  if (second === undefined) return;
  const assistant = second.messages.find((m) => m.role === 'assistant' && m.tool_calls);
  if (assistant === undefined) return;
  const ids = assistant.tool_calls.map((c) => c.id);
  const answered = second.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  const ok = ids.every((id, i) => answered[i] === id);
  report.push(`2a peticion: assistant.tool_calls=[${ids}] tool_call_id=[${answered}] -> ${ok ? 'CORRECTO' : 'MAL EMPAREJADO'}`);
}

async function measureAbort({ baseUrl, log, report }) {
  const controller = new AbortController();
  let seen = 0;
  const t0 = Date.now();
  let abortedAt = 0;
  try {
    await streamCompletion({ baseUrl, signal: controller.signal,
      body: { model: MODEL, messages: [{ role: 'user', content: 'cuenta' }], stream: true },
      onText: () => { if (++seen === 2) { abortedAt = Date.now(); controller.abort(); } } });
    report.push('NO se aborto (inesperado)');
  } catch (e) {
    const rejectMs = Date.now() - abortedAt;
    await new Promise((r) => setTimeout(r, 50));
    report.push(`abort tras 2 trozos de texto (${abortedAt - t0} ms): cliente rechaza con ${e.name} en ${rejectMs} ms; el servidor ve cerrar la conexion ${log.closedAt === null ? 'NUNCA' : `a los ${log.closedAt - abortedAt} ms`}; trozos enviados antes de cortar: ${log.chunksSent}`);
  }
  return report;
}

async function main() {
  const filter = process.argv[2] ?? '';
  const cwd = mkdtempSync(join(tmpdir(), 'mage-runtime-spike-'));
  writeFileSync(join(cwd, 'hola.txt'), 'hola');
  console.log(`# Spike del runtime propio — Node ${process.version}, ${process.platform}`);
  try {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      if (!name.includes(filter)) continue;
      console.log(`\n## ${name}`);
      for (const line of await runScenario(name, scenario, cwd)) console.log(`  ${line}`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

await main();
