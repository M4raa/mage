// P-040: mide si una partición en memoria del navegador aislado puede servir `file://` con
// `session.protocol.handle('file')` y qué peticiones pasan por el manejador (página, subrecursos, fetch, enlaces).
// Electron real, sin red y sin Mage: solo la API.
//
//   node spike/browser-file-spike.cjs        (desde la raíz del repo)
//
// Salida: .verify-out/browser-file-spike.json; código 0 si todo pasa.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');

const SETTLE_MS = 1500;

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const electron = require('electron');
  const run = spawnSync(electron, [__filename], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}

const { app, session, net, BaseWindow, WebContentsView } = require('electron');

function buildFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-file-spike-'));
  const root = path.join(base, 'proyecto');
  const outside = path.join(base, 'fuera');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secreto.txt'), 'SECRETO');
  fs.writeFileSync(path.join(outside, 'fuera.css'), 'body{color:red}');
  fs.writeFileSync(path.join(root, 'style.css'), 'body{background:#123}');
  fs.writeFileSync(path.join(root, 'sub', 'app.js'), 'window.appLoaded = true;');
  fs.writeFileSync(path.join(root, 'sub', 'mod.js'), 'window.moduleLoaded = true;');
  fs.writeFileSync(path.join(root, 'otra.html'), '<title>otra</title>');
  // Enlace de directorio que sale del proyecto (junction en Windows: no pide privilegios).
  fs.symlinkSync(outside, path.join(root, 'enlace'), process.platform === 'win32' ? 'junction' : 'dir');
  const outsideUrl = pathToFileURL(path.join(outside, 'secreto.txt')).href;
  fs.writeFileSync(
    path.join(root, 'index.html'),
    `<!doctype html><title>spike</title>
<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="../fuera/fuera.css">
<script src="sub/app.js"></script><script type="module" src="sub/mod.js"></script>
<img src="enlace/secreto.txt">
<a id="out" href="${outsideUrl}">fuera</a><a id="in" href="otra.html">dentro</a>
<script>
window.fetchResult = fetch('style.css').then(r => r.text()).then(t => 'ok:' + t.length, e => 'err:' + e.message);
</script>`,
  );
  return { root, outside };
}

async function main() {
  await app.whenReady();
  const { root } = buildFixture();
  const requests = [];
  const navigations = [];
  const ses = session.fromPartition('mage-browser-file-spike');
  let handleError = null;
  try {
    ses.protocol.handle('file', async (request) => {
      const filePath = fileURLToPath(request.url);
      requests.push(path.relative(root, filePath));
      const real = fs.realpathSync.native(filePath);
      const rel = path.relative(fs.realpathSync.native(root), real);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return new Response('denied', { status: 403 });
      return net.fetch(pathToFileURL(real).href, { bypassCustomProtocolHandlers: true });
    });
  } catch (error) {
    handleError = String(error);
  }
  const window = new BaseWindow({ show: false, width: 800, height: 600 });
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, session: ses } });
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  const contents = view.webContents;
  contents.on('will-navigate', (e) => navigations.push(e.url));
  await contents.loadURL(pathToFileURL(path.join(root, 'index.html')).href);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const page = await contents.executeJavaScript(
    `(async () => ({ title: document.title, appLoaded: window.appLoaded === true, moduleLoaded: window.moduleLoaded === true, fetch: await window.fetchResult,
      bg: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color }))()`,
  );
  await contents.executeJavaScript(`document.getElementById('out').click()`);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const urlAfterOut = contents.getURL();
  // El manejador es de ESTA partición: la sesión por defecto sigue con su file:// normal.
  const defaultHandled = session.defaultSession.protocol.isProtocolHandled('file');
  const result = { handleError, requests, navigations, page, urlAfterOut, defaultHandled };
  const out = path.join(process.cwd(), '.verify-out', 'browser-file-spike.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  app.exit(handleError === null ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
