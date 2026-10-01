import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { glob, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_OPENAI_REPLY, startFakeOpenAiServer } from './fake-openai-server.mjs';
import { buildRuntimeSession } from '../src/main/runtime/runtimeFactory';

// Integracion del runtime propio con el servidor falso REAL (red de verdad en 127.0.0.1): la misma
// sesion que monta main, sin GUI. Es la verificacion de punta a punta de cada fase de P-032.
let fake = null;
let workDir = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
  if (workDir !== null) rmSync(workDir, { recursive: true, force: true });
  workDir = null;
});

function tempProject(files) {
  workDir = mkdtempSync(join(tmpdir(), 'mage-rt-e2e-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(workDir, name), content);
  return workDir;
}

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
    fs: { stat, readFile, glob },
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

  it('turno_openaiTroceado_ejecutaReadYGlobRealesDelCwd', async () => {
    fake = await startFakeOpenAiServer();
    const cwd = tempProject({ 'hola.txt': 'hola' });
    const events = [];
    const session = buildRuntimeSession('custom:falso', launch('fake:openai-troceado', events, { cwd }), envFor(fake.baseUrl));

    session.start();
    session.sendUserMessage('lee hola.txt');
    await waitFor(events, (e) => e.kind === 'result');

    // Las dos lecturas van en paralelo: sus resultados llegan en cualquier orden.
    const results = new Map(events.filter((e) => e.kind === 'tool_result').map((e) => [e.result.toolUseId, e.result]));
    expect(results.get('call_a')).toMatchObject({ isError: false, output: '     1	hola' });
    expect(results.get('call_b')).toMatchObject({ isError: false, output: 'hola.txt' });
    expect(fake.stats.completions).toBe(2);
    const second = fake.stats.requests[1];
    expect(second.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['call_a', 'call_b']);
  });

  it('turno_argumentosRotos_seRecuperaEnElBucle', async () => {
    fake = await startFakeOpenAiServer();
    const cwd = tempProject({ 'hola.txt': 'hola' });
    const events = [];
    const session = buildRuntimeSession('custom:falso', launch('fake:argumentos-rotos', events, { cwd }), envFor(fake.baseUrl));

    session.start();
    session.sendUserMessage('lee');
    await waitFor(events, (e) => e.kind === 'result');

    expect(events.filter((e) => e.kind === 'tool_result').map((e) => e.result.isError)).toEqual([true, true, false]);
    expect(events.find((e) => e.kind === 'result').result).toMatchObject({ isError: false, numTurns: 4 });
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
