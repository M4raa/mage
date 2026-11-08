import { afterEach, describe, expect, it } from 'vitest';
import { startFakeAnthropic } from './fake-anthropic-messages.mjs';

// Servidor Messages falso REAL (red de verdad en 127.0.0.1), como fake-openai-server.test.mjs.
let fake = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

async function postMessage(url, text) {
  return fetch(`${url}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: false, messages: [{ role: 'user', content: text }] }),
  });
}

describe('fake-anthropic-messages', () => {
  it('startFakeAnthropic_ecoSinStream_responde200ConElTexto', async () => {
    fake = await startFakeAnthropic({ cwd: process.cwd() });

    const res = await postMessage(fake.url, 'ECO hola');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.content[0].text).toBe('ECO: ECO hola');
    expect(fake.requests).toHaveLength(1);
  });

  it('startFakeAnthropic_cacheTtl1hPorDefecto_cuentaEnLaCubeta1h', async () => {
    fake = await startFakeAnthropic({ cwd: process.cwd() });

    const body = await (await postMessage(fake.url, 'ECO hola')).json();

    expect(body.usage.cache_creation).toEqual({ ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 });
  });

  it('startFakeAnthropic_cacheTtl5m_cuentaEnLaCubeta5m', async () => {
    fake = await startFakeAnthropic({ cwd: process.cwd(), cacheTtl: '5m' });

    const body = await (await postMessage(fake.url, 'ECO hola')).json();

    expect(body.usage.cache_creation.ephemeral_5m_input_tokens).toBe(10);
    expect(body.usage.cache_creation.ephemeral_1h_input_tokens).toBe(0);
  });

  it('startFakeAnthropic_cacheTtlNull_sinCacheCreation', async () => {
    fake = await startFakeAnthropic({ cwd: process.cwd(), cacheTtl: null });

    const body = await (await postMessage(fake.url, 'ECO hola')).json();

    expect('cache_creation' in body.usage).toBe(false);
  });

  it('startFakeAnthropic_rutaDesconocida_responde404', async () => {
    fake = await startFakeAnthropic({ cwd: process.cwd() });

    const res = await fetch(`${fake.url}/v1/otra`, { method: 'POST', body: '{}' });

    expect(res.status).toBe(404);
  });
});
