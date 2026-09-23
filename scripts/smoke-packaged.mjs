// Humo del EMPAQUETADO: arranca `release/win-unpacked/Mage.exe` con un perfil aislado y comprueba por
// CDP que la app montada de verdad funciona.
//
// POR QUE EXISTE, y por que no vale `pnpm build`: un bundle en verde NO prueba que el .exe arranque.
// Los fallos de empaquetado —un modulo externalizado que no existe dentro del asar, un icono que no
// se copio, una ruta que en dev resolvia y dentro del asar no— solo aparecen ejecutando el binario.
// Este proyecto ya lo pago una vez con `zod` externalizado.
//
// Y POR QUE NO ESTA EN `verify:gui`: aquel harness comparte UNA ventana entre sus ~94 comprobaciones,
// con un contrato de estado estricto (quien abre algo, lo cierra). Abrir una segunda ventana a mitad
// de esa cadena arrastraria a todas las siguientes. Aqui el proceso es nuestro y el perfil esta
// aislado, asi que la multiventana se puede verificar sin efectos colaterales.
//
// Uso: `pnpm dist:win` primero (necesita `release/win-unpacked`), luego `pnpm smoke:packaged`.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const CDP_PORT = 9333;
const ARRANQUE_MAX_S = 40;
const PROPAGACION_MAX_MS = 10_000;

const exe = join(process.cwd(), 'release', 'win-unpacked', 'Mage.exe');
if (!existsSync(exe)) {
  throw new Error(`No hay app empaquetada en ${exe}. Ejecuta \`pnpm dist:win\` antes de este humo.`);
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const paginasReales = (ctx) => (ctx?.pages() ?? []).filter((p) => !p.url().startsWith('devtools://'));

const perfil = mkdtempSync(join(tmpdir(), 'mage-smoke-'));
const proc = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${perfil}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let salida = '';
proc.stdout.on('data', (d) => {
  salida += String(d);
});
proc.stderr.on('data', (d) => {
  salida += String(d);
});

let browser = null;
let ctx = null;
try {
  // --- 1. Arranca y monta -----------------------------------------------------------------------
  let page = null;
  for (let i = 0; i < ARRANQUE_MAX_S && page === null; i += 1) {
    await esperar(1000);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      ctx = browser.contexts()[0];
      page = paginasReales(ctx)[0] ?? null;
    } catch {
      // Aun no escucha: se reintenta.
    }
  }
  if (page === null) {
    throw new Error(`La app no expuso CDP en ${ARRANQUE_MAX_S} s. Salida del proceso:\n${salida.slice(0, 2000)}`);
  }

  await page.waitForSelector('[role="tablist"]', { timeout: 30_000 });
  const arranque = await page.evaluate(() => ({
    titulo: document.title,
    barras: document.querySelectorAll('[role="tablist"]').length,
    conVersion: document.body.innerText.includes('v'),
  }));
  console.log('OK empaquetado:', JSON.stringify(arranque));

  // --- 2. Multiventana --------------------------------------------------------------------------
  const ventanasAntes = paginasReales(ctx).length;
  await page.evaluate(() => window.mage.openWindow());
  await esperar(4000);
  const paginas = paginasReales(ctx);
  if (paginas.length !== ventanasAntes + 1) {
    throw new Error(`Se esperaba una ventana mas: antes=${ventanasAntes}, despues=${paginas.length}`);
  }
  const segunda = paginas[paginas.length - 1];
  await segunda.waitForSelector('[role="tablist"]', { timeout: 30_000 });

  // LA PROPIEDAD QUE PIDIO EL USUARIO: la configuracion es COMPARTIDA entre ventanas. Se cambia en una
  // y se comprueba que la otra se entera, sin tocarla.
  //
  // Se usa `window.mage` (el puente del preload, que SI existe en produccion) y no `__mageDev`: ese
  // puente es de desarrollo y el bundle de produccion lo deja fuera a proposito — lo descubrio este
  // mismo humo, que es justo para lo que sirve ejecutar el .exe de verdad.
  //
  // La opacidad de fondo es buen testigo: se persiste y ademas cambia el color CALCULADO de las
  // superficies, asi que la propagacion se comprueba en el DOM de la otra ventana y no en un numero
  // que podria venir de su propia lectura del fichero.
  const previas = await page.evaluate(() => window.mage.loadSettings());
  const objetivo = previas.backgroundOpacity === 80 ? 70 : 80;
  await page.evaluate((s) => window.mage.saveSettings(s), { ...previas, backgroundOpacity: objetivo });

  const opaco = (texto) => /^rgb\(\d+, \d+, \d+\)$/.test(texto);
  let fondoSegunda = null;
  for (let i = 0; i < PROPAGACION_MAX_MS / 250; i += 1) {
    await esperar(250);
    fondoSegunda = await segunda.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (!opaco(fondoSegunda)) break;
  }
  if (fondoSegunda === null || opaco(fondoSegunda)) {
    throw new Error(
      `El ajuste NO se propago a la otra ventana: se puso opacidad ${objetivo} en la primera y el fondo de la segunda sigue opaco (${fondoSegunda})`,
    );
  }

  // Y el workspace es POR VENTANA: cada una lleva SUS pestañas, asi que las dos barras son
  // independientes aunque la configuracion sea la misma.
  const pestanas = {
    primera: await page.evaluate(() => document.querySelectorAll('[role="tab"]').length),
    segunda: await segunda.evaluate(() => document.querySelectorAll('[role="tab"]').length),
  };

  await page.evaluate((s) => window.mage.saveSettings(s), previas);
  console.log('OK multiventana:', JSON.stringify({ ventanas: paginas.length, fondoSegunda, pestanas }));
} finally {
  await browser?.close().catch(() => undefined);
  proc.kill();
}
