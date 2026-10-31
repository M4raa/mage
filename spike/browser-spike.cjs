// F11b.1: mide el navegador aislado (IsolatedBrowser) con Electron real. Sin red pública y sin modelos:
// un servidor local en 127.0.0.1 y perfiles desechables.
//
//   node spike/browser-spike.cjs [--scale=1|1.25|1.5]     (desde la raíz del worktree)
//
// Salida: .verify-out/browser-spike/out-<scale>.json; código de salida 0 si todas las comprobaciones pasan, 1 si no.
// Dos modos en el mismo fichero, según `process.versions.electron`: bajo Node empaqueta el módulo con esbuild y
// lanza Electron con este mismo fichero; bajo Electron ejecuta las comprobaciones.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VALID_SCALES = ['1', '1.25', '1.5'];
const SPIKE_TIMEOUT_MS = 90_000;
const SETTLE_MS = 800;
const DOWNLOAD_SETTLE_MS = 1500;
const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 600;

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

function buildBundle(repo, tmp) {
  const esbuild = loadEsbuild(repo);
  const bundle = path.join(tmp, 'browser-bundle.cjs');
  esbuild.buildSync({
    stdin: {
      contents: "export * from './isolatedBrowser';\nexport * from './electronBrowserDeps';\n",
      resolveDir: path.join(repo, 'src/main/browser'),
      loader: 'ts',
      sourcefile: 'browser-spike-entry.ts',
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-browser-spike-'));
  try {
    const bundle = buildBundle(repo, tmp);
    const electron = require(path.join(repo, 'node_modules/electron'));
    // Sin ELECTRON_RUN_AS_NODE: con esa variable Electron arranca como Node y no hay `app`.
    const { ELECTRON_RUN_AS_NODE: _asNode, ...inherited } = process.env;
    const out = path.join(repo, '.verify-out', 'browser-spike', `out-${scale}.json`);
    const result = require('node:child_process').spawnSync(electron, [__filename], {
      env: {
        ...inherited,
        MAGE_BROWSER_SPIKE_BUNDLE: bundle,
        MAGE_BROWSER_SPIKE_TMP: tmp,
        MAGE_BROWSER_SPIKE_SCALE: scale,
        MAGE_BROWSER_SPIKE_OUT: out,
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
const rejects = (promise) => promise.then(() => 'no lanzó', (e) => e.message);

function createRecorder() {
  const checks = [];
  const check = (name, expected, got) => {
    checks.push({ name, expected, got, ok: JSON.stringify(expected) === JSON.stringify(got) });
  };
  // Cada comprobación va en su propio try: si lanza, se registra y se sigue con la siguiente.
  const attempt = async (name, expected, fn) => {
    try {
      check(name, expected, await fn());
    } catch (error) {
      check(name, expected, `EXCEPCIÓN: ${error.message}`);
    }
  };
  return { checks, check, attempt };
}

function createFixtureServer(http, url) {
  const fileUrl = url.pathToFileURL(__filename).href;
  const html =
    '<h1 id=t>Hola</h1><input id=i aria-label="Campo">' +
    '<button id=b onclick="document.getElementById(\'t\').textContent=\'CLIC\'">ok</button>' +
    `<a id=f href="${fileUrl}">fichero</a><a id=d href="/descarga">descarga</a><a id=o href="/otro">otro</a>`;
  return http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'mage_spike=1; Path=/' });
      res.end(html);
    } else if (req.url === '/otro') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Otro</h1>');
    } else if (req.url === '/descarga') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="mage-spike.txt"',
      });
      res.end('x');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

async function checkNavigation(ctx) {
  const { rec, browser, wc, port, base } = ctx;
  await rec.attempt('navegar_localhost', base, () => browser.navigate(`localhost:${port}`));
  await rec.attempt('particion_en_memoria', { persistente: false, esPorDefecto: false }, () => ({
    persistente: wc.session.isPersistent(),
    esPorDefecto: wc.session === ctx.electron.session.defaultSession,
  }));
}

async function checkIsolation(ctx) {
  const { rec, page } = ctx;
  const undef = { require: 'undefined', process: 'undefined', mage: 'undefined', electron: 'undefined' };
  await rec.attempt('sin_node_ni_mage', undef, async () =>
    JSON.parse(
      await page(
        'JSON.stringify({ require: typeof require, process: typeof process, mage: typeof window.mage, electron: typeof window.electron })',
      ),
    ),
  );
}

async function checkFileScheme(ctx) {
  const { rec, browser, wc, page, base } = ctx;
  const fileUrl = ctx.url.pathToFileURL(__filename).href;
  await rec.attempt('file_por_navigate_denegado', true, async () =>
    /Esquema no permitido/.test(await rejects(browser.navigate(fileUrl))),
  );
  await rec.attempt('file_por_navigate_url_intacta', base, () => wc.getURL());
  await rec.attempt('file_por_enlace_bloqueado', base, async () => {
    await page('document.getElementById("f").click()');
    await wait(SETTLE_MS);
    return wc.getURL();
  });
}

async function checkWindowOpen(ctx) {
  const { rec, page } = ctx;
  const { webContents, BrowserWindow } = ctx.electron;
  const counts = () => ({ contents: webContents.getAllWebContents().length, windows: BrowserWindow.getAllWindows().length });
  const before = counts();
  await rec.attempt('window_open_no_abre', 'null', () => page('String(window.open(location.origin + "/otro"))'));
  await rec.attempt('window_open_sin_contenidos_nuevos', before, async () => {
    await wait(SETTLE_MS);
    return counts();
  });
}

async function checkPermissions(ctx) {
  const { rec, page } = ctx;
  await rec.attempt('geolocalizacion_denegada', 'denegado:1', () =>
    page(
      'new Promise((r) => navigator.geolocation.getCurrentPosition(() => r("concedido"), (e) => r("denegado:" + e.code), { timeout: 5000 }))',
    ),
  );
  await rec.attempt('permiso_notificaciones_denegado', 'denied', () =>
    page('navigator.permissions.query({ name: "notifications" }).then((s) => s.state)'),
  );
}

async function checkDownload(ctx) {
  const { rec, wc, page, base } = ctx;
  await rec.attempt('descarga_cancelada', [], async () => {
    await page('document.getElementById("d").click()');
    await wait(DOWNLOAD_SETTLE_MS);
    return fs.readdirSync(ctx.downloads);
  });
  await rec.attempt('descarga_url_intacta', base, () => wc.getURL());
}

async function checkInput(ctx) {
  const { rec, browser, page } = ctx;
  let button;
  let field;
  await rec.attempt('clic_surte_efecto', 'CLIC', async () => {
    const els = await browser.readDom();
    button = els.find((e) => e.role === 'button' && e.name === 'ok');
    await browser.click({ elementId: button.id });
    return page('document.getElementById("t").textContent');
  });
  await rec.attempt('escritura_surte_efecto', 'escrito por Mage', async () => {
    const els = await browser.readDom();
    field = els.find((e) => e.role === 'textbox' && e.name === 'Campo');
    await browser.type({ elementId: field.id, text: 'escrito por Mage' });
    return page('document.getElementById("i").value');
  });
  await rec.attempt('id_caducado_lanza', true, async () => {
    await browser.readDom();
    return /caducado/.test(await rejects(browser.click({ elementId: button.id })));
  });
}

async function checkScreenshot(ctx) {
  const { rec, browser, host } = ctx;
  const factor = ctx.electron.screen.getDisplayMatching(host.getBounds()).scaleFactor;
  ctx.factor = factor;
  const expected = {
    widthDip: WINDOW_WIDTH,
    heightDip: WINDOW_HEIGHT,
    widthPx: Math.round(WINDOW_WIDTH * factor),
    heightPx: Math.round(WINDOW_HEIGHT * factor),
    deviceScale: factor,
    png: true,
  };
  await rec.attempt('captura_tamanos', expected, async () => {
    const s = await browser.screenshot();
    return {
      widthDip: s.widthDip,
      heightDip: s.heightDip,
      widthPx: s.widthPx,
      heightPx: s.heightPx,
      deviceScale: s.deviceScale,
      png: s.base64.length > 0,
    };
  });
}

async function checkBack(ctx) {
  const { rec, browser, wc, base } = ctx;
  await rec.attempt('atras', { volvio: true, url: base }, async () => {
    await browser.navigate(`${base}otro`);
    const volvio = browser.back();
    await wait(SETTLE_MS);
    return { volvio, url: wc.getURL() };
  });
}

async function checkClose(ctx) {
  const { rec, browser, wc, base } = ctx;
  const ses = wc.session;
  await rec.attempt('cerrar_vacia_particion', { habiaCookie: true, destruido: true, cookiesDespues: 0 }, async () => {
    const antes = (await ses.cookies.get({})).length;
    await browser.close();
    return { habiaCookie: antes > 0, destruido: wc.isDestroyed(), cookiesDespues: (await ses.cookies.get({})).length };
  });
  await rec.attempt('cerrar_dos_veces', 'no lanzó', () => rejects(browser.close()));
  await rec.attempt('operar_tras_cerrar_lanza', true, async () =>
    /ya está cerrado/.test(await rejects(browser.navigate(base))),
  );
  // Esta comprobación va tras cerrar: la sesión por defecto no debe haber recibido nada en todo el spike.
  await rec.attempt('sesion_por_defecto_intacta', 0, async () =>
    (await ctx.electron.session.defaultSession.cookies.get({})).length,
  );
}

function configureApp(electron, tmp, scale) {
  const { app } = electron;
  app.setPath('userData', path.join(tmp, 'profile'));
  const downloads = path.join(tmp, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });
  app.setPath('downloads', downloads);
  if (scale !== '1') app.commandLine.appendSwitch('force-device-scale-factor', scale);
  return downloads;
}

async function buildContext(electron, scale, downloads) {
  const http = require('node:http');
  const url = require('node:url');
  const { IsolatedBrowser, electronBrowserDeps } = require(process.env.MAGE_BROWSER_SPIKE_BUNDLE);
  const server = createFixtureServer(http, url);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const host = new electron.BrowserWindow({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT, show: true });
  const browser = new IsolatedBrowser(require('node:crypto').randomUUID(), electronBrowserDeps);
  host.contentView.addChildView(browser.view);
  browser.view.setBounds({ x: 0, y: 0, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  const wc = browser.view.webContents;
  // `page` SOLO lo usa el spike para comprobar; el agente no tiene esto.
  const page = (js) => wc.executeJavaScript(js);
  return {
    electron, url, server, host, browser, wc, page, port, downloads, scale, factor: null,
    base: `http://localhost:${port}/`,
    rec: createRecorder(),
  };
}

async function runChecks(ctx) {
  await checkNavigation(ctx);
  await checkIsolation(ctx);
  await checkFileScheme(ctx);
  await checkWindowOpen(ctx);
  await checkPermissions(ctx);
  await checkDownload(ctx);
  await checkInput(ctx);
  await checkScreenshot(ctx);
  await checkBack(ctx);
  await checkClose(ctx);
}

function writeResult(ctx) {
  const { checks } = ctx.rec;
  const out = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    scale: ctx.scale,
    factor: ctx.factor,
    checks,
    ok: checks.every((c) => c.ok),
  };
  const outPath = process.env.MAGE_BROWSER_SPIKE_OUT;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  return out.ok;
}

async function runElectronMode() {
  const electron = require('electron');
  const scale = process.env.MAGE_BROWSER_SPIKE_SCALE;
  const downloads = configureApp(electron, process.env.MAGE_BROWSER_SPIKE_TMP, scale);
  await electron.app.whenReady();
  let ctx;
  try {
    ctx = await buildContext(electron, scale, downloads);
    await runChecks(ctx);
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
