import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { AnthropicStreamTranslator, translateOpenAiResponse } from './streamTranslator';
import { resolveUpstream, type KeyedCustomProvider, type UpstreamTarget } from './providerEndpoints';

// Registry to keep track of active sessions
export interface SessionConfig {
  readonly provider: string;
  readonly model: string;
  readonly accountDir: string;
}

const sessions = new Map<string, SessionConfig>();
let serverPort = 0;
let server: ReturnType<typeof createServer> | null = null;

// Log inyectable hacia el LogBus. Por defecto no-op (tests, arranque temprano): el gateway no debe
// depender de que alguien lo haya cableado, pero tampoco puede tragarse los fallos en silencio.
export type GatewayLogFn = (level: 'info' | 'warn' | 'error', message: string, data?: unknown) => void;
let gatewayLog: GatewayLogFn = () => {};

export function setGatewayLogger(log: GatewayLogFn): void {
  gatewayLog = log;
}

// Registro de proveedores del usuario (E2). Se inyecta como FUNCION, no como valor: se invoca en cada
// peticion para que un proveedor recien anadido o editado en Configuracion aplique sin reiniciar (mismo
// criterio que `loadSharedConfigArgs`, que tampoco cachea el resultado de arranque). Por defecto vacio:
// el gateway no depende de que alguien lo haya cableado (tests, arranque temprano).
export type CustomProviderLoader = () => readonly KeyedCustomProvider[];
let loadCustomProviders: CustomProviderLoader = () => [];

export function setCustomProviderLoader(load: CustomProviderLoader): void {
  loadCustomProviders = load;
}

export function startGateway(): Promise<number> {
  if (server !== null) {
    return Promise.resolve(serverPort);
  }
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      handleRequest(req, res);
    });
    // Listen on 127.0.0.1 and let OS assign a random free port (port 0)
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (address && typeof address === 'object') {
        serverPort = address.port;
        resolve(serverPort);
      } else {
        reject(new Error('No se pudo determinar el puerto del gateway'));
      }
    });
    server.on('error', (err) => {
      reject(err);
    });
  });
}

export function stopGateway(): void {
  if (server !== null) {
    server.close();
    server = null;
    serverPort = 0;
  }
}

export function getGatewayPort(): number {
  return serverPort;
}

export function registerSession(sessionId: string, config: SessionConfig): void {
  sessions.set(sessionId, config);
}

export function unregisterSession(sessionId: string): void {
  sessions.delete(sessionId);
}

// ¿Es una peticion de mensajes de la Messages API? Se comprueba NORMALIZANDO la ruta, no con una
// igualdad exacta contra '/v1/messages', porque la ruta real que manda el CLI no es esa:
//   - la base URL que le pasan los adapters ya termina en '/v1' y el CLI le concatena '/v1/messages',
//     asi que llega '/v1/v1/messages';
//   - ademas trae query string ('?beta=true').
// Observado en vivo con el CLI 2.1.220 contra un stub del gateway. Con el match exacto anterior, toda
// peticion de una sesion por gateway se respondia con 404 y ninguna podia conversar.
export function isMessagesRequest(method: string | undefined, url: string | undefined): boolean {
  if (method !== 'POST') return false;
  const path = (url ?? '').split('?')[0] ?? '';
  return path === '/v1/messages' || path.endsWith('/v1/messages');
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (!isMessagesRequest(req.method, req.url)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'not_found', message: 'Ruta no encontrada' } }));
    return;
  }

  // Extraer sessionId de la cabecera x-api-key o Authorization
  const apiKeyHeader = req.headers['x-api-key'] || req.headers['authorization'];
  if (!apiKeyHeader) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'Falta cabecera de autenticacion' } }));
    return;
  }

  const headerStr = (Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader) || '';
  const match = headerStr.match(/(?:Bearer\s+)?sk-mage-([a-f0-9-]+)/i);
  if (!match || !match[1]) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'Formato de api-key no valido' } }));
    return;
  }

  const sessionId = match[1];
  const config = sessions.get(sessionId);
  if (!config) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'Sesion no registrada o expirada' } }));
    return;
  }

  let body = '';
  // `setEncoding` ANTES de acumular (B7). Sin el, `string += Buffer` hace toString(utf8) POR CHUNK,
  // y un caracter multibyte partido en el limite (~64 kB) se convierte en dos U+FFFD: cualquier turno
  // grande con acentos o emoji llegaba al proveedor con mojibake. Las otras dos rutas ya lo ponian.
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  // Un `error` sin listener en un stream de Node es una excepcion no capturada, y este proceso es el
  // main: se lleva por delante todas las pestañas (ver la nota de `startGateway`). Pasa si el CLI
  // aborta el turno mientras sube el cuerpo.
  req.on('error', (err: unknown) => {
    gatewayLog('warn', 'Peticion del CLI abortada', { detail: err instanceof Error ? err.message : String(err) });
  });

  req.on('end', () => {
    // El `try` envuelve SOLO el parseo (B13c). Con `forwardRequest` dentro, un baseUrl sin esquema
    // —que revienta en `new URL()`— se reportaba al usuario como "JSON malformado", que no tiene
    // nada que ver y no ayuda a arreglarlo.
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: `JSON malformado (${body.length} caracteres)` } }));
      return;
    }
    forwardRequest(config, payload, res);
  });
}

// Reenvia el turno al upstream que decide `resolveUpstream` (modulo puro): built-in con su key de
// entorno o proveedor del usuario con su URL/key. El registro se RE-LEE aqui, no se cachea.
function forwardRequest(config: SessionConfig, payload: any, res: ServerResponse): void {
  let target: UpstreamTarget;
  try {
    target = resolveUpstream({
      providerId: config.provider,
      model: config.model,
      customProviders: loadCustomProviders(),
      env: process.env,
    });
  } catch (err) {
    // El mensaje del resolutor es lo UNICO que vera el usuario cuando su proveedor este mal puesto, asi
    // que se propaga tal cual (nunca contiene la api key: solo id de proveedor, modelo y URL base).
    const detail = err instanceof Error ? err.message : String(err);
    gatewayLog('error', 'No se pudo resolver el proveedor de la sesion', { detail });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: detail } }));
    return;
  }

  sendOpenAiRequest(target.url, target.apiKey, convertAnthropicToOpenAi(payload, target.model), res);
}

export function convertAnthropicToOpenAi(payload: any, finalModel: string): any {
  const messages: any[] = [];

  // El CLI NUNCA manda `system` como string: son bloques `{type:'text', text, cache_control?}`. Tal
  // cual, un upstream OpenAI-compatible recibe una forma que no entiende (400 por `cache_control`, o
  // el system prompt entero perdido en Ollama/LM Studio, que es donde viven las herramientas).
  const system = Array.isArray(payload.system)
    ? payload.system.map((block: { text?: string }) => block?.text ?? '').join('\n\n')
    : payload.system;
  if (system) {
    messages.push({ role: 'system', content: system });
  }

  if (Array.isArray(payload.messages)) {
    for (const msg of payload.messages) {
      const role = msg.role;
      const content = msg.content;

      if (typeof content === 'string') {
        messages.push({ role, content });
      } else if (Array.isArray(content)) {
        const isToolResult = content.some((block) => block.type === 'tool_result');

        if (isToolResult) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              let textContent = '';
              if (typeof block.content === 'string') {
                textContent = block.content;
              } else if (Array.isArray(block.content)) {
                textContent = block.content.map((b: any) => b.text || '').join('');
              }
              messages.push({
                role: 'tool',
                tool_call_id: block.tool_use_id,
                content: textContent,
              });
            }
          }
        } else {
          const openAiMsg: any = { role };
          const toolCalls: any[] = [];
          let textContent = '';

          for (const block of content) {
            if (block.type === 'text') {
              textContent += block.text;
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input),
                },
              });
            }
          }

          openAiMsg.content = textContent || null;
          if (toolCalls.length > 0) {
            openAiMsg.tool_calls = toolCalls;
          }
          messages.push(openAiMsg);
        }
      }
    }
  }

  const tools: any[] = [];
  if (Array.isArray(payload.tools)) {
    for (const tool of payload.tools) {
      tools.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      });
    }
  }

  const streaming = payload.stream || false;
  const openAiPayload: any = {
    model: finalModel,
    messages,
    stream: streaming,
  };

  // Sin esto, un stream OpenAI-compatible NO devuelve contadores de tokens en ningun chunk, y el turno
  // se reportaria con 0 tokens (que es lo que hacia el gateway antes: escribia 0 siempre). Es un campo
  // opcional documentado; los proveedores que no lo entienden lo ignoran.
  if (streaming) {
    openAiPayload.stream_options = { include_usage: true };
  }

  if (tools.length > 0) {
    openAiPayload.tools = tools;
  }

  if (payload.max_tokens) {
    openAiPayload.max_tokens = payload.max_tokens;
  }

  return openAiPayload;
}

function sendOpenAiRequest(targetUrl: string, apiKey: string, payload: any, res: ServerResponse): void {
  const url = new URL(targetUrl);
  const isHttps = url.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Key vacia = sin cabecera de autenticacion (lo normal en un runtime local). Antes se comparaba
  // contra las cadenas magicas 'ollama'/'lmstudio', que eran keys falsas para lograr este mismo efecto.
  if (apiKey.length > 0) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const reqOptions = {
    method: 'POST',
    headers,
  };

  const targetReq = makeRequest(url, reqOptions, (targetRes) => {
    const statusCode = targetRes.statusCode || 200;
    if (statusCode >= 400) {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      targetRes.pipe(res);
      return;
    }

    // La cabecera SSE va DENTRO de la rama que streamea (B1). Antes se escribia SIEMPRE y luego se
    // ramificaba, asi que la rama JSON hacia un SEGUNDO writeHead sobre cabeceras ya enviadas ->
    // ERR_HTTP_HEADERS_SENT dentro de un handler de evento -> excepcion no capturada -> se muere el
    // proceso main y con el TODAS las pestañas. No hay `uncaughtException` en el proyecto.
    if (payload.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      handleStreamResponse(targetRes, res, payload.model);
    } else {
      handleJSONResponse(targetRes, res, payload.model);
    }
  });

  targetReq.on('error', (err) => {
    // Si el upstream se corta A MITAD de stream, las cabeceras ya salieron: un writeHead aqui lanza
    // ERR_HTTP_HEADERS_SENT y mata el proceso. Con las cabeceras puestas, lo unico honesto que queda
    // es cerrar: el cliente ya recibio un 200 y no se le puede convertir en un 500 a posteriori.
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'api_error', message: `Error conectando al proveedor: ${err.message}` } }));
  });

  targetReq.write(JSON.stringify(payload));
  targetReq.end();
}

function handleStreamResponse(targetRes: IncomingMessage, res: ServerResponse, fallbackModel: string): void {
  const translator = new AnthropicStreamTranslator(newMessageId(), fallbackModel);
  let buffer = '';

  targetRes.setEncoding('utf8');
  targetRes.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      for (const out of translator.push(line).lines) res.write(out);
    }
  });

  targetRes.on('end', () => {
    // Ultima linea sin '\n' final (algunos proveedores cierran sin el salto).
    for (const out of translator.push(buffer).lines) res.write(out);
    for (const out of translator.finish().lines) res.write(out);
    res.end();

    // Las lineas ilegibles NO se tragan en silencio: una racha significa respuesta truncada o un
    // formato que el traductor no contempla, y sin esto el sintoma era "faltan trozos de la respuesta"
    // sin ninguna pista de por que.
    if (translator.malformed > 0) {
      gatewayLog('warn', 'Lineas ilegibles en el stream del proveedor', { count: translator.malformed });
    }
    if (translator.usage === null) {
      gatewayLog('warn', 'El proveedor no devolvio contadores de tokens; el turno se reporta con 0');
    }
  });
}

function handleJSONResponse(targetRes: IncomingMessage, res: ServerResponse, fallbackModel: string): void {
  let body = '';
  targetRes.setEncoding('utf8');
  targetRes.on('data', (chunk) => {
    body += chunk;
  });
  targetRes.on('end', () => {
    let translated: unknown;
    try {
      translated = translateOpenAiResponse(JSON.parse(body), newMessageId(), fallbackModel);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      gatewayLog('error', 'No se pudo traducir la respuesta del proveedor', { detail });
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { type: 'api_error', message: `Respuesta del proveedor no utilizable: ${detail}` } }),
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(translated));
  });
}

// Id de mensaje unico por respuesta. `Date.now()` colisionaba entre dos turnos en el mismo milisegundo.
function newMessageId(): string {
  return `msg_mage_${randomUUID()}`;
}
