import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { glob, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { FAKE_OPENAI_REPLY, startFakeOpenAiServer } from './fake-openai-server.mjs';
import { buildRuntimeSession } from '../src/main/runtime/runtimeFactory';
import { ModelCatalog } from '../src/main/runtime/modelCatalog';
import { createMcpConnector } from '../src/main/runtime/mcp/mcpSdk';
import { nodeRealpath } from '../src/main/runtime/tools/pathGuard';

// Integracion del runtime propio con el servidor falso REAL (red de verdad en 127.0.0.1): la misma
// sesion que monta main, sin GUI. Es la verificacion de punta a punta de cada fase de P-032.
let fake = null;
let workDir = null;
const transcriptRoot = mkdtempSync(join(tmpdir(), 'mage-rt-transcripts-'));
afterAll(() => rmSync(transcriptRoot, { recursive: true, force: true }));
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
    realpath: nodeRealpath,
    fs: { stat, readFile, glob },
    editFs: { readFile, writeFile, mkdir, stat },
    shell: () => ({ name: 'node', command: process.execPath, argsFor: (script) => ['-e', script] }),
    spawn: (command, args, options) => spawn(command, [...args], options),
    commandEnv: () => ({ ...process.env }),
    killTree: (child) => {
      child.kill();
      return 'signal';
    },
    transcriptRoot,
    appendLine: (path, line) => appendFileSync(path, line, 'utf8'),
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    readText: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    catalog: new ModelCatalog({ fetch: globalThis.fetch, now: Date.now }),
    mcpConnector: (cwd) => createMcpConnector({ vault: { get: () => null, set: () => undefined }, openUrl: async () => undefined, baseEnv: () => ({ PATH: process.env.PATH }), cwd }),
    toolAccess: () => [],
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
    expect(results.get('call_a')).toMatchObject({ isError: false, output: '     1\thola' });
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

  it('turno_writeEnManual_pidePermisoYNoEscribeHastaQueSeConceda', async () => {
    fake = await startFakeOpenAiServer();
    const cwd = tempProject({});
    const events = [];
    const session = buildRuntimeSession('custom:falso', launch('fake:write', events, { cwd }), envFor(fake.baseUrl));

    session.start();
    session.sendUserMessage('escribe');
    await waitFor(events, (e) => e.kind === 'permission_request');
    const request = events.find((e) => e.kind === 'permission_request').request;
    expect(request).toMatchObject({ toolName: 'Write', input: { file_path: 'vg-runtime.txt' } });
    expect(() => readFileSync(join(cwd, 'vg-runtime.txt'))).toThrow();

    session.answerPermission(request.requestId, { behavior: 'allow' });
    await waitFor(events, (e) => e.kind === 'result');

    expect(readFileSync(join(cwd, 'vg-runtime.txt'), 'utf8')).toBe('hola desde el runtime\n');
  });

  it('turno_editAprobado_traeSuDiff', async () => {
    fake = await startFakeOpenAiServer();
    const cwd = tempProject({ 'hola.txt': 'hola\n' });
    const events = [];
    const session = buildRuntimeSession('custom:falso', launch('fake:edit', events, { cwd, permissionMode: 'acceptEdits' }), envFor(fake.baseUrl));

    session.start();
    session.sendUserMessage('edita');
    await waitFor(events, (e) => e.kind === 'result');

    const result = events.find((e) => e.kind === 'tool_result').result;
    expect(result.file.structuredPatch).toEqual([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-hola', '+adiós'] }]);
    expect(readFileSync(join(cwd, 'hola.txt'), 'utf8')).toBe('adiós\n');
  });

  it('reanudar_trasCerrar_elSiguienteMensajeMantieneElContexto', async () => {
    fake = await startFakeOpenAiServer();
    const cwd = tempProject({});
    const first = [];
    const params = { cwd, sessionId: 'reanudar-1' };
    const one = buildRuntimeSession('custom:falso', launch('fake:cuenta-mensajes', first, params), envFor(fake.baseUrl));
    one.start();
    one.sendUserMessage('uno');
    await waitFor(first, (e) => e.kind === 'result');
    one.stop();

    const second = [];
    const two = buildRuntimeSession('custom:falso', launch('fake:cuenta-mensajes', second, { ...params, resume: true }), envFor(fake.baseUrl));
    two.start();
    two.sendUserMessage('dos');
    await waitFor(second, (e) => e.kind === 'result');

    const reply = second.filter((e) => e.kind === 'stream_delta').map((e) => e.text).join('');
    expect(reply).toBe('mensajes: 3');
  });

  it('transcripcion_turnoConHerramientas_cadaAssistantPrecedeASusResultados', async () => {
    fake = await startFakeOpenAiServer();
    const cwd = tempProject({ 'hola.txt': 'hola' });
    const events = [];
    const params = { cwd, sessionId: 'orden-1' };
    const session = buildRuntimeSession('custom:falso', launch('fake:openai-troceado', events, params), envFor(fake.baseUrl));
    session.start();
    session.sendUserMessage('lee hola.txt');
    await waitFor(events, (e) => e.kind === 'result');
    session.stop();

    const file = join(transcriptRoot, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), 'orden-1.jsonl');
    const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const order = lines.map((line) => (line.type === 'user' && Array.isArray(line.message.content) ? 'tool_result' : line.type));
    expect(order).toEqual(['user', 'assistant', 'tool_result', 'tool_result', 'assistant']);
    expect(lines[1].message.content.map((block) => block.type)).toEqual(['tool_use', 'tool_use']);

    const resumed = [];
    const again = buildRuntimeSession('custom:falso', launch('fake:cuenta-mensajes', resumed, { ...params, resume: true }), envFor(fake.baseUrl));
    again.start();
    again.sendUserMessage('y ahora?');
    await waitFor(resumed, (e) => e.kind === 'result');
    const sent = fake.stats.requests.at(-1).messages.map((m) => m.role);
    expect(sent).toEqual(['system', 'user', 'assistant', 'tool', 'tool', 'assistant', 'user']);
  });

  it('contexto_ventanaDe2048_daElErrorExplicadoEnVezDeUn400', async () => {
    fake = await startFakeOpenAiServer();
    const events = [];
    const session = buildRuntimeSession('custom:falso', launch('fake:contexto-2048', events, { cwd: tempProject({}) }), envFor(fake.baseUrl));
    session.start();

    for (let turn = 0; turn < 12 && !events.some((e) => e.kind === 'error'); turn++) {
      const before = events.filter((e) => e.kind === 'result').length;
      session.sendUserMessage(`mensaje ${turn}`);
      await waitFor(events, () => events.filter((e) => e.kind === 'result').length > before);
    }

    const error = events.find((e) => e.kind === 'error');
    expect(error?.message).toMatch(/no cabe en la ventana de 2048 tokens de fake:contexto-2048/);
    expect(events.some((e) => e.kind === 'notice' && /se acerca al límite/.test(e.text))).toBe(true);
    const usage = events.filter((e) => e.kind === 'context_usage').at(-1)?.usage;
    expect(usage?.maxTokens).toBe(2048);
  });

  it('contexto_seLlena_seResumeConElModeloYSeSigueYSeReanudaConElResumen', async () => {
    fake = await startFakeOpenAiServer();
    const events = [];
    const params = { cwd: tempProject({}), sessionId: 'resumen-1' };
    const session = buildRuntimeSession('custom:falso', launch('fake:resumen', events, params), envFor(fake.baseUrl));
    session.start();

    for (let turn = 0; turn < 10 && !events.some((e) => e.kind === 'compacted'); turn++) {
      const before = events.filter((e) => e.kind === 'result').length;
      session.sendUserMessage(`mensaje ${turn}`);
      await waitFor(events, () => events.filter((e) => e.kind === 'result').length > before);
    }
    session.stop();

    expect(events).toContainEqual({ kind: 'compacted', trigger: 'auto' });
    expect(events.some((e) => e.kind === 'error')).toBe(false);
    const after = fake.stats.requests.at(-1).messages;
    expect(after[1].content).toMatch(/^\[Resumen de la conversación anterior/);

    const resumed = [];
    const again = buildRuntimeSession('custom:falso', launch('fake:cuenta-mensajes', resumed, { ...params, resume: true }), envFor(fake.baseUrl));
    again.start();
    again.sendUserMessage('sigo');
    await waitFor(resumed, (e) => e.kind === 'result');
    expect(fake.stats.requests.at(-1).messages[1].content).toMatch(/RESUMEN: el usuario/);
  });

  it('textual_modeloSinHerramientasEscribeLaLlamada_MageLaEjecutaYLeDevuelveElResultado', async () => {
    fake = await startFakeOpenAiServer();
    const events = [];
    const cwd = tempProject({ 'hola.txt': 'hola' });
    const env = envFor(fake.baseUrl, {
      findProvider: (id) => ({ id, label: 'Falso', baseUrl: fake.baseUrl, hasApiKey: false, models: [], supportsTools: false }),
    });
    const session = buildRuntimeSession('custom:falso', launch('fake:tool-en-texto', events, { cwd }), env);
    session.start();
    session.sendUserMessage('lee hola.txt');
    await waitFor(events, (e) => e.kind === 'result');

    const [first, second] = fake.stats.requests;
    expect(first.tools).toBeUndefined();
    expect(first.messages[0].content).toContain('<tool_call>');
    expect(events.find((e) => e.kind === 'tool_result').result).toMatchObject({ isError: false });
    expect(second.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('<tool_result name="Read">') });
    expect(second.messages.some((m) => m.role === 'tool')).toBe(false);
  });

  it('herramientas_catalogoDiceQueNo_noSeMandanYSeAvisa', async () => {
    fake = await startFakeOpenAiServer();
    const events = [];
    const session = buildRuntimeSession('custom:falso', launch('fake:sin-tools', events, { cwd: tempProject({}) }), envFor(fake.baseUrl));
    session.start();
    session.sendUserMessage('hola');
    await waitFor(events, (e) => e.kind === 'result');

    expect(fake.stats.requests.every((request) => request.tools === undefined)).toBe(true);
    expect(events.some((e) => e.kind === 'notice' && /no admite herramientas/.test(e.text))).toBe(true);
  });

  it('mcp_servidorComun_apareceEnSessionInitYSeLlama', async () => {
    fake = await startFakeOpenAiServer();
    const events = [];
    const server = {
      name: 'falso',
      source: 'common',
      onlyIn: null,
      extra: {},
      secrets: {},
      transport: 'stdio',
      command: process.execPath,
      args: [join(process.cwd(), 'src', 'main', 'runtime', 'mcp', '__fixtures__', 'fake-mcp-server.mjs')],
      env: {},
      // Fuera del temporal del test: el proceso del servidor se cierra en segundo plano al parar.
      cwd: process.cwd(),
    };
    const shared = { mcpServers: [server], settingsFragment: null, claudeAiConnectors: false };
    const session = buildRuntimeSession('custom:falso', launch('fake:mcp', events, { cwd: tempProject({}), shared, permissionMode: 'bypassPermissions' }), envFor(fake.baseUrl));
    session.start();
    session.sendUserMessage('usa el mcp');
    await waitFor(events, (e) => e.kind === 'result', 15_000);
    session.stop();

    const inits = events.filter((e) => e.kind === 'session_init');
    expect(inits.at(-1).mcpServers).toEqual([{ name: 'falso', status: 'connected' }]);
    expect(inits.at(-1).tools).toContain('mcp__falso__eco');
    const result = events.find((e) => e.kind === 'tool_result').result;
    expect(result).toMatchObject({ isError: false, output: expect.stringContaining('eco: desde el runtime') });
  });

  it('acceso_reglaQueRestringe_laHerramientaNoSeAnuncia', async () => {
    fake = await startFakeOpenAiServer();
    const events = [];
    const env = envFor(fake.baseUrl, { toolAccess: () => [{ model: '*', allow: null, deny: ['Bash', 'Write'] }] });
    const session = buildRuntimeSession('custom:falso', launch('fake:eco', events, { cwd: tempProject({}) }), env);
    session.start();
    session.sendUserMessage('hola');
    await waitFor(events, (e) => e.kind === 'result');

    const names = fake.stats.requests[0].tools.map((tool) => tool.function.name);
    expect(names).not.toContain('Bash');
    expect(names).not.toContain('Write');
    expect(names).toContain('Read');
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
