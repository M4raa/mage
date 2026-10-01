import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_OPENAI_REPLY, startFakeOpenAiServer } from './fake-openai-server.mjs';
import { buildRuntimeSession } from '../src/main/runtime/runtimeFactory';

// Integracion del runtime propio con el servidor falso REAL (red de verdad en 127.0.0.1): la misma
// sesion que monta main, sin GUI. Es la verificacion de punta a punta de cada fase de P-032.
let fake = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

const realTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) };

function envFor(baseUrl, overrides = {}) {
  let id = 0;
  return {
    findProvider: (providerId) => (providerId === 'custom:falso' ? { id: providerId, label: 'Falso', baseUrl, hasApiKey: false, models: [] } : null),
    apiKeyFor: () => null,
    fetch: globalThis.fetch,
    timers: realTimers,
    now: Date.now,
    newId: () => `id-${++id}`,
    platform: process.platform,
    ...overrides,
  };
}

function launch(model, events, extra = {}) {
  return {
    params: { sessionId: 'sesion-1', accountDir: '', model, cwd: process.cwd(), ...extra },
    emit: (event) => events.push(event),
  };
}

async function waitFor(events, predicate, ms = 3000) {
  const started = Date.now();
  while (!events.some(predicate)) {
    if (Date.now() - started > ms) throw new Error(`no llego el evento esperado; eventos: ${events.map((e) => e.kind).join(',')}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('runtime propio contra el servidor falso', () => {
  it('turno_eco_conversaYCuentaLaPeticion', async () => {
    fake = await startFakeOpenAiServer();
    const events = [];
    const session = buildRuntimeSession('custom:falso', launch('vg-modelo-falso', events), envFor(fake.baseUrl));

    session.start();
    session.sendUserMessage('hola');
    await waitFor(events, (e) => e.kind === 'result');

    const text = events.filter((e) => e.kind === 'stream_delta').map((e) => e.text).join('');
    expect(text).toBe(FAKE_OPENAI_REPLY);
    expect(fake.stats.completions).toBe(1);
    expect(events.find((e) => e.kind === 'result').result).toMatchObject({ isError: false, subtype: 'success', numTurns: 1 });
  });

  it('turno_proveedorNoConfigurado_lanzaConElId', () => {
    expect(() => buildRuntimeSession('custom:otro', launch('m', []), envFor('http://127.0.0.1:1/v1'))).toThrow(/custom:otro/);
  });

  it('servidor_statsPorHttp_devuelveElRecuento', async () => {
    fake = await startFakeOpenAiServer();

    const stats = await (await fetch(`http://127.0.0.1:${fake.port}/__stats`)).json();

    expect(stats).toMatchObject({ completions: 0, models: 0 });
  });
});
