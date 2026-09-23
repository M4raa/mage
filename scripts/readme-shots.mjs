// Capturas del README, con datos SINTETICOS.
//
// POR QUE EXISTE: las capturas que deja `pnpm verify:gui` no son publicables. Ese arnes aisla el
// `userData` de Electron con `--user-data-dir` pero NO el HOME (lo dice en su propio codigo), asi que
// descubre las cuentas REALES de la maquina: las capturas salen con el correo del usuario en el rail y
// con los titulos de sus conversaciones. Aqui se monta un HOME falso y se inyecta una conversacion
// inventada, para que la app se vea llena sin un solo dato de nadie.
//
// NO es un driver de usar y tirar: `CLAUDE.md` prohibe expresamente escribir uno de esos. Vive en
// `scripts/`, se commitea, y se vuelve a pasar cuando la interfaz cambie y las capturas se queden
// viejas.
//
// NUNCA pulsa `Enter` en el prompt: dispararia un turno real del agente. Todo el contenido entra por
// `window.__mageDev.store`, que es el mismo camino que usa el arnes.
//
//   pnpm shots
//
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const CONFIG = {
  port: 9333, // distinto del 9222 del arnes: asi pueden convivir sin pelearse por el puerto
  bootTimeoutMs: 120_000,
  pollIntervalMs: 250,
  settleMs: 600,
  outDir: path.join(repoRoot, 'docs', 'readme'),
  width: 1280,
  height: 800,
};

// La cuenta que se ve en el rail y en la barra de estado. Inventada a proposito, y con un dominio
// reservado por la RFC 2606 para que no pueda existir de verdad.
const CUENTA = { emailAddress: 'demo@ejemplo.com', organizationName: 'Demo' };

// --- HOME falso -----------------------------------------------------------------------------------

// Mage descubre las cuentas leyendo los directorios `.claude*` que cuelgan de HOME. Con un HOME propio,
// las unicas que existen son las que se escriban aqui.
function seedFakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-shots-home-'));
  const accountDir = path.join(home, '.claude');
  fs.mkdirSync(path.join(accountDir, 'projects'), { recursive: true });
  // OJO: la cuenta PRINCIPAL guarda su `.claude.json` en la RAIZ del HOME, no dentro de `.claude/`
  // (`accountService.ts:252`). Sembrarlo dentro es lo que hacia que el rail dijera «sin email».
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: CUENTA }, null, 2), 'utf-8');
  // Credenciales de mentira con caducidad futura: sin ellas la ficha dice «no tiene login valido» y
  // el panel de uso sale vacio, que en una captura de portada se lee como que la app no funciona.
  // Los valores NO son un token de nadie: son literales inventados que solo existen en este HOME
  // temporal, que se borra al terminar.
  fs.writeFileSync(
    path.join(accountDir, '.credentials.json'),
    JSON.stringify(
      {
        claudeAiOauth: {
          accessToken: 'demo-no-es-un-token',
          refreshToken: 'demo-no-es-un-token',
          expiresAt: Date.now() + 5 * 60 * 60 * 1000,
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
  return home;
}

function seedUserData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-shots-data-'));
  // Sin esto sale el asistente de primer arranque encima de cada captura.
  fs.writeFileSync(
    path.join(dir, 'app-settings.json'),
    JSON.stringify({ version: 1, notificationRules: [], onboardingCompletedVersion: 9999 }, null, 2),
    'utf-8',
  );
  return dir;
}

// --- Arranque -------------------------------------------------------------------------------------

function launchApp(userDataDir, fakeHome) {
  const args = [
    path.join(repoRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
    'dev',
    '--',
    `--remote-debugging-port=${CONFIG.port}`,
    `--user-data-dir=${userDataDir}`,
  ];
  return spawn(process.execPath, args, {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    // HOME y USERPROFILE a la vez: `os.homedir()` mira USERPROFILE en Windows y HOME en el resto.
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
}

async function waitForCdp() {
  const deadline = Date.now() + CONFIG.bootTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CONFIG.port}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // aun no escucha: reintentar
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG.pollIntervalMs));
  }
  throw new Error(`El puerto ${CONFIG.port} no respondio en ${CONFIG.bootTimeoutMs} ms`);
}

async function findMainPage(browser) {
  const deadline = Date.now() + CONFIG.bootTimeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url();
        if (url.includes('debug.html') || url.includes('widget.html') || url.startsWith('devtools://')) continue;
        if (url.includes('index.html') || url.endsWith('/')) return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG.pollIntervalMs));
  }
  throw new Error('No se encontro la ventana principal por CDP');
}

function killTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ya estaba muerto */ }
}

// --- Contenido sintetico --------------------------------------------------------------------------

let uuid = 0;
// Una entrada de transcripcion con la forma que espera `transcriptToBlocks` de la app.
function entry(kind, raw) {
  uuid += 1;
  return {
    index: uuid,
    uuid: `shot-${uuid}`,
    parentUuid: null,
    isSidechain: false,
    isMeta: false,
    timestampMs: Date.now(),
    category: 'turn',
    kind,
    summary: '',
    tokenUsage: null,
    raw,
  };
}

const CONVERSACION = [
  entry('user', { message: { content: 'Añade un botón para informar de fallos en la barra de título, junto a los controles de ventana.' } }),
  entry('assistant', {
    message: {
      content:
        'Voy a mirar primero cómo está montada la cabecera, porque los tres botones de sistema los pinta el propio sistema operativo y puede que ahí no quepa nada.\n\n' +
        '```tsx\n' +
        '// Ancho que reserva Windows para minimizar/maximizar/cerrar.\n' +
        'const WINDOWS_CONTROLS_WIDTH_PX = 138;\n' +
        '```\n\n' +
        'Confirmado: esa franja es intocable. El botón va **pegado a su izquierda**, que es lo más cerca que permite Electron.',
    },
  }),
  entry('user', { message: { content: 'Perfecto. Que abra el formulario de GitHub con la versión ya puesta.' } }),
];

async function hydrate(page, entries) {
  return page.evaluate((payload) => {
    const dev = window.__mageDev;
    if (dev === undefined) throw new Error('window.__mageDev no existe: ¿la app no está en modo desarrollo?');
    const tabId = dev.store.getState().activeTabId;
    const blocks = dev.transcriptToBlocks(payload);
    dev.store.setState((state) => ({ blocksByChat: { ...state.blocksByChat, [tabId]: blocks } }));
    return blocks.length;
  }, entries);
}

async function nuevaConversacion(page) {
  const tabs = '[role="tablist"][aria-label^="Conversaciones abiertas"] [role="tab"]';
  const antes = await page.locator(tabs).count();
  await page.keyboard.press('Control+KeyN');
  await page.locator(tabs).nth(antes).waitFor({ state: 'visible', timeout: CONFIG.bootTimeoutMs });
  await page.waitForTimeout(CONFIG.settleMs);
}

async function shot(page, nombre) {
  const file = path.join(CONFIG.outDir, `${nombre}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${path.relative(repoRoot, file)}`);
}

// --- Principal ------------------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(CONFIG.outDir, { recursive: true });
  const fakeHome = seedFakeHome();
  const userDataDir = seedUserData();
  console.log(`[shots] HOME falso: ${fakeHome}`);
  const child = launchApp(userDataDir, fakeHome);
  let browser = null;
  try {
    const wsUrl = await waitForCdp();
    browser = await chromium.connectOverCDP(wsUrl);
    const page = await findMainPage(browser);
    await page.setViewportSize({ width: CONFIG.width, height: CONFIG.height });
    await page.waitForSelector('[data-titlebar]', { timeout: CONFIG.bootTimeoutMs });
    await page.waitForTimeout(CONFIG.settleMs * 2);

    // El panel de USO se cierra para las capturas. Con credenciales de mentira, la app hace la llamada
    // de verdad y recibe un 401: pinta un aviso rojo con la ruta del HOME temporal dentro. Es correcto
    // —esta diciendo la verdad— pero no es lo que tiene que ver quien entra al repositorio. El uso
    // merece su propia captura el dia que se pueda sembrar con datos de mentira.
    await page.evaluate(() => window.__mageDev.panelStore.getState().togglePanel('left', 'b', 'usage'));
    await page.waitForTimeout(CONFIG.settleMs);

    await nuevaConversacion(page);
    const bloques = await hydrate(page, CONVERSACION);
    console.log(`[shots] conversación hidratada con ${bloques} bloques`);
    await page.waitForTimeout(CONFIG.settleMs);
    await shot(page, 'conversacion');

    // Segunda conversación en un panel dividido: es la funcionalidad que más cuesta explicar por texto.
    // El split se hace con la MISMA accion que el arrastre real (`movePaneTab` al camino del panel
    // raiz), que es como lo monta el arnes — no hay una accion "dividir" en el store.
    const tabA = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
    await nuevaConversacion(page);
    await hydrate(page, [
      entry('user', { message: { content: 'Mientras tanto, revisa el contraste de los tooltips en tema claro.' } }),
      entry('assistant', { message: { content: 'El fondo de la burbuja es oscuro en **los dos** temas a propósito, pero la tinta salía de un token que sí conmuta. En claro quedaba negro sobre negro.' } }),
    ]);
    await page.evaluate((id) => window.__mageDev.store.getState().movePaneTab(id, [], 'left'), tabA);
    await page.waitForTimeout(CONFIG.settleMs * 2);
    await shot(page, 'split');
  } finally {
    if (browser !== null) await browser.close().catch(() => undefined);
    killTree(child);
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[shots] falló:', error.message);
  process.exit(1);
});
