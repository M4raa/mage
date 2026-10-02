import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatHttpError, classifyStatus, HttpChatClient, redactUrl, type TimerDeps } from './chatClient';
import type { StreamPart } from './openAiStream';

// Servidor real en 127.0.0.1:0, como gatewayHttp.test.ts.
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let server: Server | null = null;
const closed: string[] = [];

function serve(handler: Handler): Promise<string> {
  server = createServer(handler);
  return new Promise((resolve) => server!.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`)));
}

afterEach(async () => {
  closed.length = 0;
  await new Promise((done) => (server === null ? done(undefined) : server.close(() => done(undefined))));
  server = null;
});

const realTimers: TimerDeps = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };

function client(baseUrl: string, apiKey: string | null = null, timers: TimerDeps = realTimers, idleTimeoutMs?: number): HttpChatClient {
  return new HttpChatClient({ baseUrl, apiKey: () => apiKey, fetch: globalThis.fetch, timers, ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }) });
}

async function collect(stream: AsyncIterable<StreamPart>): Promise<StreamPart[]> {
  const parts: StreamPart[] = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

const REQUEST = { model: 'm', messages: [{ role: 'user' as const, content: 'hola' }] };

function sseResponse(res: ServerResponse, chunks: unknown[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
}

describe('HttpChatClient', () => {
  it('streamChat_streaming200_yieldsPartsAndSendsBody', async () => {
    let body: Record<string, unknown> = {};
    let auth: string | undefined;
    const baseUrl = await serve((req, res) => {
      auth = req.headers.authorization;
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        body = JSON.parse(raw);
        sseResponse(res, [{ choices: [{ delta: { content: 'ho' } }] }, { choices: [{ delta: { content: 'la' }, finish_reason: 'stop' }] }]);
      });
    });

    const parts = await collect(client(baseUrl).streamChat(REQUEST, new AbortController().signal));

    expect(parts).toEqual([{ kind: 'text', text: 'ho' }, { kind: 'text', text: 'la' }, { kind: 'finish', reason: 'stop' }]);
    expect(body).toMatchObject({ model: 'm', stream: true, stream_options: { include_usage: true } });
    expect(body).not.toHaveProperty('tools');
    expect(auth).toBeUndefined(); // sin clave, sin cabecera
  });

  it('streamChat_withKey_sendsBearerHeader', async () => {
    let auth: string | undefined;
    const baseUrl = await serve((req, res) => {
      auth = req.headers.authorization;
      sseResponse(res, []);
    });

    await collect(client(baseUrl, 'sk-secreta').streamChat(REQUEST, new AbortController().signal));

    expect(auth).toBe('Bearer sk-secreta');
  });

  it('streamChat_400NoTools_throwsClassifiedError', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'registry.ollama.ai/library/m does not support tools' } }));
    });

    const error = await collect(client(baseUrl).streamChat(REQUEST, new AbortController().signal)).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ChatHttpError);
    expect((error as ChatHttpError).kind).toBe('no_tools');
    expect((error as ChatHttpError).message).toContain('400');
  });

  it('streamChat_401WithKeyInBody_keyNeverInMessage', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-supersecreta-123' } }));
    });

    const error = (await collect(client(baseUrl, 'sk-supersecreta-123').streamChat(REQUEST, new AbortController().signal)).catch((err: unknown) => err)) as ChatHttpError;

    expect(error.kind).toBe('auth');
    expect(error.message).not.toContain('sk-supersecreta-123');
    expect(error.message).toContain('***');
  });

  it('streamChat_abortMidStream_rejectsAndServerSeesClose', async () => {
    let serverClosed: () => void = () => undefined;
    const closedPromise = new Promise<void>((resolve) => (serverClosed = resolve));
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'uno' } }] })}\n\n`);
      res.on('close', () => serverClosed());
      // nunca termina: solo el abort lo corta
    });
    const controller = new AbortController();
    const parts: StreamPart[] = [];

    const done = (async () => {
      for await (const part of client(baseUrl).streamChat(REQUEST, controller.signal)) {
        parts.push(part);
        controller.abort();
      }
    })();

    await expect(done).rejects.toThrow();
    await closedPromise;
    expect(parts).toEqual([{ kind: 'text', text: 'uno' }]);
  });

  it('streamChat_idleTimeout_throwsIdleTimeoutWithFakeClock', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': esperando\n\n');
    });
    // Reloj falso: el temporizador de inactividad se dispara a mano.
    const pending: Array<() => void> = [];
    const timers: TimerDeps = { setTimeout: (fn) => pending.push(fn), clearTimeout: () => undefined };
    const stream = client(baseUrl, null, timers, 1234).streamChat(REQUEST, new AbortController().signal);

    const done = collect(stream).catch((err: unknown) => err);
    await new Promise((resolve) => setTimeout(resolve, 50));
    pending.at(-1)?.();
    const error = (await done) as ChatHttpError;

    expect(error.kind).toBe('idle_timeout');
    expect(error.message).toContain('1.234 s');
  });
});

describe('classifyStatus', () => {
  it('classify_statuses_mapToKinds', () => {
    expect([classifyStatus(400, 'x does not support tools'), classifyStatus(400, 'bad'), classifyStatus(403, ''), classifyStatus(404, ''), classifyStatus(503, '')]).toEqual([
      'no_tools',
      'other',
      'auth',
      'model_not_found',
      'server',
    ]);
  });
});

describe('redactUrl', () => {
  it('redact_urlWithCredentials_dropsThem', () => {
    expect(redactUrl('http://user:pass@host:1/v1/chat/completions')).toBe('http://host:1/v1/chat/completions');
  });

  it('redact_queryWithKey_dropsIt', () => {
    expect(redactUrl('https://h/v1/chat/completions?api-key=secreta')).toBe('https://h/v1/chat/completions');
  });

  it('redact_invalidUrl_saysSo', () => {
    expect(redactUrl('no es url')).toBe('(URL no válida)');
  });
});

describe('IdleWatchdog (B1)', () => {
  it('streamChat_manyRequestsSameSignal_noListenerLeft', async () => {
    const baseUrl = await serve((_req, res) => sseResponse(res, [{ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]));
    const turn = new AbortController();
    const chat = client(baseUrl);

    for (let i = 0; i < 3; i++) await collect(chat.streamChat(REQUEST, turn.signal));

    expect(getEventListeners(turn.signal, 'abort')).toHaveLength(0);
  });
});
