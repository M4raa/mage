import { chatCompletionsUrl } from '@shared/providers';
import { ChatStreamParser, parseChatChunk, SseDecoder, type StreamPart } from './openAiStream';

// Cliente de Chat Completions (OpenAI-compatible) del runtime propio: hace el `fetch` en streaming y
// devuelve `StreamPart` ya normalizados. La red, el reloj y la clave entran inyectados.

// Mensajes de Chat Completions tal cual viajan al servidor.
export interface ChatToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string | null; readonly tool_calls?: readonly ChatToolCall[] }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };

// Una herramienta tal cual se declara en `tools`.
export interface ChatToolSpec {
  readonly type: 'function';
  readonly function: { readonly name: string; readonly description: string; readonly parameters: Readonly<Record<string, unknown>> };
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  // Ausente = la peticion va sin `tools` (modelo sin herramientas o modo solo chat).
  readonly tools?: readonly ChatToolSpec[];
}

export interface ChatClient {
  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamPart>;
}

// Clasificacion de un fallo HTTP del servidor. `no_tools` es el 400 de un modelo sin herramientas
// (texto de Ollama: «… does not support tools», medido en el spike); el bucle reintenta sin `tools`.
export type ChatErrorKind = 'no_tools' | 'auth' | 'model_not_found' | 'server' | 'idle_timeout' | 'other';

export class ChatHttpError extends Error {
  constructor(
    message: string,
    readonly kind: ChatErrorKind,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ChatHttpError';
  }
}

// Sin datos del servidor durante este tiempo, el turno se corta. 300 s como OpenClaw para modelos
// locales: un modelo grande en CPU puede tardar minutos en dar el primer token.
export const STREAM_IDLE_TIMEOUT_MS = 300_000;
const ERROR_BODY_MAX_CHARS = 300;
const NO_TOOLS_PATTERN = /does not support tools|tools? (?:is|are) not supported|tool[_ ]?(?:use|calling)? not supported/i;

export interface TimerDeps {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface HttpChatClientDeps {
  readonly baseUrl: string;
  // Se llama en CADA peticion: la clave vive en la boveda de main y puede cambiar entre turnos. null =
  // sin clave (lo normal en local): no se manda cabecera Authorization.
  readonly apiKey: () => string | null;
  readonly fetch: typeof fetch;
  readonly timers: TimerDeps;
  readonly idleTimeoutMs?: number;
}

export class HttpChatClient implements ChatClient {
  private readonly url: string;

  constructor(private readonly deps: HttpChatClientDeps) {
    this.url = chatCompletionsUrl(deps.baseUrl);
  }

  async *streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamPart> {
    const apiKey = this.deps.apiKey();
    const idle = new IdleWatchdog(this.deps.timers, this.deps.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS, signal);
    try {
      const response = await this.post(request, apiKey, idle.signal);
      if (!response.ok) throw await this.httpError(response, apiKey);
      if (response.body === null) throw new ChatHttpError(`Respuesta sin cuerpo de ${redactUrl(this.url)}`, 'other', response.status);
      yield* readStream(response.body, idle);
    } catch (err) {
      if (idle.fired) throw new ChatHttpError(`El servidor no mandó nada en ${idle.ms / 1000} s (${redactUrl(this.url)})`, 'idle_timeout', null);
      throw scrubError(err, apiKey);
    } finally {
      idle.stop();
    }
  }

  private post(request: ChatRequest, apiKey: string | null, signal: AbortSignal): Promise<Response> {
    const body = {
      model: request.model,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(request.tools === undefined || request.tools.length === 0 ? {} : { tools: request.tools }),
    };
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
    if (apiKey !== null && apiKey.length > 0) headers.authorization = `Bearer ${apiKey}`;
    return this.deps.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  }

  private async httpError(response: Response, apiKey: string | null): Promise<ChatHttpError> {
    const text = filterSecret(await response.text().catch((err: unknown) => `(cuerpo ilegible: ${String(err)})`), apiKey);
    const excerpt = text.length > ERROR_BODY_MAX_CHARS ? `${text.slice(0, ERROR_BODY_MAX_CHARS)}…` : text;
    const message = `El servidor respondió ${response.status} en ${redactUrl(this.url)}: ${excerpt}`;
    return new ChatHttpError(message, classifyStatus(response.status, text), response.status);
  }
}

export function classifyStatus(status: number, body: string): ChatErrorKind {
  if (status === 400 && NO_TOOLS_PATTERN.test(body)) return 'no_tools';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model_not_found';
  if (status >= 500) return 'server';
  return 'other';
}

async function* readStream(body: ReadableStream<Uint8Array>, idle: IdleWatchdog): AsyncIterable<StreamPart> {
  const decoder = new SseDecoder();
  const parser = new ChatStreamParser();
  const reader = body.getReader();
  try {
    for (;;) {
      idle.reset();
      const { done, value } = await reader.read();
      if (done) break;
      for (const data of decoder.push(value)) yield* parser.push(parseChatChunk(data));
    }
    for (const data of decoder.end()) yield* parser.push(parseChatChunk(data));
    yield* parser.end();
  } finally {
    // Cortar la conexion si el consumidor deja de leer (abortar, error en el bucle). Es limpieza de un
    // stream que ya termino o se abandono: si `cancel` falla no queda nada que cerrar ni a quien avisar.
    await reader.cancel().catch(() => undefined);
  }
}

// Aborta la peticion si pasan `ms` sin datos. Encadena la senal del turno: abortar el turno aborta el fetch.
class IdleWatchdog {
  private readonly controller = new AbortController();
  private handle: unknown = null;
  private readonly onParentAbort: () => void;
  fired = false;

  constructor(
    private readonly timers: TimerDeps,
    readonly ms: number,
    private readonly parent: AbortSignal,
  ) {
    this.onParentAbort = () => this.controller.abort(parent.reason);
    if (parent.aborted) this.controller.abort(parent.reason);
    else parent.addEventListener('abort', this.onParentAbort, { once: true });
    this.reset();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  reset(): void {
    this.clear();
    this.handle = this.timers.setTimeout(() => {
      this.fired = true;
      this.controller.abort(new Error('idle'));
    }, this.ms);
  }

  // B1: el oyente se quita al terminar, o la senal del turno acumula uno por peticion.
  stop(): void {
    this.clear();
    this.parent.removeEventListener('abort', this.onParentAbort);
  }

  private clear(): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }
}

// La clave nunca sale en un mensaje: se filtra por su VALOR (un 401 puede devolverla en el cuerpo).
function filterSecret(text: string, apiKey: string | null): string {
  if (apiKey === null || apiKey.length === 0) return text;
  return text.split(apiKey).join('***');
}

function scrubError(err: unknown, apiKey: string | null): unknown {
  if (!(err instanceof Error) || apiKey === null || apiKey.length === 0 || !err.message.includes(apiKey)) return err;
  const clean = new Error(filterSecret(err.message, apiKey));
  clean.name = err.name;
  return clean;
}

// URL sin usuario, contraseña ni query (una base `http://user:pass@host` o un `?api-key=…`, que piden
// algunos servidores compatibles, no deben acabar en un mensaje).
export function redactUrl(url: string): string {
  if (!URL.canParse(url)) return '(URL no válida)';
  const parsed = new URL(url);
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  return parsed.toString();
}
