// F11b.2 (carril S, S05): mide las herramientas `mage_browser_*` con Electron REAL y SIN modelo: el servidor MCP de Mage
// (SDK en memoria) delante de `BrowserRegistry` + `IsolatedBrowser` + `ViewPlacement` + `PenSessions` reales. Sin red pública:
// un servidor local en 127.0.0.1 que sirve `spike/__fixtures__/browser-test-page.html` y perfiles desechables.
//
//   node spike/browser-tools-spike.cjs [--scale=1|1.25|1.5]     (desde la raíz del worktree; abre una ventana de 900x600)
//
// Qué mide (cada comprobación sale como { ok, detalle } en la salida): t1_navegar, t2_aislamiento, t3_leer_dom, t4_clic,
// t5_escribir, t6_captura_anotada, t7_captura_oculta (mide D-S3: si sale vacía, ok:false y esa es la limitación),
// t8_mapa_de_bits (toBitmap = ancho*alto*4), t9_pluma (trazo verde en el PNG compuesto), t10_detener (Detener suelta el CDP y
// el agente recibe browser_user_in_control), t11_otra_sesion (browser_not_open desde la sesión B), t12_file (esquema file:
// denegado), t13_atras y t14_cerrar (partición vacía y la de por defecto intacta).
// Salida: .verify-out/browser-tools-spike/out-<scale>.json; código 0 solo si TODAS pasan, 1 si no. Tope total: 120 s.
// Consume: nada (ni modelos, ni CLI, ni cuentas). Con MAGE_BROWSER_SPIKE_HIDE=1 la ventana se crea con show:false (por defecto
// show:true: la captura de una vista de una ventana no mostrada no está medida).
// Dos modos en el mismo fichero, según `process.versions.electron`: bajo Node empaqueta con esbuild y lanza Electron con este
// fichero; bajo Electron ejecuta las comprobaciones.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VALID_SCALES = ['1', '1.25', '1.5'];
const SPIKE_TIMEOUT_MS = 120_000;
const WAIT_EVENT_MS = 5_000;
const POLL_MS = 50;
const SETTLE_MS = 500;
const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 600;
const MAX_IMAGE_SIDE_PX = 1568;
const PEN_BOX = [[10, 10], [200, 100]];
const PEN_GREEN_MIN = 190;
const PEN_OTHER_MAX = 10;
const PEN_MARGIN_DIP = 4;
const BYTES_PER_PIXEL = 4;
const TYPED_TEXT = 'hola mage';
const SESSION_A = 'S-A';
const SESSION_B = 'S-B';
const FIXTURE = path.join('spike', '__fixtures__', 'browser-test-page.html');
const SECOND_PAGE = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Segunda</title></head><body><p>Segunda</p></body></html>';

// ---------------------------------------------------------------- MODO NODE
function readScale() {
  const arg = process.argv.find((a) => a.startsWith('--scale='));
  const scale = arg === undefined ? '1' : arg.slice('--scale='.length);
  if (!VALID_SCALES.includes(scale)) {
    console.error(`Escala no válida: ${scale} (válidas: ${VALID_SCALES.join(', ')})`);
    process.exit(2);
  }
  return scale;
}

function loadEsbuild(repo) {
  const pnpmDir = path.join(repo, 'node_modules/.pnpm');
  const dir = fs.readdirSync(pnpmDir).find((d) => d.startsWith('esbuild@'));
  if (dir === undefined) {
    console.error(`No hay esbuild en ${pnpmDir}`);
    process.exit(2);
  }
  return require(path.join(pnpmDir, dir, 'node_modules/esbuild'));
}

// Un solo paquete con lo de main que se mide, más el SDK MCP (servidor, cliente y transporte en memoria) para hablarle como un agente.
const ENTRY = [
  "export { IsolatedBrowser } from './browser/isolatedBrowser';",
  "export { electronBrowserDeps, electronImageDeps } from './browser/electronBrowserDeps';",
  "export { BrowserRegistry } from './browser/browserRegistry';",
  "export { createBrowserAgent } from './browser/browserAgent';",
  "export { PenSessions } from './browser/penSession';",
  "export { ViewPlacement } from './browser/viewPlacement';",
  "export { startMageMcpServer } from './mcpServer/server';",
  "export { MemoryIdempotencyStore } from './mcpServer/idempotencyStore';",
  "export { MemorySessionsPort } from './mcpServer/memorySessionsPort';",
  "export { Client } from '@modelcontextprotocol/sdk/client/index.js';",
  "export { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';",
].join('\n');

function buildBundle(repo, tmp) {
  const esbuild = loadEsbuild(repo);
  const bundle = path.join(tmp, 'browser-tools-bundle.cjs');
  esbuild.buildSync({
    stdin: {
      contents: ENTRY,
      resolveDir: path.join(repo, 'src/main'),
      loader: 'ts',
      sourcefile: 'browser-tools-spike-entry.ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    external: ['electron'],
    alias: { '@shared': path.join(repo, 'src/shared') },
    logLevel: 'error',
  });
  return bundle;
}

function runNodeMode() {
  const repo = path.resolve(__dirname, '..');
  const scale = readScale();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-browser-tools-spike-'));
  try {
    const bundle = buildBundle(repo, tmp);
    const electron = require(path.join(repo, 'node_modules/electron'));
    // Sin ELECTRON_RUN_AS_NODE: con esa variable Electron arranca como Node y no hay `app`.
    const { ELECTRON_RUN_AS_NODE: _asNode, ...inherited } = process.env;
    const out = path.join(repo, '.verify-out', 'browser-tools-spike', `out-${scale}.json`);
    const result = require('node:child_process').spawnSync(electron, [__filename], {
      env: {
        ...inherited,
        MAGE_BROWSER_TOOLS_BUNDLE: bundle,
        MAGE_BROWSER_TOOLS_TMP: tmp,
        MAGE_BROWSER_TOOLS_SCALE: scale,
        MAGE_BROWSER_TOOLS_OUT: out,
        MAGE_BROWSER_TOOLS_FIXTURE: path.join(repo, FIXTURE),
      },
      encoding: 'utf8',
      timeout: SPIKE_TIMEOUT_MS,
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------- MODO ELECTRON
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = WAIT_EVENT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await wait(POLL_MS);
  }
  return predicate();
}

// Cada comprobación va en su propio try: si lanza, se registra como fallo y se sigue con la siguiente.
function createRecorder() {
  const results = {};
  const attempt = async (name, fn) => {
    try {
      const { ok, detalle } = await fn();
      results[name] = { ok: ok === true, detalle };
    } catch (error) {
      results[name] = { ok: false, detalle: `EXCEPCIÓN: ${error.stack ?? error.message}` };
    }
  };
  return { results, attempt };
}

function createFixtureServer(http, events) {
  const page = fs.readFileSync(process.env.MAGE_BROWSER_TOOLS_FIXTURE, 'utf8');
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/evento') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          events.push(JSON.parse(body));
        } catch (error) {
          events.push({ kind: 'invalid', body, error: error.message });
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }
    const known = { '/': page, '/segunda': SECOND_PAGE }[req.url];
    if (known === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(known);
  });
}

// Resultado de callTool en una forma comparable: error o no, textos y estructura.
async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name: `mage_browser_${name}`, arguments: args });
  const texts = result.content.filter((c) => c.type === 'text').map((c) => c.text);
  return { isError: result.isError === true, content: result.content, texts, data: result.structuredContent };
}

function findElement(elements, role, name) {
  return elements.find((e) => e.role === role && e.name === name);
}

function lastOf(events, kind) {
  return events.filter((e) => e.kind === kind).at(-1);
}

function pngInfo(electron, base64) {
  const image = electron.nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
  return { empty: image.isEmpty(), size: image.getSize(), image };
}

// Hay un píxel verde de la pluma (G alto, R y B casi cero) en la franja del trazo; el orden BGRA/RGBA da igual (R = B).
function hasPenGreen(image, pxPerDip) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const [[x0, y0], [x1, y1]] = PEN_BOX.map((p) => p.map((v) => Math.round(v * pxPerDip)));
  const margin = Math.ceil(PEN_MARGIN_DIP * pxPerDip);
  for (let y = Math.max(0, y0 - margin); y <= Math.min(height - 1, y1 + margin); y += 1) {
    for (let x = Math.max(0, x0 - margin); x <= Math.min(width - 1, x1 + margin); x += 1) {
      const at = (y * width + x) * BYTES_PER_PIXEL;
      if (bitmap[at + 1] >= PEN_GREEN_MIN && bitmap[at] <= PEN_OTHER_MAX && bitmap[at + 2] <= PEN_OTHER_MAX) return true;
    }
  }
  return false;
}

async function checkBasics(ctx) {
  const { rec, a, events, base, handle } = ctx;
  await rec.attempt('t1_navegar', async () => {
    const r = await callTool(a, 'navigate', { url: base });
    return { ok: !r.isError && r.data?.title === 'Prueba Mage', detalle: { isError: r.isError, data: r.data, texts: r.texts } };
  });
  await rec.attempt('t2_aislamiento', async () => {
    await waitFor(() => lastOf(events, 'globals') !== undefined);
    const g = lastOf(events, 'globals');
    const ok = g !== undefined && ['mage', 'require', 'process', 'electron'].every((k) => g[k] === 'undefined');
    return { ok, detalle: g ?? 'no llegó el evento globals' };
  });
  await rec.attempt('t3_leer_dom', async () => {
    const r = await callTool(a, 'read_dom');
    const elements = r.data?.elements ?? [];
    const found = { button: findElement(elements, 'button', 'Pulsar'), nombre: elements.find((e) => e.name === 'Nombre'), link: findElement(elements, 'link', 'Segunda') };
    ctx.elements = found;
    return { ok: !r.isError && Object.values(found).every((e) => e !== undefined), detalle: { isError: r.isError, elements } };
  });
  await rec.attempt('t4_clic', async () => {
    const r = await callTool(a, 'click', { elementId: ctx.elements.button.id });
    const arrived = await waitFor(() => lastOf(events, 'click') !== undefined);
    const titled = await waitFor(() => handle().view.webContents.getTitle() === 'Pulsado');
    return { ok: !r.isError && arrived && titled, detalle: { isError: r.isError, texts: r.texts, llegoClic: arrived, titulo: handle().view.webContents.getTitle() } };
  });
  await rec.attempt('t5_escribir', async () => {
    const r = await callTool(a, 'type', { elementId: ctx.elements.nombre.id, text: TYPED_TEXT });
    const typed = await waitFor(() => lastOf(events, 'input')?.value === TYPED_TEXT);
    return { ok: !r.isError && typed, detalle: { isError: r.isError, texts: r.texts, ultimoInput: lastOf(events, 'input') ?? null } };
  });
}

async function checkCaptures(ctx) {
  const { rec, a, electron, placement } = ctx;
  const visible = () => placement.show(ctx.handle(), ctx.host, { x: 0, y: 0, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  await rec.attempt('t6_captura_anotada', async () => {
    visible();
    const r = await callTool(a, 'screenshot', { annotate: true });
    const image = r.content[0];
    const info = image?.type === 'image' && image.mimeType === 'image/png' ? pngInfo(electron, image.data) : null;
    const side = info === null ? null : Math.max(info.size.width, info.size.height);
    const text = r.content[1]?.text ?? '';
    const ok = !r.isError && info !== null && !info.empty && side <= MAX_IMAGE_SIDE_PX && text.includes('Elementos:') && /button "Pulsar"/.test(text);
    return { ok, detalle: { isError: r.isError, tamano: info?.size ?? null, ladoMayor: side, texto: text } };
  });
  await rec.attempt('t7_captura_oculta', async () => {
    placement.hide(ctx.handle());
    const r = await callTool(a, 'screenshot', { annotate: false });
    const image = r.content[0];
    const info = !r.isError && image?.type === 'image' ? pngInfo(electron, image.data) : null;
    return { ok: info !== null && !info.empty, detalle: { isError: r.isError, texts: r.texts, tamano: info?.size ?? null, vacia: info?.empty ?? null } };
  });
  visible();
  await rec.attempt('t8_mapa_de_bits', async () => {
    const raw = await ctx.handle().captureRaw();
    const { width, height } = raw.image.getSize();
    const length = raw.image.toBitmap().length;
    return { ok: length === width * height * BYTES_PER_PIXEL, detalle: { width, height, length, esperado: width * height * BYTES_PER_PIXEL } };
  });
  await rec.attempt('t9_pluma', async () => {
    const capture = await ctx.pens.capture(SESSION_A);
    const strokes = [{ id: 1, kind: 'box', pointsDip: PEN_BOX }];
    const result = ctx.pens.compose(SESSION_A, capture.captureId, strokes);
    const info = pngInfo(electron, result.attachment.data);
    const pxPerDip = info.size.width / capture.widthDip;
    const green = !info.empty && hasPenGreen(info.image, pxPerDip);
    const hasButton = /button "Pulsar"/.test(result.elementsText);
    return { ok: !info.empty && green && hasButton, detalle: { tamano: info.size, pxPorDip: pxPerDip, verde: green, elementsText: result.elementsText, strokesText: result.strokesText } };
  });
}

async function checkControl(ctx) {
  const { rec, a, b, registry, handle } = ctx;
  await rec.attempt('t10_detener', async () => {
    const adjuntoAntes = handle().view.webContents.debugger.isAttached();
    registry.takeControl(SESSION_A);
    const adjuntoDespues = handle().view.webContents.debugger.isAttached();
    const blocked = await callTool(a, 'click', { x: 5, y: 5 });
    registry.returnControl(SESSION_A);
    const again = await callTool(a, 'click', { x: 5, y: 5 });
    const ok = adjuntoDespues === false && blocked.isError && blocked.texts.join().includes('browser_user_in_control') && !again.isError;
    return { ok, detalle: { adjuntoAntes, adjuntoDespues, bloqueado: blocked.texts, tras_devolver: { isError: again.isError, texts: again.texts } } };
  });
  await rec.attempt('t11_otra_sesion', async () => {
    const r = await callTool(b, 'click', { x: 5, y: 5 });
    const stillOpen = registry.get(SESSION_A) !== null && registry.get(SESSION_B) === null;
    return { ok: r.isError && r.texts.join().includes('browser_not_open') && stillOpen, detalle: { isError: r.isError, texts: r.texts, aSigueAbierta: registry.get(SESSION_A) !== null } };
  });
  await rec.attempt('t12_file', async () => {
    const target = process.platform === 'win32' ? 'file:///C:/Windows/win.ini' : 'file:///etc/hostname';
    const r = await callTool(a, 'navigate', { url: target });
    const text = r.texts.join();
    return { ok: r.isError && text.includes('browser_failed') && text.includes('Esquema no permitido'), detalle: { target, isError: r.isError, texts: r.texts } };
  });
}

async function checkBackAndClose(ctx) {
  const { rec, a, registry, electron, base, handle } = ctx;
  await rec.attempt('t13_atras', async () => {
    await callTool(a, 'navigate', { url: `${base}segunda` });
    const r = await callTool(a, 'back');
    const titled = await waitFor(() => handle().view.webContents.getTitle() === 'Prueba Mage');
    return { ok: !r.isError && r.data?.navigated === true && titled, detalle: { isError: r.isError, data: r.data, titulo: handle().view.webContents.getTitle() } };
  });
  await rec.attempt('t14_cerrar', async () => {
    const ses = handle().view.webContents.session;
    const cookiesA = (await ses.cookies.get({})).map((c) => c.name);
    const cookiesDefault = (await electron.session.defaultSession.cookies.get({})).map((c) => c.name);
    const r = await callTool(a, 'close');
    const after = await ses.cookies.get({});
    const ok = cookiesA.includes('prueba') && !cookiesDefault.includes('prueba') && !r.isError && r.data?.closed === true && registry.states().length === 0 && after.length === 0;
    return { ok, detalle: { cookiesA, cookiesDefault, cerrar: r.data ?? r.texts, estados: registry.states().length, cookiesDespues: after.length } };
  });
}

function configureApp(electron, tmp, scale) {
  electron.app.setPath('userData', path.join(tmp, 'profile'));
  if (scale !== '1') electron.app.commandLine.appendSwitch('force-device-scale-factor', scale);
}

async function connectAgent(lib, registry, sessionId, imageDeps) {
  const [clientTransport, serverTransport] = lib.InMemoryTransport.createLinkedPair();
  const port = new lib.MemorySessionsPort({ targets: [], now: () => new Date().toISOString(), newConversationId: () => `spike-${sessionId}` });
  await lib.startMageMcpServer({
    port, scope: { accountIds: [] }, store: new lib.MemoryIdempotencyStore(), now: () => new Date().toISOString(),
    transport: serverTransport, browser: lib.createBrowserAgent({ registry, sessionId, imageDeps }),
  });
  const client = new lib.Client({ name: 'browser-tools-spike', version: '1' });
  await client.connect(clientTransport);
  return client;
}

async function buildContext(electron, scale) {
  const http = require('node:http');
  const lib = require(process.env.MAGE_BROWSER_TOOLS_BUNDLE);
  const events = [];
  const server = createFixtureServer(http, events);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = new electron.BrowserWindow({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT, show: process.env.MAGE_BROWSER_SPIKE_HIDE !== '1' });
  const placement = new lib.ViewPlacement();
  const live = new Set([SESSION_A, SESSION_B]);
  const registry = new lib.BrowserRegistry({
    createBrowser: (id) => new lib.IsolatedBrowser(id, lib.electronBrowserDeps),
    newId: () => require('node:crypto').randomUUID(),
    isLive: (id) => live.has(id),
    onChange: () => undefined,
    onOpened: (_id, h) => placement.ensureHosted(h, host),
    onClosed: (_id, h) => placement.forget(h),
    log: () => undefined,
  });
  const pens = new lib.PenSessions({ registry, imageDeps: lib.electronImageDeps, newId: () => require('node:crypto').randomUUID() });
  const a = await connectAgent(lib, registry, SESSION_A, lib.electronImageDeps);
  const b = await connectAgent(lib, registry, SESSION_B, lib.electronImageDeps);
  return {
    electron, scale, server, host, placement, registry, pens, a, b, events, elements: null,
    base: `http://127.0.0.1:${server.address().port}/`,
    handle: () => registry.get(SESSION_A),
    rec: createRecorder(),
  };
}

function writeResult(ctx) {
  const { results } = ctx.rec;
  const out = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    scale: ctx.scale,
    factor: ctx.electron.screen.getDisplayMatching(ctx.host.getBounds()).scaleFactor,
    checks: results,
    ok: Object.keys(results).length > 0 && Object.values(results).every((c) => c.ok),
  };
  const outPath = process.env.MAGE_BROWSER_TOOLS_OUT;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  return out.ok;
}

async function runElectronMode() {
  const electron = require('electron');
  configureApp(electron, process.env.MAGE_BROWSER_TOOLS_TMP, process.env.MAGE_BROWSER_TOOLS_SCALE);
  await electron.app.whenReady();
  try {
    const ctx = await buildContext(electron, process.env.MAGE_BROWSER_TOOLS_SCALE);
    await checkBasics(ctx);
    await checkCaptures(ctx);
    await checkControl(ctx);
    await checkBackAndClose(ctx);
    await wait(SETTLE_MS);
    const ok = writeResult(ctx);
    ctx.server.close();
    ctx.host.destroy();
    electron.app.exit(ok ? 0 : 1);
  } catch (error) {
    console.error(error.stack);
    electron.app.exit(1);
  }
}

if (process.versions.electron === undefined) {
  runNodeMode();
} else {
  runElectronMode();
}
