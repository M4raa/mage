import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  registerSession,
  setCustomProviderLoader,
  setGatewayLogger,
  startGateway,
  stopGateway,
  unregisterSession,
} from './gateway';

// Fase 7.4: tests de la RUTA HTTP del gateway. Hasta aqui solo estaban cubiertas sus dos funciones
// puras, y esta es la ruta donde viven B1, B7 y 6.3 — o sea, donde tres arreglos ya pagados podian
// volver sin que nadie se enterara.
//
// Se levanta el servidor DE VERDAD (puerto efimero en 127.0.0.1) en vez de exportar `handleRequest`
// para llamarlo a mano: lo que se quiere probar es el camino completo, incluido el troceado del body
// por el propio Node, que es justo donde estaba B7. Ninguno de estos casos llega a reenviar nada a un
// upstream — todos cortan antes, a proposito: un test no puede depender de una red ajena.

const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
let base = '';

beforeAll(async () => {
  setGatewayLogger(() => undefined); // el log del gateway no ensucia la salida de los tests
  setCustomProviderLoader(() => []);
  const port = await startGateway();
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  stopGateway();
});

afterEach(() => {
  unregisterSession(SESSION);
});

// POST a /v1/messages con las cabeceras que manda el CLI.
async function post(body: string, init: { apiKey?: string | null; path?: string; method?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = init.apiKey === undefined ? `sk-mage-${SESSION}` : init.apiKey;
  if (key !== null) headers['x-api-key'] = key;
  return fetch(`${base}${init.path ?? '/v1/v1/messages?beta=true'}`, {
    method: init.method ?? 'POST',
    headers,
    body,
  });
}

async function errorOf(response: Response): Promise<{ type: string; message: string }> {
  const json = (await response.json()) as { error: { type: string; message: string } };
  return json.error;
}

describe('gateway HTTP: rutas y autenticacion', () => {
  it('handleRequest_rutaDesconocida_devuelve404', async () => {
    const response = await post('{}', { path: '/v1/completions' });

    expect(response.status).toBe(404);
    expect((await errorOf(response)).type).toBe('not_found');
  });

  it('handleRequest_metodoGet_devuelve404', async () => {
    const response = await fetch(`${base}/v1/messages`, { method: 'GET' });

    expect(response.status).toBe(404);
  });

  it('handleRequest_rutaRealDelCliConV1Duplicado_noEs404', async () => {
    // 6.3: la ruta que llega de verdad es '/v1/v1/messages?beta=true' (la base URL ya trae /v1). Con
    // el match exacto de antes, TODA sesion por gateway se respondia 404 y ninguna podia conversar.
    const response = await post('{}', { apiKey: null });

    expect(response.status).not.toBe(404);
  });

  it('handleRequest_sinCabeceraDeAuth_devuelve401', async () => {
    const response = await post('{}', { apiKey: null });

    expect(response.status).toBe(401);
    expect((await errorOf(response)).type).toBe('authentication_error');
  });

  it('handleRequest_apiKeyConOtroFormato_devuelve401', async () => {
    const response = await post('{}', { apiKey: 'sk-ant-una-key-de-verdad' });

    expect(response.status).toBe(401);
  });

  it('handleRequest_sesionNoRegistrada_devuelve401', async () => {
    // El ticket tiene forma valida pero nadie registro esa sesion (p.ej. ya termino).
    const response = await post('{}');

    expect(response.status).toBe(401);
    expect((await errorOf(response)).message).toMatch(/no registrada|expirada/i);
  });

  it('handleRequest_ticketComoBearer_tambienVale', async () => {
    registerSession(SESSION, { provider: 'proveedor-inexistente', model: 'm', accountDir: '/tmp' });

    const response = await post('{}', { apiKey: `Bearer sk-mage-${SESSION}` });

    expect(response.status).not.toBe(401); // reconocio la sesion; falla despues, al resolver
  });
});

describe('gateway HTTP: cuerpo de la peticion', () => {
  beforeEach(() => {
    registerSession(SESSION, { provider: 'proveedor-inexistente', model: 'm', accountDir: '/tmp' });
  });

  it('handleRequest_jsonMalformado_devuelve400YNoLoConfundeConOtroFallo', async () => {
    const response = await post('{ esto no es json');

    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.type).toBe('invalid_request_error');
    expect(error.message).toMatch(/JSON malformado/);
  });

  it('handleRequest_cuerpoGrandeConMultibyte_loDecodificaEntero', async () => {
    // B7: sin `setEncoding('utf8')` ANTES de acumular, `string += Buffer` hace toString POR CHUNK y un
    // caracter multibyte partido en el limite (~64 kB) se convierte en dos U+FFFD. El oraculo es el
    // recuento de caracteres que el propio gateway reporta al fallar el parseo: si el troceado hubiera
    // roto algun caracter, el recuento NO cuadraria con el del cuerpo enviado.
    //
    // La unidad es `String.length` (unidades UTF-16), que es lo que cuenta el gateway: el emoji vale 2.
    // No se compara contra puntos de codigo a proposito — lo que se prueba es que la cadena que recibio
    // el gateway sea IDENTICA a la enviada, no cuantos caracteres "de verdad" tiene.
    const relleno = 'áéíóú🙂'.repeat(30_000); // ~210k unidades, muy por encima del limite de chunk
    const cuerpo = `{ roto ${relleno}`;

    const response = await post(cuerpo);

    expect(response.status).toBe(400);
    const reportados = Number(/\((\d+) caracteres\)/.exec((await errorOf(response)).message)?.[1]);
    expect(reportados).toBe(cuerpo.length);
  });

  it('handleRequest_jsonValidoYProveedorQueNoResuelve_devuelve400ConElMotivo', async () => {
    // B13c: el `try` envuelve SOLO el parseo. Antes, un fallo al resolver el upstream se reportaba como
    // "JSON malformado", que no tiene nada que ver y no ayuda a arreglarlo.
    const response = await post(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hola' }] }));

    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.message).not.toMatch(/JSON malformado/);
    expect(error.message).toMatch(/proveedor-inexistente/);
  });

  it('handleRequest_elMotivoDelFallo_noFiltraNingunaApiKey', async () => {
    // El mensaje del resolutor es lo UNICO que ve el usuario cuando su proveedor esta mal puesto, y
    // viaja hasta el CLI: no puede llevar credenciales dentro.
    const response = await post(JSON.stringify({ model: 'm', messages: [] }));

    expect((await errorOf(response)).message).not.toMatch(/sk-|api[_-]?key\s*[:=]/i);
  });
});
