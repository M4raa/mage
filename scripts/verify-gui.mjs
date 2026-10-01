// Mage — Verificacion GUI contra la app REAL, por CDP.
//
// Por que existe: cada ronda de verificacion se escribia un driver desechable (`_cdp_*.mjs`) en la
// raiz del repo, porque `playwright-core` no resuelve modulos desde el scratchpad. Esto lo deja fijo,
// versionado y repetible, con tres cosas que los drivers de usar y tirar no tenian:
//
//   1. `--user-data-dir` AISLADO: la verificacion no toca el %APPDATA%/Mage real del usuario. De paso
//      arranca sin pestañas persistidas, asi que ninguna comprobacion spawnea el CLI salvo la ULTIMA (el
//      turno minimo de verdad, con su guarda de uso), y no
//      hereda el "residuo de maquina" (panels-layout.json viejo) que ya disfrazo un bug dos veces.
//   2. Un ARTEFACTO revisable por ejecucion (`session.md` + capturas), en vez de un parrafo de ROADMAP
//      que nadie puede volver a comprobar. Idea tomada de playwright-core/src/tools/backend/sessionLog.
//   3. Terminacion del ARBOL de procesos al acabar (electron-vite -> electron -> renderers/GPU): con
//      un kill del hijo directo quedaban procesos vivos, que es justo el bug que se corrigio en
//      AgentSession (ver src/main/os/processTree.ts).
//
// Uso:
//   pnpm verify:gui             # arranca, comprueba y limpia
//   pnpm verify:gui --keep      # deja la app abierta al terminar (para mirar a ojo)
//   pnpm verify:gui --only=texto # solo las comprobaciones cuyo nombre contenga `texto`
//   pnpm verify:gui --turn=local # el turno minimo contra el servidor falso, sin gastar cuota
//   pnpm verify:gui --turn=real  # el turno minimo contra Claude aunque la guarda de uso avise
//
// UN TURNO REAL POR EJECUCION: la ultima comprobacion envia un mensaje minimo a Claude (modelo y
// esfuerzo mas bajos). Antes mira el uso de la cuenta; con mas del 70 % gastado avisa y deja elegir
// real o local (servidor falso), y sin terminal interactiva elige local y lo dice en el informe.
//
// LIMITE, dicho en voz alta: esto MIDE el DOM real; no juzga si el resultado se ve bien. El vistazo
// humano sigue siendo del usuario (ver .claude/skills/verificacion-gui).

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { FAKE_OPENAI_MODEL, FAKE_OPENAI_REPLY, startFakeOpenAiServer } from './fake-openai-server.mjs';
import { decideTurnTarget, parseTurnAnswer, spentPercent } from './lib/usageGuard.mjs';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Version de Mage que corre (la de package.json): la usan el seed de ajustes y las notas de version.
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')).version;
// El paquete `electron` exporta la RUTA a su binario cuando se carga desde node (no desde Electron).
const requireFromHere = createRequire(import.meta.url);

const CONFIG = {
  port: 9222,
  outDir: path.join(repoRoot, '.verify-out'),
  bootTimeoutMs: 120_000,
  pollIntervalMs: 500,
  actionTimeoutMs: 10_000,
  // Re-render de React tras un clic/cambio de estado. Corto a proposito: lo que tarda de verdad se
  // espera con `waitFor`/sondeo, no con esperas ciegas mas largas.
  settleMs: 200,
};

// Anclas del DOM real. Los textos se repiten aqui en vez de importarse de `src/shared` porque este
// fichero es un .mjs que corre en node, sin el pipeline de TS: si alguien cambia el catalogo, el aviso o
// una etiqueta y no toca esto, la comprobacion lo canta en su medida en vez de pasar en verde.
const MODAL = '[role="dialog"][aria-modal="true"]';
const NEW_TAB_DIALOG = '[role="dialog"][aria-labelledby="newtab-title"]';
// Etiquetas de los campos del dialogo de nueva conversacion (el <label> envuelve a su control).
const NEW_TAB_FIELD = { provider: 'PROVEEDOR', model: 'MODELO' };
// Motivo del rechazo del formulario de ALTA de proveedor (`idSuffix="nuevo"` en SettingsView).
const PROVIDER_NEW_ERROR = '#provider-error-nuevo';
// PROVIDER_TEMPLATES de src/shared/providers.ts: solo prerrellenan el formulario, no son proveedores.
const PROVIDER_TEMPLATE_LABELS = ['Ollama', 'LM Studio'];
const OLLAMA_TEMPLATE = {
  label: 'Ollama',
  baseUrl: 'http://localhost:11434/v1',
  models: 'llama3, mistral, qwen2.5-coder',
  modelCount: 3,
};
// Primeras palabras de NO_PERMISSION_CONTROL_WARNING y del aviso de `agy` sin instalar (E3).
const NO_PERMISSION_HEAD = 'Sin control de permisos';
const AGY_MISSING_HEAD = 'No se ha encontrado el CLI';
const AGY_PROVIDER_ID = 'agy';
const AGY_PERMISSION_CHIP = 'Sin permisos';
// Grupo E, fase 2: comando y carpeta de prueba (nunca se lanza agy con ellos).
const AGY_VG_COMMAND = 'vg-comando --exacto > vg.txt';
const AGY_VG_DENIED = 'vg-denegado > vg.txt';
const AGY_VG_LINK = '.vg-carpeta';
// Vallas de codigo para medir el resaltado (F4): `ts` esta en HIGHLIGHT_LANGS (debe tokenizar) y `rust`
// no lo esta (debe caer a texto plano, que NO es lo mismo que quedarse en blanco).
const TS_FENCE = '```ts\nconst answer: number = 42;\nexport const twice = (n: number): number => n * 2;\n```';
const RUST_FENCE = '```rust\nfn main() { println!("hola"); }\n```';

// --- Comprobaciones ------------------------------------------------------------------------------
//
// Cada una devuelve { ok, detail }. `detail` SIEMPRE lleva el valor medido, tambien cuando pasa: un
// "ok" sin dato no es verificacion, es fe.

// --- Fase 0: presupuestos de rendimiento ----------------------------------------------------------
// Holgados a proposito. Un presupuesto apretado en un harness que corre en DEV, con CDP enganchado y
// compitiendo por CPU con lo que tenga la maquina, seria un intermitente — y un intermitente en el
// harness es peor que una comprobacion de menos (regla del repo, ver .claude/skills/verificacion-gui).
// Se ajustan a la baja cuando las fases 1 y 5 muevan el numero, no antes.
//
// Cuantos deltas tiene la rafaga de 0.1: 60 es alrededor de un segundo de streaming real.
// Cuentas falsas que se inyectan para estresar la columna izquierda. El numero esta elegido para que
// el contenido NO quepa: con 12 medía 742 px en una ventana de 800 y pasaba por los pelos, que es
// justo el falso verde que hay que evitar. Lo que se mide no es "caben N", es que la columna se las
// arregle sola —scrolleando por dentro— en vez de empujar la pagina entera.
const RAIL_STRESS_ACCOUNTS = 30;

const DELTA_BURST_SIZE = 60;
// Coste maximo por delta, INCLUIDO el frame que se le deja pintar (de ese presupuesto, unos 16,7 ms
// son el propio requestAnimationFrame: lo que se vigila es lo que se pase de ahi).
const DELTA_BUDGET_MS = 45;
// Tarea larga: el umbral de 50 ms es el estandar de la Long Tasks API. Se tolera una punta hasta aqui.
const LONG_TASK_BUDGET_MS = 180;
// Arranque hasta que monta el workbench (0.2). En DEV incluye la transformacion de Vite modulo a modulo.
const BOOT_BUDGET_MS = 6000;
// Ventana de sondeo de 0.3 y tope de ida y vuelta de IPC. Con P1 sin arreglar, refreshJumpList mete
// unos 300 ms de bloqueo en main y una de las sondas se lo come entero.
const IPC_PROBE_WINDOW_MS = 2500;
const IPC_BLOCK_BUDGET_MS = 120;
// Nombre de la marca de arranque que pone src/renderer/src/App.tsx. Se repite aqui, como el resto de
// anclas de este fichero, porque este .mjs corre en node sin el pipeline de TS: si alguien la renombra
// alli y no aqui, 0.2 lo canta en vez de pasar en verde midiendo otra cosa.
const WORKBENCH_MOUNTED_MARK = "mage:workbench-mounted";
// Alto maximo de la fila del prompt con el editor VACIO (una linea de 12,5 px a 1.55 + 20 px de relleno
// + el chip mas alto de los controles). Con el editor estirado a su `max-height` la fila medía 223 px.
// Presupuesto de la fila del prompt VACIA, en la ventana minima: como fraccion del alto del panel de
// conversacion (el reporte era justo ese, "se come media pantalla") y ancho minimo del editor, que es lo
// que de verdad se rompio — con los controles a `shrink-0` y el editor a basis 0, el editor se quedaba en
// 0 px y el placeholder envolvia letra a letra hasta el `max-height`.
// 0.3 (era 0.25): los chips de modo y esfuerzo reservan el ancho de su etiqueta mas larga (0.1.1, punto 5)
// y en el panel minimo (260 px) envuelven una linea mas: 131 px de 486. Con el editor estirado serian ~223.
const PROMPT_ROW_MAX_SHARE = 0.3;
const PROMPT_EDITOR_MIN_PX = 120;
// Tamano de "modo ventana" que se mide. Es EL SUELO REAL de la ventana (`WINDOW.minWidth/minHeight` en
// src/main/index.ts): mas pequena no se puede poner arrastrando y la app no tiene zoom de renderer, asi
// que medir por debajo seria perseguir estados inalcanzables. Ahi aprietan los dos ejes a la vez — el
// alto a las columnas de iconos y el ancho a los paneles del dock, que es quien estruja al centro.
const VENTANAS_PEQUENAS = [{ etiqueta: 'minima', width: 900, height: 600 }];

const CHECKS = [
  {
    name: 'La ventana principal arranca',
    async run(page) {
      const title = await page.title();
      const railCount = await page.locator('[role="toolbar"]').count();
      return { ok: railCount > 0, detail: `title=${JSON.stringify(title)} toolbars=${railCount}` };
    },
  },
  {
    // Ronda 3, item 9: la barra de titulo NATIVA no se puede tematizar. Se mide que la app pinta la
    // suya (arrastrable, con el boton "Editar" que despliega el Menu nativo) y que hereda los tokens
    // del tema en vez de un color fijo del SO.
    name: 'Cabecera propia: existe, es arrastrable y hereda el tema',
    async run(page) {
      // Ancla: el icono de la app. El boton "Preferencias" que se usaba antes ya no existe — su accion
      // vive en el menu de tres puntos (donde el catalogo la generaba desde el principio) y en el propio
      // icono, que desde 2026-09-07 es quien abre los ajustes.
      const header = page.getByRole('button', { name: /Configuración/ });
      await header.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const measured = await page.evaluate(() => {
        const bar = document.querySelector('button[aria-label^="Mage"]')?.parentElement;
        if (!bar) return null;
        const styles = getComputedStyle(bar);
        return {
          height: Math.round(bar.getBoundingClientRect().height),
          top: Math.round(bar.getBoundingClientRect().top),
          appRegion: styles.getPropertyValue('-webkit-app-region').trim(),
          background: styles.backgroundColor,
          rail: getComputedStyle(document.documentElement).getPropertyValue('--color-mg-rail').trim(),
          // Ya NO hay etiquetas de menu en la cabecera: viven detras del boton de tres puntos (peticion
          // del usuario). Lo que se exige ahora es que ese boton este, y que su nombre accesible siga
          // siendo el del menu — era el unico que tenia la cabecera.
          menuPlegado: document.querySelectorAll('[data-app-menu-toggle="true"]').length,
          nombreDelMenu: document.querySelector('[data-app-menu-toggle="true"]')?.getAttribute('aria-label') ?? null,
        };
      });
      const ok =
        measured !== null &&
        measured.top === 0 &&
        measured.height === 32 &&
        measured.appRegion === 'drag' &&
        measured.menuPlegado === 1 &&
        measured.nombreDelMenu === 'Menú de la aplicación' &&
        measured.background !== 'rgba(0, 0, 0, 0)';
      return { ok, detail: `cabecera=${JSON.stringify(measured)}` };
    },
  },
  {
    // 2.9.a: la cabecera pintaba el texto "MAGE"; ahora va la marca (MageMark, monocroma via
    // `currentColor`). Un "hay un svg" a secas pasaria en verde con el logo INVISIBLE, asi que se mide
    // tambien su `stroke` calculado (debe heredar un token del tema, no quedarse en negro puro), su
    // ancho real, y que sigue existiendo un nombre accesible para la app en la ventana — ese texto era
    // el unico que habia.
    name: '2.9.a: la cabecera pinta el logo y no el texto MAGE',
    async run(page) {
      const measured = await page.evaluate(() => {
        // ANCLADO al boton de ajustes, no a la cabecera entera: contar los svg de toda la barra hacia
        // que cualquier icono nuevo a su derecha (el de informar de un fallo, 2026-09-21) tumbara esta
        // comprobacion, que no habla de ellos. Lo que aqui se afirma es que ESTE control pinta el logo.
        const boton = document.querySelector('button[aria-label^="Mage · Configuración"]');
        const bar = boton?.parentElement;
        if (!bar || !boton) return null;
        const svgs = [...boton.querySelectorAll('svg')];
        const logo = svgs[0] ?? null;
        const path = logo?.querySelector('path') ?? null;
        return {
          texto: bar.textContent ?? '',
          svgs: svgs.length,
          // La marca pasa de TRAZO a RELLENO con la ilustracion nueva (brandbook 2026-09-06): un solo
          // contorno con `fill-rule="evenodd"` y los calados como agujeros de verdad. Se mide el relleno
          // resuelto —que tiene que heredar del contenedor, no ser negro ni transparente— y que la regla
          // de relleno sea evenodd, que es de lo que depende que el sombrero no salga macizo.
          fill: path === null ? null : getComputedStyle(path).fill,
          fillRule: path === null ? null : getComputedStyle(path).fillRule,
          ancho: logo === null ? 0 : Math.round(logo.getBoundingClientRect().width),
        };
      });
      // El nombre de la app ya no lo lleva el <svg> sino el BOTON que lo envuelve (que ademas abre los
      // ajustes). Lo que importa no cambia: que "Mage" siga siendo alcanzable por nombre accesible —
      // era el unico sitio de la ventana donde aparece desde que el texto se sustituyo por el logo.
      // ANCLADO al control concreto, no a cualquier boton que contenga la palabra: 'Mage (común)' es
      // una etiqueta de ORIGEN de permisos que tambien se pinta como boton, y hacia que esto contara 2
      // segun que pantalla dejara abierta la comprobacion anterior.
      const nombreAccesible = await page.getByRole('button', { name: /^Mage · Configuración$/ }).count();
      const ok =
        measured !== null &&
        !measured.texto.includes('MAGE') &&
        measured.svgs === 1 &&
        measured.ancho >= 12 &&
        measured.fill !== null &&
        measured.fill !== 'rgb(0, 0, 0)' &&
        measured.fill !== 'none' &&
        measured.fillRule === 'evenodd' &&
        nombreAccesible === 1;
      return { ok, detail: `cabecera=${JSON.stringify(measured)} nombreAccesible=${nombreAccesible}` };
    },
  },
  {
    // Boton de informar de un fallo (2026-09-21, peticion del usuario: "un icono de bug junto al
    // minimizar/maximizar/cerrar"). No puede ir ENTRE ellos —esa franja la pinta el SO y el DOM solo
    // reserva su ancho—, asi que lo que se mide es que queda pegado a su izquierda y que no se cuela
    // por debajo: si `right` del boton pasa del borde util de la cabecera, el clic no llegaria nunca.
    //
    // NO se pulsa: abriria el navegador del sistema a mitad de la tanda. La URL se comprueba en
    // `bugReport.test.ts`, que es donde vive esa logica; aqui solo se verifica que el control existe,
    // esta donde toca y dice a donde va.
    name: 'Cabecera: el boton de informar de un fallo va pegado a los botones del SO y es alcanzable',
    async run(page) {
      const measured = await page.evaluate(() => {
        const boton = document.querySelector('button[aria-label^="Informar de un fallo"]');
        const bar = document.querySelector('[data-titlebar]');
        if (!boton || !bar) return null;
        const b = boton.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        const padding = Number.parseFloat(getComputedStyle(bar).paddingRight);
        return {
          svgs: boton.querySelectorAll('svg').length,
          etiqueta: boton.getAttribute('aria-label') ?? '',
          tip: boton.getAttribute('data-tip') ?? '',
          // `no-drag`: sin esto la cabecera se traga el clic como arrastre de ventana.
          region: getComputedStyle(boton).getPropertyValue('-webkit-app-region'),
          derecha: Math.round(b.right),
          // Borde a partir del cual empieza la franja intocable de los botones del SO.
          bordeUtil: Math.round(barRect.right - padding),
          alto: Math.round(b.height),
          dentroDeLaCabecera: b.top >= barRect.top && b.bottom <= barRect.bottom,
        };
      });
      const ok =
        measured !== null &&
        measured.svgs === 1 &&
        measured.region === 'no-drag' &&
        measured.dentroDeLaCabecera &&
        // Pegado a la franja del SO (a su izquierda), nunca por debajo de ella.
        measured.derecha <= measured.bordeUtil &&
        measured.bordeUtil - measured.derecha <= 12 &&
        measured.alto >= 16 &&
        // Dice que se va al navegador ANTES de pulsarlo, no despues.
        /navegador/i.test(measured.etiqueta) &&
        /GitHub/i.test(measured.tip);
      return { ok, detail: `bug=${JSON.stringify(measured)}` };
    },
  },
  {
    // Boton de aportar una idea (2026-09-23, peticion del usuario: "junto al de reportar bug"). Se
    // mide ORDENADO respecto al de fallo, porque es lo unico que distingue "hay dos botones" de "hay
    // dos botones puestos donde toca": la idea a la izquierda, el fallo pegado a la franja del SO.
    //
    // Y se mide que NO abren el mismo formulario. No se pulsa ninguno -abriria el navegador a mitad
    // de la tanda-, asi que el destino se compara por la etiqueta accesible, que es lo unico que el
    // DOM expone de a donde va cada uno. Las URL en si las cubre `bugReport.test.ts`.
    name: 'Cabecera: los dos botones de GitHub (idea y fallo) estan, en orden y sin solaparse',
    async run(page) {
      const measured = await page.evaluate(() => {
        const idea = document.querySelector('button[aria-label^="Aportar una idea"]');
        const fallo = document.querySelector('button[aria-label^="Informar de un fallo"]');
        if (!idea || !fallo) return null;
        const i = idea.getBoundingClientRect();
        const f = fallo.getBoundingClientRect();
        return {
          etiquetaIdea: idea.getAttribute('aria-label') ?? '',
          tipIdea: idea.getAttribute('data-tip') ?? '',
          region: getComputedStyle(idea).getPropertyValue('-webkit-app-region'),
          svgs: idea.querySelectorAll('svg').length,
          // El icono NO puede ser el mismo: dos botones pegados con el mismo dibujo no se distinguen.
          mismoIcono: (idea.querySelector('path')?.getAttribute('d') ?? 'a') === (fallo.querySelector('path')?.getAttribute('d') ?? 'b'),
          ideaAntes: Math.round(i.right) <= Math.round(f.left),
          separacionPx: Math.round(f.left - i.right),
          mismaAltura: Math.round(i.top) === Math.round(f.top),
          alto: Math.round(i.height),
        };
      });
      const ok =
        measured !== null &&
        measured.svgs === 1 &&
        measured.region === 'no-drag' &&
        !measured.mismoIcono &&
        measured.ideaAntes &&
        measured.separacionPx >= 0 &&
        measured.mismaAltura &&
        measured.alto >= 16 &&
        // Dice que se va al navegador ANTES de pulsarlo, igual que el de fallo.
        /navegador/i.test(measured.etiquetaIdea) &&
        /GitHub/i.test(measured.tipIdea);
      return { ok, detail: `idea=${JSON.stringify(measured)}` };
    },
  },
  {
    // 2.9.b: el menu de aplicacion propio SUSTITUYE al `Menu` nativo. La medida que demuestra la
    // sustitucion es que el desplegable esta EN EL DOM del renderer (el nativo no lo estaba), y que sus
    // atajos vienen del catalogo de acciones — por eso se busca `Ctrl+N`, que nadie escribio a mano.
    name: '2.9.b: la cabecera lista el menu de app con acciones del actionCatalog',
    async run(page) {
      // La barra vive detras del boton de tres puntos: hay que desplegarla. El clic se dispara desde
      // dentro de la pagina porque la cabecera es region de ARRASTRE de ventana y Electron se come los
      // eventos sinteticos de raton que caen sobre ella.
      await page.evaluate(() => document.querySelector('[data-app-menu-toggle="true"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      const menubar = page.locator('[role="menubar"][aria-label="Menú de la aplicación"]');
      await menubar.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const menus = await menubar.locator('[role="menuitem"]').allInnerTexts();
      await page.evaluate(() =>
        document.querySelector('[role="menubar"] > [role="menuitem"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
      );
      await page.waitForTimeout(CONFIG.settleMs);
      const measured = await page.evaluate(() => {
        const menu = document.querySelector('[role="menu"]');
        const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])];
        return {
          desplegables: document.querySelectorAll('[role="menu"]').length,
          items: items.length,
          etiquetas: items.map((i) => i.textContent?.trim() ?? ''),
          conAtajoCtrlN: items.some((i) => (i.textContent ?? '').includes('Ctrl+N')),
        };
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(CONFIG.settleMs);
      const cerrado = await page.locator('[role="menu"]').count();
      const ok =
        menus.length >= 3 &&
        measured.desplegables === 1 &&
        measured.items >= 3 &&
        measured.conAtajoCtrlN &&
        cerrado === 0;
      return { ok, detail: `menus=${JSON.stringify(menus)} desplegado=${JSON.stringify(measured)} tras Escape=${cerrado}` };
    },
  },
  {
    // El patron de teclado que este repo ya ha roto TRES veces. Se mide foco Y `aria-expanded`, no solo
    // que algo cambie.
    name: '2.9.b: el menu de app se navega con el teclado',
    async run(page) {
      // La barra ya NO esta desplegada de entrada: ahora vive detras del boton de tres puntos, asi que
      // hay que abrirla antes de navegarla. El contrato de teclado de dentro no cambia.
      // Se dispara desde dentro de la pagina: la cabecera es region de arrastre y Electron se come los
      // clics sinteticos que caen sobre ella (ver la comprobacion del menu plegado).
      await page.evaluate(() => document.querySelector('[data-app-menu-toggle="true"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.waitForTimeout(CONFIG.settleMs);
      const menubar = page.locator('[role="menubar"][aria-label="Menú de la aplicación"]');
      const first = menubar.locator('[role="menuitem"]').first();
      await first.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(CONFIG.settleMs);
      const trasDerecha = await focusedMenuLabel(page);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(CONFIG.settleMs);
      const vuelta = await focusedMenuLabel(page);

      // Igual que arriba: dispatch en vez de clic real, por la region de arrastre de la cabecera.
      await page.evaluate(() =>
        document.querySelector('[role="menubar"] > [role="menuitem"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
      ); // abre el primer desplegable
      await page.waitForTimeout(CONFIG.settleMs);
      const abierto = await menubar.locator('[role="menuitem"]').first().getAttribute('aria-expanded');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(CONFIG.settleMs);
      const enElSegundoItem = await page.evaluate(() => {
        const menu = document.querySelector('[role="menu"]');
        const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])];
        return items.findIndex((item) => item === document.activeElement);
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(CONFIG.settleMs);
      const focoTrasEscape = await focusedMenuLabel(page);
      // Se deja la cabecera como estaba: el primer Escape cerro el desplegable, el segundo pliega la
      // barra en los tres puntos. Sin esto, la comprobacion deja residuo para las siguientes — que es
      // justo el fallo que ya costo una tarde con el estado del store.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        trasDerecha.length > 0 &&
        trasDerecha !== vuelta &&
        abierto === 'true' &&
        enElSegundoItem === 1 &&
        focoTrasEscape.length > 0;
      return {
        ok,
        detail: `ArrowRight=${JSON.stringify(trasDerecha)} ArrowLeft=${JSON.stringify(vuelta)} aria-expanded=${abierto} item enfocado tras ArrowDown=${enElSegundoItem} foco tras Escape=${JSON.stringify(focoTrasEscape)}`,
      };
    },
  },
  {
    name: 'La StatusBar esta montada',
    async run(page) {
      const text = await page.locator('body').innerText();
      return { ok: text.length > 0, detail: `caracteres visibles=${text.length}` };
    },
  },
  {
    name: 'Ctrl+, abre Configuracion (contrato de dialogo)',
    async run(page) {
      await page.keyboard.press('Control+Comma');
      const dialog = page.locator(MODAL);
      await dialog.first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      return { ok: (await dialog.count()) === 1, detail: `dialogos modales=${await dialog.count()}` };
    },
  },
  {
    // B5 / F3 del backlog: "Modelo por defecto por proveedor", pendiente de verificacion GUI.
    name: 'Proveedores y modelos: un selector de modelo por proveedor (F3)',
    async run(page) {
      // La seccion 'Modelos' se fundio con 'Proveedores' el 2026-09-18: una ficha por proveedor con su
      // ruta/URL, sus modelos reales y sus valores por defecto.
      await openSection(page, /Proveedores y modelos/);
      const selectors = page.locator('[aria-label^="Modelo por defecto de"]');
      await selectors.first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const labels = await selectors.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
      return { ok: labels.length >= 2, detail: `selectores=${labels.length} ${JSON.stringify(labels)}` };
    },
  },
  {
    // Ronda 3, item 1: era el ULTIMO `<select>` nativo de la app (su popup lo pinta el SO, con el
    // resaltado azul imposible de tematizar). Se mide que no queda ninguno y que el control es el
    // Dropdown propio (boton con aria-haspopup="listbox").
    name: 'Proveedores y modelos: el selector es el Dropdown propio, no un <select> nativo',
    async run(page) {
      await openSection(page, /Proveedores y modelos/);
      const selectors = page.locator('[aria-label^="Modelo por defecto de"]');
      await selectors.first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const shapes = await selectors.evaluateAll((nodes) =>
        nodes.map((n) => `${n.tagName.toLowerCase()}:${n.getAttribute('aria-haspopup') ?? 'sin-haspopup'}`),
      );
      const nativeSelects = await page.locator('[role="dialog"] select').count();
      const ok = nativeSelects === 0 && shapes.length > 0 && shapes.every((s) => s === 'button:listbox');
      return { ok, detail: `selects nativos en el dialogo=${nativeSelects} controles=${JSON.stringify(shapes)}` };
    },
  },
  {
    // 0.1.1 R2, punto 6: «Omitir permisos» como modo por defecto, con su linea fija en Ajustes. Se elige
    // por la accion del store (no abre ninguna conversacion) y se restaura el que habia.
    name: 'Proveedores y modelos: «Omitir permisos» por defecto enseña su aviso fijo (R2 6)',
    async run(page) {
      await openSection(page, /Proveedores y modelos/);
      const aviso = page.locator('[data-testid="default-bypass-warning"]');
      const previo = await page.evaluate(() => window.__mageDev?.store.getState().settings.defaultPermissionMode ?? '');
      try {
        await page.evaluate(() => window.__mageDev?.store.getState().setDefaultPermissionMode('bypassPermissions'));
        await aviso.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const conBypass = await aviso.count();
        const texto = (await aviso.textContent()) ?? '';
        await page.evaluate(() => window.__mageDev?.store.getState().setDefaultPermissionMode(''));
        await aviso.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
        const ok = conBypass === 1 && texto.includes('sin preguntar');
        return { ok, detail: `avisos con bypass=${conBypass} texto=${JSON.stringify(texto)} sin bypass=${await aviso.count()}` };
      } finally {
        await page.evaluate((modo) => window.__mageDev?.store.getState().setDefaultPermissionMode(modo), previo);
      }
    },
  },
  {
    // Grupo E, fase 2: la ficha de agy deja añadir y quitar carpetas extra para su perfil, valida la ruta
    // y lo guarda en app-settings.json (main las enlaza al lanzar agy; aqui no se lanza nada).
    name: 'E fase 2: Ajustes › agy añade, valida y quita carpetas extra de su perfil',
    async run(page, { userDataDir }) {
      // Autosuficiente con `--only`: en la tanda completa Configuracion ya llega abierta (y se deja abierta).
      const propio = (await page.locator(MODAL).count()) === 0;
      if (propio) await openSettingsDialog(page);
      try {
        return await measureAgyProfileLinks(page, userDataDir);
      } finally {
        if (propio) await closeDialog(page);
      }
    },
  },
  {
    // D5: la seccion existe, lista atajos y el buscador FILTRA de verdad (no solo pinta la caja).
    name: 'Seccion Atajos: lista y el buscador filtra (D5)',
    async run(page) {
      await openSection(page, /Atajos de teclado/);
      const search = page.getByRole('textbox', { name: 'Buscar atajo por nombre' });
      await search.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const rows = page.getByRole('button', { name: 'Cambiar' });
      const total = await rows.count();
      await search.fill('zzzz-no-existe');
      await page.waitForTimeout(200);
      const none = await rows.count();
      await search.fill('');
      await page.waitForTimeout(200);
      const restored = await rows.count();
      const ok = total > 0 && none === 0 && restored === total;
      return { ok, detail: `filas=${total} tras filtro imposible=${none} restauradas=${restored}` };
    },
  },
  {
    // M3: tema claro/oscuro. Se mide el efecto REAL en el DOM (data-theme en <html>), no el clic.
    name: 'Apariencia: cambiar de tema aplica data-theme',
    async run(page) {
      await openSection(page, /Apariencia/);
      const before = await page.evaluate(() => document.documentElement.dataset.theme);
      await page.getByText('Claro', { exact: true }).first().click();
      await page.waitForTimeout(250);
      const light = await page.evaluate(() => document.documentElement.dataset.theme);
      await page.getByText('Oscuro', { exact: true }).first().click();
      await page.waitForTimeout(250);
      const dark = await page.evaluate(() => document.documentElement.dataset.theme);
      const ok = light === 'light' && dark === 'dark';
      return { ok, detail: `inicial=${before} tras Claro=${light} tras Oscuro=${dark}` };
    },
  },
  {
    // El fondo del tooltip es OSCURO EN LOS DOS TEMAS a proposito (`--color-mg-tooltip`), asi que su
    // texto no puede salir de un token que SI conmuta. Salia de `--color-mg-body`, y en tema claro eso
    // es casi negro: la burbuja se veia como un rectangulo negro macizo, sin texto (reportado el
    // 2026-09-21 con tres capturas). Un check de clases no lo habria cazado —las clases estaban bien
    // puestas—, asi que se mide el CONTRASTE REAL calculado, en los DOS temas.
    //
    // No se mueve el raton: se dispara `pointerover` sobre el control, que es como TooltipLayer escucha
    // (delegacion en document). Asi la burbuja sale aunque el control este tapado por el dialogo que la
    // comprobacion anterior deja abierto, y el puntero se queda donde estaba para la siguiente.
    name: 'Tooltips: el texto contrasta con su burbuja en los dos temas',
    async run(page) {
      const temaInicial = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
      const medidas = {};
      for (const tema of ['dark', 'light']) {
        medidas[tema] = await page.evaluate(async (t) => {
          document.documentElement.dataset.theme = t;
          const disparador = document.querySelector('[data-tip]');
          if (disparador === null) return { error: 'sin ningun [data-tip] en la pagina' };
          disparador.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
          // TooltipLayer espera SHOW_DELAY_MS (350) antes de montar la burbuja; se sondea en vez de
          // esperar un tiempo fijo, que da medidas distintas segun lo cargado que este el render.
          let burbuja = null;
          for (let i = 0; i < 40 && burbuja === null; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            burbuja = document.querySelector('[role="tooltip"]');
          }
          if (burbuja === null) return { error: 'la burbuja no llego a montarse' };
          const estilo = getComputedStyle(burbuja);
          const canal = (c) => {
            const v = c / 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          };
          const luminancia = (css) => {
            const [r, g, b] = (css.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).map(Number);
            return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
          };
          const lTexto = luminancia(estilo.color);
          const lFondo = luminancia(estilo.backgroundColor);
          const ratio = (Math.max(lTexto, lFondo) + 0.05) / (Math.min(lTexto, lFondo) + 0.05);
          const medida = {
            texto: estilo.color,
            fondo: estilo.backgroundColor,
            ratio: Math.round(ratio * 100) / 100,
            conTexto: (burbuja.textContent ?? '').trim().length > 0,
          };
          document.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
          return medida;
        }, tema);
      }
      // Se restaura el tema que habia: esta comprobacion no es de apariencia y no debe cambiarsela a las
      // que vienen detras.
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, temaInicial);
      // 4.5:1 es el minimo de la WCAG para texto normal. El fallo reportado medía ~1.1:1.
      const ok = ['dark', 'light'].every((t) => medidas[t].conTexto === true && medidas[t].ratio >= 4.5);
      return { ok, detail: `tooltip=${JSON.stringify(medidas)} restaurado=${temaInicial}` };
    },
  },
  {
    // P-028 punto 5: «Config. compartida» pasa a «MCP y conectores», un inventario de TODAS las fuentes.
    // Las fuentes son FALSAS (sembradas en `main()`: mcp-common.json del perfil aislado y, por
    // MAGE_MCP_FAKE_SOURCES, un .claude.json de la cuenta principal y un claude_desktop_config.json):
    // una verificacion no enseña nunca lo real de la maquina. Se mide que salen las cuatro filas, que
    // ningun valor de env/headers llega al DOM y que el editor de hooks ya no esta aqui.
    name: 'MCP y conectores: inventario de las fuentes sembradas sin valores de env en el DOM',
    async run(page) {
      // Autosuficiente con `--only=MCP`: en la tanda completa Configuracion ya llega abierta.
      if ((await page.locator(MODAL).count()) === 0) await openSettingsDialog(page);
      await openSection(page, /MCP y conectores/);
      await page.locator('[data-mcp-row]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const medida = await page.evaluate((secreto) => {
        const seccion = document.querySelector('[data-mcp-section]');
        const filas = [...document.querySelectorAll('[data-mcp-row]')].map((fila) => fila.getAttribute('data-mcp-row'));
        const valores = [...document.querySelectorAll('input, textarea')].map((input) => input.value);
        const botones = [...(seccion?.querySelectorAll('button') ?? [])].map((b) => (b.textContent ?? '').trim());
        return {
          filas,
          secretoEnDom: document.documentElement.outerHTML.includes(secreto) || valores.some((v) => v.includes(secreto)),
          editorDeHooks: botones.some((t) => /Añadir (regla|hook)/.test(t)),
        };
      }, SEEDED_MCP_SECRET);
      const esperadas = [...SEEDED_MCP_SERVERS, SEEDED_MCP_ACCOUNT_SERVER, SEEDED_MCP_DESKTOP_SERVER];
      const faltan = esperadas.filter((nombre) => !medida.filas.includes(nombre));
      const ok = faltan.length === 0 && !medida.secretoEnDom && !medida.editorDeHooks;
      return { ok, detail: `filas=${JSON.stringify(medida.filas)} faltan=${JSON.stringify(faltan)} secretoEnDom=${medida.secretoEnDom} editorDeHooks=${medida.editorDeHooks}` };
    },
  },
  {
    // P-028 bug HTTP/SSE: el editor antiguo no podia guardar un remoto (exigia `command`). Se abre el
    // HTTP sembrado, se comprueba que la cabecera sale ENMASCARADA, que Escape cierra solo el dialogo
    // (Configuracion sigue abierta: es una capa dentro de otra) y que «Guardar» sin tocar nada deja en
    // DISCO el remoto intacto: con su URL, sin `command` y con el valor de la cabecera conservado.
    name: 'MCP y conectores: un comun HTTP se edita y se guarda sin comando y sin perder su cabecera',
    async run(page, { userDataDir }) {
      const dialogo = page.locator('[data-mcp-server-dialog]');
      await page.getByRole('button', { name: `Editar ${SEEDED_MCP_HTTP}`, exact: true }).click();
      await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const enmascarado = await page.evaluate(
        (secreto) => !document.documentElement.outerHTML.includes(secreto) && [...document.querySelectorAll('input')].every((i) => !i.value.includes(secreto)),
        SEEDED_MCP_SECRET,
      );
      await page.keyboard.press('Escape');
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const configuracionAbierta = (await page.locator('[data-mcp-section]').count()) === 1;
      await page.getByRole('button', { name: `Editar ${SEEDED_MCP_HTTP}`, exact: true }).click();
      await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click();
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const enDisco = JSON.parse(fs.readFileSync(path.join(userDataDir, 'shared-config', 'mcp-common.json'), 'utf-8')).mcpServers[SEEDED_MCP_HTTP];
      const remotoIntacto =
        enDisco?.type === 'http' && typeof enDisco.url === 'string' && enDisco.command === undefined && enDisco.headers?.Authorization === SEEDED_MCP_SECRET;
      const ok = enmascarado && configuracionAbierta && remotoIntacto;
      // Solo se mide la FORMA de lo guardado: el valor de la cabecera no sale al informe.
      return { ok, detail: `enmascarado=${enmascarado} escapeSoloDialogo=${configuracionAbierta} remotoIntacto=${remotoIntacto} claves=${JSON.stringify(Object.keys(enDisco ?? {}))}` };
    },
  },
  {
    // P-028 punto 34: «Importar…» con vista previa. Se abre, se comprueba que ofrece las dos fuentes
    // falsas (la cuenta y Claude Desktop) sin valores en el DOM, y se CANCELA: la comprobacion no
    // cambia mcp-common.json para las que vienen detras. Configuracion se deja abierta, como llego.
    name: 'MCP y conectores: Importar… enseña la vista previa de las fuentes y se cancela sin escribir',
    async run(page, { userDataDir }) {
      const fichero = path.join(userDataDir, 'shared-config', 'mcp-common.json');
      const antes = fs.readFileSync(fichero, 'utf-8');
      const dialogo = page.locator('[data-mcp-import-dialog]');
      await page.locator('[data-mcp-section]').getByRole('button', { name: 'Importar…', exact: true }).first().click();
      await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await dialogo.locator('[data-mcp-candidate]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const candidatos = await dialogo.locator('[data-mcp-candidate]').evaluateAll((nodos) => nodos.map((n) => n.getAttribute('data-mcp-candidate')));
      const secretoEnDom = await page.evaluate((secreto) => document.documentElement.outerHTML.includes(secreto), SEEDED_MCP_SECRET);
      await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const sinCambios = fs.readFileSync(fichero, 'utf-8') === antes;
      const ok = candidatos.includes(SEEDED_MCP_ACCOUNT_SERVER) && candidatos.includes(SEEDED_MCP_DESKTOP_SERVER) && !secretoEnDom && sinCambios;
      return { ok, detail: `candidatos=${JSON.stringify(candidatos)} secretoEnDom=${secretoEnDom} sinCambios=${sinCambios}` };
    },
  },
  {
    // 0.1.1 R2, punto 18: «Autenticar» en un MCP que pide OAuth. Con MAGE_MCP_FAKE_CLI=1 main contesta con
    // un CLI FALSO en proceso (config/mcpFakeCli.ts): `vg-auth` sale en `needs-auth` en cada cuenta con
    // login, `mcp_authenticate` da una URL falsa que NO se abre y el «callback» llega a los 1,5 s. Se mide
    // la secuencia visible: boton → «Autenticando…» → mensaje de conectado y el boton de esa cuenta fuera.
    // Nunca hay OAuth real ni se spawnea el CLI. Configuracion se deja abierta, como llego.
    name: '18: «Autenticar» un MCP que pide OAuth pasa por «Autenticando…» y acaba conectado (CLI falso)',
    async run(page) {
      const seccion = page.locator('[data-mcp-section]');
      await seccion.getByRole('button', { name: 'Comprobar estado', exact: true }).click();
      const fila = page.locator(`[data-mcp-row="${FAKE_MCP_AUTH_SERVER}"]`);
      try {
        await fila.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      } catch {
        const cuentas = await page.evaluate(() => (window.__mageDev?.store.getState().accounts ?? []).filter((a) => a.loginStatus === 'logged_in').length);
        if (cuentas === 0) return { ok: true, detail: 'ninguna cuenta con login: no hay CLI (falso) que sondear, no aplicable' };
        return { ok: false, detail: `con ${cuentas} cuentas con login no aparece la fila ${FAKE_MCP_AUTH_SERVER}` };
      }
      const estadoAntes = await fila.locator('[data-mcp-status]').innerText();
      const botones = fila.getByRole('button', { name: new RegExp(`^Autenticar ${FAKE_MCP_AUTH_SERVER} en `) });
      const antes = await botones.count();
      const boton = botones.first();
      const etiqueta = await boton.getAttribute('aria-label');
      await boton.click();
      const vioAutenticando = await fila.getByText('Autenticando…').waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs }).then(() => true, () => false);
      const mensaje = fila.locator('[data-mcp-auth-message]');
      await mensaje.first().waitFor({ state: 'visible', timeout: 15_000 });
      const texto = await mensaje.first().innerText();
      const despues = await botones.count();
      const sigueSuBoton = (await fila.getByRole('button', { name: etiqueta, exact: true }).count()) > 0;
      const ok = estadoAntes.includes('Requiere autenticación') && antes >= 1 && vioAutenticando && /Autenticado/.test(texto) && despues === antes - 1 && !sigueSuBoton;
      return { ok, detail: `estadoAntes=«${estadoAntes}» botones ${antes}→${despues} autenticando=${vioAutenticando} mensaje=«${texto}»` };
    },
  },
  {
    // 0.1.2 grupo C: «MCP y conectores» con tres pestañas, como Claude Desktop. En Servidores, la columna
    // «Proveedores» (un comun local llega a Claude, Codex y locales; a agy solo si se sincroniza) y lo
    // propio de agy con su insignia «Solo agy» (mcp_config.json FALSO de MAGE_MCP_FAKE_SOURCES). Los
    // conectores de claude.ai ya no salen aqui. Se deja en Servidores, como llego.
    name: 'MCP y conectores: tres pestañas, columna Proveedores y «Solo agy» en Servidores',
    async run(page) {
      if ((await page.locator(MODAL).count()) === 0) await openSettingsDialog(page);
      if ((await page.locator('[data-mcp-section]').count()) === 0) await openSection(page, /MCP y conectores/);
      await page.locator('[data-mcp-tab="servers"]').click();
      await page.locator(`[data-mcp-row="${SEEDED_AGY_SERVER}"]`).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const medida = await page.evaluate(
        ({ local, agy, conector }) => ({
          pestañas: [...document.querySelectorAll('[data-mcp-tab]')].map((t) => t.getAttribute('data-mcp-tab')),
          pastillasLocal: document.querySelector(`[data-mcp-providers="${local}"]`)?.textContent ?? null,
          filaAgy: document.querySelector(`[data-mcp-row="${agy}"]`)?.textContent ?? '',
          conectorEnServidores: document.querySelector(`[data-mcp-row="${conector}"]`) !== null,
        }),
        { local: SEEDED_MCP_LOCAL, agy: SEEDED_AGY_SERVER, conector: FAKE_MCP_CONNECTOR },
      );
      const ok =
        JSON.stringify(medida.pestañas) === JSON.stringify(['servers', 'connectors', 'extensions']) &&
        medida.pastillasLocal === 'ClaudeCodexLocales' &&
        medida.filaAgy.includes('Solo agy') &&
        !medida.conectorEnServidores;
      return { ok, detail: JSON.stringify(medida) };
    },
  },
  {
    // C3-e…h: Conectores por cuenta con el ULTIMO estado guardado (lo dejo la comprobacion anterior de
    // «Autenticar» con el CLI falso) y su fecha, «Conectar» en el que pide autorizacion, «Claude in
    // Chrome» como solo de Desktop, Codex «sin verificar» y el interruptor de claude.ai, que se guarda
    // en los ajustes del perfil aislado y se repone. Se deja en Servidores.
    name: 'MCP y conectores: Conectores con último estado y fecha, «Conectar», Claude in Chrome y el interruptor de claude.ai',
    async run(page, { userDataDir }) {
      await page.locator('[data-mcp-tab="connectors"]').click();
      // Autosuficiente: sondea con el CLI falso (el ultimo estado queda guardado con su fecha).
      const sondear = page.locator('[data-mcp-connectors]').getByRole('button', { name: /Comprobar estado|Comprobando/ });
      await sondear.click();
      // Hecho cuando alguna cuenta con login tiene fecha de «hace un momento». Sin cuentas con login el
      // CLI falso no se sondea: no hay grupo con fecha y se mide el primero.
      const conLogin = await page.evaluate(() => (window.__mageDev?.store.getState().accounts ?? []).filter((a) => a.loginStatus === 'logged_in').length);
      if (conLogin > 0) {
        await page.waitForFunction(
          () => [...document.querySelectorAll('[data-mcp-connector-group] [data-mcp-checked-at]')].some((f) => (f.textContent ?? '').includes('hace un momento')),
          null,
          { timeout: 30_000 },
        );
      }
      const recien = page.locator('[data-mcp-connector-group]').filter({ has: page.locator('[data-mcp-checked-at]', { hasText: 'hace un momento' }) });
      const grupo = (await recien.count()) > 0 ? recien.first() : page.locator('[data-mcp-connector-group]').first();
      if ((await grupo.count()) === 0) {
        await page.locator('[data-mcp-tab="servers"]').click();
        return { ok: true, detail: 'sin cuentas de Claude: no hay grupos de conectores, no aplicable' };
      }
      const cuenta = await grupo.getAttribute('data-mcp-connector-group');
      const conector = grupo.locator(`[data-mcp-connector="${FAKE_MCP_CONNECTOR_NAME}"]`);
      const hayConector = (await conector.count()) === 1;
      const conectar = hayConector ? await conector.getByRole('button', { name: /^Autenticar / }).count() : 0;
      const fecha = await grupo.locator('[data-mcp-checked-at]').innerText();
      const chrome = await grupo.locator('[data-mcp-connector="Claude in Chrome"]').innerText();
      const codex = await page.locator('[data-mcp-codex-apps]').innerText();
      const interruptor = grupo.getByRole('checkbox', { name: /^Usar los conectores de claude\.ai en / });
      await interruptor.uncheck();
      const ajustes = path.join(userDataDir, 'app-settings.json');
      const apagado = await waitForFile(ajustes, (t) => (JSON.parse(t).claudeAiConnectorsOff ?? []).includes(cuenta));
      const guardado = apagado !== null && (JSON.parse(apagado).claudeAiConnectorsOff ?? []).includes(cuenta);
      const etiquetaApagado = hayConector ? await conector.locator('[data-mcp-status]').innerText() : '';
      await interruptor.check();
      const repuesto = await waitForFile(ajustes, (t) => !(JSON.parse(t).claudeAiConnectorsOff ?? []).includes(cuenta));
      await page.locator('[data-mcp-tab="servers"]').click();
      const ok =
        (!hayConector || (conectar === 1 && etiquetaApagado === 'Apagados en esta cuenta')) &&
        /Última comprobación/.test(fecha) === hayConector &&
        chrome.includes('Solo disponible en Claude Desktop') &&
        codex.includes('sin verificar') &&
        guardado &&
        repuesto !== null &&
        !(JSON.parse(repuesto).claudeAiConnectorsOff ?? []).includes(cuenta);
      return { ok, detail: `conector=${hayConector} conectar=${conectar} fecha=«${fecha}» apagado=«${etiquetaApagado}» guardado=${guardado} chrome=${chrome.includes('Solo disponible')} codex=${codex.includes('sin verificar')}` };
    },
  },
  {
    // C3-a…d: la extension sembrada pide configurar; el valor sensible sube UNA vez a la boveda (cifrado)
    // y no vuelve al DOM ni queda en extensions-settings/; «Importar de Claude Desktop» COPIA la de la
    // carpeta falsa a la de Mage, y se desinstala para dejarlo como estaba. Se deja en Servidores.
    name: 'MCP y conectores: Extensiones, el secreto va a la bóveda y no vuelve; importar de Desktop copia y se desinstala',
    async run(page, { userDataDir }) {
      await page.locator('[data-mcp-tab="extensions"]').click();
      const tarjeta = page.locator(`[data-mcp-extension="${SEEDED_EXTENSION}"]`);
      await tarjeta.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const pideConfigurar = (await tarjeta.locator('[data-mcp-extension-problem]').innerText()).includes('Falta configurar');
      const dialogo = page.locator('[data-mcp-extension-config]');
      await tarjeta.getByRole('button', { name: 'Ajustes', exact: true }).click();
      await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await dialogo.getByLabel('Clave API').fill(SEEDED_EXTENSION_SECRET);
      await dialogo.getByRole('button', { name: 'Guardar', exact: true }).click();
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      await tarjeta.locator('[data-mcp-extension-problem]').waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs }).catch(() => undefined);
      const configurada = (await tarjeta.locator('[data-mcp-extension-problem]').count()) === 0;
      await tarjeta.getByRole('button', { name: 'Ajustes', exact: true }).click();
      await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const reabierto = await page.evaluate((secreto) => ({
        enDom: document.documentElement.outerHTML.includes(secreto) || [...document.querySelectorAll('input')].some((i) => i.value.includes(secreto)),
        guardado: document.querySelector('[data-mcp-extension-config] input[type="password"]')?.getAttribute('placeholder') ?? '',
      }), SEEDED_EXTENSION_SECRET);
      await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const enAjustes = (readIfExists(path.join(userDataDir, 'extensions-settings', `${SEEDED_EXTENSION}.json`)) ?? '').includes(SEEDED_EXTENSION_SECRET);
      const enBoveda = (readIfExists(path.join(userDataDir, 'secrets.json')) ?? '').includes(SEEDED_EXTENSION_SECRET);
      const candidato = page.locator(`[data-mcp-desktop-candidate="${SEEDED_DESKTOP_EXTENSION_DIR}"]`);
      await candidato.getByRole('button', { name: 'Importar', exact: true }).click();
      const importada = page.locator(`[data-mcp-extension="${SEEDED_DESKTOP_EXTENSION}"]`);
      await importada.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const copiada = fs.existsSync(path.join(userDataDir, 'extensions', SEEDED_DESKTOP_EXTENSION, 'manifest.json'));
      await importada.getByRole('button', { name: /^Desinstalar / }).click();
      await importada.getByRole('button', { name: '¿Desinstalar?', exact: true }).click();
      await importada.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const limpia = !fs.existsSync(path.join(userDataDir, 'extensions', SEEDED_DESKTOP_EXTENSION));
      await page.locator('[data-mcp-tab="servers"]').click();
      const ok = pideConfigurar && configurada && !reabierto.enDom && reabierto.guardado.includes('guardado') && !enAjustes && !enBoveda && copiada && limpia;
      return { ok, detail: `pideConfigurar=${pideConfigurar} configurada=${configurada} secretoEnDom=${reabierto.enDom} placeholder=«${reabierto.guardado}» enAjustes=${enAjustes} enClaroEnBoveda=${enBoveda} copiada=${copiada} desinstalada=${limpia}` };
    },
  },
  {
    // C3-j: «Sincronizar con agy» enseña el cambio ANTES de escribir, y al aplicar escribe en el
    // mcp_config.json FALSO solo lo de Mage (lo del usuario se queda), con copia previa en la carpeta de
    // Mage. Despues, los comunes llevan la pastilla agy con su nota de copia. Va la ultima de las de MCP:
    // deja el fichero falso de agy sincronizado.
    name: 'MCP y conectores: «Sincronizar con agy» enseña el cambio y escribe solo lo de Mage, con copia previa',
    async run(page, { userDataDir }) {
      const fichero = path.join(mcpFakeSourcesDir(userDataDir), 'agy', 'mcp_config.json');
      const dialogo = page.locator('[data-mcp-agy-dialog]');
      await page.locator('[data-mcp-agy-sync]').getByRole('button', { name: 'Sincronizar con agy', exact: true }).click();
      await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const cambios = await dialogo.locator('[data-mcp-agy-change="add"]').allInnerTexts();
      const antes = fs.readFileSync(fichero, 'utf-8');
      await dialogo.getByRole('button', { name: 'Aplicar', exact: true }).click();
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const texto = fs.readFileSync(fichero, 'utf-8');
      const despues = JSON.parse(texto).mcpServers ?? {};
      // El valor de la boveda de la extension (comprobacion anterior) no se copia sin confirmarlo.
      const secretoEnAgy = texto.includes(SEEDED_EXTENSION_SECRET);
      const copias = fs.existsSync(path.join(userDataDir, 'agy-backups')) ? fs.readdirSync(path.join(userDataDir, 'agy-backups')).length : 0;
      await page.locator(`[data-mcp-providers="${SEEDED_MCP_LOCAL}"]`).getByText('agy').waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs }).catch(() => undefined);
      const pastillas = (await page.locator(`[data-mcp-providers="${SEEDED_MCP_LOCAL}"]`).innerText()).replace(/\s+/g, '');
      const ok =
        cambios.some((t) => t.includes(SEEDED_MCP_LOCAL)) &&
        antes.includes(SEEDED_AGY_SERVER) &&
        Object.hasOwn(despues, SEEDED_AGY_SERVER) &&
        Object.hasOwn(despues, SEEDED_MCP_LOCAL) &&
        copias === 1 &&
        !secretoEnAgy &&
        pastillas.includes('agy');
      return { ok, detail: `añade=${JSON.stringify(cambios)} enAgy=${JSON.stringify(Object.keys(despues))} copias=${copias} secretoEnAgy=${secretoEnAgy} pastillas=${pastillas}` };
    },
  },
  {
    // M2.3 / Ronda 3 item 4: las reglas de notificacion son regex del usuario, o sea una FRONTERA. Se mide
    // que una regex rota se rechaza con motivo (y no revienta la pantalla) y que el banco de pruebas usa
    // el mismo compilador que el matcher real: mismo patron, un texto que casa y otro que no.
    name: 'Notificaciones: regex invalida con motivo y banco de pruebas que acierta',
    async run(page) {
      await openSection(page, /Notificaciones/);
      const add = page.getByRole('button', { name: /Añadir regla/ });
      await add.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const before = await notificationRuleRows(page).count();
      await add.click();
      await page.waitForTimeout(CONFIG.settleMs);
      const pattern = page.getByRole('textbox', { name: 'Patrón (expresión regular)' }).last();
      await pattern.fill('deploy (ok');
      await page.waitForTimeout(CONFIG.settleMs);
      const brokenReason = await patternErrorText(page);
      await pattern.fill('deploy (ok|listo)');
      await page.waitForTimeout(CONFIG.settleMs);
      const fixedReason = await patternErrorText(page);
      const matches = await probeVerdict(page, 'el deploy ok por fin');
      const misses = await probeVerdict(page, 'nada que ver');
      // Limpieza: la regla se guarda en el app-settings.json del perfil aislado, y una regla con un
      // patron de prueba cambiaria lo que miden las comprobaciones siguientes.
      const remove = page.getByRole('button', { name: 'Eliminar regla', exact: true });
      if ((await remove.count()) === 1) await remove.click();
      await page.waitForTimeout(CONFIG.settleMs);
      const after = await notificationRuleRows(page).count();
      // El dialogo se deja ABIERTO a proposito: las dos comprobaciones siguientes son de dentro.
      const ok =
        before === 0 &&
        typeof brokenReason === 'string' &&
        brokenReason.length > 0 &&
        fixedReason === null &&
        matches === '✓ notificaría' &&
        misses === '✗ no casa' &&
        after === 0;
      return {
        ok,
        detail: `reglas ${before}->${after} motivo con "deploy (ok"=${JSON.stringify(brokenReason)} tras arreglarla=${JSON.stringify(fixedReason)} prueba que casa=${JSON.stringify(matches)} que no casa=${JSON.stringify(misses)}`,
      };
    },
  },
  {
    // Accesibilidad (M3): el nav de secciones declara role="tablist", asi que DEBE moverse con flechas.
    // La comprobacion exige que el foco CAMBIE: una version anterior solo miraba que hubiera foco, y
    // pasaba en falso mientras las flechas no hacian nada.
    name: 'Accesibilidad: el tablist de Configuracion responde a flechas',
    async run(page) {
      const tabs = page.getByRole('tab');
      const count = await tabs.count();
      // Se enfoca la pestaña SELECCIONADA, no la primera: con roving tabindex solo la seleccionada
      // tiene tabIndex=0, asi que es la unica a la que el usuario puede llegar tabulando. Enfocar otra
      // crea un estado que la app nunca produce (y hacia fallar esta comprobacion por un motivo falso).
      await page.locator('[role="tab"][aria-selected="true"]').first().focus();
      const before = await focusedTabLabel(page);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      const afterDown = await focusedTabLabel(page);
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(150);
      const afterUp = await focusedTabLabel(page);
      const ok = count >= 6 && afterDown !== before && afterUp === before;
      return { ok, detail: `pestañas=${count} inicio=${JSON.stringify(before)} ArrowDown=${JSON.stringify(afterDown)} ArrowUp=${JSON.stringify(afterUp)}` };
    },
  },
  {
    // Accesibilidad (M3): "que el foco sea siempre visible" seguia siendo manual. La regla de index.css
    // repone el anillo SOLO con :focus-visible (no con el raton), asi que la medida correcta es
    // `matches(':focus-visible')` MAS el outline calculado: comprobar solo el outline pasaria en verde con
    // un outline heredado, y comprobar solo el pseudo-selector pasaria si la regla CSS desapareciera.
    // Llega justo despues del check de flechas, que ya dejo a Chromium en modalidad de teclado.
    name: 'Accesibilidad: el foco por teclado pinta el anillo visible',
    async run(page) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(CONFIG.settleMs);
      const measured = await page.evaluate(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) return null;
        const styles = getComputedStyle(active);
        return {
          element: `${active.tagName.toLowerCase()}${active.getAttribute('role') === null ? '' : `[role=${active.getAttribute('role')}]`}`,
          focusVisible: active.matches(':focus-visible'),
          outlineWidth: styles.outlineWidth,
          outlineStyle: styles.outlineStyle,
          outlineColor: styles.outlineColor,
          ring: getComputedStyle(document.documentElement).getPropertyValue('--color-mg-focus-ring').trim(),
        };
      });
      const ok =
        measured !== null &&
        measured.focusVisible &&
        measured.outlineStyle === 'solid' &&
        parseFloat(measured.outlineWidth) >= 2 &&
        measured.ring.length > 0;
      return { ok, detail: `foco=${JSON.stringify(measured)}` };
    },
  },
  {
    // A3 de la checklist: "Widget flotante: activarlo en Configuracion". Se mide que aparece una
    // VENTANA nueva (widget.html), no solo que la casilla queda marcada.
    name: 'Widget flotante: activarlo abre su ventana y desactivarlo la cierra',
    async run(page) {
      await openSection(page, /Widget flotante/);
      const toggle = page.getByRole('checkbox');
      await toggle.first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const before = countWidgetPages(page);
      await toggle.first().check();
      const opened = await waitForWidgetPages(page, 1);
      await toggle.first().uncheck();
      const closed = await waitForWidgetPages(page, 0);
      const ok = before === 0 && opened && closed;
      return { ok, detail: `ventanas widget: inicio=${before} tras activar=${opened ? 1 : 'ninguna'} tras desactivar=${closed ? 0 : 'sigue abierta'}` };
    },
  },
  {
    name: 'Escape cierra el dialogo',
    async run(page) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const count = await page.locator(MODAL).count();
      return { ok: count === 0, detail: `dialogos tras Escape=${count}` };
    },
  },
  {
    // F6 Fase 4: el resize de una zona del dock tambien va por teclado. Se mide `aria-valuenow` (el
    // tamaño REAL que la zona acaba de guardar), no la posicion del raton: un arrastre simulado mide el
    // gesto, este numero mide el efecto. Se devuelve el valor a su sitio con la flecha contraria, porque
    // el tamaño se persiste en panels-layout.json y no queremos arrastrar estado entre comprobaciones.
    name: 'F6: el separador del dock se redimensiona con el teclado',
    async run(page) {
      const separators = page.locator('[role="separator"][aria-valuenow]');
      const total = await separators.count();
      if (total === 0) return { ok: false, detail: 'no hay ningun separador de zona montado' };
      const handle = separators.first();
      const orientation = await handle.getAttribute('aria-orientation');
      // El caller solo escucha el par de flechas de SU orientacion (ver ZoneResizeHandle).
      const [grow, shrink] = orientation === 'vertical' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp'];
      const before = await separatorValue(handle);
      await handle.focus();
      await page.keyboard.press(grow);
      await page.waitForTimeout(CONFIG.settleMs);
      const moved = await separatorValue(handle);
      await page.keyboard.press(shrink);
      await page.waitForTimeout(CONFIG.settleMs);
      const restored = await separatorValue(handle);
      const ok = before !== null && moved !== null && moved !== before && restored === before;
      return {
        ok,
        detail: `separadores=${total} orientacion=${orientation} aria-valuenow ${before} --${grow}--> ${moved} --${shrink}--> ${restored}`,
      };
    },
  },
  // --- E2: proveedores arbitrarios configurables --------------------------------------------------
  //
  // Estas cuatro llegan con el DOM SIN dialogos (justo despues de "Escape cierra el dialogo") y cada una
  // abre y cierra lo que necesita, para poder leerse (y reordenarse) por separado.
  {
    // Asistente de primer arranque (2026-09-20). Se mide el CICLO COMPLETO: reabrirlo, recorrer los
    // tres pasos, comprobar que el paso del aspecto APLICA de verdad (la escala cambia el zoom del
    // frame, que es lo unico que demuestra que el deslizador no es decorativo) y que al terminar no
    // vuelve a salir. Un check de "aparece el modal" pasaria con un asistente que no hace nada.
    //
    // Deja el perfil como lo encontro: el asistente completado y la escala al 100 %.
    name: 'Setup: el asistente de primer arranque guia, aplica y no vuelve a salir',
    async run(page) {
      const zoomInicial = await page.evaluate(() => window.__mageDev?.store.getState().settings.uiScale ?? null);
      await page.evaluate(() => window.__mageDev?.store.getState().setOnboardingCompleted(false));
      await page.locator('[data-onboarding="overlay"]').waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });

      // Paso 1: el motor. El sondeo es real (mismo `probeProvider` que Configuracion), asi que se
      // espera a que responda algo — instalado o no, las dos respuestas son validas en una maquina
      // cualquiera; lo que no vale es quedarse en "comprobando".
      const motor = await waitForEngineStatus(page);
      await page.locator('[data-onboarding="next"]').click();

      // Paso 2: escala. Se mueve el deslizador con el teclado y se comprueba el zoom REAL del frame.
      const escala = page.getByLabel('Escala de la interfaz');
      await escala.focus();
      await escala.press('ArrowRight');
      await page.waitForTimeout(CONFIG.settleMs);
      const aplicado = await page.evaluate(() => ({
        ajuste: window.__mageDev?.store.getState().settings.uiScale ?? null,
        // `devicePixelRatio` cambia con el zoom del frame: es la medida del navegador, no la del store.
        zoomAplicado: Math.round(window.devicePixelRatio * 1000) / 1000,
      }));
      await page.locator('[data-onboarding="next"]').click();

      // Paso 3: los atajos que se enseñan, resueltos del catalogo real.
      const atajos = await page.evaluate(() => {
        const filas = [...document.querySelectorAll('[data-onboarding="shortcuts"] kbd')];
        return { filas: filas.length, primero: filas[0]?.textContent?.trim() ?? '' };
      });
      await page.locator('[data-onboarding="next"]').click();
      await page.locator('[data-onboarding="overlay"]').waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });

      // Y no vuelve: se remonta el arbol (cambiando de pestaña activa no basta) leyendo el ajuste.
      const tras = await page.evaluate(() => ({
        completado: window.__mageDev?.store.getState().settings.onboardingCompletedVersion ?? 0,
        overlays: document.querySelectorAll('[data-onboarding="overlay"]').length,
      }));
      // Restaurar la escala para las comprobaciones siguientes (miden pixeles).
      await page.evaluate((valor) => window.__mageDev?.store.getState().setUiScale(valor ?? 100), zoomInicial);
      await page.waitForTimeout(CONFIG.settleMs);

      const ok =
        motor !== null &&
        (motor.instalado || motor.conComando) && // o esta, o se dice como instalarlo: nunca un hueco
        aplicado.ajuste === (zoomInicial ?? 100) + 10 &&
        aplicado.zoomAplicado > 1 && // el zoom del frame se movio de verdad
        atajos.filas === 6 &&
        atajos.primero.length > 0 &&
        tras.completado >= 1 &&
        tras.overlays === 0;
      return { ok, detail: `motor=${JSON.stringify(motor)} escala=${JSON.stringify(aplicado)} atajos=${JSON.stringify(atajos)} tras terminar=${JSON.stringify(tras)}` };
    },
  },
  {
    // B.2/B.3 de la revision de licencias de terceros: la pantalla «Acerca de» es donde Mage cumple lo que
    // exigen las licencias de sus dependencias — conservar su aviso de copyright — porque el bundle
    // minificado los borra. Se mide el TEXTO de una licencia real, no que la seccion exista: un panel
    // con el titulo y el hueco vacio es exactamente el fallo que esto viene a cazar.
    name: 'B.2: «Acerca de» enseña los avisos de terceros con su copyright',
    async run(page) {
      await openSettingsDialog(page);
      await openSection(page, /Acerca de/);
      const medido = await waitForNotices(page);
      const closed = await closeDialog(page);
      const ok =
        medido !== null &&
        medido.conClausulaMit && // el texto literal de la MIT, no un resumen
        medido.conCopyright &&
        medido.paquetes >= 50 && // la revision conto 85; por debajo de 50 algo se quedo por el camino
        medido.versiones &&
        closed === 0;
      return { ok, detail: `${JSON.stringify(medido)} dialogos al cerrar=${closed}` };
    },
  },
  {
    // Mage no asume que el usuario tenga ninguna IA local: de serie la lista esta VACIA y Ollama/LM
    // Studio son solo plantillas del formulario. Se mide el numero de filas guardadas (0) y que las dos
    // plantillas existen; "hay algo en la seccion" no distinguiria una lista vacia de una precargada.
    name: 'E2: la seccion Proveedores carga y arranca sin proveedores',
    async run(page) {
      await openSettingsDialog(page);
      await openSection(page, /Proveedores/);
      const rows = await providerRows(page).count();
      const templates = [];
      for (const label of PROVIDER_TEMPLATE_LABELS) {
        templates.push(await page.getByRole('button', { name: label, exact: true }).count());
      }
      const addButton = await page.getByRole('button', { name: /Añadir proveedor/ }).count();
      const closed = await closeDialog(page);
      const ok = rows === 0 && templates.every((count) => count === 1) && addButton === 1 && closed === 0;
      return {
        ok,
        detail: `filas guardadas=${rows} plantillas ${JSON.stringify(PROVIDER_TEMPLATE_LABELS)}=${JSON.stringify(templates)} boton anadir=${addButton} dialogos al cerrar=${closed}`,
      };
    },
  },
  {
    // Los tres rechazos con MOTIVO. Sin ellos se guardaria basura que solo falla en el primer turno:
    // sin nombre, URL sin esquema (`localhost:11434`, que `new URL` lee como protocolo "localhost:") y
    // sin ningun modelo (un proveedor sin modelos no puede abrir conversacion). Se mide el texto exacto
    // del motivo Y que la lista sigue con 0 filas: un formulario que avisa pero guarda seria peor.
    name: 'E2: el formulario rechaza nombre vacio, URL sin esquema y sin modelos',
    async run(page) {
      await openSettingsDialog(page);
      await openSection(page, /Proveedores/);
      await page.getByRole('button', { name: /Añadir proveedor/ }).click();
      const reasons = [
        await submitNewProvider(page, { label: '', baseUrl: '', models: '' }),
        await submitNewProvider(page, { label: 'Prueba', baseUrl: 'localhost:11434', models: 'llama3' }),
        await submitNewProvider(page, { label: 'Prueba', baseUrl: OLLAMA_TEMPLATE.baseUrl, models: '' }),
      ];
      const rows = await providerRows(page).count();
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      // Donde queda el foco tras "Cancelar": su boton se DESMONTA con el formulario, asi que Chromium lo
      // manda a <body>, FUERA del panel. Se mide porque de aqui salio un bug real —el modal se quedaba
      // sin Escape— y el `closed === 0` de abajo es lo que lo detecta (ver useDialogA11y.ts).
      const focusAfterCancel = await page.evaluate((modal) => {
        const active = document.activeElement;
        const inside = active !== null && document.querySelector(modal)?.contains(active) === true;
        return `${active?.tagName.toLowerCase() ?? 'ninguno'} (${inside ? 'dentro' : 'fuera'} del modal)`;
      }, MODAL);
      const closed = await closeDialog(page);
      const ok =
        rows === 0 &&
        closed === 0 &&
        /nombre/i.test(reasons[0] ?? '') &&
        (reasons[1] ?? '').includes('"localhost:11434"') &&
        /http/i.test(reasons[1] ?? '') &&
        /al menos un modelo/i.test(reasons[2] ?? '');
      return {
        ok,
        detail: `motivos=${JSON.stringify(reasons)} filas guardadas=${rows} foco tras Cancelar=${focusAfterCancel} dialogos tras Escape=${closed}`,
      };
    },
  },
  {
    // La plantilla PRERRELLENA (no guarda) y "Añadir" guarda. Se mide el resumen de la fila (URL y nº de
    // modelos, que es lo que prueba que se guardo el proveedor entero y no solo su nombre) y que aparece
    // un selector NUEVO en "🧠 Modelos" — comparando la lista de antes con la de despues, no un conteo
    // fijo: los proveedores de serie pueden cambiar sin que eso rompa esta comprobacion.
    name: 'E2: la plantilla de Ollama anade el proveedor y sale en Modelos',
    async run(page) {
      await openSettingsDialog(page);
      const modelsBefore = await modelSelectorLabels(page);
      await openSection(page, /Proveedores/);
      await page.getByRole('button', { name: OLLAMA_TEMPLATE.label, exact: true }).click();
      const prefilled = await readProviderForm(page);
      await page.getByRole('button', { name: 'Añadir', exact: true }).click();
      await page.waitForTimeout(CONFIG.settleMs);
      const rows = await providerRows(page).count();
      const summary = await providerRowSummary(page, OLLAMA_TEMPLATE.label);
      const modelsAfter = await modelSelectorLabels(page);
      const closed = await closeDialog(page);
      const added = modelsAfter.filter((label) => !modelsBefore.includes(label));
      const ok =
        prefilled.label === OLLAMA_TEMPLATE.label &&
        prefilled.baseUrl === OLLAMA_TEMPLATE.baseUrl &&
        prefilled.models === OLLAMA_TEMPLATE.models &&
        rows === 1 &&
        summary !== null &&
        summary.includes(OLLAMA_TEMPLATE.baseUrl) &&
        // La ficha nueva (2026-09-18) ya no imprime "N modelos" en su resumen: los modelos viven en su
        // propio selector, y eso es justo lo que comprueba `added` un par de lineas mas abajo. Lo que
        // SI tiene que decir la ficha es de que CLASE es el proveedor, que es lo que distingue un CLI
        // local de un endpoint HTTP.
        summary.includes('API compatible con OpenAI') &&
        added.length === 1 &&
        added[0] === `Modelo por defecto de ${OLLAMA_TEMPLATE.label}` &&
        closed === 0;
      return {
        ok,
        detail: `plantilla=${JSON.stringify(prefilled)} filas=${rows} resumen=${JSON.stringify(summary)} selectores de Modelos ${modelsBefore.length}->${modelsAfter.length} nuevos=${JSON.stringify(added)}`,
      };
    },
  },
  {
    // Tercer sitio donde tiene que aparecer: el selector de proveedor de "Nueva conversacion". Se abre y
    // se CIERRA con Escape (no crea ninguna pestaña, no spawnea nada).
    name: 'E2: el proveedor anadido aparece en el selector de Nueva conversacion',
    async run(page) {
      const options = await withNewTabDialog(page, (dialogPage) => selectOptionsOf(dialogPage, NEW_TAB_FIELD.provider));
      const ok = options !== null && options.some((option) => option.endsWith(`|${OLLAMA_TEMPLATE.label}`));
      return { ok, detail: `opciones de proveedor=${JSON.stringify(options)}` };
    },
  },
  {
    // Y el ciclo completo: borrarlo lo quita de los TRES sitios. Antes de clicar se comprueba que hay
    // exactamente 1 boton de borrado con ese nombre (regla de la skill: si esperas 1 y hay otra cosa, no
    // se clica).
    name: 'E2: borrar el proveedor lo quita de la lista, de Modelos y de Nueva conversacion',
    async run(page) {
      await openSettingsDialog(page);
      await openSection(page, /Proveedores/);
      const remove = page.getByRole('button', { name: `Eliminar el proveedor ${OLLAMA_TEMPLATE.label}` });
      const targets = await remove.count();
      if (targets === 1) await remove.click();
      await page.waitForTimeout(CONFIG.settleMs);
      const rows = await providerRows(page).count();
      const models = await modelSelectorLabels(page);
      const closed = await closeDialog(page);
      const options = await withNewTabDialog(page, (dialogPage) => selectOptionsOf(dialogPage, NEW_TAB_FIELD.provider));
      const inModels = models.includes(`Modelo por defecto de ${OLLAMA_TEMPLATE.label}`);
      const inNewTab = options !== null && options.some((option) => option.endsWith(`|${OLLAMA_TEMPLATE.label}`));
      const ok = targets === 1 && rows === 0 && !inModels && !inNewTab && closed === 0;
      return {
        ok,
        detail: `botones de borrado=${targets} filas tras borrar=${rows} sigue en Modelos=${inModels} sigue en Nueva conversacion=${inNewTab} opciones=${JSON.stringify(options)}`,
      };
    },
  },
  {
    // Grupo 0 (0.1.2): la api key de un proveedor del usuario sube UNA vez a main, se cifra en la boveda
    // (`secrets.json`, safeStorage) y no vuelve: ni en el estado del renderer, ni en `SettingsLoad`, ni
    // en `app-settings.json`. Se mide con un centinela en los cuatro sitios, que al editar el campo sale
    // vacio con el aviso de «clave guardada», y que borrar el proveedor borra tambien su secreto.
    // Autosuficiente: añade su proveedor y lo borra; llega y se va sin dialogo abierto.
    name: 'Grupo 0: la clave del proveedor se cifra en main y no vuelve al renderer',
    async run(page, { userDataDir }) {
      await openSettingsDialog(page);
      await openSection(page, /Proveedores/);
      await page.getByRole('button', { name: /Añadir proveedor/ }).click();
      await page.getByRole('textbox', { name: 'Nombre del proveedor' }).fill(SECRET_PROVIDER.label);
      await page.getByRole('textbox', { name: 'URL base del endpoint compatible con la API de OpenAI' }).fill(SECRET_PROVIDER.baseUrl);
      await page.getByRole('textbox', { name: 'Modelos del proveedor, separados por comas' }).fill('vg');
      await page.getByLabel('API key del proveedor (opcional)').fill(SECRET_PROVIDER.key);
      await page.getByRole('button', { name: 'Añadir', exact: true }).click();
      await page.getByRole('button', { name: `Eliminar el proveedor ${SECRET_PROVIDER.label}` }).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const settingsFile = path.join(userDataDir, 'app-settings.json');
      const secretsFile = path.join(userDataDir, 'secrets.json');
      // Los ajustes se guardan con debounce: `SettingsLoad` solo sabe del proveedor cuando ha llegado a disco.
      const persisted = await waitForFile(settingsFile, (text) => text.includes(SECRET_PROVIDER.baseUrl));
      const renderer = await page.evaluate(async (label) => {
        const own = window.__mageDev.store.getState().settings.customProviders.find((p) => p.label === label) ?? null;
        const loaded = await window.mage.loadSettings();
        return { own, loaded: JSON.stringify(loaded), loadedFlag: loaded.customProviders.find((p) => p.label === label)?.hasApiKey ?? null };
      }, SECRET_PROVIDER.label);
      const secretId = `provider-api-key:${renderer.own?.id ?? '?'}`;
      const vault = readIfExists(secretsFile);
      const modal = page.locator(MODAL).first();
      await modal.getByRole('button', { name: 'Editar', exact: true }).click();
      const keyField = modal.getByLabel('API key del proveedor (opcional)');
      const editField = { value: await keyField.inputValue(), placeholder: await keyField.getAttribute('placeholder') };
      await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await page.getByRole('button', { name: `Eliminar el proveedor ${SECRET_PROVIDER.label}` }).click();
      const vaultAfter = await waitForFile(secretsFile, (text) => !text.includes(secretId));
      const closed = await closeDialog(page);
      const measured = {
        hasApiKeyEnElStore: renderer.own?.hasApiKey ?? null,
        campoApiKeyEnElStore: renderer.own !== null && 'apiKey' in renderer.own,
        hasApiKeyEnSettingsLoad: renderer.loadedFlag,
        centinelaEnSettingsLoad: renderer.loaded.includes(SECRET_PROVIDER.key),
        centinelaEnAppSettings: persisted?.includes(SECRET_PROVIDER.key) ?? null,
        secretoEnBoveda: vault?.includes(secretId) ?? false,
        centinelaEnClaroEnBoveda: vault?.includes(SECRET_PROVIDER.key) ?? null,
        campoAlEditar: editField,
        secretoTrasBorrar: vaultAfter?.includes(secretId) ?? null,
        dialogosAlCerrar: closed,
      };
      const ok =
        measured.hasApiKeyEnElStore === true &&
        !measured.campoApiKeyEnElStore &&
        measured.hasApiKeyEnSettingsLoad === true &&
        !measured.centinelaEnSettingsLoad &&
        measured.centinelaEnAppSettings === false &&
        measured.secretoEnBoveda &&
        measured.centinelaEnClaroEnBoveda === false &&
        editField.value === '' &&
        editField.placeholder === SAVED_API_KEY_PLACEHOLDER &&
        measured.secretoTrasBorrar === false &&
        closed === 0;
      return { ok, detail: JSON.stringify(measured) };
    },
  },
  {
    // Grupo A (0.1.2, punto 1): sin pestañas sale la MISMA pantalla que la de un chat nuevo (constelacion y
    // selector de proyecto con sus recientes), y elegir un proyecto CREA la conversacion en esa carpeta.
    // Su «＋ Nuevo chat» crea SIEMPRE en carpeta temporal, aunque el ajuste diga «ultimo proyecto» (se
    // siembra asi para que la medida distinga). Y el placeholder del prompt deja de decir «Abre una
    // pestaña…» en cuanto la hay. Nada se envia: la sesion es perezosa. Deja el estado como lo encontro.
    name: 'Grupo A: sin pestañas sale la pantalla de nuevo chat y elegir proyecto crea la conversacion',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, conversationHistory: s.conversationHistory, settings: s.settings };
      });
      const proyecto = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-verify-sin-pestanas-'));
      const pantalla = page.locator('[data-no-conversation="true"]');
      const prompt = page.getByRole('textbox', { name: 'Escribe una instrucción para el agente' });
      const vaciar = (history) =>
        page.evaluate(
          ({ cwd, conHistorial }) => {
            const s = window.__mageDev.store.getState();
            const base = { configDir: '', title: 't', privacy: 'shared', sizeBytes: 1, isScheduled: false };
            window.__mageDev.store.setState({
              tabs: [],
              activeTabId: '',
              splitLayout: { kind: 'leaf', tabIds: [''], activeTabId: '' },
              settings: { ...s.settings, newConversationFolder: 'lastProject' },
              ...(conHistorial ? { conversationHistory: [{ ...base, sessionId: 'v-sin-pestanas', cwd, updatedAtMs: Date.now() }] } : {}),
            });
          },
          { cwd: proyecto, conHistorial: history },
        );
      const pestañaActiva = () =>
        page.evaluate(() => {
          const s = window.__mageDev.store.getState();
          return { total: s.tabs.length, cwd: s.tabs.find((t) => t.id === s.activeTabId)?.cwd ?? null };
        });
      const esperarPestaña = () => page.waitForFunction(() => window.__mageDev.store.getState().tabs.length === 1, null, { timeout: CONFIG.actionTimeoutMs });
      let medido = null;
      try {
        // El sondeo periodico del historial (App.tsx) lo recargaba del disco a mitad de la comprobacion y
        // se llevaba la tarjeta sembrada (medido: 3 de 4 tandas). Se desactiva mientras dura, tras una
        // ultima carga real que vacie la que pudiera estar en vuelo; el `finally` lo repone.
        await page.evaluate(async () => {
          const store = window.__mageDev.store;
          window.__mageVerifyLoadHistory = store.getState().loadConversationHistory;
          store.setState({ loadConversationHistory: async () => undefined });
          await window.__mageVerifyLoadHistory();
        });
        await vaciar(true);
        await pantalla.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const tarjeta = pantalla.locator(`[data-recent-project="${proyecto.replace(/\\/g, '\\\\')}"]`);
        await tarjeta.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const vacia = {
          chispas: await pantalla.locator('.mg-sparkle').count(),
          elegir: await pantalla.getByRole('button', { name: 'Elegir proyecto' }).count(),
          recientes: await pantalla.locator('[data-recent-projects]').count(),
          placeholder: await prompt.getAttribute('aria-placeholder'),
        };
        await tarjeta.click();
        await esperarPestaña();
        await pantalla.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
        const trasTarjeta = { ...(await pestañaActiva()), placeholder: await prompt.getAttribute('aria-placeholder') };
        await vaciar(false);
        await pantalla.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        await pantalla.getByRole('button', { name: '＋ Nuevo chat', exact: true }).click();
        await esperarPestaña();
        medido = { vacia, trasTarjeta, trasNuevoChat: await pestañaActiva() };
      } finally {
        await page.evaluate((estado) => {
          const loadConversationHistory = window.__mageVerifyLoadHistory;
          delete window.__mageVerifyLoadHistory;
          window.__mageDev.store.setState(loadConversationHistory === undefined ? estado : { ...estado, loadConversationHistory });
        }, previo);
        fs.rmSync(proyecto, { recursive: true, force: true });
        await page.waitForTimeout(CONFIG.settleMs);
      }
      const ok =
        medido !== null &&
        medido.vacia.chispas === 5 &&
        medido.vacia.elegir === 1 &&
        medido.vacia.recientes === 1 &&
        medido.vacia.placeholder === 'Abre una pestaña para escribir…' &&
        medido.trasTarjeta.total === 1 &&
        medido.trasTarjeta.cwd === proyecto &&
        medido.trasTarjeta.placeholder === 'Escribe una instrucción…' &&
        medido.trasNuevoChat.total === 1 &&
        /mage-scratch/i.test(medido.trasNuevoChat.cwd ?? '');
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // A partir de aqui hace falta una CONVERSACION abierta. Se usa "Carpeta temporal" (no el dialogo
    // del SO, que un driver no puede pilotar) y NO se envia ningun mensaje: `ensureSession` es
    // perezoso, asi que abrir la pestaña no spawnea el CLI y la comprobacion no gasta suscripcion.
    // CAMBIO DEL 2026-09-18 (peticion del usuario): Ctrl+N ya NO abre un formulario. Abre la
    // conversacion directamente, en carpeta temporal y con los valores por defecto. Lo que esta
    // comprobacion mide pasa a ser justo eso: que aparece una pestaña, que NO aparece ningun modal, y
    // que la carpeta es la temporal — porque "sin formulario" sin "carpeta temporal" seria una
    // conversacion sin sitio donde trabajar.
    name: 'Ctrl+N abre la conversacion directamente, sin formulario y en carpeta temporal',
    async run(page) {
      const antes = await page.locator('[role="tablist"][aria-label^="Conversaciones abiertas"] [role="tab"]').count();
      await page.keyboard.press('Control+KeyN');
      await page
        .locator('[role="tablist"][aria-label^="Conversaciones abiertas"] [role="tab"]')
        .nth(antes)
        .waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const dialogos = await page.locator(MODAL).count();
      const despues = await page.locator('[role="tablist"][aria-label^="Conversaciones abiertas"] [role="tab"]').count();
      const cwd = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return s.tabs.find((t) => t.id === s.activeTabId)?.cwd ?? '';
      });
      const enTemporal = /mage-scratch/i.test(cwd);
      const ok = despues === antes + 1 && dialogos === 0 && enTemporal;
      return { ok, detail: `pestañas ${antes}->${despues} modales=${dialogos} cwd=${JSON.stringify(cwd)}` };
    },
  },
  {
    // F2: la conversacion vacia dice EN QUE carpeta va a trabajar el agente y deja cambiarla.
    // P-028 16: el boton es ahora el primario «Elegir proyecto…» y la ruta va debajo, con su ancla.
    name: 'F2: la conversacion vacia muestra la carpeta y deja cambiarla',
    async run(page) {
      const change = page.getByRole('button', { name: 'Elegir proyecto' });
      await change.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const enabled = await change.isEnabled();
      // La ruta completa viaja en el title del elemento (lo pintado va acortado).
      const shown = await page.evaluate(
        () => document.querySelector('[data-working-folder="true"]')?.getAttribute('title') ?? null,
      );
      const ok = enabled && typeof shown === 'string' && shown.length > 0;
      return { ok, detail: `boton habilitado=${enabled} carpeta=${JSON.stringify(shown)}` };
    },
  },
  {
    // P-028 16: el estado vacio ofrece los proyectos recientes como tarjetas, derivadas del historial y
    // filtrando las carpetas que ya no existen (IPC `existsDirs`). Se SIEMBRA el historial en el store
    // (nunca el real): dos carpetas que existen, una borrada y una del scratch. Pulsar una tarjeta solo
    // cambia la carpeta de la pestaña: no se envia nada ni se arranca ninguna sesion.
    name: 'P-028 16: el estado vacio ofrece los proyectos recientes y fija la carpeta al pulsar',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { conversationHistory: s.conversationHistory, tabs: s.tabs };
      });
      const existenteA = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-verify-proyecto-a-'));
      const existenteB = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-verify-proyecto-b-'));
      const borrada = path.join(os.tmpdir(), `mage-verify-no-existe-${Date.now()}`);
      let medido = null;
      try {
        await page.evaluate(({ a, b, gone }) => {
          const s = window.__mageDev.store.getState();
          const scratch = s.tabs.find((t) => t.id === s.activeTabId)?.cwd ?? '';
          const base = { configDir: '', title: 't', privacy: 'shared', sizeBytes: 1, isScheduled: false };
          window.__mageDev.store.setState({
            conversationHistory: [
              { ...base, sessionId: 'v-a', cwd: a, updatedAtMs: 3 },
              { ...base, sessionId: 'v-b', cwd: b, updatedAtMs: 2 },
              { ...base, sessionId: 'v-gone', cwd: gone, updatedAtMs: 4 },
              { ...base, sessionId: 'v-scratch', cwd: scratch, updatedAtMs: 5 },
            ],
          });
        }, { a: existenteA, b: existenteB, gone: borrada });
        await page.locator('[data-recent-project]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const tarjetas = await page.evaluate(() => [...document.querySelectorAll('[data-recent-project]')].map((n) => n.getAttribute('data-recent-project')));
        await page.locator(`[data-recent-project="${existenteB.replace(/\\/g, '\\\\')}"]`).click();
        await page.waitForTimeout(CONFIG.settleMs);
        const cwd = await page.evaluate(() => {
          const s = window.__mageDev.store.getState();
          return s.tabs.find((t) => t.id === s.activeTabId)?.cwd ?? null;
        });
        medido = { tarjetas, cwd };
      } finally {
        await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
        fs.rmSync(existenteA, { recursive: true, force: true });
        fs.rmSync(existenteB, { recursive: true, force: true });
        await page.waitForTimeout(CONFIG.settleMs);
      }
      const ok =
        medido !== null &&
        medido.tarjetas.length === 2 &&
        medido.tarjetas[0] === existenteA &&
        medido.tarjetas[1] === existenteB &&
        medido.cwd === existenteB;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // La otra mitad de la mudanza: el widget se MOVIO, no se duplico. "Dos sitios que hacen lo mismo" es
    // un error que este proyecto ya ha corregido dos veces (el resumen de uso vivia en tres).
    name: '2.8: el pie del dock derecho ya no existe',
    async run(page) {
      const measured = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('span, div')].filter((node) => node.textContent?.trim() === 'Contexto usado');
        const panes = document.querySelectorAll('[role="tabpanel"], [data-zone-pane]').length;
        return { piesDeContexto: nodes.length, panelesAbiertos: panes, dockDerechoVisible: document.body.innerText.length > 0 };
      });
      return { ok: measured.piesDeContexto === 0, detail: `nodos "Contexto usado"=${measured.piesDeContexto}` };
    },
  },
  {
    // Accesibilidad: "Escape en los 4 modales" de la checklist. Abrir el dialogo NO crea ninguna
    // cuenta (eso solo pasa al enviar el formulario), asi que es seguro dejarlo en el harness.
    name: 'Accesibilidad: el dialogo "Añadir cuenta" abre y cierra con Escape',
    async run(page) {
      await page.getByRole('button', { name: 'Añadir cuenta' }).first().click();
      const dialog = page.locator(MODAL);
      await dialog.first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const opened = await dialog.count();
      // DONDE esta el foco al pulsar Escape. Es la diferencia entre "el modal ignora Escape" y "algo se
      // llevo el foco fuera del modal", que son dos bugs distintos con dos arreglos distintos — y el
      // segundo ya ha pasado dos veces en este proyecto (ver useDialogA11y.ts).
      const focusBefore = await focusLocation(page);
      const closed = await closeDialog(page);
      const focusAfter = closed === 0 ? null : await focusLocation(page);
      return {
        ok: opened === 1 && closed === 0,
        detail: `abierto=${opened} foco al pulsar Escape=${focusBefore} tras Escape=${closed}${focusAfter === null ? '' : ` foco despues=${focusAfter}`}`,
      };
    },
  },
  {
    // Fase 9.2: el alta de cuenta ya NO aloja la pagina de login de Anthropic en una ventana de Mage.
    // Ahora el login lo hace el CLI y la pagina se abre en el navegador, en ventana privada.
    //
    // Se mide el FORMULARIO, que es lo que cambia de forma visible: aparece el campo de email (el
    // `login_hint`) y desaparece la casilla de "sesion limpia dentro de Mage", que solo tenia sentido
    // con la ventana embebida. NO se pulsa el boton: enviarlo crearia una cuenta de verdad en disco.
    //
    // Y se comprueba la seccion de "usar la sesion de...": debe haber UN boton por cuenta con login y
    // ninguno si no hay ninguna (un boton que no puede hacer nada es peor que su ausencia). Se compara
    // contra el estado REAL del store, no contra un numero fijo: el harness aisla el `userData` de
    // Electron, NO el HOME, asi que las cuentas que se descubren son las de la maquina.
    name: '9.2: el alta de cuenta pide nombre y email, y ya no ofrece ventana embebida',
    async run(page) {
      await page.getByRole('button', { name: 'Añadir cuenta' }).first().click();
      const dialog = page.locator(MODAL);
      await dialog.first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });

      const measured = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"]');
        const text = modal?.textContent ?? '';
        return {
          campos: modal?.querySelectorAll('input[type="text"], input:not([type])').length ?? 0,
          casillas: modal?.querySelectorAll('input[type="checkbox"]').length ?? 0,
          pideEmail: /EMAIL/.test(text),
          diceCli: /CLI de Claude Code/.test(text),
          dicePrivada: /ventana privada/.test(text),
          // Restos del flujo embebido que NO deben quedar.
          diceDentroDeMage: /dentro de Mage/.test(text),
          botonesAdoptar: [...(modal?.querySelectorAll('button') ?? [])].filter((b) =>
            (b.textContent ?? '').startsWith('Usar la sesión de'),
          ).length,
          conLogin: (window.__mageDev?.store.getState().accounts ?? []).filter((a) => a.loginStatus === 'logged_in').length,
        };
      });
      const closed = await closeDialog(page);

      const ok =
        measured.campos === 2 &&
        measured.casillas === 0 &&
        measured.pideEmail &&
        measured.diceCli &&
        measured.dicePrivada &&
        !measured.diceDentroDeMage &&
        measured.botonesAdoptar === measured.conLogin &&
        closed === 0;
      return {
        ok,
        detail:
          `campos=${measured.campos} casillas=${measured.casillas} email=${measured.pideEmail} ` +
          `cli=${measured.diceCli} privada=${measured.dicePrivada} restoEmbebido=${measured.diceDentroDeMage} ` +
          `botonesAdoptar=${measured.botonesAdoptar} cuentasConLogin=${measured.conLogin} cerrado=${closed === 0}`,
      };
    },
  },
  {
    // Grupo E (respuestas 3 y 6): «Añadir cuenta» es la matriz FABRICANTE × FORMA DE PAGO. Se recorre
    // entera SIN crear nada (ningun boton de crear se pulsa): Anthropic por suscripcion es el formulario
    // de la 9.2 (dos campos), por API pide nombre y una clave en un campo de contraseña, OpenAI lleva el
    // aviso «sin verificar», la suscripcion de agy no pide nada y Local reutiliza el formulario de
    // proveedor con la plantilla de Ollama.
    name: '41/E: el alta de cuenta es la matriz fabricante × forma de pago (sin crear nada)',
    async run(page) {
      await page.getByRole('button', { name: 'Añadir cuenta' }).first().click();
      const dialog = page.locator(MODAL).first();
      await dialog.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await page.waitForTimeout(CONFIG.settleMs);
      const vendors = dialog.locator('[role="group"][aria-label="Fabricante de la cuenta"] button');
      const payments = dialog.locator('[role="group"][aria-label="Forma de pago de la cuenta"] button');
      const fields = () => dialog.locator('input').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('type') ?? 'text'));
      const medido = { fabricantes: await vendors.count(), anthropicPorDefecto: (await vendors.first().getAttribute('aria-pressed')) === 'true' };
      medido.suscripcion = await fields();
      await payments.filter({ hasText: 'Clave de API' }).first().click();
      medido.claudeApi = await fields();
      medido.claudeApiAviso = /Factura API/.test((await dialog.textContent()) ?? '');
      await vendors.filter({ hasText: 'OpenAI' }).click();
      medido.openaiSinVerificar = /Sin verificar/.test((await dialog.textContent()) ?? '');
      medido.openaiFormas = await payments.count();
      await vendors.filter({ hasText: 'Google' }).click();
      medido.agySuscripcion = await fields();
      await vendors.filter({ hasText: 'Local' }).click();
      medido.localUrl = await dialog.getByRole('textbox', { name: 'URL base del endpoint compatible con la API de OpenAI' }).inputValue();
      const closed = await closeDialog(page);
      const ok =
        medido.fabricantes === 4 &&
        medido.anthropicPorDefecto &&
        medido.suscripcion.length === 2 &&
        JSON.stringify(medido.claudeApi) === JSON.stringify(['text', 'password']) &&
        medido.claudeApiAviso &&
        medido.openaiSinVerificar &&
        medido.openaiFormas === 2 &&
        medido.agySuscripcion.length === 0 &&
        medido.localUrl === OLLAMA_TEMPLATE.baseUrl &&
        closed === 0;
      return { ok, detail: JSON.stringify({ ...medido, cerrado: closed === 0 }) };
    },
  },
  {
    // Grupo E: la pestaña de una cuenta que factura la API lo dice con TEXTO fijo («Factura API»), y la de
    // una suscripcion no. Se abre una conversacion temporal (sin mensaje: no se lanza nada), se la pasa en
    // el store a una cuenta de API sembrada y se deshace todo al terminar.
    name: 'E: la pestaña de una cuenta por API lleva «Factura API»',
    async run(page) {
      const previo = await captureTurnState(page);
      const cuentas = await page.evaluate(() => window.__mageDev.store.getState().accounts);
      await openTemporaryConversation(page);
      const tabId = await page.evaluate(() => {
        const dev = window.__mageDev;
        const id = dev.store.getState().activeTabId;
        dev.store.setState((s) => {
          const base = s.accounts[0];
          if (base === undefined) return {};
          const api = { ...base, id: 'C:\\vg\\.claude-api', alias: 'vg-api', apiBilled: true, isMain: false };
          return { accounts: [...s.accounts, api], tabs: s.tabs.map((t) => (t.id === id ? { ...t, accountId: api.id } : t)) };
        });
        return id;
      });
      await page.waitForTimeout(CONFIG.settleMs);
      const medido = await page.evaluate((id) => {
        const tab = document.querySelector(`[role="tab"][data-tab-id="${id}"]`);
        const others = [...document.querySelectorAll('[role="tab"][data-tab-id]')].filter((n) => n.getAttribute('data-tab-id') !== id);
        return {
          pestañaSembrada: tab !== null,
          marca: tab?.querySelector('[data-tab-api-billed]')?.textContent?.trim() ?? null,
          marcasEnOtras: others.filter((n) => n.querySelector('[data-tab-api-billed]') !== null).length,
        };
      }, tabId);
      await page.evaluate((accounts) => window.__mageDev.store.setState({ accounts }), cuentas);
      await restoreTurnState(page, previo);
      const ok = medido.pestañaSembrada && medido.marca === 'Factura API' && medido.marcasEnOtras === 0;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Grupo E (M9): el panel de Uso enseña la suscripcion de agy. main lee `agy /usage` (gratis); aqui,
    // el fichero FALSO de MAGE_AGY_USAGE_FAKE (la salida medida de agy 1.2.14), sin lanzar agy.
    name: 'E: el panel de Uso enseña el uso de agy (su /usage, falso)',
    async run(page) {
      const layout = await page.evaluate(() => window.__mageDev.panelStore.getState().layout);
      await page.evaluate(() => window.__mageDev.panelStore.getState().revealPanelById('usage'));
      const section = page.locator('[data-agy-usage="true"]');
      await section.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const medido = await section.evaluate((node) => ({
        titulo: /ANTIGRAVITY/.test(node.textContent ?? ''),
        barras: (node.textContent ?? '').match(/\d+% ·/g)?.length ?? 0,
        grupos: ['Gemini Models', 'Claude and GPT models'].filter((g) => (node.textContent ?? '').includes(g)).length,
      }));
      await page.evaluate((l) => window.__mageDev.panelStore.setState({ layout: l }), layout);
      return { ok: medido.titulo && medido.barras === 4 && medido.grupos === 2, detail: JSON.stringify(medido) };
    },
  },
  {
    // Grupo E (respuesta 30): Codex se ofrece en Nueva conversacion, y con el aviso «sin verificar».
    name: 'E: elegir Codex en Nueva conversacion avisa de que está sin verificar',
    async run(page) {
      return withNewTabDialog(page, async () => {
        const provider = newTabSelect(page, NEW_TAB_FIELD.provider);
        if ((await provider.count()) !== 1) return { ok: false, detail: 'sin un selector de proveedor' };
        const options = await selectOptionsOf(page, NEW_TAB_FIELD.provider);
        const before = await page.locator(`${NEW_TAB_DIALOG} [data-unverified-provider]`).count();
        await provider.selectOption('codex');
        await page.waitForTimeout(CONFIG.settleMs);
        const after = await page.locator(`${NEW_TAB_DIALOG} [data-unverified-provider]`).count();
        const ok = (options ?? []).some((o) => o.startsWith('codex|')) && before === 0 && after === 1;
        return { ok, detail: JSON.stringify({ codexOfrecido: (options ?? []).some((o) => o.startsWith('codex|')), avisoAntes: before, avisoDespues: after }) };
      });
    },
  },
  {
    // G5: `app.requestSingleInstanceLock()`. Estaba como "⚠ pendiente de verificacion GUI" desde que se
    // implemento. Se lanza un SEGUNDO Electron contra el MISMO perfil: debe rendirse enseguida y no
    // abrir otra ventana; la primera instancia recibe 'second-instance' y se enfoca.
    name: 'G5: una segunda instancia no abre otra ventana',
    async run(page, ctx) {
      const before = countMainPages(page);
      const electronPath = requireFromHere('electron');
      const result = spawnSync(electronPath, ['.', `--user-data-dir=${ctx.userDataDir}`], {
        cwd: repoRoot,
        windowsHide: true,
        timeout: 30_000,
        stdio: 'ignore',
      });
      await page.waitForTimeout(1500);
      const after = countMainPages(page);
      // `timeout` mata el proceso y deja `signal`: si eso pasa, la segunda instancia NO se rindio.
      const surrendered = result.signal === null;
      const ok = surrendered && after === before && before === 1;
      return { ok, detail: `ventanas principales antes=${before} despues=${after} segunda instancia se rindio=${surrendered} (code=${result.status} signal=${result.signal})` };
    },
  },
  {
    // P-028, punto 36: «Mover a una ventana nueva» perdia la pestaña en las DOS ventanas (se le
    // empujaba a la nueva antes de que su renderer escuchara). Ahora va por el transporte "pull": main
    // la guarda y el renderer nuevo la recoge al acabar de restaurar. Se mide en la ventana NUEVA por
    // CDP que la pestaña esta alli con su titulo, y en la de origen que ya no. No se envia nada ni se
    // arranca ninguna sesion; la ventana nueva se cierra al final (una secundaria no pregunta).
    name: 'P-028 36: mover una pestaña a una ventana nueva la entrega alli y la quita de aqui',
    async run(page) {
      const before = countMainPages(page);
      await openTemporaryConversation(page);
      const title = `verify-mover-${Date.now()}`;
      const tabId = await page.evaluate((nuevo) => {
        const s = window.__mageDev.store.getState();
        s.renameTab(s.activeTabId, nuevo);
        return s.activeTabId;
      }, title);
      const browser = page.context().browser();
      const knownPages = new Set(browser.contexts().flatMap((context) => context.pages()));
      let medido = { antes: before };
      let nueva = null;
      try {
        await page.locator(`[data-tab-id="${tabId}"]`).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Mover a una ventana nueva' }).click();
        const deadline = Date.now() + CONFIG.actionTimeoutMs;
        while (nueva === null && Date.now() < deadline) {
          nueva =
            browser
              .contexts()
              .flatMap((context) => context.pages())
              .find((candidate) => !knownPages.has(candidate) && !candidate.url().includes('widget.html') && !candidate.url().includes('debug.html') && !candidate.url().startsWith('devtools://')) ?? null;
          if (nueva === null) await page.waitForTimeout(200);
        }
        if (nueva !== null) {
          await nueva.locator('[data-tab-id]').filter({ hasText: title }).first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs }).catch(() => {});
          medido.enLaNueva = await nueva.locator('[data-tab-id]').filter({ hasText: title }).count();
        }
        medido.enElOrigen = await page.evaluate((id) => window.__mageDev.store.getState().tabs.some((t) => t.id === id), tabId);
      } catch (error) {
        medido.fallo = error.message;
      } finally {
        if (nueva !== null) await nueva.close().catch(() => {});
        const deadline = Date.now() + CONFIG.actionTimeoutMs;
        while (countMainPages(page) > before && Date.now() < deadline) await page.waitForTimeout(200);
        medido.alFinal = countMainPages(page);
      }
      const ok = nueva !== null && medido.enLaNueva === 1 && medido.enElOrigen === false && medido.alFinal === before;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Input rico (M3): Tab indenta y Shift+Tab desindenta. NUNCA se pulsa Enter: dispararia un turno
    // real del agente, que gasta suscripcion y escribe en una transcripcion de verdad.
    name: 'Input rico: Tab indenta y Shift+Tab desindenta',
    async run(page) {
      const prompt = page.getByRole('textbox', { name: 'Escribe una instrucción para el agente' });
      await prompt.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await clearPrompt(page);
      await typeInPrompt(page, 'hola');
      await prompt.press('Tab');
      const indented = await promptText(page);
      await prompt.press('Shift+Tab');
      const back = await promptText(page);
      await clearPrompt(page);
      const ok = indented.startsWith(' ') && indented.trimStart() === 'hola' && back === 'hola';
      return { ok, detail: `tras Tab=${JSON.stringify(indented)} tras Shift+Tab=${JSON.stringify(back)}` };
    },
  },
  {
    // Input rico (M3), la otra mitad que seguia siendo manual: Shift+Enter continua la lista con el
    // marcador siguiente, y en un item VACIO sale de la lista. Shift+Enter NO envia (el envio es Enter a
    // secas), asi que aqui no se dispara ningun turno.
    name: 'Input rico: Shift+Enter continua la lista y la cierra en un item vacio',
    async run(page) {
      const prompt = page.getByRole('textbox', { name: 'Escribe una instrucción para el agente' });
      await prompt.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await clearPrompt(page);
      await typeInPrompt(page, '- uno');
      await prompt.press('Shift+Enter');
      const continued = await promptText(page);
      await page.keyboard.type('dos', { delay: PROMPT_TYPE_DELAY_MS });
      await prompt.press('Shift+Enter');
      const second = await promptText(page);
      // Tercer Shift+Enter sobre el marcador vacio que acaba de insertar: debe SALIR de la lista.
      await prompt.press('Shift+Enter');
      const exited = await promptText(page);
      await clearPrompt(page);
      const ok = continued === '- uno\n- ' && second === '- uno\n- dos\n- ' && !exited.endsWith('- ');
      return {
        ok,
        detail: `tras 1er Shift+Enter=${JSON.stringify(continued)} tras escribir y repetir=${JSON.stringify(second)} sobre item vacio=${JSON.stringify(exited)}`,
      };
    },
  },
  {
    // M2.6 + D5: con el input VACIO, Shift+Tab cicla el modo de permiso en vez de desindentar (el guard
    // `promptTextEmpty` del resolver). Se mide el CICLO COMPLETO y la vuelta al punto de partida: medir un
    // solo paso no distingue "cicla" de "se queda pegado en el segundo". Sin sesion viva no se manda
    // ningun `set_permission_mode` al CLI, solo cambia el estado de la pestaña.
    name: 'Shift+Tab con el input vacio cicla el modo de permiso',
    async run(page) {
      const chip = page.locator('[aria-label^="Modo de permiso:"]');
      // Autosuficiente: con `--only` no hay pestaña de una comprobacion anterior.
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      const propia = (await chip.count()) === 0;
      if (propia) await openTemporaryConversation(page);
      await chip.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const prompt = page.getByRole('textbox', { name: 'Escribe una instrucción para el agente' });
      await clearPrompt(page);
      // P-026 2.3 (D8/D9): CINCO modos. P-028 14: «Omitir permisos» ya no lleva franja fija: sale un aviso
      // TEMPORAL (8 s, con X) y la señal permanente es solo el chip en rojo.
      const MODES = 5;
      const AVISO = 'Omitir permisos: el agente ejecuta todo sin preguntar';
      const seen = [await permissionModeLabel(page)];
      let avisoAlEntrar = null;
      let avisoTras9s = null;
      let chipRojo = null;
      let franjaFija = 0;
      for (let step = 0; step < MODES; step += 1) {
        await prompt.press('Shift+Tab');
        await page.waitForTimeout(CONFIG.settleMs);
        const label = await permissionModeLabel(page);
        seen.push(label);
        franjaFija += await page.locator('[data-bypass-warning="true"]').count();
        if (label !== 'Omitir permisos') continue;
        avisoAlEntrar = await countBypassAdvice(page, AVISO);
        await page.waitForTimeout(8600);
        avisoTras9s = await countBypassAdvice(page, AVISO);
        chipRojo = await chip.evaluate((el) => el.className.includes('text-mg-danger'));
      }
      if (propia) await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      const distinct = new Set(seen.slice(0, MODES)).size;
      const ok =
        distinct === MODES && seen[MODES] === seen[0] && seen.includes('Auto') && avisoAlEntrar === 1 && avisoTras9s === 0 && chipRojo === true && franjaFija === 0;
      return {
        ok,
        detail: `modos=${JSON.stringify(seen)} distintos=${distinct} vuelve al inicio=${seen[MODES] === seen[0]} aviso al entrar=${avisoAlEntrar} tras 8,6 s=${avisoTras9s} chip rojo=${chipRojo} franja fija=${franjaFija}`,
      };
    },
  },
  {
    // D4 / B3 de la checklist: el popover de comandos "/". Sin sesion viva la lista es la CURADA (los
    // reales llegan en la respuesta al `initialize`), asi que lo verificable aqui es la mecanica: filtra
    // por lo tecleado y Escape lo cierra. Se mide tambien que los seis comandos de la TUI que D4 quito
    // (`cost`, `help`…) NO vuelven a ofrecerse: ofrecerlos era engañar, porque el modelo los recibe como
    // texto. NUNCA se pulsa Enter ni Tab con el popover abierto (completarian y dejarian texto).
    name: 'Comandos /: el popover filtra, Escape lo cierra y no ofrece los de la TUI',
    async run(page) {
      const prompt = page.getByRole('textbox', { name: 'Escribe una instrucción para el agente' });
      const listbox = page.getByRole('listbox', { name: 'Comandos disponibles' });
      await clearPrompt(page);
      await typeInPrompt(page, '/');
      await listbox.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const all = await slashOptionNames(page);
      await clearPrompt(page);
      await typeInPrompt(page, '/m');
      await page.waitForTimeout(CONFIG.settleMs);
      const filtered = await slashOptionNames(page);
      await prompt.press('Escape');
      await page.waitForTimeout(CONFIG.settleMs);
      const openAfterEscape = await listbox.count();
      await clearPrompt(page);
      // El contrato NO es "todos empiezan por lo escrito": `filterSlashCommands` ranquea PREFIJO primero e
      // INFIJO despues (por eso "/m" ofrece tambien `/compact`). Medir "todos empiezan por /m" habria
      // suspendido a la app por cumplir su especificacion. Lo que se verifica es lo que promete: todos
      // CONTIENEN lo escrito, y los que empiezan por ello van delante.
      const tuiOnly = ['cost', 'help', 'hooks', 'memory', 'permissions', 'status'];
      const leaked = tuiOnly.filter((name) => all.includes(`/${name}`));
      const prefixCount = filtered.findIndex((name) => !name.startsWith('/m'));
      const prefixFirst = prefixCount === -1 || filtered.slice(prefixCount).every((name) => !name.startsWith('/m'));
      const ok =
        all.length > filtered.length &&
        filtered.length > 0 &&
        filtered.every((name) => name.slice(1).includes('m')) &&
        filtered.includes('/mcp') &&
        prefixFirst &&
        leaked.length === 0 &&
        openAfterEscape === 0;
      return {
        ok,
        detail: `con "/"=${all.length} comandos, con "/m"=${JSON.stringify(filtered)} prefijo antes que infijo=${prefixFirst} de la TUI colados=${JSON.stringify(leaked)} listbox tras Escape=${openAfterEscape}`,
      };
    },
  },
  {
    // Ronda 2, B1: "cambiar de modelo no avisa de que sera mas costoso". Estaba verificado por CDP una
    // vez, a mano, sobre la app REAL del usuario (y hubo que reponer el modelo despues). Aqui pasa a ser
    // repetible y sobre el perfil aislado. El cambio no gasta nada: sin sesion viva no se manda
    // `set_model`, solo se actualiza la pestaña — y al acabar se repone el modelo de partida.
    name: 'Cambiar a Opus avisa del coste y el aviso se puede descartar',
    async run(page) {
      const trigger = page.getByRole('button', { name: 'Modelo (aplica al siguiente turno)' });
      await trigger.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const initial = (await trigger.innerText()).trim();
      const opus = await pickDropdownOption(page, 'Modelo (aplica al siguiente turno)', /opus/i);
      if (opus === null) return { ok: false, detail: `no hay ninguna opcion de Opus en el selector (modelo actual=${JSON.stringify(initial)})` };
      await page.waitForTimeout(CONFIG.settleMs);
      const banner = page.getByRole('button', { name: 'Descartar aviso' });
      const warned = await banner.count();
      const text = warned === 0 ? null : ((await banner.locator('..').innerText()) ?? '').trim();
      if (warned === 1) await banner.click();
      await page.waitForTimeout(CONFIG.settleMs);
      const dismissed = await page.getByRole('button', { name: 'Descartar aviso' }).count();
      // Reponer el modelo de partida y descartar el aviso que provoca el propio cambio de vuelta.
      await pickDropdownOption(page, 'Modelo (aplica al siguiente turno)', new RegExp(`^${escapeRegExp(initial)}$`, 'i'));
      await page.waitForTimeout(CONFIG.settleMs);
      const back = page.getByRole('button', { name: 'Descartar aviso' });
      if ((await back.count()) === 1) await back.click();
      await page.waitForTimeout(CONFIG.settleMs);
      const restored = (await trigger.innerText()).trim();
      const ok = warned === 1 && text !== null && /opus/i.test(text) && dismissed === 0 && restored === initial;
      return {
        ok,
        detail: `modelo ${JSON.stringify(initial)} -> ${JSON.stringify(opus)} avisos=${warned} texto=${JSON.stringify(text)} tras descartar=${dismissed} modelo repuesto=${JSON.stringify(restored)}`,
      };
    },
  },
  {
    // I11-drag: el boton ⫿ se quito (feedback del usuario: dividir debe ser arrastrar una pestaña,
    // como VS Code/IntelliJ, no un boton que solo sabe partir en dos). Con UNA sola pestaña, "Dividir
    // a..." del menu contextual (la alternativa SIN raton) tiene que estar deshabilitado: no hay OTRA
    // pestaña con la que dividir el panel enfocado, y esta pestaña ya es esa misma.
    name: 'Dividir workspace: con una sola pestaña, "Dividir a..." esta deshabilitado en el menu',
    async run(page) {
      const tab = page.locator('[role="tab"]').first();
      await tab.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await tab.click({ button: 'right' });
      const menu = page.getByRole('menu');
      await menu.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const splitItems = menu.getByRole('menuitem', { name: /^Dividir/ });
      const count = await splitItems.count();
      const disabledFlags = [];
      for (let i = 0; i < count; i++) disabledFlags.push(await splitItems.nth(i).isDisabled());
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const prompts = await page.getByRole('textbox', { name: 'Escribe una instrucción para el agente' }).count();
      const ok = count === 4 && disabledFlags.every(Boolean) && prompts === 1;
      return { ok, detail: `items "Dividir a..."=${count} deshabilitados=${JSON.stringify(disabledFlags)} areas de prompt=${prompts}` };
    },
  },
  {
    // Ronda 3, item 5: el menu "nacia desde arriba de la pantalla, no del boton". El calculo del `top`
    // clampaba contra el borde de la VENTANA sin mirar el trigger; con el boton abajo (PromptBar) el
    // menu aparecia muy por encima, desconectado. Se mide la separacion REAL entre las dos cajas: da
    // igual si vuelca hacia arriba o hacia abajo, pero tiene que estar PEGADO a una de las dos caras.
    // Solo se ABRE el menu (Escape para cerrarlo): elegir una opcion cambiaria el esfuerzo de verdad.
    name: 'Esfuerzo y modo: el popover del deslizador nace pegado a su chip y trae sus pasos (StepSlider)',
    async run(page) {
      // P-028 32/33: modo y esfuerzo son deslizadores de pasos. Grupo A (0.1.2, punto 4): se RECORREN todos
      // los pasos con el teclado midiendo que ni el chip ni el popover se mueven (el de modo saltaba 16 px
      // y el popover iba un paso por detras) y que el pulgar dibujado llega a su sitio con transicion. Al
      // terminar se vuelve al paso de partida: el modo o el esfuerzo cambiado romperia las siguientes.
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      const propia = (await page.locator('button[aria-label^="Modo de permiso:"]').count()) === 0;
      if (propia) await openTemporaryConversation(page);
      const casos = [
        { chip: 'button[aria-label="Nivel de esfuerzo"]', pasos: 6 },
        { chip: 'button[aria-label^="Modo de permiso:"]', pasos: 5 },
      ];
      const medidas = [];
      try {
        for (const caso of casos) medidas.push(await walkStepSlider(page, caso));
      } finally {
        if (propia) await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      }
      // Tolerancia de 24 px en el hueco: el `top` se calcula con una estimacion del alto del popover.
      const ok = medidas.every(
        (m) =>
          m.gap <= 24 &&
          m.pasos === m.esperados &&
          m.recorridos === m.esperados &&
          m.desplazamientoChip <= SLIDER_STILL_TOLERANCE_PX &&
          m.desplazamientoPopover <= SLIDER_STILL_TOLERANCE_PX &&
          Math.max(...Object.values(m.filaDeriva)) <= SLIDER_STILL_TOLERANCE_PX &&
          m.errorPulgar <= 1 &&
          m.transicion !== '0s' &&
          m.vuelveAlInicio &&
          m.valuetext.length > 0,
      );
      return { ok, detail: JSON.stringify(medidas) };
    },
  },
  {
    // La medida es el numero de colores DISTINTOS entre los <span> de token. Si el resaltado muriera
    // (gramatica que no carga, tema importado sin reglas, shiki que lanza), `useHighlightedCode`
    // devuelve null y el bloque cae a texto plano: 0 spans y un solo color heredado. Contar "spans > 0"
    // o "hay un <pre>" pasaria en verde con la funcionalidad muerta.
    name: 'F4: un bloque ```ts se tokeniza con varios colores en el chat',
    async run(page) {
      // La vista previa del prompt desaparecio con 2.7 (el input YA es WYSIWYG), asi que el resaltado
      // se mide donde de verdad importa: en el hilo. Mismo componente (`Markdown`) y mismo resaltador.
      await hydrateBlocks(page, [{ kind: 'agent', id: 'hl-ts', runs: [{ code: false, text: TS_FENCE }], streaming: false }]);
      const measured = await waitForChatCode(page, (m) => m.colors.length > 1);
      const ok = measured !== null && measured.lang === 'ts' && measured.colors.length > 1 && measured.text.includes('const answer');
      return {
        ok,
        detail: `lenguaje=${JSON.stringify(measured?.lang ?? null)} spans de token=${measured?.spans ?? 0} colores distintos=${measured?.colors.length ?? 0}`,
      };
    },
  },
  {
    // Contraparte: un lenguaje que NO esta en HIGHLIGHT_LANGS cae a texto plano. Lo que hay que medir es
    // que el codigo SIGUE AHI (0 spans pero texto intacto): un fallo que se comiera el contenido
    // dejaria el bloque en blanco.
    name: 'F4: un lenguaje no registrado (rust) queda en texto plano y no en blanco',
    async run(page) {
      await hydrateBlocks(page, [{ kind: 'agent', id: 'hl-rs', runs: [{ code: false, text: RUST_FENCE }], streaming: false }]);
      const measured = await waitForChatCode(page, (m) => m.lang === 'rust' && m.spans === 0);
      const ok = measured !== null && measured.lang === 'rust' && measured.spans === 0 && measured.text.includes('fn main');
      return {
        ok,
        detail: `lenguaje=${JSON.stringify(measured?.lang ?? null)} spans=${measured?.spans ?? 0} texto=${JSON.stringify((measured?.text ?? '').slice(0, 40))}`,
      };
    },
  },
  {
    // Extra de la ronda 2 (0.1.1): el usuario veia «fondos de color» junto a los bloques del chat. Se
    // recorren los ANTEPASADOS de un bloque y los hermanos del hilo mirando fondo, degradado, sombra,
    // filtro y pseudo-elementos, y se lista todo lo que pinte algo distinto de transparente.
    name: 'Extra: el hilo del chat no pinta fondos, sombras ni degradados fuera de sus burbujas',
    async run(page) {
      const previo = await page.evaluate(() => (({ tabs, activeTabId, splitLayout, blocksByChat }) => ({ tabs, activeTabId, splitLayout, blocksByChat }))(window.__mageDev.store.getState()));
      await openTemporaryConversation(page);
      await hydrateBlocks(page, [
        { kind: 'user', id: 'bg-u', text: 'hola', time: '10:00', attachments: [] },
        { kind: 'agent', id: 'bg-a', runs: [{ code: false, text: 'respuesta' }], streaming: false },
      ]);
      const medido = await page.evaluate(() => {
        const pintado = (el, pseudo) => {
          const c = getComputedStyle(el, pseudo ?? null);
          const out = {};
          if (c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent') out.bg = c.backgroundColor;
          if (c.backgroundImage !== 'none') out.img = c.backgroundImage.slice(0, 80);
          if (c.boxShadow !== 'none') out.sombra = c.boxShadow.slice(0, 80);
          if (c.filter !== 'none') out.filtro = c.filter;
          if (c.backdropFilter !== 'none') out.backdrop = c.backdropFilter;
          if (pseudo !== undefined && c.content === 'none') return {};
          return out;
        };
        const nombre = (el) => `${el.tagName.toLowerCase()}${el.dataset?.block ? `[data-block=${el.dataset.block}]` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(/\s+/).slice(0, 3).join('.')}` : ''}`;
        const bloque = document.querySelector('[data-block]');
        if (bloque === null) return { sinBloque: true };
        const hilo = bloque.parentElement;
        const cadena = [];
        for (let el = bloque.parentElement; el !== null && el !== document.documentElement; el = el.parentElement) {
          const p = [pintado(el), pintado(el, '::before'), pintado(el, '::after')];
          if (p.some((x) => Object.keys(x).length > 0)) cadena.push({ el: nombre(el), p });
        }
        // Lo que cuelga del hilo y no es un bloque (relleno, indicadores, sentinelas).
        const sueltos = [...(hilo?.querySelectorAll(':scope > :not([data-block])') ?? [])]
          .map((el) => ({ el: nombre(el), p: pintado(el) }))
          .filter((x) => Object.keys(x.p).length > 0);
        // Dentro de cada bloque: solo los elementos de nivel 1-2 (la burbuja y su envoltorio).
        const burbujas = [...document.querySelectorAll('[data-block]')].map((b) => ({
          bloque: b.dataset.block,
          nivel1: [...b.children].map((el) => ({ el: nombre(el), p: pintado(el), hijos: [...el.children].map((h) => ({ el: nombre(h), p: pintado(h) })).filter((x) => Object.keys(x.p).length > 0) })),
        }));
        return { cadena, sueltos, burbujas };
      });
      await page.evaluate((p) => window.__mageDev.store.setState(p), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      // Contrato: todos los antepasados del hilo pintan el MISMO fondo (sin bandas de otro tono junto a las
      // burbujas), ninguno lleva degradado, sombra ni filtro, y el hilo no tiene hijos sueltos pintados.
      const fondos = new Set((medido.cadena ?? []).map((n) => n.p[0].bg));
      const decorado = (medido.cadena ?? []).some((n) => n.p.some((x) => x.img !== undefined || x.sombra !== undefined || x.filtro !== undefined || x.backdrop !== undefined));
      const ok = medido.sinBloque !== true && fondos.size === 1 && !decorado && medido.sueltos.length === 0;
      return { ok, detail: JSON.stringify({ fondos: [...fondos], decorado, sueltos: medido.sueltos }) };
    },
  },
  {
    name: 'E3: elegir `agy` en Nueva conversacion muestra el aviso de sin permisos',
    async run(page) {
      return withNewTabDialog(page, async () => {
        const warning = page.locator(`${NEW_TAB_DIALOG} [role="status"]`);
        const withClaude = await warning.count();
        const provider = newTabSelect(page, NEW_TAB_FIELD.provider);
        const targets = await provider.count();
        if (targets !== 1) return { ok: false, detail: `selectores de proveedor=${targets} (se esperaba 1: no se toca)` };
        await provider.selectOption(AGY_PROVIDER_ID);
        await page.waitForTimeout(CONFIG.settleMs);
        const withAgy = await warning.count();
        const text = withAgy === 0 ? '' : (await warning.first().innerText()).trim();
        const model = await newTabSelect(page, NEW_TAB_FIELD.model).inputValue();
        const modelOptions = await selectOptionsOf(page, NEW_TAB_FIELD.model);
        // El modelo por defecto de un proveedor sin preferencia fijada es el PRIMERO de su catalogo.
        const firstModel = modelOptions?.[0]?.split('|')[0] ?? null;
        const ok = withClaude === 0 && withAgy === 1 && text.includes(NO_PERMISSION_HEAD) && model === firstModel;
        return {
          ok,
          detail: `avisos con claude=${withClaude} con agy=${withAgy} modelo=${JSON.stringify(model)} primer modelo de agy=${JSON.stringify(firstModel)} aviso=${JSON.stringify(text)}`,
        };
      });
    },
  },
  {
    // La mas delicada del lote. Con `agy` instalado se abre su pestaña y se mide lo que la UI DEBE tener
    // (el chip permanente "⚠ Sin permisos" y el recuadro del estado vacio) y lo que NO debe tener: el
    // chip de modo de permiso y el selector de esfuerzo, que son de Claude y para `agy` no existen —
    // pintarlos seria fingir un control de permisos que su CLI no ofrece.
    // Si `agy` NO estuviera instalado, el contrato es otro y se mide ese: boton de crear DESHABILITADO y
    // el motivo a la vista.
    name: 'E3: la pestaña de `agy` lleva el chip "Sin permisos" y no el selector de modo de permiso',
    async run(page) {
      await page.locator('button[aria-label="Nueva pestaña"]').first().click({ button: 'right' });
      await page.locator(NEW_TAB_DIALOG).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await page.getByRole('button', { name: 'Carpeta temporal', exact: true }).click();
      const provider = newTabSelect(page, NEW_TAB_FIELD.provider);
      const targets = await provider.count();
      if (targets !== 1) {
        await closeDialog(page);
        return { ok: false, detail: `selectores de proveedor=${targets} (se esperaba 1: no se toca)` };
      }
      await provider.selectOption(AGY_PROVIDER_ID);
      await page.waitForTimeout(CONFIG.settleMs);
      const warning = (await page.locator(`${NEW_TAB_DIALOG} [role="status"]`).first().innerText()).trim();
      const open = page.getByRole('button', { name: /Abrir pestaña|Abriendo/ });
      const enabled = await open.isEnabled();
      if (warning.includes(AGY_MISSING_HEAD)) {
        const closed = await closeDialog(page);
        return {
          ok: !enabled && closed === 0,
          detail: `agy NO instalado: boton habilitado=${enabled} (se espera false) motivo=${JSON.stringify(warning)}`,
        };
      }
      await open.click();
      // Se espera al DESMONTAJE del dialogo, no a un tiempo fijo: mientras su animacion de salida corre,
      // el aviso del dialogo sigue en el DOM y se contaria como si fuera el del estado vacio (dos
      // recuadros en vez de uno). Con `modalExitMs` la medida salia distinta segun la ejecucion.
      await page.locator(NEW_TAB_DIALOG).waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const measured = await page.evaluate((head) => {
        // El chip de la PromptBar es el unico role=status con aria-label; el recuadro del estado vacio
        // lleva el aviso como TEXTO. Distinguirlos importa: si se contaran juntos, tener solo uno de los
        // dos pasaria en verde.
        const chips = [...document.querySelectorAll('[role="status"][aria-label]')].filter((node) =>
          (node.getAttribute('aria-label') ?? '').startsWith(head),
        );
        const boxes = [...document.querySelectorAll('[role="status"]')].filter((node) => (node.textContent ?? '').includes(head));
        return {
          chips: chips.length,
          chipText: chips[0]?.textContent?.trim() ?? null,
          emptyStateBoxes: boxes.length,
          // Quien es cada uno: `[role=status]` ANIDADOS contarian dos veces el mismo aviso, y un conteo
          // pelado no distingue "falta el recuadro" de "hay uno de mas".
          boxOwners: boxes.map((node) => {
            const inDialog = node.closest('[role="dialog"]') !== null;
            const nested = boxes.some((other) => other !== node && other.contains(node));
            return `${node.tagName.toLowerCase()}${inDialog ? ' en-dialogo' : ''}${nested ? ' anidado' : ''}`;
          }),
          permissionModeControls: document.querySelectorAll('[aria-label^="Modo de permiso"]').length,
          effortControls: document.querySelectorAll('[aria-label="Nivel de esfuerzo"]').length,
        };
      }, NO_PERMISSION_HEAD);
      const ok =
        measured.chips === 1 &&
        measured.chipText === AGY_PERMISSION_CHIP &&
        measured.emptyStateBoxes === 1 &&
        measured.permissionModeControls === 0 &&
        measured.effortControls === 0;
      return { ok, detail: `agy instalado; pestaña abierta: ${JSON.stringify(measured)}` };
    },
  },
  {
    // Grupo E, fase 2: los comandos de agy se conceden al EMPEZAR la conversacion (el estado vacio de su
    // pestaña) por linea exacta, sin regex, y el aviso de comando denegado ofrece permitirlo para la
    // siguiente. Autosuficiente: pestaña temporal marcada como agy en el store (no se lanza nada).
    name: 'E fase 2: comandos de agy al empezar la conversación y «permitir» desde el aviso de denegado',
    async run(page, { userDataDir }) {
      const previo = await page.evaluate(() => (({ tabs, activeTabId, splitLayout, blocksByChat }) => ({ tabs, activeTabId, splitLayout, blocksByChat }))(window.__mageDev.store.getState()));
      const ajustes = path.join(userDataDir, 'app-settings.json');
      const reglas = (t) => JSON.parse(t).agyCommandRules ?? { allow: [], deny: [] };
      const medido = {};
      try {
        await openTemporaryConversation(page);
        await page.evaluate(() => {
          const s = window.__mageDev.store.getState();
          window.__mageDev.store.setState({ tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, provider: 'agy' } : t)) });
        });
        const abrir = page.locator('[data-agy-commands-open="true"]');
        await abrir.first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        medido.botones = await abrir.count();
        if (medido.botones !== 1) return { ok: false, detail: `botones de comandos=${medido.botones} (se esperaba 1: no se toca)` };
        await abrir.click();
        const dialogo = page.locator('[data-agy-commands-dialog="true"]');
        await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const campo = dialogo.getByRole('textbox', { name: 'Comando exacto' });
        await campo.fill('regex:.*');
        await dialogo.getByRole('button', { name: 'Permitir', exact: true }).click();
        medido.errorRegex = await dialogo.getByRole('alert').count();
        await campo.fill(AGY_VG_COMMAND);
        await dialogo.getByRole('button', { name: 'Permitir', exact: true }).click();
        medido.permitido = (await waitForFile(ajustes, (t) => reglas(t).allow.includes(AGY_VG_COMMAND))) !== null;
        await dialogo.getByRole('button', { name: 'Permitido', exact: true }).click();
        medido.denegado = (await waitForFile(ajustes, (t) => reglas(t).deny.includes(AGY_VG_COMMAND) && !reglas(t).allow.includes(AGY_VG_COMMAND))) !== null;
        await dialogo.getByRole('button', { name: `Quitar ${AGY_VG_COMMAND}`, exact: true }).click();
        medido.quitado = (await waitForFile(ajustes, (t) => !reglas(t).deny.includes(AGY_VG_COMMAND))) !== null;
        await dialogo.getByRole('button', { name: 'Listo', exact: true }).click();
        await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
        await hydrateBlocks(page, [{ kind: 'error', id: 'vg-denied', message: `agy denegó el comando «${AGY_VG_DENIED}»`, deniedCommand: AGY_VG_DENIED }]);
        await page.locator('[data-agy-allow-command="true"]').click();
        await page.locator('[data-agy-command-allowed="true"]').waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        medido.desdeElAviso = (await waitForFile(ajustes, (t) => reglas(t).allow.includes(AGY_VG_DENIED))) !== null;
      } finally {
        await page.evaluate((cmd) => window.__mageDev.store.getState().setAgyCommandVerdict(cmd, null), AGY_VG_DENIED);
        await page.evaluate((p) => window.__mageDev.store.setState(p), previo);
        await page.waitForTimeout(CONFIG.settleMs);
      }
      const ok = medido.errorRegex === 1 && medido.permitido && medido.denegado && medido.quitado && medido.desdeElAviso;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // El estado vacio de una conversacion es la constelacion de chispas de la marca, no los dos
    // anillos que giraban antes. Se mide la FORMA (estrella de cuatro puntas = 8 comandos de path),
    // que cada una lleve SU desfase —si todas titilaran a la vez se leeria como un parpadeo, no como
    // una constelacion— y que la animacion este de verdad corriendo, no solo declarada: el fallo real
    // que esto caza es que el CSS no llegue y las cinco queden estaticas con animationName="none".
    // Se cuenta POR constelacion, no en total: con el workspace dividido hay un estado vacio por panel.
    name: "I1: el estado vacio son cinco chispas de la marca, titilando desfasadas",
    async run(page) {
      const measured = await page.evaluate(() => {
        const grupos = [...document.querySelectorAll("svg")].filter((svg) => svg.querySelector(".mg-sparkle") !== null);
        return {
          constelaciones: grupos.length,
          porConstelacion: grupos.map((svg) => svg.querySelectorAll(".mg-sparkle").length),
          // Cuatro puntas = 8 vertices = 1 comando M + 7 L. Con otra cifra no es la estrella de marca.
          comandosDePath: [...new Set([...document.querySelectorAll(".mg-sparkle")].map((n) => ((n.getAttribute("d") ?? "").match(/[ML]/g) ?? []).length))],
          animaciones: [...new Set([...document.querySelectorAll(".mg-sparkle")].map((n) => getComputedStyle(n).animationName))],
          desfasesDistintos: new Set([...document.querySelectorAll(".mg-sparkle")].map((n) => getComputedStyle(n).animationDelay)).size,
          anillosViejos: document.querySelectorAll(".mg-magic-ring").length,
        };
      });
      const animando = measured.animaciones.length === 1 && ["mg-twinkle", "mg-twinkle-still"].includes(measured.animaciones[0]);
      const ok =
        measured.constelaciones >= 1 &&
        measured.porConstelacion.every((n) => n === 5) &&
        measured.comandosDePath.length === 1 &&
        measured.comandosDePath[0] === 8 &&
        animando &&
        measured.desfasesDistintos === 5 &&
        measured.anillosViejos === 0;
      return { ok, detail: `estado vacio=${JSON.stringify(measured)}` };
    },
  },
  // --- Las dos ultimas necesitan DOS conversaciones abiertas, que es justo lo que deja E3 ------------
  {
    // Accesibilidad (M3): el TabBar declara role="tablist", y en el se aprendio la leccion. Hasta ahora
    // solo estaba cubierto el tablist de Configuracion; este es el otro. Aqui las flechas mueven foco Y
    // seleccion (a diferencia del roving puro de Configuracion), asi que se miden las dos cosas — y se
    // vuelve con la flecha contraria para dejar activa la pestaña de partida.
    name: 'Accesibilidad: el tablist de conversaciones responde a flechas',
    async run(page) {
      const tablist = page.locator('[role="tablist"][aria-label^="Conversaciones abiertas"]');
      await tablist.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const tabs = tablist.locator('[role="tab"]');
      const total = await tabs.count();
      if (total < 2) return { ok: false, detail: `pestañas=${total} (hacen falta 2; las abren las comprobaciones anteriores)` };
      await tablist.locator('[role="tab"][aria-selected="true"]').first().focus();
      const start = await focusedTabLabel(page);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(CONFIG.settleMs);
      const moved = await focusedTabLabel(page);
      const selectedMoved = await selectedTabLabel(tablist);
      // Donde acabo el foco si NO es una pestaña. Sin esto, un fallo aqui solo dice "foco=''" y no
      // distingue "se fue a otro sitio" de "se cayo a <body>", que es la firma del bug de a11y que este
      // proyecto ya ha pagado dos veces (y la diferencia entre las dos es el arreglo).
      const landed = await page.evaluate(() => {
        const active = document.activeElement;
        if (active === null) return 'ninguno';
        return `${active.tagName.toLowerCase()} role=${active.getAttribute('role') ?? 'sin-role'} conectado=${active.isConnected}`;
      });
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(CONFIG.settleMs);
      const back = await focusedTabLabel(page);
      const ok = moved !== start && moved.length > 0 && selectedMoved === moved && back === start;
      return {
        ok,
        detail: `pestañas=${total} inicio=${JSON.stringify(start)} ArrowLeft foco=${JSON.stringify(moved)} (activeElement=${landed}) seleccionada=${JSON.stringify(selectedMoved)} ArrowRight=${JSON.stringify(back)}`,
      };
    },
  },
  {
    // GRUPOS DE PESTAÑAS (2026-09-17): al dividir, cada panel tiene SU barra con SUS pestañas. Antes la
    // barra era una sola y comun, asi que los dos paneles obedecian a la misma lista. Esto lo mide
    // sobre el DOM real porque el cambio es estructural: los tests de `splitLayout` prueban el arbol,
    // no que se pinten dos barras ni que cada una liste lo suyo.
    //
    // CONTRATO DE ESTADO: abre dos conversaciones temporales y divide; al terminar restaura el estado
    // que habia (mismo mecanismo que la comprobacion de arrastre).
    name: 'Grupos: al dividir, cada panel trae su propia barra de pestañas',
    async run(page) {
      const original = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat };
      });
      try {
        const barrasAntes = await page.evaluate(() => document.querySelectorAll('[role="tablist"][aria-label^="Conversaciones abiertas"]').length);

        await openTemporaryConversation(page);
        const tabA = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
        await openTemporaryConversation(page);
        const tabB = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
        // Se divide por la accion del store: el arrastre real ya lo cubre la comprobacion anterior, y
        // aqui lo que se mide es el resultado estructural, no el gesto.
        await page.evaluate((a) => window.__mageDev.store.getState().movePaneTab(a, [], 'left'), tabA);
        await page.waitForTimeout(CONFIG.settleMs);

        const medido = await page.evaluate(() => {
          const barras = [...document.querySelectorAll('[role="tablist"][aria-label^="Conversaciones abiertas"]')];
          return {
            barras: barras.length,
            // Pestañas de cada barra y cual marca como activa: dos barras que listaran lo mismo serian
            // exactamente el defecto que esto vigila.
            porBarra: barras.map((b) => ({
              pestanas: [...b.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('data-tab-id')),
              activa: b.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab-id') ?? null,
            })),
            // Un `+` por barra: crear una pestaña nueva tiene que poder dirigirse a un panel concreto.
            botonesNueva: document.querySelectorAll('button[aria-label="Nueva pestaña"]').length,
          };
        });

        const [izq, der] = medido.porBarra;
        // El perfil de verificacion ya trae pestañas de comprobaciones anteriores, asi que NO se puede
        // exigir "una en cada barra" (la primera medida real dio 1 y 3). Lo que se comprueba es la
        // propiedad de verdad: que las dos listas sean DISJUNTAS —invariante 3 del modelo, ninguna
        // pestaña en dos barras a la vez—, que cada panel enseñe una distinta, y que las dos pestañas
        // de este test acaben en paneles DISTINTOS, que es lo que significa "se ha dividido".
        const paneDe = (tabId) => (izq?.pestanas.includes(tabId) === true ? 0 : der?.pestanas.includes(tabId) === true ? 1 : -1);
        const solapan = izq === undefined || der === undefined || izq.pestanas.some((id) => der.pestanas.includes(id));
        const ok =
          barrasAntes === 1 &&
          medido.barras === 2 &&
          medido.botonesNueva === 2 &&
          izq !== undefined &&
          der !== undefined &&
          izq.pestanas.length > 0 &&
          der.pestanas.length > 0 &&
          !solapan &&
          izq.activa !== der.activa &&
          paneDe(tabA) !== -1 &&
          paneDe(tabA) !== paneDe(tabB);
        return { ok, detail: `barrasAntes=${barrasAntes} ${JSON.stringify(medido)}` };
      } finally {
        await page.evaluate((s) => window.__mageDev.store.setState(s), original);
        await page.waitForTimeout(CONFIG.settleMs);
      }
    },
  },
  {
    // VENTANAS FLOTANTES (2026-09-20, peticion del usuario): «no sirve de nada redondear los bordes y
    // dejar los margenes con angulos rectos». Se mide lo que de verdad falla a ojo: el radio en las
    // CUATRO esquinas de cada espacio de trabajo y que haya hueco a su alrededor por los cuatro lados
    // —incluido ARRIBA, contra la barra de titulo, que era donde se veia el angulo recto—.
    //
    // Mismo contrato de estado que las otras de grupos: divide con dos conversaciones temporales y
    // restaura lo que habia.
    name: 'Cada espacio de trabajo flota: redondeo en las cuatro esquinas y hueco por los cuatro lados',
    async run(page) {
      const original = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat };
      });
      try {
        await openTemporaryConversation(page);
        const tabA = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
        await openTemporaryConversation(page);
        await page.evaluate((a) => window.__mageDev.store.getState().movePaneTab(a, [], 'left'), tabA);
        await page.waitForTimeout(CONFIG.settleMs);

        const medido = await page.evaluate(() => {
          // El espacio de trabajo (barra de pestañas + chat) se marca con `data-workspace` justo para
          // esto: es la caja que tiene que flotar.
          const espacios = [...document.querySelectorAll('[data-workspace="pane"]')];
          const radios = espacios.map((nodo) => {
            const estilo = getComputedStyle(nodo);
            return [estilo.borderTopLeftRadius, estilo.borderTopRightRadius, estilo.borderBottomRightRadius, estilo.borderBottomLeftRadius].map(
              (valor) => Number.parseFloat(valor),
            );
          });
          const cajas = espacios.map((nodo) => nodo.getBoundingClientRect());
          // Hueco por arriba: contra la barra de titulo, que es lo que el usuario vio cuadrado.
          const barraTitulo = document.querySelector('[data-titlebar]');
          const topeSuperior = barraTitulo === null ? 0 : barraTitulo.getBoundingClientRect().bottom;
          return {
            espacios: espacios.length,
            radios,
            huecoArriba: cajas.map((caja) => Math.round(caja.top - topeSuperior)),
            // Separacion horizontal entre las dos ventanas. A la derecha NO se mide contra el borde de
            // la ventana: ahi vive el borde acoplable (otra isla), asi que el hueco util es el que hay
            // hasta ella, y eso ya lo cubre el hueco entre islas del shell.
            huecoEntre: cajas.length === 2 ? Math.round(cajas[1].left - cajas[0].right) : null,
            huecoAbajo: cajas.map((caja) => Math.round(window.innerHeight - caja.bottom)),
          };
        });

        const todasLasEsquinas = medido.radios.every((esquinas) => esquinas.length === 4 && esquinas.every((radio) => radio >= 4));
        const ok =
          medido.espacios === 2 &&
          todasLasEsquinas &&
          medido.huecoArriba.every((hueco) => hueco >= 3) &&
          medido.huecoAbajo.every((hueco) => hueco >= 3) &&
          (medido.huecoEntre ?? 0) >= 3;
        // Captura CON LA DIVISION PUESTA: la del final de la comprobacion se toma ya restaurada, y de
        // esto justamente hay que poder mirar el resultado (el harness mide, el ojo lo juzga).
        await page.screenshot({ path: path.join(CONFIG.outDir, 'espacios-divididos.png') }).catch(() => {});
        return { ok, detail: JSON.stringify(medido) };
      } finally {
        await page.evaluate((s) => window.__mageDev.store.setState(s), original);
        await page.waitForTimeout(CONFIG.settleMs);
      }
    },
  },
  {
    // TAMAÑO MINIMO DE PANEL: el divisor no puede dejar un panel en nada. Esto ya fallo una vez en el
    // otro sentido — un minimo de 320 px sobre un centro de ~406 congelaba el divisor en 0.5 y no
    // dejaba redimensionar—, asi que se mide lo que de verdad importa: que el reparto SE MUEVA y que
    // ninguno de los dos paneles quede por debajo de un ancho usable.
    name: 'Grupos: el divisor mueve el reparto y ningun panel queda inservible',
    async run(page) {
      const original = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat };
      });
      try {
        await openTemporaryConversation(page);
        const tabA = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
        await openTemporaryConversation(page);
        await page.evaluate((a) => window.__mageDev.store.getState().movePaneTab(a, [], 'left'), tabA);
        await page.waitForTimeout(CONFIG.settleMs);

        const ratioInicial = await page.evaluate(() => window.__mageDev.store.getState().splitLayout.ratio ?? null);
        // Se empuja el reparto a los dos extremos por la accion del store, pasando el ancho REAL del
        // contenedor: es el mismo camino que usa el arrastre del divisor.
        const medido = await page.evaluate(() => {
          const dev = window.__mageDev;
          const contenedor = document.querySelector('[data-pane-tab-id]')?.parentElement?.parentElement ?? null;
          const total = contenedor === null ? 0 : Math.round(contenedor.getBoundingClientRect().width);
          dev.store.getState().resizeSplitAt([], 0.99, total);
          const alTope = dev.store.getState().splitLayout.ratio ?? null;
          dev.store.getState().resizeSplitAt([], 0.01, total);
          const alOtro = dev.store.getState().splitLayout.ratio ?? null;
          return { total, alTope, alOtro };
        });
        await page.waitForTimeout(CONFIG.settleMs);
        const anchos = await page.evaluate(() =>
          [...document.querySelectorAll('[data-pane-tab-id]')].map((n) => Math.round(n.getBoundingClientRect().width)),
        );

        const ok =
          ratioInicial !== null &&
          medido.alTope !== null &&
          medido.alOtro !== null &&
          // Se mueve de verdad en los dos sentidos (el fallo que se colo: quedarse clavado en 0.5).
          medido.alTope > ratioInicial &&
          medido.alOtro < ratioInicial &&
          // Y nunca se va al borde: el acotado sigue puesto.
          medido.alTope <= 0.9 &&
          medido.alOtro >= 0.1 &&
          anchos.length === 2 &&
          anchos.every((w) => w >= Math.round(medido.total * 0.2));
        return { ok, detail: `ratioInicial=${ratioInicial} ${JSON.stringify(medido)} anchosDePanel=${JSON.stringify(anchos)}` };
      } finally {
        await page.evaluate((s) => window.__mageDev.store.setState(s), original);
        await page.waitForTimeout(CONFIG.settleMs);
      }
    },
  },
  {
    // I11-drag: arrastrar una pestaña sobre el panel de OTRA la divide, estilo VS Code/IntelliJ —
    // soltar cerca del borde izquierdo crea un panel nuevo a la izquierda con la arrastrada. La medida
    // real es el numero de areas de prompt (1 -> 2) y que el panel nuevo muestra la pestaña arrastrada
    // (por su ancla `data-pane-tab-id`, no por texto). Usa DOS PESTAÑAS PROPIAS (creadas y cerradas
    // aqui mismo) para no depender de que otra comprobacion haya dejado exactamente 2 pestañas
    // abiertas; el estado previo se restaura por `window.__mageDev` al terminar (mismo mecanismo que
    // ya usa el grupo de hidratacion), asi que las comprobaciones de despues no ven ninguna pestaña
    // de mas. Va la ultima antes del grupo de hidratacion: con dos paneles montados a mitad de la
    // prueba, los localizadores de prompt de cualquier comprobacion CONCURRENTE dejarian de ser unicos.
    name: 'Dividir workspace: arrastrar una pestaña a un panel lo divide (I11-drag)',
    async run(page) {
      const before0 = await promptAreas(page).count();
      const originalState = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat };
      });

      await openTemporaryConversation(page); // pestaña A, queda activa y sola en el panel
      const tabAId = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      await openTemporaryConversation(page); // pestaña B, ocupa el panel; A ya no se ve en ningun lado
      const tabBId = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);

      const before = await promptAreas(page).count();
      const targetPane = page.locator(`[data-pane-tab-id="${tabBId}"]`);
      const box = await targetPane.boundingBox();
      const sourceTab = page.locator(`[role="tab"][data-tab-id="${tabAId}"]`);
      // Soltar al 10% del ancho: bien dentro de la zona 'left' (la mitad izquierda), lejos del centro.
      await sourceTab.dragTo(targetPane, { targetPosition: { x: Math.round(box.width * 0.1), y: Math.round(box.height / 2) } });
      await page.waitForTimeout(CONFIG.settleMs);

      const after = await promptAreas(page).count();
      const draggedPane = page.locator(`[data-pane-tab-id="${tabAId}"]`);
      const targetPaneAfter = page.locator(`[data-pane-tab-id="${tabBId}"]`);
      const draggedPaneVisible = await draggedPane.count();
      const targetStillVisible = await targetPaneAfter.count();
      // Soltar al 10% cae en la zona 'left': la arrastrada debe quedar a la IZQUIERDA de la destino (no
      // al reves) y pasar a ser la pestaña activa — las dos cosas que un `dragTo` mal leido (zona
      // recalculada de un estado de `dragover` obsoleto, o el `.focus()` de montaje robando el foco a
      // la pestaña equivocada, ver PromptBar.tsx/ChatPane.tsx) dejaba invertidas sin que "hay 2 areas"
      // lo detectara.
      const draggedBox = draggedPaneVisible === 1 ? await draggedPane.boundingBox() : null;
      const targetBox = targetStillVisible === 1 ? await targetPaneAfter.boundingBox() : null;
      const draggedIsLeft = draggedBox !== null && targetBox !== null && draggedBox.x < targetBox.x;
      const activeAfterDrop = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      const draggedBecameActive = activeAfterDrop === tabAId;
      // Con la division montada, se mide de paso la ZONA DE AGARRE de su divisoria (feedback del
      // 2026-09-15: "no se ve y cuesta cogerla"). No se mide el ancho de la caja —la linea sigue siendo
      // de 1 px a proposito— sino a quien le llega el raton 3 px a cada lado: el `::after` invisible
      // hace que esos puntos sean del propio separador. Si alguien quita el pseudo-elemento, aqui caen
      // los paneles vecinos y la comprobacion falla.
      const grabbable = await page.evaluate(() => {
        const handle = document.querySelector('[role="separator"][aria-label="Redimensionar la división de paneles"]');
        if (handle === null) return null;
        const box = handle.getBoundingClientRect();
        const y = box.top + box.height / 2;
        const x = box.left + box.width / 2;
        const hits = [-3, 0, 3].map((offset) => document.elementFromPoint(x + offset, y) === handle);
        return { hits, width: Math.round(box.width) };
      });
      const grabOk = grabbable !== null && grabbable.hits.every(Boolean);
      // Y el arrastre en si: el reparto se mueve EN VIVO por variable CSS (el panel cambia de ancho
      // mientras el raton esta abajo) y el store NO se toca hasta soltar — la restriccion de rendimiento
      // que `ZoneResizeHandle` ya cumplia y esta divisoria no. Las tres medidas son: ancho del panel
      // durante el arrastre, ratio del store durante el arrastre (debe seguir igual) y ratio tras soltar.
      const splitRatio = () =>
        page.evaluate(() => {
          const layout = window.__mageDev.store.getState().splitLayout;
          return layout.kind === 'leaf' ? null : layout.ratio;
        });
      const handleBox = await page.locator('[role="separator"][aria-label="Redimensionar la división de paneles"]').boundingBox();
      const widthBefore = (await draggedPane.boundingBox())?.width ?? 0;
      const ratioBefore = await splitRatio();
      const handleY = handleBox.y + handleBox.height / 2;
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleY);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + 120, handleY, { steps: 8 });
      const widthDuring = (await draggedPane.boundingBox())?.width ?? 0;
      const ratioDuring = await splitRatio();
      await page.mouse.up();
      await page.waitForTimeout(CONFIG.settleMs);
      const ratioAfter = await splitRatio();
      const dragOk = ratioBefore !== null && ratioAfter !== null && widthDuring > widthBefore + 50 && ratioDuring === ratioBefore && ratioAfter > ratioBefore;

      await page.evaluate((state) => window.__mageDev.store.setState(state), originalState);
      await page.waitForTimeout(CONFIG.settleMs);
      const restored = await promptAreas(page).count();

      const ok =
        before === 1 &&
        after === 2 &&
        draggedPaneVisible === 1 &&
        targetStillVisible === 1 &&
        draggedIsLeft &&
        draggedBecameActive &&
        grabOk &&
        dragOk &&
        restored === before0;
      return {
        ok,
        detail: `areas de prompt ${before}->${after} (arrastrada visible=${draggedPaneVisible === 1}, destino sigue visible=${targetStillVisible === 1}, arrastrada a la izquierda=${draggedIsLeft}, arrastrada activa=${draggedBecameActive}) divisoria: linea=${grabbable?.width ?? '?'}px agarre en -3/0/+3 px=${JSON.stringify(grabbable?.hits ?? null)} arrastre: ancho ${Math.round(widthBefore)}->${Math.round(widthDuring)}px ratio ${ratioBefore}--(durante)-->${ratioDuring}--(al soltar)-->${ratioAfter} tras restaurar=${restored} (antes de empezar=${before0})`,
      };
    },
  },
  {
    // Decision del usuario (2026-09-15): "Cerrar todas" ya NO pide confirmacion. Se mide el efecto (las
    // pestañas se cierran con UN clic) y la ausencia de la confirmacion que habia dentro del menu (su
    // boton "Cancelar"). Abre y cierra sus propias pestañas y restaura el estado previo, como la
    // comprobacion de I11-drag.
    name: 'Cerrar todas: un solo clic cierra, sin confirmacion dentro del menu',
    async run(page) {
      const originalState = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat };
      });
      await openTemporaryConversation(page);
      await openTemporaryConversation(page);
      // Las ancladas sobreviven a "Cerrar todas": lo que debe quedar es exactamente ese resto.
      const antes = await page.evaluate(() => {
        const tabs = window.__mageDev.store.getState().tabs;
        return { total: tabs.length, ancladas: tabs.filter((t) => t.pinned === true).length };
      });

      const active = page.locator('[role="tablist"][aria-label^="Conversaciones abiertas"] [role="tab"][aria-selected="true"]');
      const selected = await active.count();
      if (selected !== 1) return { ok: false, detail: `pestañas seleccionadas=${selected} (se esperaba 1; no se clica nada)` };
      await active.click({ button: 'right' });
      await page.locator(TAB_MENU).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await page.locator(TAB_MENU).getByRole('menuitem', { name: /^Cerrar todas/ }).click();

      // La medida de "sin confirmacion" es que el menu se DESMONTA con ese unico clic: la confirmacion
      // vivia dentro y lo habria dejado abierto esperando. Se espera al desmontaje, no a un tiempo fijo
      // (error §6 de la skill `verificacion-gui`: durante la animacion de salida el menu sigue en el DOM
      // — contar sus botones daba 15, que son las muestras de color, no una confirmacion).
      let menuCerrado = true;
      try {
        await page.locator(TAB_MENU).waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      } catch {
        menuCerrado = false;
      }
      const after = await page.evaluate(() => window.__mageDev.store.getState().tabs.length);

      await page.evaluate((state) => window.__mageDev.store.setState(state), originalState);
      await page.waitForTimeout(CONFIG.settleMs);
      const restored = await page.evaluate(() => window.__mageDev.store.getState().tabs.length);
      const ok = antes.total >= 2 && menuCerrado && after === antes.ancladas && restored === originalState.tabs.length;
      return {
        ok,
        detail: `pestañas ${antes.total}->${after} (ancladas=${antes.ancladas}) menu desmontado con un clic=${menuCerrado} tras restaurar=${restored}`,
      };
    },
  },
  {
    // Decision del usuario (2026-09-15): cerrar una conversacion con trabajo en vuelo NO lo corta — se
    // va a segundo plano y su fila del panel de Conversaciones lo dice. Se mide en DOS tramos porque
    // cada uno falla por su cuenta: (a) `closeTab` con estado 'streaming' NO para el CLI y apunta la
    // sesion; (b) con la sesion ya en 'done', la fila del historial pinta la pastilla REVISAR. La
    // sesion es FALSA (un id inventado, nunca se spawnea el CLI) y el estado previo se restaura.
    name: 'Segundo plano: cerrar con trabajo en vuelo no corta, y la fila queda pendiente de revisar',
    async run(page) {
      const originalState = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return {
          tabs: s.tabs,
          activeTabId: s.activeTabId,
          splitLayout: s.splitLayout,
          sessionIdByChat: s.sessionIdByChat,
          statusByChat: s.statusByChat,
          conversationHistory: s.conversationHistory,
          backgroundSessions: s.backgroundSessions,
        };
      });
      await openTemporaryConversation(page);
      const cerrado = await page.evaluate(async () => {
        const store = window.__mageDev.store;
        const tabId = store.getState().activeTabId;
        const { cwd, title, privacy } = store.getState().tabs.find((t) => t.id === tabId);
        store.setState({
          sessionIdByChat: { ...store.getState().sessionIdByChat, [tabId]: 'vg-fondo' },
          statusByChat: { ...store.getState().statusByChat, [tabId]: 'streaming' },
        });
        await store.getState().closeTab(tabId);
        const entry = store.getState().backgroundSessions['vg-fondo'];
        return { estado: entry?.state ?? null, cwd, title, privacy, sigueAbierta: store.getState().tabs.some((t) => t.id === tabId) };
      });
      // Turno terminado: se pone a mano (inyectar el evento dispararia una recarga del historial por IPC
      // que borraria la fila sintetica de abajo a mitad de la medida). Por lo mismo, mientras se mide no
      // recarga nadie: ni el sondeo de App.tsx (30 s) ni el fin de turno de otra sesion en segundo plano
      // de una comprobacion anterior. `closeTab` ya ha esperado la suya; el final lo repone.
      await page.evaluate((info) => {
        const store = window.__mageDev.store;
        window.__mageVerifyLoadHistory = store.getState().loadConversationHistory;
        store.setState({ loadConversationHistory: async () => undefined });
        const entry = store.getState().backgroundSessions['vg-fondo'];
        store.setState({
          backgroundSessions: { ...store.getState().backgroundSessions, 'vg-fondo': { ...entry, state: 'done' } },
          conversationHistory: [
            { sessionId: 'vg-fondo', title: info.title, cwd: info.cwd, privacy: info.privacy, updatedAtMs: Date.now(), configDir: '' },
          ],
        });
      }, cerrado);
      await page.waitForTimeout(CONFIG.settleMs);
      const fila = await page.evaluate(() => {
        const badge = document.querySelector('[data-background-badge]');
        const row = badge?.closest('button');
        return {
          pastillas: document.querySelectorAll('[data-background-badge]').length,
          estado: badge?.getAttribute('data-background-badge') ?? null,
          texto: (row?.textContent ?? '').trim(),
        };
      });

      await page.evaluate((state) => window.__mageDev.store.setState({ ...state, loadConversationHistory: window.__mageVerifyLoadHistory }), originalState);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        cerrado.estado === 'working' &&
        cerrado.sigueAbierta === false &&
        fila.pastillas === 1 &&
        fila.estado === 'done' &&
        fila.texto.includes('pendiente de revisión');
      return {
        ok,
        detail: `al cerrar: estado=${cerrado.estado} pestaña cerrada=${!cerrado.sigueAbierta} · fila: pastillas=${fila.pastillas} estado=${fila.estado} texto=${JSON.stringify(fila.texto)}`,
      };
    },
  },
  // --- GRUPO NUEVO (Fase A): las que HIDRATAN el chat ------------------------------------------------
  //
  // Van las ultimas y en bloque, por contrato de orden: un chat con contenido cambia el DOM que miden
  // las anteriores (y la #38 ya deja el workspace dividido y vuelto a juntar). Ninguna pulsa `Enter`,
  // ninguna spawnea el CLI: los bloques se inyectan por el `__mageDev` de desarrollo (devBridge.ts),
  // que no existe en el bundle de produccion. La PRIMERA abre su propia conversacion con "Carpeta
  // temporal" y las otras dos la reutilizan (cada una reemplaza los bloques de la anterior).
  {
    // 2.6, el bug medido: el contenedor del chat es `flex-col` y `ToolBlock` lleva `overflow-hidden`, asi
    // que recibia minimo automatico 0 y en cuanto la conversacion DESBORDABA el alto disponible el
    // navegador lo encogia a 2 px (cajas de herramienta convertidas en rayas, img_8/img_10). Por eso se
    // hidratan ~60 bloques y no cuatro: sin desbordamiento el sintoma no aparece — se comprueba que
    // desborda de verdad, o la medida no estaria midiendo nada.
    name: '2.6: ningun bloque del chat mide menos de 8 px',
    async run(page) {
      await openTemporaryConversation(page);
      const hydrated = await page.evaluate((total) => {
        const dev = window.__mageDev;
        if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
        const tabId = dev.store.getState().activeTabId;
        const blocks = [];
        for (let i = 0; i < total; i += 1) {
          const slot = i % 5;
          if (slot === 0) blocks.push({ kind: 'user', id: `vg-u${i}`, text: `Mensaje del usuario ${i}`, time: '12:00', attachments: [] });
          else if (slot === 2) blocks.push({ kind: 'agent', id: `vg-a${i}`, runs: [{ code: false, text: `Respuesta del agente ${i}` }], streaming: false });
          else
            blocks.push({
              kind: 'tool',
              id: `vg-t${i}`,
              toolUseId: `vg-tu${i}`,
              tool: 'Read',
              command: `src/fichero-${i}.ts`,
              meta: 'ok · 12 ms',
              output: [{ code: false, text: `salida de la herramienta ${i}` }],
              filePath: null,
              previewLines: null,
              // Desde P-026 3.4 una herramienta solo deja rastro en el chat si FALLA (la linea de D22):
              // con error, siguen siendo items del hilo que el bug de 2.6 podia aplastar.
              isError: true,
              parentToolUseId: null,
            });
        }
        dev.store.setState({ blocksByChat: { ...dev.store.getState().blocksByChat, [tabId]: blocks } });
        return blocks.length;
      }, HYDRATED_BLOCK_COUNT);
      await page.waitForTimeout(CONFIG.settleMs);

      const measured = await measureBlockHeights(page);
      const ok =
        measured !== null &&
        measured.bloques === hydrated &&
        measured.tools >= 12 &&
        measured.desborda &&
        measured.pordebajode8 === 0 &&
        measured.minAltura >= 8;
      return { ok, detail: `hidratados=${hydrated} ${JSON.stringify(measured)}` };
    },
  },
  {
    // 2.12.1 + 2.12.3, de punta a punta: se hidrata con las TRES entradas REALES de la conversacion
    // medida (indices 5, 12 y 61 de 9253933c-…) pasadas por el `transcriptToBlocks` de la app. La
    // entrada 5 es UN solo mensaje con [texto, imagen]; las 12 y 61 son `isMeta` (el aviso del
    // image-cache de img_6 y el `<system-reminder>` de img_10) y no deben pintar nada.
    // `naturalWidth > 0` es lo que distingue "pinta la imagen" de "pinta un `data:` roto".
    name: '2.12.1/2.12.3: isMeta invisible y la imagen en la misma burbuja',
    async run(page) {
      const blocks = await hydrateFromEntries(page, REAL_TRANSCRIPT_ENTRIES);
      const measured = await waitForUserBubbles(page, (m) => m.naturalWidth > 0);
      const ok =
        measured !== null &&
        blocks === 1 &&
        measured.burbujas === 1 &&
        measured.conSystemReminder === 0 &&
        measured.conAvisoDeImagen === 0 &&
        measured.conImagenYTexto === 1 &&
        measured.naturalWidth > 0;
      return { ok, detail: `entradas=${REAL_TRANSCRIPT_ENTRIES.length} bloques=${blocks} ${JSON.stringify(measured)}` };
    },
  },
  {
    // P-026, 1.3: el Markdown trataba «\ + cualquier caracter» como escape, y una ruta de Windows salia
    // como `C:Usersx` en todos los mensajes. CommonMark solo escapa puntuacion ASCII.
    name: 'Markdown: una ruta de Windows conserva sus barras invertidas en la burbuja',
    async run(page) {
      const previo = await page.evaluate(() => window.__mageDev.store.getState().blocksByChat);
      await hydrateBlocks(page, [
        { kind: 'user', id: 'vg-ruta', text: 'mira C:\\Users\\x\\notas.md y \\*esto\\*', time: '12:00', attachments: [] },
      ]);
      const texto = await page.evaluate(() => document.querySelector('[data-block="user"]')?.textContent ?? '');
      await page.evaluate((estado) => window.__mageDev.store.setState({ blocksByChat: estado }), previo);
      const ok = texto.includes('C:\\Users\\x\\notas.md') && texto.includes('*esto*') && !texto.includes('\\*');
      return { ok, detail: `texto=${JSON.stringify(texto)}` };
    },
  },
  {
    // P-028, 8 + 12: «Copiar» en el bloque de codigo (con y sin `lang`), en la burbuja del agente y en la
    // del usuario. `writeText` va MOCKEADO: el portapapeles real del SO falla en silencio (ver 2.9.b).
    // Cada boton copia el markdown CRUDO (el texto exacto del bloque, no el renderizado).
    name: 'P-028 8/12: los botones Copiar entregan el markdown crudo de su bloque',
    async run(page) {
      const previo = await page.evaluate(() => window.__mageDev.store.getState().blocksByChat);
      const crudo = 'Mira **esto**:\n\n```ts\nconst a = 1;\n```\n\n```\nsin lenguaje\n```';
      await hydrateBlocks(page, [
        { kind: 'user', id: 'vg-cp-u', text: 'Pregunta con **negrita**', time: '12:00', attachments: [] },
        { kind: 'agent', id: 'vg-cp-a', runs: [{ code: false, text: crudo }], streaming: false },
      ]);
      const medido = await page.evaluate(async () => {
        const copiados = [];
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (t) => void copiados.push(t) },
        });
        try {
          const botones = [...document.querySelectorAll('[data-copy-button="true"]')];
          for (const boton of botones) {
            boton.click();
            await new Promise((r) => setTimeout(r, 30));
          }
          return { botones: botones.length, copiados, etiquetas: botones.map((b) => b.getAttribute('aria-label')) };
        } finally {
          // El mock es una propiedad PROPIA de `navigator` que tapa el getter del prototipo: borrarla
          // devuelve el portapapeles real. Sin esto, Artifacts (mas abajo) moria con `readText is not
          // a function`.
          delete navigator.clipboard;
        }
      });
      await page.evaluate((estado) => window.__mageDev.store.setState({ blocksByChat: estado }), previo);
      const ok =
        medido.botones === 4 && // usuario, agente, codigo con lang, codigo sin lang
        medido.copiados.includes('Pregunta con **negrita**') &&
        medido.copiados.includes(crudo) &&
        medido.copiados.includes('const a = 1;') &&
        medido.copiados.includes('sin lenguaje');
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // P-028, 25 (+13): un mensaje nuevo del usuario lleva al final aunque el chat estuviera arriba del
    // todo. Se anade el bloque por el store (lo mismo que hace `sendActiveMessage`); NUNCA Enter.
    name: 'P-028 25: un mensaje nuevo del usuario aterriza al fondo aunque se hubiera subido',
    async run(page) {
      const previo = await page.evaluate(() => window.__mageDev.store.getState().blocksByChat);
      const hilo = Array.from({ length: 40 }, (_, i) =>
        i % 2 === 0
          ? { kind: 'user', id: `vg-sb-u${i}`, text: `Pregunta ${i}\n\n${'linea\n\n'.repeat(4)}`, time: '12:00', attachments: [] }
          : { kind: 'agent', id: `vg-sb-a${i}`, runs: [{ code: false, text: `Respuesta ${i}\n\n${'texto\n\n'.repeat(4)}` }], streaming: false },
      );
      await hydrateBlocks(page, hilo);
      const arriba = await page.evaluate(() => {
        const cont = document.querySelector('[data-block]')?.closest('.overflow-y-auto');
        if (cont === null || cont === undefined) return null;
        cont.scrollTop = 0;
        cont.dispatchEvent(new Event('scroll', { bubbles: true }));
        return { scrollable: cont.scrollHeight - cont.clientHeight };
      });
      await hydrateBlocks(page, [
        ...hilo,
        { kind: 'user', id: 'vg-sb-nuevo', text: 'Mensaje nuevo', time: '12:01', attachments: [] },
      ]);
      const distancia = await page.evaluate(() => {
        const cont = document.querySelector('[data-block]')?.closest('.overflow-y-auto');
        return cont === null || cont === undefined ? null : cont.scrollHeight - cont.scrollTop - cont.clientHeight;
      });
      await page.evaluate((estado) => window.__mageDev.store.setState({ blocksByChat: estado }), previo);
      const ok = arriba !== null && arriba.scrollable > 200 && distancia !== null && distancia < 2;
      return { ok, detail: `arriba=${JSON.stringify(arriba)} distanciaAlFondo=${distancia}` };
    },
  },
  {
    // P-028, 28: la tarjeta de tarea programada dice quien la lanza.
    name: 'P-028 28: la tarea programada avisa de que la lanza la app de escritorio de Claude',
    async run(page) {
      const previo = await page.evaluate(() => window.__mageDev.store.getState().blocksByChat);
      await hydrateBlocks(page, [
        {
          kind: 'user',
          id: 'vg-sch',
          text: '<scheduled-task name="revisar" file="x">\nHaz algo\n</scheduled-task>',
          time: '12:00',
          attachments: [],
        },
      ]);
      const texto = await page.evaluate(() => document.querySelector('[data-scheduled-task="true"]')?.textContent ?? null);
      await page.evaluate((estado) => window.__mageDev.store.setState({ blocksByChat: estado }), previo);
      const ok = texto !== null && texto.includes('las lanza la app de escritorio de Claude');
      return { ok, detail: `texto=${JSON.stringify(texto)}` };
    },
  },
  {
    // P-026, 3.3 (D14-D16): una pregunta de TRES pasos queda anclada encima del input, fuera del hilo, y se
    // maneja con el teclado sin tocar el input. Se inyecta por el reducer real y se cancela al final por
    // el mismo camino que el CLI. Nunca se pulsa Enter (contestaria).
    name: 'Preguntas: el dock va encima del input, fuera del hilo, y se maneja con el teclado',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      const base = ASK_USER_QUESTION_INPUT.questions[0];
      const tres = { questions: [base, { ...base, question: '¿Y de fondo?' }, { ...base, question: '¿Y el borde?' }] };
      await injectPermissionRequest(page, tres, 'vg-ask-3');
      const dock = page.locator('[data-question-dock="true"]');
      await dock.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await page.waitForTimeout(CONFIG.settleMs);
      const posicion = await page.evaluate(() => {
        const d = document.querySelector('[data-question-dock="true"]').getBoundingClientRect();
        const fila = document.querySelector('[data-prompt-editor="true"]').parentElement.getBoundingClientRect();
        const scroller = document.querySelector('[data-pane-tab-id] [class*="overflow-y-auto"]');
        if (scroller !== null) scroller.scrollTop = 0;
        return {
          encimaDelInput: d.bottom <= fila.top + 1,
          contador: document.querySelector('[data-question-counter]')?.textContent?.trim() ?? null,
          enElHilo: document.querySelectorAll('[data-block="question"]').length,
        };
      });
      const visibleTrasScroll = await dock.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight;
      });
      await dock.focus();
      await page.keyboard.press('Digit2');
      await page.waitForTimeout(CONFIG.settleMs);
      const trasElegir = await page.evaluate(() => ({
        opcion2: document.querySelectorAll('[data-question-dock] [role="radio"]')[1]?.getAttribute('aria-checked') ?? null,
        sigue: window.__mageDev.store.getState().pendingByChat[window.__mageDev.store.getState().activeTabId]?.[0]?.requestId ?? null,
      }));
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(CONFIG.settleMs);
      const contadorTras = await page.evaluate(() => document.querySelector('[data-question-counter]')?.textContent?.trim() ?? null);
      await cancelInjectedPermission(page, 'vg-ask-3');
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        posicion.encimaDelInput &&
        posicion.contador === '1 de 3' &&
        posicion.enElHilo === 0 &&
        visibleTrasScroll &&
        trasElegir.opcion2 === 'true' &&
        trasElegir.sigue === 'vg-ask-3' &&
        contadorTras === '2 de 3';
      return { ok, detail: JSON.stringify({ ...posicion, visibleTrasScroll, ...trasElegir, contadorTras }) };
    },
  },
  {
    // P-026, 3.2 (D13): pegar imagenes deja un token `[Imagen N]` en el cursor por cada una, y quitar una
    // miniatura quita su token y renumera. Pegado sintetico; el borrador se limpia al final.
    name: 'Prompt: pegar dos imagenes deja [Imagen 1] y [Imagen 2], y quitar la primera renumera',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      const tabId = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      const leer = () =>
        page.evaluate((id) => ({
          texto: window.__mageDev.store.getState().draftByChat[id]?.text ?? '',
          miniaturas: document.querySelectorAll('img[data-attachment="thumb"]').length,
        }), tabId);
      await pasteFiles(page, [
        { name: 'uno.png', type: 'image/png', base64: TINY_PNG_BASE64 },
        { name: 'dos.png', type: 'image/png', base64: TINY_PNG_BASE64 },
      ]);
      await page.waitForTimeout(CONFIG.settleMs * 2);
      const pegadas = await leer();
      await page.getByRole('button', { name: 'Quitar el adjunto 1' }).click();
      await page.waitForTimeout(CONFIG.settleMs);
      const trasQuitar = await leer();
      await page.evaluate((id) => window.__mageDev.store.getState().setDraft(id, null), tabId);
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        pegadas.texto.includes('[Imagen 1]') &&
        pegadas.texto.includes('[Imagen 2]') &&
        pegadas.miniaturas === 2 &&
        trasQuitar.texto.includes('[Imagen 1]') &&
        !trasQuitar.texto.includes('[Imagen 2]') &&
        trasQuitar.miniaturas === 1;
      return { ok, detail: `pegadas=${JSON.stringify(pegadas)} tras quitar la 1=${JSON.stringify(trasQuitar)}` };
    },
  },
  {
    // P-026, 3.1 (D17): con el texto largo, los selectores bajan a su fila y el editor se queda con el
    // ancho; con el input vacio, vuelven al lado del texto. Borrador fijado por el store (no se envia).
    name: 'Prompt: los selectores bajan cuando el texto salta de linea y vuelven con el input vacio',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      // Ventana ANCHA: con los dos docks abiertos el chat de la ventana por defecto mide ~500 px, y ahi los
      // selectores no caben al lado del texto ni vacio (bajan por el flex-wrap, que es el otro mecanismo).
      const ventanaPrevia = page.viewportSize();
      await page.setViewportSize({ width: 1800, height: 900 });
      await page.waitForTimeout(CONFIG.settleMs * 2);
      const tabId = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      const medir = () =>
        page.evaluate(() => {
          const host = document.querySelector('[data-prompt-editor="true"]');
          const editor = host?.querySelector('.cm-editor');
          const controles = document.querySelector('[data-prompt-controls="true"]');
          if (!host || !editor || !controles) return null;
          const e = editor.getBoundingClientRect();
          const c = controles.getBoundingClientRect();
          const fila = host.parentElement.getBoundingClientRect();
          return { editorTop: e.top, editorBottom: e.bottom, controlesTop: c.top, anchoEditor: host.offsetWidth, anchoFila: fila.width, disposicion: host.getAttribute('data-prompt-layout') };
        });
      await page.evaluate((id) => window.__mageDev.store.getState().setDraft(id, { text: 'a'.repeat(400), attachments: [] }), tabId);
      await page.waitForTimeout(CONFIG.settleMs * 3);
      await waitForStillBox(page, '[data-prompt-controls="true"]');
      const largo = await medir();
      await page.evaluate((id) => window.__mageDev.store.getState().setDraft(id, null), tabId);
      await page.waitForTimeout(CONFIG.settleMs * 3);
      await waitForStillBox(page, '[data-prompt-controls="true"]');
      const vacio = await medir();
      if (ventanaPrevia !== null) await page.setViewportSize(ventanaPrevia);
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        largo !== null &&
        vacio !== null &&
        largo.disposicion === 'stacked' &&
        largo.controlesTop >= largo.editorBottom - 1 &&
        largo.anchoEditor >= largo.anchoFila * 0.9 &&
        vacio.disposicion === 'inline' &&
        Math.abs(vacio.controlesTop - vacio.editorTop) <= 4;
      return { ok, detail: JSON.stringify({ largo, vacio }) };
    },
  },
  {
    // P-026, 2.7 (D5): pulsar otra cuenta con una conversacion PARADA de la activa pregunta si migrarla.
    // La pestaña lleva un `resumeSessionId` FALSO (nada se reanuda) y solo se pulsa «Abrir un chat nuevo
    // en <B>» (P-028, 26: sustituye a «Solo cambiar de cuenta»), que no mueve nada: la pestaña tiene que
    // seguir ahi, en su cuenta, y la activa pasa a B con un chat nuevo. Se restaura todo al final. Si
    // solo hay una cuenta, no hay a donde cambiar: se da por no aplicable.
    name: 'Cambiar de cuenta con una conversación parada pregunta si migrarla',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, activeAccountId: s.activeAccountId };
      });
      const otra = page.locator('[role="group"][aria-label="Cuentas"] button[aria-pressed="false"]');
      if ((await otra.count()) === 0) return { ok: true, detail: 'una sola cuenta: no aplicable' };
      await openTemporaryConversation(page);
      const tabId = await page.evaluate(() => {
        const store = window.__mageDev.store;
        const { activeTabId, tabs } = store.getState();
        store.setState({ tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, resumeSessionId: 'vg-migrar' } : t)) });
        return activeTabId;
      });
      await otra.first().click();
      const dialogo = page.locator('[data-account-switch-dialog="true"]');
      await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const botones = await dialogo.locator('button').evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? '').trim()));
      const lineaMigrar = /Compartida: se reanuda con .+\. Privada: se mueve a /.test((await dialogo.textContent()) ?? '');
      await dialogo.getByRole('button', { name: /^Abrir un chat nuevo en / }).click();
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const tras = await page.evaluate((id) => {
        const s = window.__mageDev.store.getState();
        return { pestanaSigue: s.tabs.some((t) => t.id === id && t.resumeSessionId === 'vg-migrar'), cuentaActiva: s.activeAccountId };
      }, tabId);
      await page.evaluate((estado) => {
        window.__mageDev.store.getState().setActiveAccount(estado.activeAccountId);
        window.__mageDev.store.setState({ tabs: estado.tabs, activeTabId: estado.activeTabId, splitLayout: estado.splitLayout });
      }, previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        botones.some((t) => t.startsWith('Abrir un chat nuevo en')) &&
        lineaMigrar &&
        botones.some((t) => t.startsWith('Migrar la conversación a')) &&
        tras.pestanaSigue &&
        tras.cuentaActiva !== previo.activeAccountId;
      return { ok, detail: `botones=${JSON.stringify(botones)} lineaMigrar=${lineaMigrar} tras «Chat nuevo»=${JSON.stringify({ pestanaSigue: tras.pestanaSigue, cambioDeCuenta: tras.cuentaActiva !== previo.activeAccountId })}` };
    },
  },
  {
    // P-028, punto 2: cada pestaña lleva el MONOGRAMA de su cuenta y, si no es de Claude, una marca
    // corta del proveedor; la barra de estado dice el proveedor de la pestaña ENFOCADA. Se simula una
    // pestaña de agy cambiando solo su `provider` en el store (no se lanza nada) y se restaura.
    name: '2: monograma de la cuenta en la pestaña y marca «agy» también en la barra de estado',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      const medido = await page.evaluate(async () => {
        const store = window.__mageDev.store;
        const { activeTabId, tabs, accounts } = store.getState();
        const cuenta = accounts.find((a) => a.id === tabs.find((t) => t.id === activeTabId)?.accountId);
        const pestana = () => document.querySelector(`[data-tab-id="${activeTabId}"]`);
        const monograma = pestana()?.querySelector('[data-tab-monogram]')?.textContent ?? null;
        const proveedorAntes = document.querySelector('[data-status-provider]')?.textContent ?? null;
        store.setState({ tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, provider: 'agy' } : t)) });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
          monograma,
          esperado: cuenta?.monogram ?? null,
          marcaClaude: proveedorAntes,
          marcaAgy: pestana()?.querySelector('[data-tab-provider]')?.textContent ?? null,
          barraAgy: document.querySelector('[data-status-provider]')?.textContent ?? null,
        };
      });
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        medido.monograma !== null &&
        medido.monograma === medido.esperado &&
        medido.marcaClaude === 'Claude' &&
        medido.marcaAgy === 'agy' &&
        medido.barraAgy === 'agy';
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // P-028, punto 22: el popover de uso se titula «Uso general» y, por cuenta, o bien dice «sin dato»
    // o bien trae las DOS ventanas con su reset (5 h y 7 d). Nunca un 0 % de relleno.
    name: '22: popover «Uso general» con 5 h y 7 d y su reset por cuenta',
    async run(page) {
      const disparador = page.locator('span[tabindex="0"]', { hasText: /5h \d+% · sem/ }).first();
      if ((await disparador.count()) === 0) return { ok: false, detail: 'sin indicador de uso en la barra' };
      await disparador.hover();
      await page.waitForTimeout(CONFIG.settleMs);
      const medido = await page.evaluate(() => {
        const pop = document.querySelector('[data-usage-popover="true"]');
        const filas = [...(pop?.querySelectorAll('[data-usage-account]') ?? [])].map((f) => ({
          sinDato: /sin dato/.test(f.textContent ?? ''),
          ventanas: [...f.querySelectorAll('[data-usage-window]')].map((w) => (w.textContent ?? '').trim()),
        }));
        return { titulo: /USO GENERAL/.test(pop?.textContent ?? ''), filas };
      });
      await page.mouse.move(0, 0);
      const filasOk = medido.filas.every((f) => f.sinDato || (f.ventanas.length === 2 && f.ventanas.every((t) => /% · reset /.test(t))));
      return { ok: medido.titulo && medido.filas.length > 0 && filasOk, detail: JSON.stringify(medido) };
    },
  },
  {
    // P-028, punto 31: con un chat NUEVO (sin mensajes ni sesion), pulsar otra cuenta se lo lleva sin
    // preguntar. No se envia nada: solo se mira el `accountId` de la pestaña. Se restaura al final.
    name: '31: un chat nuevo sigue a la cuenta pulsada sin diálogo',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, activeAccountId: s.activeAccountId };
      });
      const destino = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return s.accounts.find((a) => a.id !== s.activeAccountId && a.loginStatus === 'logged_in')?.id ?? null;
      });
      if (destino === null) return { ok: true, detail: 'sin otra cuenta con login: no aplicable' };
      await openTemporaryConversation(page);
      const tabId = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      const indice = await page.evaluate((id) => window.__mageDev.store.getState().accounts.findIndex((a) => a.id === id), destino);
      await page.locator('[role="group"][aria-label="Cuentas"] button[aria-pressed]').nth(indice).click();
      await page.waitForTimeout(CONFIG.settleMs);
      const tras = await page.evaluate((id) => {
        const s = window.__mageDev.store.getState();
        return { dialogo: s.accountSwitchPrompt !== null, cuentaPestana: s.tabs.find((t) => t.id === id)?.accountId ?? null };
      }, tabId);
      await page.evaluate((estado) => {
        window.__mageDev.store.getState().setActiveAccount(estado.activeAccountId);
        window.__mageDev.store.setState({ tabs: estado.tabs, activeTabId: estado.activeTabId, splitLayout: estado.splitLayout });
      }, previo);
      await page.waitForTimeout(CONFIG.settleMs);
      return { ok: !tras.dialogo && tras.cuentaPestana === destino, detail: JSON.stringify(tras) };
    },
  },
  {
    // P-028, punto 30: el menu contextual del avatar ofrece «Eliminar cuenta…» en las cuentas que no
    // son la principal, y NUNCA en la principal. Se abre la confirmacion y se CANCELA: pulsar
    // «Eliminar la cuenta» borraria de verdad un dir del HOME real (el harness no aisla el HOME).
    name: '30: el menú del avatar ofrece eliminar cuenta (salvo la principal) y la confirmación se cancela',
    async run(page) {
      const avatares = page.locator('[role="group"][aria-label="Cuentas"] button[aria-pressed]');
      const cuentas = await page.evaluate(() => window.__mageDev.store.getState().accounts.map((a) => ({ id: a.id, isMain: a.isMain })));
      const menuTiene = async (index) => {
        await avatares.nth(index).click({ button: 'right' });
        const menu = page.locator('[data-account-menu="true"]');
        await menu.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        return (await menu.getByRole('menuitem', { name: 'Eliminar cuenta…' }).count()) > 0;
      };
      const principal = cuentas.findIndex((c) => c.isMain);
      const principalOfrece = principal >= 0 ? await menuTiene(principal) : false;
      await page.keyboard.press('Escape');
      const otra = cuentas.findIndex((c) => !c.isMain);
      if (otra < 0) return { ok: !principalOfrece, detail: `solo la principal: ofrece borrar=${principalOfrece}` };
      const otraOfrece = await menuTiene(otra);
      await page.locator('[data-account-menu="true"]').getByRole('menuitem', { name: 'Eliminar cuenta…' }).click();
      const dialogo = page.locator('[data-delete-account-dialog="true"]');
      await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const texto = (await dialogo.textContent()) ?? '';
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const siguen = await page.evaluate(() => window.__mageDev.store.getState().accounts.length);
      const ok =
        !principalOfrece && otraOfrece && /privad/.test(texto) && /compartidas no se tocan/.test(texto) && siguen === cuentas.length;
      return { ok, detail: JSON.stringify({ principalOfrece, otraOfrece, dicePrivadas: /privad/.test(texto), siguen }) };
    },
  },
  {
    // P-026, 2.2 (D18): el modelo salia en tres sitios (selector del input, insignia de encima y barra
    // de estado). Se cuenta cuantos elementos VISIBLES dicen la etiqueta del selector: uno.
    name: 'Modelo: su etiqueta solo se ve una vez, en el selector del input',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      await page.waitForTimeout(CONFIG.settleMs);
      const medido = await page.evaluate(() => {
        const selector = document.querySelector('[aria-label="Modelo (aplica al siguiente turno)"]');
        const etiqueta = (selector?.textContent ?? '').replace(/[▾⌄]/g, '').trim();
        const visibles = [...document.querySelectorAll('body *')].filter(
          (n) => n.children.length === 0 && (n.textContent ?? '').replace(/[▾⌄]/g, '').trim() === etiqueta && n.getClientRects().length > 0,
        );
        return { etiqueta, visibles: visibles.length };
      });
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok = medido.etiqueta.length > 0 && medido.visibles === 1;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // P-026, 2.1: el menu ⋯ del prompt ya no ofrece «Adjuntar una imagen» (se pega con Ctrl+V) ni
    // «Abrir carpeta» (la insignia de encima del input ya lo hace). Se abre y se cierra con Escape.
    name: 'Menú ⋯ del prompt: sin «Adjuntar» ni «Abrir carpeta», con «Abrir terminal»',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      const boton = page.locator('[aria-haspopup="menu"][aria-label="Acciones"]').first();
      await boton.click();
      await page.locator('[role="menu"]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const items = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((n) => (n.textContent ?? '').trim()));
      await page.keyboard.press('Escape');
      await page.locator('[role="menu"]').first().waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok = items.length >= 1 && !items.some((t) => /Adjuntar|Abrir carpeta/.test(t)) && items.some((t) => t.includes('Abrir terminal'));
      return { ok, detail: `items=${JSON.stringify(items)}` };
    },
  },
  {
    // P-026, 1.7 (D19): la fila de una pestaña ABIERTA dice lo mismo que la de una cerrada —cuando y
    // cuanto pesa—, no `claude · opus[1m]`. Pestaña propia con un `resumeSessionId` falso y su fila de
    // historial inyectada; nada se spawnea.
    name: 'Historial lateral: la fila de una pestaña abierta dice tiempo y peso, no proveedor y modelo',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, conversationHistory: s.conversationHistory };
      });
      await openTemporaryConversation(page);
      for (let intento = 0; intento < 3; intento += 1) {
        await page.evaluate(() => {
          const store = window.__mageDev.store;
          const { activeTabId, tabs } = store.getState();
          const tab = tabs.find((t) => t.id === activeTabId);
          store.setState({
            tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, resumeSessionId: 'vg-fila' } : t)),
            conversationHistory: [
              { sessionId: 'vg-fila', title: tab.title, cwd: tab.cwd, privacy: tab.privacy, updatedAtMs: Date.now() - 3 * 60_000, configDir: '', sizeBytes: 2_200_000, isScheduled: false },
            ],
          });
        });
        await page.waitForTimeout(CONFIG.settleMs * 2);
        const aguanta = await page.evaluate(() => window.__mageDev.store.getState().conversationHistory.some((c) => c.sessionId === 'vg-fila'));
        if (aguanta) break;
      }
      const linea = await page.evaluate(() => document.querySelector('button[aria-current="true"] [data-row-meta]')?.textContent?.trim() ?? null);
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok = linea !== null && /(hace|ahora).*(B|kB|MB)/.test(linea) && !/· (opus|sonnet|haiku)/.test(linea);
      return { ok, detail: `segunda linea=${JSON.stringify(linea)}` };
    },
  },
  {
    // P-026, 1.6 (D20): los envoltorios de sistema que el CLI guarda como mensaje del usuario ya no se
    // pintan como una burbuja con el XML crudo. Formas REALES del CLI 2.1.283.
    name: 'Envoltorios de sistema: /rename es un chip, la tarea programada una tarjeta y el historial la marca',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { blocksByChat: s.blocksByChat, conversationHistory: s.conversationHistory };
      });
      const rename = '<command-name>/rename</command-name>\n            <command-message>rename</command-message>\n            <command-args>REVISION-MAGE</command-args>';
      const tarea = '<scheduled-task name="say-hello" file="C:\\Users\\x\\SKILL.md">\nThis is an automated run of a scheduled task.\n\nSay .\n</scheduled-task>';
      await hydrateBlocks(page, [
        { kind: 'user', id: 'vg-rename', text: rename, time: '12:00', attachments: [] },
        { kind: 'user', id: 'vg-tarea', text: tarea, time: '12:01', attachments: [] },
      ]);
      // La carga del historial del arranque llega TARDE y pisaba la fila sintetica cuando esta
      // comprobacion corria de las primeras (medido: 1 de 3 tandas con `--only`). Se reinyecta hasta que
      // la fila aguanta en el store, con un tope.
      for (let intento = 0; intento < 3; intento += 1) {
        await page.evaluate(() =>
          window.__mageDev.store.setState({
            conversationHistory: [
              { sessionId: 'vg-prog', title: 'say-hello', cwd: '', privacy: 'shared', updatedAtMs: Date.now(), configDir: '', sizeBytes: 1024, isScheduled: true },
            ],
          }),
        );
        await page.waitForTimeout(CONFIG.settleMs * 2);
        const aguanta = await page.evaluate(() => window.__mageDev.store.getState().conversationHistory.some((c) => c.sessionId === 'vg-prog'));
        if (aguanta) break;
      }
      const medido = await page.evaluate(() => {
        const tarjeta = document.querySelector('[data-scheduled-task]');
        return {
          chips: [...document.querySelectorAll('[data-command-chip]')].map((n) => (n.textContent ?? '').trim()),
          xmlEnElChat: [...document.querySelectorAll('[data-block="user"]')].some((n) => /<command-name>|<scheduled-task/.test(n.textContent ?? '')),
          tarjeta: (tarjeta?.querySelector('summary')?.textContent ?? '').trim(),
          plegada: tarjeta instanceof HTMLDetailsElement ? !tarjeta.open : null,
          insignias: document.querySelectorAll('[data-scheduled-badge]').length,
          filaDelHistorial: document.querySelector('button[aria-label="say-hello"]') !== null,
        };
      });
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        medido.chips.length === 1 &&
        medido.chips[0] === '/rename REVISION-MAGE' &&
        !medido.xmlEnElChat &&
        medido.tarjeta === 'Tarea programada: say-hello' &&
        medido.plegada === true &&
        medido.insignias === 1;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // 2.2: la cache en disco es lo que hace que el popover ofrezca los comandos REALES del usuario
    // ANTES del primer mensaje (`ensureSession` es perezoso, asi que una conversacion recien abierta no
    // tiene sesion de la que sacarlos). Se siembra en `main()`, antes de arrancar la app.
    // Se escribe con `type`, NUNCA se pulsa Enter.
    name: '2.2: con el catalogo cacheado, "/" ofrece comandos namespaced antes del primer mensaje',
    async run(page) {
      const prompt = promptAreas(page).first();
      await clearPrompt(page);
      await typeInPrompt(page, '/itb');
      const options = page.getByRole('listbox', { name: 'Comandos disponibles' }).getByRole('option');
      await options.first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const namespaced = await options.allInnerTexts();
      await clearPrompt(page);
      await typeInPrompt(page, '/compact');
      await page.waitForTimeout(CONFIG.settleMs);
      const conHint = await page.getByRole('listbox', { name: 'Comandos disponibles' }).getByRole('option').allInnerTexts();
      await clearPrompt(page); // se deja el prompt como se encontro
      const ok =
        namespaced.length >= 1 &&
        namespaced.some((text) => text.includes(SEEDED_NAMESPACED_COMMAND)) &&
        conHint.some((text) => text.includes(SEEDED_HINT));
      return { ok, detail: `con "/itb"=${JSON.stringify(namespaced)} con "/compact"=${JSON.stringify(conHint)}` };
    },
  },
  {
    // 2.3: un can_use_tool de AskUserQuestion se pinta como TARJETA en el chat, y el panel de permiso
    // deja de ofrecer Permitir/Denegar para esa peticion — que es lo que hace estructuralmente
    // imposible contestarla dos veces (contestar dos veces hace que main lance y la pestaña muera).
    // El permiso se inyecta por `__mageDev` con el input MEDIDO: no hay sesion, asi que no se pulsa
    // "Responder" (sin sesion viva `answerActivePermission` sale por su guard y se mediria el guard).
    // P-026 3.3: la tarjeta ya no va en el hilo sino ANCLADA encima del input (`[data-question-dock]`).
    name: '2.3: un can_use_tool de AskUserQuestion se pinta como tarjeta y no como permiso',
    async run(page) {
      await injectPermissionRequest(page, ASK_USER_QUESTION_INPUT, 'vg-ask-1');
      const measured = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-question-dock]')];
        const first = cards[0] ?? null;
        return {
          tarjetas: cards.length,
          header: first?.textContent?.includes('¿Prefieres el color rojo o el azul?') ?? false,
          radios: first?.querySelectorAll('[role="radio"]').length ?? 0,
          casillas: first?.querySelectorAll('[role="checkbox"]').length ?? 0,
          responder: [...(first?.querySelectorAll('button') ?? [])].some((b) => b.textContent?.trim() === 'Responder'),
        };
      });
      const permiso = await measurePermissionPanel(page);
      // Con la cola de permisos, una pregunta sin cancelar se queda DELANTE de las que inyecten los
      // checks siguientes, y el dock sigue ensenando esta.
      await cancelInjectedPermission(page, 'vg-ask-1');
      const ok =
        measured.tarjetas === 1 &&
        measured.header &&
        measured.radios === 2 &&
        measured.casillas === 0 &&
        measured.responder &&
        permiso.permitir === 0 &&
        permiso.denegar === 0 &&
        permiso.avisoDePregunta;
      return { ok, detail: `tarjeta=${JSON.stringify(measured)} panelPermiso=${JSON.stringify(permiso)}` };
    },
  },
  {
    // La mitad barata que distingue dos comportamientos que un solo check confundiria.
    name: '2.3: multiSelect pinta casillas y no radios',
    async run(page) {
      const multi = {
        questions: [
          {
            ...ASK_USER_QUESTION_INPUT.questions[0],
            question: '¿Que colores te valen?',
            multiSelect: true,
          },
        ],
      };
      await injectPermissionRequest(page, multi, 'vg-ask-2');
      const measured = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-question-dock]')];
        const last = cards[cards.length - 1] ?? null;
        return {
          tarjetas: cards.length,
          casillas: last?.querySelectorAll('[role="checkbox"]').length ?? 0,
          radios: last?.querySelectorAll('[role="radio"]').length ?? 0,
        };
      });
      await cancelInjectedPermission(page, 'vg-ask-2');
      const ok = measured.casillas > 0 && measured.radios === 0;
      return { ok, detail: `multiSelect=${JSON.stringify(measured)}` };
    },
  },
  {
    // 2.10 (fuera la cabecera "Tú") y 2.11 (menu de pestaña sin titulo ni subtitulos) van juntas: las dos
    // necesitan el mismo estado (una conversacion con una burbuja de usuario) y la segunda deja el menu
    // cerrado, como lo encontro.
    name: '2.10 / 2.11: sin cabecera «Tú» y menu de pestaña sin subtitulos',
    async run(page) {
      // Autosuficiente: antes medía la burbuja que dejara en el chat activo alguna comprobacion anterior,
      // y desde que W-E añadio comprobaciones que abren chats nuevos delante, el chat activo llegaba
      // vacio (burbujas=0). Se hidrata una burbuja propia CON hora, para exigir que no se pinte.
      const previo = await page.evaluate(() => window.__mageDev.store.getState().blocksByChat);
      await hydrateBlocks(page, [{ kind: 'user', id: 'vg-210', text: 'Hola desde verify', time: '12:00', attachments: [] }]);
      const burbuja = await page.evaluate(() => {
        const bubbles = [...document.querySelectorAll('[data-block="user"]')];
        const texts = bubbles.map((node) => (node.textContent ?? '').trim());
        return {
          burbujas: bubbles.length,
          empiezanPorTu: texts.filter((text) => text.startsWith('Tú')).length,
          // Ya NO debe haber hora en la burbuja (buzon, punto 1): se cuenta para exigir CERO.
          conHora: texts.filter((text) => /\d{2}:\d{2}/.test(text)).length,
        };
      });
      await page.evaluate((estado) => window.__mageDev.store.setState({ blocksByChat: estado }), previo);
      const menu = await measureTabContextMenu(page);
      const clamp = await measureTabContextMenuClamp(page);
      const ok =
        burbuja.burbujas >= 1 &&
        burbuja.empiezanPorTu === 0 &&
        burbuja.conHora === 0 &&
        menu.menus === 1 &&
        menu.items >= 4 &&
        menu.subtitulos === 0 &&
        menu.color === 1 &&
        menu.contadores >= 2 &&
        menu.cerrado === 0 &&
        clamp !== null &&
        clamp.dentroDeLaVentana &&
        clamp.alto > 0;
      return { ok, detail: `burbujas=${JSON.stringify(burbuja)} menu=${JSON.stringify(menu)} clamp=${JSON.stringify(clamp)}` };
    },
  },
  // --- Fase D: van DESPUES de 2.10/2.11 a proposito. Hidratan el chat con bloques sinteticos, o sea que
  // REEMPLAZAN lo que hubiera: cualquier comprobacion que mida burbujas reales tiene que ir antes.
  {
    // P-026 3.4 (D21–D24): el chat se queda con lo que se DICE y lo que se HACE va al panel de Actividad.
    // Todo entra por el reducer REAL (thinking, tool_use, tool_result, texto): se mide lo que la app hace
    // con los eventos del CLI, no lo que el harness sabe construir. Sustituye a las comprobaciones de
    // cajas colapsadas y rachas de la Fase D, que median un chat que ya no existe.
    name: '3.4: el chat se queda con lo que se dice y los pasos van al panel de Actividad',
    async run(page) {
      const previo = await captureTurnState(page);
      await openTemporaryConversation(page);
      await injectTurn(page, [
        { kind: 'thinking_delta', text: 'a ver que hay' },
        { kind: 'tool_use', tool: { toolUseId: 'v34-t1', toolName: 'Bash', input: { command: 'ls -la' } } },
        { kind: 'tool_result', result: { toolUseId: 'v34-t1', isError: false, output: 'salida de v34-t1', durationMs: 12 } },
        { kind: 'stream_delta', text: 'Reviso los ficheros.' },
        { kind: 'tool_use', tool: { toolUseId: 'v34-t3', toolName: 'Bash', input: { command: 'false' } } },
        { kind: 'tool_result', result: { toolUseId: 'v34-t3', isError: true, output: 'exit 1', durationMs: 5 } },
        { kind: 'tool_use', tool: { toolUseId: 'v34-t2', toolName: 'Read', input: { file_path: 'src/a.ts' } } },
      ]);
      const chat = await page.evaluate(() => ({
        pasosEnElChat: document.querySelectorAll('[data-block="tool"], [data-block="thinking"], [data-block="subagent"], [data-block="run"]').length,
        usuario: document.querySelectorAll('[data-block="user"]').length,
        agente: document.querySelectorAll('[data-block="agent"]').length,
        fallidas: document.querySelectorAll('[data-block="tool-failed"]').length,
        estado: document.querySelector('[data-turn-status]')?.textContent?.trim() ?? null,
      }));
      await page.locator('[data-turn-status]').first().click();
      await page.locator('[data-panel="activity"]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const panel = await page.evaluate(() => ({
        filas: document.querySelectorAll('[data-panel="activity"] [data-activity-row]').length,
        conError: document.querySelectorAll('[data-panel="activity"] [data-activity-error="true"]').length,
        turnos: [...document.querySelectorAll('[data-panel="activity"] [data-activity-turn]')].map((n) => n.textContent?.trim() ?? ''),
        // Se muda aqui la mitad de glifos de «Iconos: …»: `›_` son dos caracteres y descuadraba la fila.
        anchosDeGlifo: [...new Set([...document.querySelectorAll('[data-panel="activity"] [data-tool-glyph]')].map((n) => Math.round(n.getBoundingClientRect().width)))],
        // Punto 18: el turno en curso y SU paso sin resultado (el Read) se marcan; solo una fila.
        cabecerasVivas: document.querySelectorAll('[data-panel="activity"] [data-activity-turn][data-activity-live]').length,
        filasVivas: [...document.querySelectorAll('[data-panel="activity"] [data-activity-row][data-activity-live]')].map((n) => n.textContent?.slice(0, 12) ?? ''),
      }));
      await page.locator('[data-panel="activity"] [data-activity-row="tool"]').first().click();
      await page.waitForTimeout(CONFIG.settleMs);
      const detalle = await page.evaluate(() => document.querySelector('[data-activity-detail]')?.textContent ?? '');
      await restoreTurnState(page, previo);
      const ok =
        chat.pasosEnElChat === 0 &&
        chat.usuario === 1 &&
        chat.agente === 1 &&
        chat.fallidas === 1 &&
        /Ejecutando Read/.test(chat.estado ?? '') &&
        /4 pasos/.test(chat.estado ?? '') &&
        /1 error/.test(chat.estado ?? '') &&
        panel.filas === 4 &&
        panel.conError === 1 &&
        panel.anchosDeGlifo.length === 1 &&
        panel.cabecerasVivas === 1 &&
        panel.filasVivas.length === 1 &&
        panel.filasVivas[0].includes('Read') &&
        detalle.includes('salida de v34-t1');
      return { ok, detail: `chat=${JSON.stringify(chat)} panel=${JSON.stringify(panel)} detalle=${JSON.stringify(detalle.slice(0, 80))}` };
    },
  },
  {
    // El diff de un Edit, ahora en el DETALLE del panel: numerado con el hunk real (la primera fila del
    // borrado empieza por su linea antigua, 14), fondo distinto por insercion/borrado y codigo
    // resaltado. Junta las dos comprobaciones de diff de la Fase D, que lo median en la caja del chat.
    name: '3.4: el detalle de un Edit en Actividad pinta el diff numerado, con fondos y resaltado',
    async run(page) {
      const previo = await captureTurnState(page);
      await openTemporaryConversation(page);
      await hydrateBlocks(page, [
        { kind: 'user', id: 'v34-u', text: 'cambia a', time: '12:00', attachments: [] },
        toolBlock('d1', 'edit', {
          filePath: 'src/foo.ts',
          output: [],
          diff: [
            { sign: ' ', text: 'import type { Foo } from "./foo";', oldLine: 13, newLine: 13 },
            { sign: '-', text: 'const a: number = 1;', oldLine: 14, newLine: null },
            { sign: '+', text: 'const a: number = 2;', oldLine: null, newLine: 14 },
          ],
        }),
      ]);
      await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        s.openActivity(s.activeTabId, null);
      });
      await page.locator('[data-panel="activity"] [data-activity-row="tool"]').first().click();
      const pintado = await waitForDiffPaint(page);
      const numeros = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-activity-detail] [data-diff="lines"] > div')];
        const first = rows.find((row) => row.textContent?.includes('const a: number = 1;'));
        return [...(first?.querySelectorAll('span') ?? [])].slice(0, 2).map((s) => s.textContent?.trim() ?? '');
      });
      await restoreTurnState(page, previo);
      const ok = numeros[0] === '14' && numeros[1] === '' && pintado !== null && pintado.fondos.length === 3 && pintado.colores > 1;
      return { ok, detail: `columnas=${JSON.stringify(numeros)} fondos=${JSON.stringify(pintado?.fondos ?? null)} colores=${pintado?.colores ?? 0} (hunk real: oldStart=${REAL_HUNK.oldStart})` };
    },
  },
  {
    // D21: los subagentes dejan UNA linea en el chat, se anclan encima del input mientras dura el turno
    // y un clic en su fila filtra el panel a sus pasos (que llegan con `parentToolUseId`, medido).
    name: '3.4: subagentes: una linea en el chat, el dock encima del input y su clic filtra Actividad',
    async run(page) {
      const previo = await captureTurnState(page);
      await openTemporaryConversation(page);
      await injectTurn(page, [
        { kind: 'tool_use', tool: { toolUseId: 'v34-s1', toolName: 'Agent', input: { subagent_type: 'Explore', description: 'buscar el bug' } } },
        { kind: 'tool_use', tool: { toolUseId: 'v34-s2', toolName: 'Agent', input: { subagent_type: 'Plan', description: 'planear' } } },
        { kind: 'tool_use', tool: { toolUseId: 'v34-g1', toolName: 'Grep', input: { pattern: 'foo' }, parentToolUseId: 'v34-s1' } },
        { kind: 'tool_result', result: { toolUseId: 'v34-s2', isError: false, output: '{"agentId":"abc123"}', durationMs: 5000 } },
      ]);
      // P-028 38: el dock es UNA linea agregada; las filas se ven al desplegarla.
      const resumen = await page.evaluate(() => document.querySelector('[data-agents-dock-summary]')?.textContent?.trim() ?? '');
      await page.locator('[data-agents-dock-summary]').first().click();
      await page.waitForTimeout(CONFIG.settleMs);
      const vivo = await page.evaluate(() => {
        const dock = document.querySelector('[data-agents-dock]');
        const input = document.querySelector('[data-prompt-editor="true"]');
        return {
          filas: [...document.querySelectorAll('[data-agents-dock-row]')].map((n) => `${n.getAttribute('data-agents-dock-row')}:${n.textContent?.trim() ?? ''}`),
          encimaDelInput: dock !== null && input !== null && dock.getBoundingClientRect().bottom <= input.getBoundingClientRect().top + 1,
          lineas: [...document.querySelectorAll('[data-block="subagents"]')].map((n) => n.textContent?.trim() ?? ''),
          bloquesSubagente: document.querySelectorAll('[data-block="subagent"]').length,
        };
      });
      await page.locator('[data-agents-dock-row="running"]').first().click();
      await page.locator('[data-panel="activity"] [data-activity-filter]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const filtrado = await page.evaluate(() => document.querySelectorAll('[data-panel="activity"] [data-activity-row]').length);
      await page.evaluate(() => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        dev.store.setState((s) => dev.reduceEvent(s, tabId, { kind: 'tool_result', result: { toolUseId: 'v34-s1', isError: true, output: 'fallo', durationMs: 9000 } }));
        dev.store.setState((s) => ({ statusByChat: { ...s.statusByChat, [tabId]: 'idle' } }));
      });
      await page.waitForTimeout(CONFIG.settleMs * 2);
      const final = await page.evaluate(() => ({
        dock: document.querySelectorAll('[data-agents-dock-row]').length,
        linea: document.querySelector('[data-block="subagents"]')?.textContent?.trim() ?? '',
      }));
      await restoreTurnState(page, previo);
      const ok =
        resumen === '1 en ejecución · 1 terminado' &&
        vivo.filas.length === 2 &&
        /^running:buscar el bug.*Explore.*Ejecutando Grep/.test(vivo.filas[0] ?? '') &&
        /^done:planear.*Plan.*Terminado/.test(vivo.filas[1] ?? '') &&
        vivo.encimaDelInput &&
        vivo.lineas.length === 1 &&
        /Lanzó 2 subagentes/.test(vivo.lineas[0] ?? '') &&
        vivo.bloquesSubagente === 0 &&
        filtrado === 2 &&
        final.dock === 0 &&
        /2 terminados/.test(final.linea) &&
        /1 con error/.test(final.linea);
      return { ok, detail: `resumen=${JSON.stringify(resumen)} vivo=${JSON.stringify(vivo)} filtrado=${filtrado} final=${JSON.stringify(final)}` };
    },
  },
  {
    // P-028 37a/37c/38: un Agent en SEGUNDO PLANO (forma medida en 2.1.284: `async_launched` en el
    // `tool_use_result`, luego `task_notification`) sigue en marcha con la pestaña parada, la linea dice
    // «N en ejecución», «Ver más» abre el panel de agentes con la lista en vivo, la notificacion lo cierra
    // y su X lo quita solo del dock.
    name: 'P-028 37-38: subagentes en segundo plano: en marcha hasta la notificacion, linea agregada y panel en vivo',
    async run(page) {
      const previo = await captureTurnState(page);
      const layout = await page.evaluate(() => window.__mageDev.panelStore.getState().layout);
      await openTemporaryConversation(page);
      const launched = (id, description) => [
        { kind: 'tool_use', tool: { toolUseId: id, toolName: 'Agent', input: { subagent_type: 'general-purpose', description, run_in_background: true } } },
        {
          kind: 'tool_result',
          result: {
            toolUseId: id,
            isError: false,
            output: `Async agent launched successfully.\nagentId: ag-${id} (internal ID)`,
            durationMs: 4,
            subagent: { status: 'async_launched', agentId: `ag-${id}`, model: 'claude-haiku-4-5', totalTokens: null, totalDurationMs: null, totalToolUseCount: null },
          },
        },
      ];
      await injectTurn(page, [...launched('v37-a', 'Plan a'), ...launched('v37-b', 'Plan b'), { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } }]);
      const lanzados = await page.evaluate(() => ({
        estado: window.__mageDev.store.getState().statusByChat[window.__mageDev.store.getState().activeTabId] ?? 'idle',
        resumen: document.querySelector('[data-agents-dock-summary]')?.textContent?.trim() ?? null,
      }));
      await page.locator('[data-agents-dock-more]').first().click();
      await page.locator('[data-active-panel="agents"] [data-agents-panel-row]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const panel = await page.evaluate(() => [...document.querySelectorAll('[data-active-panel="agents"] [data-agents-panel-row]')].map((n) => `${n.getAttribute('data-agents-panel-row')}:${n.textContent?.trim() ?? ''}`));
      await page.evaluate(() => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        dev.store.setState((s) => dev.reduceEvent(s, tabId, { kind: 'subagent_update', toolUseId: 'v37-a', status: 'completed', tokens: 19906, toolUses: 2, durationMs: 1422 }));
      });
      await page.waitForTimeout(CONFIG.settleMs);
      await page.locator('[data-agents-dock-summary]').first().click();
      await page.waitForTimeout(CONFIG.settleMs);
      const trasUno = await page.evaluate(() => ({
        resumen: document.querySelector('[data-agents-dock-summary]')?.textContent?.trim() ?? null,
        filas: [...document.querySelectorAll('[data-agents-dock-row]')].map((n) => n.getAttribute('data-agents-dock-row')),
        equis: document.querySelectorAll('[data-agents-dock-dismiss]').length,
        panelA: document.querySelector('[data-active-panel="agents"] [data-agents-panel-row="done"]')?.textContent?.trim() ?? null,
        // 0.1.1 R2, punto 29: «Parar» solo en el que sigue en marcha, en el dock y en el panel.
        pararDock: document.querySelectorAll('[data-agents-dock] [data-agents-stop]').length,
        pararPanel: document.querySelectorAll('[data-active-panel="agents"] [data-agents-stop]').length,
      }));
      // El clic manda `stopSubagent` con SU agentId. Se sustituye la accion un momento para no llamar al
      // CLI (la sesion de esta conversacion es de mentira) y se restaura.
      const parado = await page.evaluate(async () => {
        const dev = window.__mageDev;
        const original = dev.store.getState().stopSubagent;
        const llamadas = [];
        dev.store.setState({ stopSubagent: (tabId, taskId) => llamadas.push(taskId) });
        // Dos frames: el boton lee la accion por selector y tiene que volver a pintarse con la sustituta.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        document.querySelector('[data-agents-dock] [data-agents-stop]')?.click();
        dev.store.setState({ stopSubagent: original });
        return llamadas;
      });
      await page.locator('[data-agents-dock-dismiss]').first().click();
      await page.waitForTimeout(CONFIG.settleMs);
      const trasQuitar = await page.evaluate(() => ({
        filas: document.querySelectorAll('[data-agents-dock-row]').length,
        enElPanel: document.querySelectorAll('[data-active-panel="agents"] [data-agents-panel-row]').length,
      }));
      await page.evaluate(() => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        dev.store.setState((s) => dev.reduceEvent(s, tabId, { kind: 'subagent_update', toolUseId: 'v37-b', status: 'stopped', tokens: null, toolUses: null, durationMs: null }));
      });
      await page.waitForTimeout(CONFIG.settleMs * 2);
      const final = await page.evaluate(() => document.querySelectorAll('[data-agents-dock]').length);
      await page.evaluate((l) => window.__mageDev.panelStore.setState({ layout: l }), layout);
      await restoreTurnState(page, previo);
      const ok =
        lanzados.estado === 'idle' &&
        lanzados.resumen === '2 en ejecución' &&
        panel.length === 2 &&
        panel.every((fila) => fila.startsWith('running:') && fila.includes('claude-haiku-4-5')) &&
        trasUno.resumen === '1 en ejecución · 1 terminado' &&
        JSON.stringify(trasUno.filas) === JSON.stringify(['done', 'running']) &&
        trasUno.equis === 1 &&
        trasUno.pararDock === 1 &&
        trasUno.pararPanel === 1 &&
        JSON.stringify(parado) === JSON.stringify(['ag-v37-b']) &&
        /19\.906 tokens/.test(trasUno.panelA ?? '') &&
        /2 herramientas/.test(trasUno.panelA ?? '') &&
        trasQuitar.filas === 1 &&
        trasQuitar.enElPanel === 2 &&
        final === 0;
      return { ok, detail: `lanzados=${JSON.stringify(lanzados)} panel=${JSON.stringify(panel)} trasUno=${JSON.stringify(trasUno)} parado=${JSON.stringify(parado)} trasQuitar=${JSON.stringify(trasQuitar)} dockFinal=${final}` };
    },
  },
  {
    // 0.1.1 R2, punto 30: con un turno en marcha la cola es de Mage. Se encola por la ACCION del store
    // (nunca Enter con texto), y el `result` se inyecta por `handleEvent` con una sesion de mentira; el
    // envio que sale de la cola se intercepta sustituyendo `sendMessageToTab`, asi no arranca ningun CLI.
    name: 'R2 30: cola de Mage: «En cola» encima del input, sin burbuja ni reloj nuevo, y sale de uno en uno',
    async run(page) {
      const previo = await captureTurnState(page);
      await openTemporaryConversation(page);
      const antes = await page.evaluate(async () => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        const previos = { sessionIdByChat: dev.store.getState().sessionIdByChat, turnStartByChat: dev.store.getState().turnStartByChat };
        dev.store.setState((s) => ({
          sessionIdByChat: { ...s.sessionIdByChat, [tabId]: 'verify-queue-session' },
          statusByChat: { ...s.statusByChat, [tabId]: 'streaming' },
          turnStartByChat: { ...s.turnStartByChat, [tabId]: 1234 },
        }));
        await dev.store.getState().sendMessageToTab(tabId, 'primero en cola');
        await dev.store.getState().sendMessageToTab(tabId, 'segundo en cola');
        await dev.store.getState().sendMessageToTab(tabId, 'tercero en cola');
        return { tabId, previos };
      });
      await page.locator('[data-queued-messages]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      // Que termine la animacion de entrada (crece de alto): a mitad, el input aun no se ha desplazado.
      await page.waitForTimeout(CONFIG.settleMs * 2);
      const encolado = await page.evaluate((tabId) => {
        const s = window.__mageDev.store.getState();
        const dock = document.querySelector('[data-queued-messages]');
        const input = document.querySelector('[data-prompt-editor="true"]');
        return {
          filas: [...document.querySelectorAll('[data-queued-message]')].map((n) => n.textContent?.trim() ?? ''),
          burbujas: (s.blocksByChat[tabId] ?? []).filter((b) => b.kind === 'user').length,
          reloj: s.turnStartByChat[tabId],
          encimaDelInput: dock !== null && input !== null && dock.getBoundingClientRect().bottom <= input.getBoundingClientRect().top + 1,
          y: [dock?.getBoundingClientRect().top, dock?.getBoundingClientRect().bottom, input?.getBoundingClientRect().top, document.querySelectorAll('[data-prompt-editor="true"]').length],
        };
      }, antes.tabId);
      // Quitar el tercero y editar el segundo (vuelve al input).
      await page.locator('[data-queued-message]').nth(2).locator('[data-queued-remove]').click();
      await page.locator('[data-queued-message]').nth(1).locator('[data-queued-edit]').click();
      await page.waitForTimeout(CONFIG.settleMs);
      const trasEditar = await page.evaluate((tabId) => ({
        filas: document.querySelectorAll('[data-queued-message]').length,
        borrador: window.__mageDev.store.getState().draftByChat[tabId]?.text ?? null,
      }), antes.tabId);
      // Fin del turno: sale SOLO el primero.
      const enviados = await page.evaluate((tabId) => {
        const dev = window.__mageDev;
        const original = dev.store.getState().sendMessageToTab;
        const llamadas = [];
        dev.store.setState({ sendMessageToTab: async (id, text) => { llamadas.push([id === tabId, text]); } });
        dev.store.getState().handleEvent('verify-queue-session', { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });
        dev.store.setState({ sendMessageToTab: original });
        return { llamadas, cola: dev.store.getState().queuedByChat[tabId]?.length ?? 0 };
      }, antes.tabId);
      await page.locator('[data-queued-messages]').first().waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      await page.evaluate(({ tabId, previos }) => {
        const dev = window.__mageDev;
        dev.store.getState().setDraft(tabId, null);
        dev.store.setState(previos);
      }, antes);
      await restoreTurnState(page, previo);
      const ok =
        encolado.filas.length === 3 &&
        encolado.filas[0]?.startsWith('primero en cola') === true &&
        encolado.burbujas === 0 &&
        encolado.reloj === 1234 &&
        encolado.encimaDelInput &&
        trasEditar.filas === 1 &&
        trasEditar.borrador === 'segundo en cola' &&
        JSON.stringify(enviados.llamadas) === JSON.stringify([[true, 'primero en cola']]) &&
        enviados.cola === 0;
      return { ok, detail: `encolado=${JSON.stringify(encolado)} trasEditar=${JSON.stringify(trasEditar)} enviados=${JSON.stringify(enviados)}` };
    },
  },
  {
    // P-028 39: al abrir un subagente, su transcripcion se pinta SOLA en el panel (la lista no queda
    // debajo) y la capa no se sale del panel. Sin fichero en disco el cuerpo es el aviso de error: lo que
    // se mide es la caja, que era lo roto.
    name: 'P-028 39: abrir un subagente en el panel pinta solo su transcripcion, dentro del panel',
    async run(page) {
      const previo = await captureTurnState(page);
      const layout = await page.evaluate(() => window.__mageDev.panelStore.getState().layout);
      await openTemporaryConversation(page);
      await injectTurn(page, [
        { kind: 'tool_use', tool: { toolUseId: 'v39-a', toolName: 'Agent', input: { subagent_type: 'Explore', description: 'Plan c' } } },
        { kind: 'tool_result', result: { toolUseId: 'v39-a', isError: false, output: 'agentId: v39agent (internal ID)', durationMs: 900 } },
      ]);
      await page.evaluate(() => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        dev.store.setState((s) => ({ sessionIdByChat: { ...s.sessionIdByChat, [tabId]: 'v39-session' } }));
      });
      await page.evaluate(() => window.__mageDev.panelStore.getState().revealPanelById('agents'));
      await page.locator('[data-active-panel="agents"] [data-agents-panel-row] button, [data-active-panel="agents"] button[data-tip="Ver la transcripción de este subagente"]').first().click();
      await page.locator('[data-subagent-transcript]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const medido = await page.evaluate(() => {
        const pane = document.querySelector('[data-active-panel="agents"]');
        const layer = document.querySelector('[data-subagent-transcript]');
        const p = pane?.getBoundingClientRect();
        const l = layer?.getBoundingClientRect();
        return {
          listaVisible: document.querySelectorAll('[data-agents-panel]').length,
          overflow: layer === null ? null : getComputedStyle(layer).overflow,
          dentro: p !== undefined && l !== undefined && l.top >= p.top - 1 && l.bottom <= p.bottom + 1,
        };
      });
      await page.keyboard.press('Escape');
      await page.evaluate((l) => window.__mageDev.panelStore.setState({ layout: l }), layout);
      await restoreTurnState(page, previo);
      const ok = medido.listaVisible === 0 && medido.overflow === 'hidden' && medido.dentro;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // P-028 40: el clic en una notificacion llega al renderer como `NotificationTarget` y lleva a SU
    // pestaña (y a Actividad si es «Subagente terminado»); una conversacion que ya no tiene pestaña solo
    // resalta su fila. El clic real en el SO no se puede provocar desde aqui: se entra por la accion que
    // llama el canal `notification:clicked`.
    name: 'P-028 40: el destino de una notificacion activa su pestaña, abre Actividad y resalta el historial',
    async run(page) {
      const previo = await captureTurnState(page);
      const layout = await page.evaluate(() => window.__mageDev.panelStore.getState().layout);
      await openTemporaryConversation(page);
      const origen = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      await openTemporaryConversation(page);
      const resultado = await page.evaluate((tabId) => {
        const dev = window.__mageDev;
        dev.store.getState().focusNotificationTarget({ tabId, sessionId: 'v40-sin-sesion', opensActivity: true });
        const activa = dev.store.getState().activeTabId;
        dev.store.getState().focusNotificationTarget({ sessionId: 'v40-nada' });
        return { activa, trasNada: dev.store.getState().activeTabId };
      }, origen);
      await page.waitForTimeout(CONFIG.settleMs);
      const actividad = await page.evaluate(() => document.querySelectorAll('[data-active-panel="activity"]').length);
      await page.evaluate((l) => window.__mageDev.panelStore.setState({ layout: l }), layout);
      await restoreTurnState(page, previo);
      const ok = resultado.activa === origen && resultado.trasNada === origen && actividad === 1;
      return { ok, detail: `origen=${origen} ${JSON.stringify(resultado)} actividad=${actividad}` };
    },
  },
  {
    // 2.4: una publicacion de artifact se pinta como TARJETA. El sintoma que arregla: la caja de tool
    // enseñaba la ruta del scratchpad como encabezado (`summarizeToolInput` prefiere `file_path`), que
    // no le dice nada a nadie. Y NUNCA entra en una racha: un artifact escondido en "Leídos 2 ficheros"
    // seria el peor resultado posible.
    name: '2.4: una publicacion de artifact se pinta como tarjeta y no como caja de tool',
    async run(page) {
      await hydrateBlocks(page, [toolBlock('r1', 'read'), toolBlock('r2', 'read'), artifactBlock()]);
      const measured = await page.evaluate((expected) => {
        const cards = [...document.querySelectorAll('[data-block="tool"]')].filter((node) =>
          node.textContent?.includes(expected.title),
        );
        const card = cards[0] ?? null;
        const runs = [...document.querySelectorAll('[data-block="run"]')];
        return {
          tarjetas: cards.length,
          conFavicon: card?.textContent?.includes(expected.favicon) ?? false,
          conUrl: card?.textContent?.includes(expected.url) ?? false,
          botonAbrir: [...(card?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim() ?? ''),
          // La ruta del scratchpad NO puede ser el encabezado (ese era el sintoma).
          rutaComoEncabezado: card?.querySelector('button[aria-expanded]') !== null && (card?.textContent?.startsWith('▸') ?? false),
          artifactDentroDeUnaRacha: runs.some((run) => run.textContent?.includes(expected.title) ?? false),
        };
      }, { ...REAL_ARTIFACT.input, url: REAL_ARTIFACT.url });
      const ok =
        measured.tarjetas === 1 &&
        measured.conFavicon &&
        measured.conUrl &&
        !measured.rutaComoEncabezado &&
        !measured.artifactDentroDeUnaRacha;
      return { ok, detail: `tarjeta=${JSON.stringify(measured)}` };
    },
  },
  {
    // 2.4: sin cuenta publicadora conocida (el indice del perfil aislado esta vacio), NO puede haber un
    // "Abrir" que abriria con una cuenta arbitraria: solo "Abrir con…", que lo elige el usuario.
    name: '2.4: sin cuenta publicadora conocida, el boton ofrece "abrir con…"',
    async run(page) {
      await hydrateBlocks(page, [artifactBlock('a2')]);
      const measured = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
        return {
          abrirCon: buttons.filter((t) => t === 'Abrir con…').length,
          abrirDirecto: buttons.filter((t) => t.startsWith('Abrir con ') && t !== 'Abrir con…').length,
        };
      });
      const ok = measured.abrirCon === 1 && measured.abrirDirecto === 0;
      return { ok, detail: `botones=${JSON.stringify(measured)}` };
    },
  },
  {
    // LA comprobacion que justifica la decision de quitar el menu nativo: en Windows/Linux, Chromium
    // maneja Ctrl+C/V dentro de campos editables sin acelerador de menu. "Deberia" no es suficiente.
    // No se pulsa Enter en ningun momento.
    name: '2.9.b: copiar y pegar siguen funcionando en el prompt sin el menu nativo',
    async run(page) {
      // Lo que hay que medir es que, sin menu nativo, los atajos LLEGAN al editor y el editor los
      // atiende. El round-trip completo por el PORTAPAPELES DEL SO no vale como criterio: en Windows el
      // portapapeles es un recurso exclusivo y cualquier proceso que lo tenga abierto hace que `Ctrl+C`
      // falle EN SILENCIO (medido: seleccion correcta, `navigator.clipboard.readText()` vacio y pegado
      // sintetico funcionando). Asi que se mide en tres piezas y el detalle dice cual es cual.
      await clearPrompt(page);
      await typeInPrompt(page, 'mage');
      await page.evaluate(() => {
        const target = document.querySelector('[data-prompt-editor="true"] .cm-content');
        window.__mgClip = { copy: 0, paste: 0 };
        target.addEventListener('copy', () => (window.__mgClip.copy += 1));
        target.addEventListener('paste', () => (window.__mgClip.paste += 1));
      });
      await page.keyboard.press('Control+a');
      const seleccion = await page.evaluate(() => window.getSelection()?.toString() ?? '');
      await page.keyboard.press('Control+c');
      await page.waitForTimeout(CONFIG.settleMs);
      const portapapeles = await page
        .evaluate(() => navigator.clipboard.readText().catch(() => null))
        .catch(() => null);
      await page.keyboard.press('End');
      await page.keyboard.press('Control+v');
      await page.waitForTimeout(CONFIG.settleMs);
      const trasAtajos = await promptText(page);
      const eventos = await page.evaluate(() => window.__mgClip);
      // Si el SO no dejo copiar, se comprueba la parte de Mage con un pegado equivalente: el editor
      // tiene que insertar en el cursor lo que venga en el evento.
      if (portapapeles !== 'mage') {
        await page.evaluate(() => {
          const dt = new DataTransfer();
          dt.setData('text/plain', 'mage');
          document
            .querySelector('[data-prompt-editor="true"] .cm-content')
            .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        });
        await page.waitForTimeout(CONFIG.settleMs);
      }
      const texto = await promptText(page);
      await clearPrompt(page); // se deja como se encontro
      const ok = seleccion === 'mage' && eventos.copy === 1 && eventos.paste === 1 && texto === 'magemage';
      return {
        ok,
        detail: `seleccion=${JSON.stringify(seleccion)} eventos=${JSON.stringify(eventos)} portapapeles del SO=${JSON.stringify(portapapeles)} tras los atajos=${JSON.stringify(trasAtajos)} final=${JSON.stringify(texto)}`,
      };
    },
  },
  {
    // 2.9.b: los tres paneles nuevos aparecen en la stripe derecha y NINGUNO se abre solo — que es el
    // contrato de `reconcileLayoutWithRegistry` y lo que evita el "residuo de maquina" de otras rondas.
    name: '2.9.b: las tres vistas nuevas montan y no roban el panel activo',
    async run(page) {
      const iconos = ['Instrucciones', 'Comandos y skills', 'Subagentes'];
      const antes = await page.evaluate(
        (labels) => ({
          presentes: labels.filter((label) => document.querySelector(`[aria-label="${label}"]`) !== null).length,
          abiertos: labels.filter((label) => document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true').length,
        }),
        iconos,
      );
      const montados = [];
      for (const label of iconos) {
        const icon = page.getByRole('button', { name: label, exact: true }).first();
        await icon.click();
        await page.waitForTimeout(CONFIG.settleMs);
        montados.push(await page.evaluate(() => document.body.innerText.length > 0));
        await icon.click(); // se cierra: se deja el dock como estaba
        await page.waitForTimeout(CONFIG.settleMs);
      }
      const ok = antes.presentes === 3 && antes.abiertos === 0 && montados.every(Boolean);
      return { ok, detail: `iconos nuevos=${antes.presentes} abiertos al arrancar=${antes.abiertos} montan=${JSON.stringify(montados)}` };
    },
  },
  {
    // 2.9.b: la seccion nueva de Configuracion. Contrato de orden: ABRE el dialogo y lo DEJA ABIERTO
    // solo si es la ultima; como no lo es, lo cierra ella misma con Escape.
    name: '2.9.b: la seccion Hooks y permisos carga',
    async run(page) {
      await page.keyboard.press('Control+Comma');
      await page.locator(MODAL).first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await openSection(page, /Hooks y permisos/);
      const measured = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        const text = dialog?.textContent ?? '';
        return {
          errores: dialog?.querySelectorAll('[role="alert"]').length ?? 0,
          conHooks: text.includes('Hooks ('),
          conReglas: text.includes('Reglas de permisos ('),
          // El estado vacio es un MENSAJE, no una lista de cero filas sin explicar.
          conMensaje: text.includes('No hay') || text.includes('unión'),
        };
      });
      await closeDialog(page);
      const ok = measured.errores === 0 && measured.conHooks && measured.conReglas && measured.conMensaje;
      return { ok, detail: `seccion=${JSON.stringify(measured)}` };
    },
  },
  // --- Fase E (2.7 y 2.12.1). NINGUNA pulsa `Enter`, y hay una que deliberadamente NO existe: medir
  // "Enter dentro de una lista no envia" obligaria a pulsar Enter con texto, y si el codigo estuviera
  // mal eso dispara un TURNO REAL. Esa decision vive en `enterAction`, con 12 tests, y la confirma el
  // ojo humano. Un intermitente que gasta suscripcion es peor que una comprobacion de menos.
  {
    // 2.7: lo que se ENVIA es markdown, no lo pintado. La medida que distingue "decorado" de
    // "transformado" es que el documento conserve el `- ` literal.
    name: '2.7: "- " produce una viñeta de verdad en el input y el documento conserva el markdown',
    async run(page) {
      await clearPrompt(page);
      await typeInPrompt(page, '- uno');
      const enLaLineaDelCursor = await page.evaluate(() => ({
        // En la linea del CURSOR el marcador se VE (comportamiento Obsidian: se puede editar).
        marcadorVisible: document.querySelectorAll('[data-prompt-editor="true"] .cm-mg-bullet').length,
        ocultos: document.querySelectorAll('[data-prompt-editor="true"] .cm-mg-marker-hidden').length,
      }));
      // Se baja de linea con Shift+Enter (NO Enter: eso enviaria) para que la primera deje de ser la
      // del cursor y su `- ` se sustituya por la viñeta pintada (P-026, 1.5: un `::before` con `•`).
      await page.keyboard.press('Shift+Enter');
      await page.waitForTimeout(CONFIG.settleMs);
      const trasBajar = await page.evaluate(() => {
        const pintadas = [...document.querySelectorAll('[data-prompt-editor="true"] .cm-mg-bullet-painted')];
        return {
          pintadas: pintadas.length,
          vineta: pintadas[0] === undefined ? null : getComputedStyle(pintadas[0], '::before').content,
        };
      });
      const documento = await promptText(page);
      await clearPrompt(page);
      const ok =
        enLaLineaDelCursor.marcadorVisible === 1 &&
        enLaLineaDelCursor.ocultos === 0 &&
        trasBajar.pintadas >= 1 &&
        trasBajar.vineta === '"•"' &&
        (documento ?? '').includes('- uno');
      return {
        ok,
        detail: `linea del cursor=${JSON.stringify(enLaLineaDelCursor)} tras bajar=${JSON.stringify(trasBajar)} documento=${JSON.stringify(documento)}`,
      };
    },
  },
  {
    // P-026, 1.5: los numeros de una lista se ven en TODAS las lineas, no solo en la del cursor (la
    // alpha ocultaba el resto con `font-size: 0` y solo quedaba el «6.» del parrafo activo). El borrador
    // se fija por el store: teclear tres lineas exigiria Shift+Enter y la continuacion de lista.
    name: 'Prompt: una lista numerada ensena los tres numeros, no solo el de la linea del cursor',
    async run(page) {
      const previoStore = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      const tabId = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      await page.evaluate((id) => window.__mageDev.store.getState().setDraft(id, { text: '1. uno\n2. dos\n3. tres', attachments: [] }), tabId);
      await page.waitForTimeout(CONFIG.settleMs);
      const numeros = await page.evaluate(() =>
        [...document.querySelectorAll('[data-prompt-editor="true"] .cm-mg-ordinal')].map((node) => ({
          texto: (node.textContent ?? '').trim(),
          fontSize: parseFloat(getComputedStyle(node).fontSize),
          ancho: node.getBoundingClientRect().width,
        })),
      );
      await page.evaluate((id) => window.__mageDev.store.getState().setDraft(id, null), tabId);
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previoStore);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok = numeros.length === 3 && numeros.every((n) => n.fontSize > 0 && n.ancho > 0);
      return { ok, detail: `numeros=${JSON.stringify(numeros)}` };
    },
  },
  {
    // 2.7: el popover de "/" contra el editor NUEVO. Si el puente de teclado esta mal, esta es la que
    // lo caza (las flechas tienen que llegar al popover, no a CodeMirror).
    name: '2.7: el popover de "/" sigue navegable con flechas en el editor nuevo',
    async run(page) {
      await clearPrompt(page);
      await typeInPrompt(page, '/');
      const listbox = page.getByRole('listbox', { name: 'Comandos disponibles' });
      await listbox.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const primero = await page.evaluate(() =>
        document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.trim() ?? '',
      );
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(CONFIG.settleMs);
      const segundo = await page.evaluate(() =>
        document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.trim() ?? '',
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(CONFIG.settleMs);
      const trasEscape = await listbox.count();
      await clearPrompt(page);
      const ok = primero.length > 0 && segundo.length > 0 && primero !== segundo && trasEscape === 0;
      return { ok, detail: `seleccionado=${JSON.stringify(primero)} tras ArrowDown=${JSON.stringify(segundo)} listbox tras Escape=${trasEscape}` };
    },
  },
  {
    // 2.7: Tab/Shift+Tab siguen indentando en el editor nuevo. El puente delega en el MISMO resolver,
    // asi que esto mide que la delegacion funciona (y con ella los overrides de D5).
    name: '2.7: Tab indenta y Shift+Tab desindenta en el editor nuevo',
    async run(page) {
      await clearPrompt(page);
      await typeInPrompt(page, 'hola');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(CONFIG.settleMs);
      const indentado = await promptText(page);
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(CONFIG.settleMs);
      const desindentado = await promptText(page);
      await clearPrompt(page);
      const ok = indentado === '  hola' && desindentado === 'hola';
      return { ok, detail: `tras Tab=${JSON.stringify(indentado)} tras Shift+Tab=${JSON.stringify(desindentado)}` };
    },
  },
  {
    // 2.7: deshacer. Un <textarea> lo daba GRATIS; un contenteditable no, y sin `history()` se pierde
    // en silencio (el usuario lo descubre perdiendo un parrafo).
    name: '2.7: deshacer funciona en el editor nuevo',
    async run(page) {
      await clearPrompt(page);
      await typeInPrompt(page, 'hola');
      const antes = await promptText(page);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(CONFIG.settleMs);
      const despues = await promptText(page);
      await clearPrompt(page);
      const ok = antes === 'hola' && despues !== 'hola';
      return { ok, detail: `antes=${JSON.stringify(antes)} tras Ctrl+Z=${JSON.stringify(despues)}` };
    },
  },
  {
    // 2.7: el editor tiene que ser EDITABLE a ojos del resolver global. De eso depende que
    // `permission.cycleMode` (guard `!focusInEditableText`) no se dispare al escribir. Antes funcionaba
    // porque `isEditableTarget` miraba HTMLTextAreaElement; con CM6 pasa a depender de la rama de
    // `isContentEditable`, asi que se MIDE en vez de suponerse.
    name: '2.7: el editor es editable a ojos del resolver global',
    async run(page) {
      await promptAreas(page).first().click();
      await page.waitForTimeout(CONFIG.settleMs);
      const measured = await page.evaluate(() => {
        const active = document.activeElement;
        return {
          contentEditable: active instanceof HTMLElement ? active.isContentEditable : false,
          dentroDelEditor: active?.closest('[data-prompt-editor="true"]') !== null,
          rol: active?.getAttribute('role') ?? null,
        };
      });
      const ok = measured.contentEditable && measured.dentroDelEditor && measured.rol === 'textbox';
      return { ok, detail: `foco=${JSON.stringify(measured)}` };
    },
  },
  {
    // 2.7: encabezado + enfasis + codigo inline TECLEADOS letra a letra. Esta comprobacion nace de un
    // bug real que solo aparecio al escribir en el .exe: al teclear "## " se emitia una decoracion VACIA,
    // CodeMirror lanzaba "Mark decorations may not be empty" y el plugin se caia dejando el input SIN
    // formato para el resto de la sesion. Se mide el estilo CALCULADO, no la clase: si el plugin muere,
    // los contadores se van a 0.
    name: '2.7: teclear un encabezado con enfasis y codigo decora sin tumbar el plugin',
    async run(page) {
      await clearPrompt(page);
      // El enfasis va en su PROPIA linea: dentro de un encabezado no se decora (solaparia con el rango
      // del encabezado, y ahi CodeMirror tambien lanza). Shift+Enter, nunca Enter.
      await typeInPrompt(page, '## Titulo');
      // Sigue escribiendo por TECLADO sin volver a hacer clic: un `click` recolocaria el cursor al final
      // de la primera linea y el texto acabaria concatenado ahi (medido).
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('**negrita** y `code`');
      await page.waitForTimeout(CONFIG.settleMs);
      const measured = await page.evaluate(() => {
        const root = document.querySelector('[data-prompt-editor="true"]');
        const style = (selector) => {
          const node = root.querySelector(selector);
          return node === null ? null : getComputedStyle(node);
        };
        return {
          h2: root.querySelectorAll('.cm-mg-h2').length,
          strong: root.querySelectorAll('.cm-mg-strong').length,
          code: root.querySelectorAll('.cm-mg-code').length,
          pesoDelStrong: style('.cm-mg-strong')?.fontWeight ?? null,
          pxDelH2: style('.cm-mg-h2')?.fontSize ?? null,
        };
      });
      const documento = await promptText(page);
      await clearPrompt(page);
      const ok =
        measured.h2 === 1 &&
        measured.strong === 1 &&
        measured.code === 1 &&
        Number(measured.pesoDelStrong) >= 600 &&
        documento === '## Titulo\n**negrita** y `code`';
      return { ok, detail: `decoraciones=${JSON.stringify(measured)} documento=${JSON.stringify(documento)}` };
    },
  },
  {
    // 2.7: la vista previa se va (el input YA es WYSIWYG). Sin esta medida el boton se quedaria
    // huerfano y nadie lo notaria.
    name: '2.7: ya no hay boton de vista previa del markdown',
    async run(page) {
      const measured = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[data-tip], [title]')];
        // Los dos rotulos que tenia el boton eliminado (alternaba segun estuviera abierta o cerrada).
        return nodes.filter((node) =>
          /vista previa del markdown|markdown renderizado/i.test(node.getAttribute('data-tip') ?? node.getAttribute('title') ?? ''),
        ).length;
      });
      return { ok: measured === 0, detail: `botones de vista previa=${measured}` };
    },
  },
  {
    // 2.12.1: adjuntar. El camino FELIZ (un PNG real) deja 1 miniatura con `naturalWidth > 0`, y el
    // invalido (un .svg) da un error EXPLICITO con el tipo recibido y no adjunta nada. No se envia.
    name: '2.12.1: adjuntar una imagen valida deja miniatura y una invalida da error explicito',
    async run(page, ctx) {
      // Con dos pestañas PROPIAS (P-026, 1.2): el error de adjuntar vivia en estado local de la barra,
      // que no se remonta, y se quedaba pintado en la pestaña siguiente para siempre.
      const previoStore = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      const tabConError = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      // Por PEGADO sintetico (P-026, 2.1): el `<input type=file>` y su item del menu ya no existen, y el
      // pegado es la unica via. PNG REAL de 1x1 (el del fixture de la Fase A): `naturalWidth` puede ser > 0.
      await pasteFiles(page, [{ name: 'adjunto-valido.png', type: 'image/png', base64: TINY_PNG_BASE64 }]);
      await page.waitForTimeout(CONFIG.settleMs);
      const valido = await page.evaluate(() => {
        const thumbs = [...document.querySelectorAll('img[data-attachment="thumb"]')];
        return { miniaturas: thumbs.length, naturalWidth: thumbs[0]?.naturalWidth ?? 0 };
      });

      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf-8').toString('base64');
      await pasteFiles(page, [{ name: 'adjunto-invalido.svg', type: 'image/svg+xml', base64: svg }]);
      await page.waitForTimeout(CONFIG.settleMs);
      const invalido = await page.evaluate(() => {
        const alerts = [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent ?? '');
        return {
          errores: alerts.filter((t) => /no admitido/i.test(t)).length,
          conElTipo: alerts.some((t) => t.includes('image/svg+xml')),
          miniaturas: document.querySelectorAll('img[data-attachment="thumb"]').length,
        };
      });

      // El error NO viaja a otra pestaña, ni vuelve al regresar a la suya.
      const erroresDeAdjuntar = () =>
        page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].filter((n) => /adjuntar/i.test(n.textContent ?? '')).length);
      await openTemporaryConversation(page);
      await page.waitForTimeout(CONFIG.settleMs);
      const enOtraPestana = await erroresDeAdjuntar();
      await page.evaluate((id) => window.__mageDev.store.getState().setActiveTab(id), tabConError);
      await page.waitForTimeout(CONFIG.settleMs);
      const alVolver = await erroresDeAdjuntar();

      // Se quita la miniatura: la comprobacion no deja adjuntos colgando para las siguientes.
      const quitar = page.getByRole('button', { name: /Quitar el adjunto/ });
      if ((await quitar.count()) > 0) await quitar.first().click();
      await page.waitForTimeout(CONFIG.settleMs);
      const limpio = await page.locator('img[data-attachment="thumb"]').count();
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previoStore);
      await page.waitForTimeout(CONFIG.settleMs);

      const ok =
        valido.miniaturas === 1 &&
        valido.naturalWidth > 0 &&
        invalido.errores === 1 &&
        invalido.conElTipo &&
        invalido.miniaturas === 1 && // el invalido NO se adjunta: sigue habiendo solo el valido
        enOtraPestana === 0 &&
        alVolver === 0 &&
        limpio === 0;
      return {
        ok,
        detail: `valido=${JSON.stringify(valido)} invalido=${JSON.stringify(invalido)} errores en otra pestaña=${enOtraPestana} al volver=${alVolver} tras quitar=${limpio}`,
      };
    },
  },
  {
    // 2.3 (la otra mitad): el panel de permisos NORMAL — el que sale con Write/Bash y NO es una pregunta.
    // Nace de un fallo de verificacion real: el nombre accesible del boton era "Permitir1" (se colaba el
    // numero del atajo), asi que era imposible anclarlo desde fuera y varias tandas de prueba con turnos
    // REALES se quedaron colgadas creyendo que el boton no existia. Ahora los tres botones llevan
    // `aria-label` estable y `aria-keyshortcuts`, y esto lo fija.
    name: '2.3: un permiso de Write pinta la tarjeta en el chat y los botones del panel',
    async run(page) {
      // Con pestana REAL: las reglas "Permitir siempre aqui" y la seccion de permisos configurados del
      // panel viven en la `Tab`, y el harness arranca sin ninguna pestana persistida (a proposito, para
      // no spawnear el CLI). Sin abrirla, esto medía un panel que no puede pintar nada.
      const previoStore = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      const icon = page.getByRole('button', { name: 'Permiso', exact: true }).first();
      const abiertoAntes = (await icon.getAttribute('aria-pressed')) === 'true';
      if (!abiertoAntes) {
        await icon.click();
        await page.waitForTimeout(CONFIG.settleMs);
      }
      const requestId = 'verify-write-1';
      await injectPermissionRequest(
        page,
        { file_path: 'C:/proj/nuevo.ts', content: 'export const a = 1;\n' },
        requestId,
        'Write',
      );
      const measured = await page.evaluate(() => {
        // Los botones se miden POR AMBITO (tarjeta del chat / panel del dock) y no con un
        // `querySelector` global: desde 2.3b los dos sitios ofrecen la misma decision con el mismo
        // nombre accesible, y el selector global devolvia el primero del DOM — el de la tarjeta.
        const boton = (raiz, label) => {
          const node = raiz?.querySelector(`button[aria-label="${label}"]`) ?? null;
          return node === null ? null : { atajo: node.getAttribute('aria-keyshortcuts'), texto: (node.textContent ?? '').trim() };
        };
        const card = document.querySelector('[data-permission-card]');
        const panel = document.querySelector('[data-permissions-panel="true"]');
        return {
          tarjeta: card === null
            ? null
            : {
                estado: card.getAttribute('data-permission-card'),
                objetivo: (card.textContent ?? '').includes('C:/proj/nuevo.ts'),
                permitir: boton(card, 'Permitir'),
                permitirSiempre: boton(card, 'Permitir siempre Write aquí'),
                denegar: boton(card, 'Denegar y decir por qué'),
                masInformacion: [...card.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Más información'),
              },
          panel: panel === null
            ? null
            : {
                permitir: boton(panel, 'Permitir'),
                permitirSiempre: boton(panel, 'Permitir siempre Write aquí'),
                denegar: boton(panel, 'Denegar y decir por qué'),
                diff: (panel.textContent ?? '').includes('export const a = 1;'),
                modo: (panel.textContent ?? '').includes('Modo de permiso'),
                configurados: (panel.textContent ?? '').includes('Permitido siempre en esta conversación'),
                reglasDelCli: (panel.textContent ?? '').includes('Reglas del CLI'),
              },
          // El numero del atajo NO debe entrar en el nombre accesible (era el fallo original).
          numeroEnElNombre: [...document.querySelectorAll('button[aria-label]')].some((b) =>
            /^Permitir\d/.test(b.getAttribute('aria-label') ?? ''),
          ),
          avisoDeEscritura: document.body.innerText.includes('quiere escribir en el proyecto'),
          // 2.3b: el aviso "Claude necesita tu atención" ya NO va al hilo (lo sustituye la tarjeta).
          avisoDeAtencion: document.body.innerText.includes('necesita tu atención'),
        };
      });
      await cancelInjectedPermission(page, requestId);
      const trasCancelar = await page.evaluate(() => ({
        botones: document.querySelectorAll('button[aria-label="Permitir"]').length,
        tarjeta: document.querySelector('[data-permission-card]')?.getAttribute('data-permission-card') ?? null,
        enActividad: [...document.querySelectorAll('[data-activity-row="permission"]')].some((n) => (n.textContent ?? '').includes('cancelado')),
      }));
      if (!abiertoAntes) {
        await icon.click(); // se deja el dock como estaba
        await page.waitForTimeout(CONFIG.settleMs);
      }
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previoStore);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        measured.tarjeta?.estado === 'pending' &&
        measured.tarjeta.objetivo === true &&
        measured.tarjeta.permitir?.atajo === '1' &&
        measured.tarjeta.permitirSiempre?.atajo === '2' &&
        measured.tarjeta.denegar?.atajo === '3' &&
        measured.tarjeta.masInformacion === true &&
        // El panel sigue ofreciendo la misma decision, ahi CON el numero del atajo visible, y ademas es
        // el que ensena el detalle (diff) y lo configurado.
        measured.panel?.permitir?.texto === 'Permitir1' &&
        measured.panel.permitirSiempre?.atajo === '2' &&
        measured.panel.denegar?.atajo === '3' &&
        measured.panel.diff === true &&
        measured.panel.modo === true &&
        measured.panel.configurados === true &&
        measured.panel.reglasDelCli === true &&
        measured.numeroEnElNombre === false &&
        measured.avisoDeEscritura &&
        measured.avisoDeAtencion === false &&
        // Cancelado: nadie ofrece contestar, y desde P-026 3.4 (D23) el permiso ya resuelto sale del hilo:
        // su relato vive en el panel de Actividad (la fila solo se mide si el panel esta montado).
        trasCancelar.botones === 0 &&
        trasCancelar.tarjeta === null;
      return { ok, detail: `${JSON.stringify(measured)} tras cancelar=${JSON.stringify(trasCancelar)} (el panel estaba ${abiertoAntes ? 'abierto' : 'cerrado'})` };
    },
  },
  {
    // 2.3b: "Permitir siempre <tool> aqui" tiene que RECORDAR. La regla se concede por la accion real
    // del store y no por un clic: sin sesion viva la respuesta no llega a main, que es justo lo que deja
    // medir la regla sin tocar el CLI ni gastar un turno. Lo que se comprueba es lo unico que importa:
    // que la SIGUIENTE peticion de esa tool no pinta tarjeta ni pone la pestana en "necesita permiso",
    // que otra tool sigue preguntando, que la regla se ve en el panel y que revocarla la quita.
    name: '2.3b: "Permitir siempre" recuerda la tool y el panel la deja revocar',
    async run(page) {
      const previoStore = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      const icon = page.getByRole('button', { name: 'Permiso', exact: true }).first();
      const abiertoAntes = (await icon.getAttribute('aria-pressed')) === 'true';
      if (!abiertoAntes) {
        await icon.click();
        await page.waitForTimeout(CONFIG.settleMs);
      }
      await injectPermissionRequest(page, { file_path: 'C:/proj/a.ts', content: 'a' }, 'verify-always-1', 'Write');
      await page.evaluate(() => window.__mageDev.store.getState().allowAlwaysAndAnswer('Write'));
      await page.waitForTimeout(CONFIG.settleMs);
      const conRegla = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        return {
          regla: tab?.alwaysAllowTools ?? [],
          enElPanel: document.querySelector('button[aria-label="Revocar el permiso permanente de Write"]') !== null,
        };
      });
      // La peticion sigue pendiente porque sin sesion viva no hay a quien contestar: se cierra por el
      // mismo camino que el CLI para dejar el hilo limpio antes de medir la segunda.
      await cancelInjectedPermission(page, 'verify-always-1');

      // Segunda peticion de la MISMA tool: ni tarjeta, ni panel, ni estado de espera.
      await injectPermissionRequest(page, { file_path: 'C:/proj/b.ts', content: 'b' }, 'verify-always-2', 'Write');
      const segunda = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        const tabId = s.activeTabId;
        return {
          tarjetasPendientes: document.querySelectorAll('[data-permission-card="pending"]').length,
          estado: s.statusByChat[tabId] ?? null,
          panelConPeticion: (s.pendingByChat[tabId] ?? []).length > 0,
        };
      });
      // Una tool DISTINTA sigue preguntando: la regla es por tool, no un "permitir todo".
      await injectPermissionRequest(page, { command: 'ls' }, 'verify-always-3', 'Bash');
      const otraTool = await page.evaluate(() => document.querySelectorAll('[data-permission-card="pending"]').length);

      await cancelInjectedPermission(page, 'verify-always-3');
      await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        s.revokeAlwaysAllow(s.activeTabId, 'Write');
      });
      await page.waitForTimeout(CONFIG.settleMs);
      const trasRevocar = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return {
          reglas: (s.tabs.find((t) => t.id === s.activeTabId)?.alwaysAllowTools ?? []).length,
          enElPanel: document.querySelector('button[aria-label="Revocar el permiso permanente de Write"]') !== null,
        };
      });
      if (!abiertoAntes) {
        await icon.click();
        await page.waitForTimeout(CONFIG.settleMs);
      }
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previoStore);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        conRegla.regla.includes('Write') &&
        conRegla.enElPanel &&
        segunda.tarjetasPendientes === 0 &&
        segunda.estado !== 'needs_permission' &&
        segunda.panelConPeticion === false &&
        otraTool === 1 &&
        trasRevocar.reglas === 0 &&
        trasRevocar.enElPanel === false;
      return { ok, detail: `conRegla=${JSON.stringify(conRegla)} segunda=${JSON.stringify(segunda)} otraTool=${otraTool} trasRevocar=${JSON.stringify(trasRevocar)}` };
    },
  },
  {
    // 2.10 — Panel "Ficheros": lo que el agente CREA aparece a la derecha, se lee de DISCO y se puede
    // editar y guardar. Se inyecta un `Write` por el reducer REAL (tool_use + tool_result, como el
    // stream) sobre un fichero de verdad dentro de la carpeta temporal de la conversacion, asi que lo
    // que se mide es la cadena completa: bloque -> lista -> IPC de lectura -> render -> IPC de escritura
    // -> disco. Incluido el compare-and-swap: se toca el fichero por detras y el guardado debe negarse.
    name: '2.10: el panel de Ficheros ensena lo que el agente creo y deja editarlo',
    async run(page) {
      const previoStore = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat };
      });
      await openTemporaryConversation(page);
      const cwd = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return s.tabs.find((t) => t.id === s.activeTabId)?.cwd ?? null;
      });
      if (cwd === null) throw new Error('la conversacion temporal no tiene cwd');
      const filePath = path.join(cwd, 'plan.md');
      fs.writeFileSync(filePath, '# Plan\n\n- primero\n', 'utf-8');

      // Se inyecta por `handleEvent` y NO por `reduceEvent` a pelo: la apertura automatica del panel
      // vive ahi (es un efecto, no parte del reducer puro), asi que pasando por el reducer solo se
      // medía media cadena. `handleEvent` enruta por sessionId, asi que se le da uno a la pestaña —
      // ningun IPC se toca con eventos de tool.
      //
      // El `Write` tal como llega del CLI: el tool_use NO trae ruta (la trae el RESULTADO, en `file`),
      // que es justo por lo que el panel solo puede listar ficheros ya escritos.
      await page.evaluate((ruta) => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        const sessionId = 'verify-files-session';
        dev.store.setState((state) => ({ sessionIdByChat: { ...state.sessionIdByChat, [tabId]: sessionId } }));
        const handle = (event) => dev.store.getState().handleEvent(sessionId, event);
        handle({ kind: 'tool_use', tool: { toolUseId: 'tu-write-1', toolName: 'Write', input: { file_path: ruta, content: '# Plan' } } });
        handle({
          kind: 'tool_result',
          result: {
            toolUseId: 'tu-write-1',
            isError: false,
            output: 'File created successfully',
            durationMs: 12,
            file: { path: ruta, content: '# Plan' },
          },
        });
      }, filePath);
      await page.waitForTimeout(CONFIG.settleMs * 5);

      const trasCrear = await page.evaluate(() => {
        const fila = document.querySelector('[data-created-file]');
        const panel = fila?.closest('div')?.parentElement ?? null;
        const icono = [...document.querySelectorAll('button[data-stripe-btn="true"]')].find((b) => b.getAttribute('aria-label') === 'Ficheros');
        return {
          // El panel se ABRE solo al crearse el fichero (es lo que se pidio: "que aparezca a la derecha").
          iconoActivo: icono?.getAttribute('aria-pressed') === 'true',
          ficherosListados: document.querySelectorAll('[data-created-file]').length,
          nombre: fila?.textContent?.includes('plan.md') ?? false,
          // El contenido viene de DISCO y el .md se pinta RENDERIZADO con el Markdown propio de Mage
          // (que hace los encabezados con `div`, no con `h1`: se mide el contenedor `.mg-md` y que el
          // `#` del origen NO se vea, que es la diferencia entre renderizar y volcar el texto crudo).
          renderizado: panel?.querySelector('.mg-md')?.textContent?.includes('Plan') ?? false,
          markdownCrudo: (panel?.textContent ?? '').includes('# Plan'),
          contenido: (panel?.textContent ?? '').includes('primero'),
        };
      });

      // Editar y guardar por la INTERFAZ real, no por el store. Si algo de esto falla, el error se
      // devuelve en la medida en vez de tumbar la comprobacion sin decir que se habia visto.
      const pasos = {};
      try {
        await page.getByRole('button', { name: 'Editar plan.md' }).click();
        await page.getByRole('textbox', { name: 'Contenido de plan.md' }).fill('# Plan editado\n\n- segundo\n');
        await page.getByRole('button', { name: 'Guardar plan.md' }).click();
        await page.waitForTimeout(CONFIG.settleMs * 4);
        pasos.enDisco = fs.readFileSync(filePath, 'utf-8');

        // Compare-and-swap: alguien (el agente, u otro editor) toca el fichero y el guardado se niega.
        await page.getByRole('button', { name: 'Editar plan.md' }).click();
        fs.writeFileSync(filePath, '# Lo cambio otro\n', 'utf-8');
        await page.getByRole('textbox', { name: 'Contenido de plan.md' }).fill('# Lo mio\n');
        await page.getByRole('button', { name: 'Guardar plan.md' }).click();
        await page.waitForTimeout(CONFIG.settleMs * 4);
        pasos.conflicto = await page.evaluate(() => ({
          aviso: [...document.querySelectorAll('[role="alert"]')].some((n) => (n.textContent ?? '').includes('cambió en disco')),
          sigueEditando: document.querySelector('textarea[aria-label="Contenido de plan.md"]') !== null,
        }));
        pasos.trasConflicto = fs.readFileSync(filePath, 'utf-8');
      } catch (error) {
        pasos.fallo = error.message;
      }

      // Un PLAN del CLI: vive en `<configDir>/plans`, o sea FUERA del cwd de cualquier conversacion. Es
      // el reporte «¿cómo es que sale fuera del sitio?»: el panel lo listaba (lo escribio un `Write` de
      // esta conversacion) y luego se negaba a abrirlo. Se comprueba con la raiz REAL, porque lo que
      // hay que verificar es que main wire el whitelisting correcto — un test unitario del predicado
      // inyectado no lo demuestra. El fichero lleva nombre inequivoco y se borra al terminar.
      const plansDir = path.join(os.homedir(), '.claude', 'plans');
      const planPath = path.join(plansDir, 'mage-verify-plan.md');
      const plan = {};
      if (fs.existsSync(path.dirname(plansDir))) {
        fs.mkdirSync(plansDir, { recursive: true });
        fs.writeFileSync(planPath, '# Plan del CLI\n\n- fuera del cwd\n', 'utf-8');
        try {
          await page.evaluate((ruta) => {
            const dev = window.__mageDev;
            const sessionId = 'verify-files-session';
            const handle = (event) => dev.store.getState().handleEvent(sessionId, event);
            handle({ kind: 'tool_use', tool: { toolUseId: 'tu-write-plan', toolName: 'Write', input: { file_path: ruta } } });
            handle({
              kind: 'tool_result',
              result: { toolUseId: 'tu-write-plan', isError: false, output: 'File created successfully', durationMs: 3, file: { path: ruta, content: '# Plan del CLI' } },
            });
          }, planPath);
          await page.waitForTimeout(CONFIG.settleMs * 2);
          // El visor es un DESPLEGABLE desde el 2026-09-21: pulsar el fichero que YA esta abierto lo
          // cierra. Un `click()` a ciegas abria o cerraba segun cual estuviera elegido por defecto —y
          // el plan recien inyectado puede serlo—, asi que se consulta `aria-expanded` y solo se pulsa
          // si hace falta: medir el estado antes de actuar, en vez de suponerlo.
          const filaDelPlan = page.locator(`[data-created-file="${planPath.replace(/\\/g, '\\\\')}"]`);
          if ((await filaDelPlan.getAttribute('aria-expanded')) !== 'true') await filaDelPlan.click();
          await page.waitForTimeout(CONFIG.settleMs * 4);
          plan.medido = await page.evaluate(() => {
            // Avisos DE ESTE PANEL, no de todo el documento: el prompt y el hilo tienen los suyos y
            // sobreviven a comprobaciones anteriores (se colaba el "no se pudo adjuntar" de 2.12.1).
            const panel = document.querySelector('[data-files-panel="true"]');
            const alerta = [...(panel?.querySelectorAll('[role="alert"]') ?? [])].map((n) => n.textContent ?? '');
            return { errores: alerta, renderizado: panel?.querySelector('.mg-md')?.textContent?.includes('Plan del CLI') ?? false };
          });
          // El DESPLIEGUE conmuta (2026-09-21, peticion del usuario: "al volver a hacer clic sobre un
          // archivo abierto, este no se cierra"). Se mide el ciclo entero sobre la fila que ya esta
          // abierta: cerrar y volver a abrir. Se espera al DESMONTAJE, no a un tiempo fijo — el visor
          // sale con una animacion de 120 ms y contarlo antes daria una medida distinta cada tanda.
          const visorDelPlan = page.locator(`[data-files-panel="true"] .mg-md`).first();
          await filaDelPlan.click();
          await visorDelPlan.waitFor({ state: "detached", timeout: CONFIG.actionTimeoutMs }).catch(() => {});
          plan.toggle = {
            cerrado: (await filaDelPlan.getAttribute('aria-expanded')) === 'false',
            visorFuera: (await page.locator(`[data-files-panel="true"] .mg-md`).count()) === 0,
          };
          // Se deja ABIERTO como estaba: el contrato del arnes es devolver el estado que se encontro.
          await filaDelPlan.click();
          await visorDelPlan.waitFor({ state: "visible", timeout: CONFIG.actionTimeoutMs }).catch(() => {});
          plan.toggle.reabre = (await filaDelPlan.getAttribute('aria-expanded')) === 'true';
        } catch (error) {
          plan.fallo = error.message;
        } finally {
          fs.rmSync(planPath, { force: true });
        }
      } else {
        plan.omitido = 'no hay ~/.claude en esta maquina';
      }

      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previoStore);
      await page.waitForTimeout(CONFIG.settleMs);
      const medido = { trasCrear, ...pasos, plan };
      const ok =
        trasCrear.iconoActivo === true &&
        trasCrear.ficherosListados === 1 &&
        trasCrear.nombre === true &&
        trasCrear.renderizado === true &&
        trasCrear.markdownCrudo === false &&
        trasCrear.contenido === true &&
        pasos.enDisco === '# Plan editado\n\n- segundo\n' &&
        pasos.conflicto?.aviso === true &&
        pasos.conflicto?.sigueEditando === true &&
        // Lo que escribio el otro SIGUE ahi: el guardado se nego, no se piso.
        pasos.trasConflicto === '# Lo cambio otro\n' &&
        // Y el plan del CLI —fuera del cwd— se abre sin error (o se omite si esta maquina no tiene
        // `~/.claude`, que en la del harness si existe).
        (plan.omitido !== undefined ||
          (plan.medido?.renderizado === true &&
            plan.medido.errores.length === 0 &&
            // Y el despliegue CONMUTA: cerrar desmonta el visor, y volver a pulsar lo reabre.
            plan.toggle?.cerrado === true &&
            plan.toggle?.visorFuera === true &&
            plan.toggle?.reabre === true));
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // P-028, punto 15: un fichero que el agente escribio FUERA de la carpeta de la conversacion ya no
    // da un error: el panel lo lista y ofrece «Abrir de todos modos…» (la pregunta la hace main con un
    // dialogo NATIVO). Esta comprobacion NO pulsa nada: el dialogo nativo no se puede contestar por CDP
    // y bloquearia el arnes. Se mide solo el aviso del fichero que el panel abre por defecto (ese no
    // pregunta solo: el dialogo sale unicamente cuando el usuario elige el fichero).
    name: 'P-028 15: un fichero fuera de la carpeta se ofrece abrir en vez de dar error',
    async run(page) {
      const previoStore = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat };
      });
      await openTemporaryConversation(page);
      const cwd = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return s.tabs.find((t) => t.id === s.activeTabId)?.cwd ?? null;
      });
      if (cwd === null) throw new Error('la conversacion temporal no tiene cwd');
      // Hermana del cwd: fuera de el y fuera de las tres raices sin pregunta (planes, memoria, scratchpad).
      const outsideDir = path.join(path.dirname(cwd), `mage-verify-fuera-${Date.now()}`);
      const outsidePath = path.join(outsideDir, 'nota.md');
      fs.mkdirSync(outsideDir, { recursive: true });
      fs.writeFileSync(outsidePath, '# Nota de fuera\n', 'utf-8');
      let medido = null;
      try {
        await page.evaluate((ruta) => {
          const dev = window.__mageDev;
          const tabId = dev.store.getState().activeTabId;
          const sessionId = 'verify-outside-session';
          dev.store.setState((state) => ({ sessionIdByChat: { ...state.sessionIdByChat, [tabId]: sessionId } }));
          const handle = (event) => dev.store.getState().handleEvent(sessionId, event);
          handle({ kind: 'tool_use', tool: { toolUseId: 'tu-write-fuera', toolName: 'Write', input: { file_path: ruta } } });
          handle({
            kind: 'tool_result',
            result: { toolUseId: 'tu-write-fuera', isError: false, output: 'File created successfully', durationMs: 3, file: { path: ruta, content: '# Nota' } },
          });
        }, outsidePath);
        await page.waitForTimeout(CONFIG.settleMs * 5);
        medido = await page.evaluate(() => {
          const panel = document.querySelector('[data-files-panel="true"]');
          const aviso = panel?.querySelector('[data-outside-cwd="true"]') ?? null;
          return {
            aviso: aviso !== null,
            boton: [...(aviso?.querySelectorAll('button') ?? [])].some((b) => (b.textContent ?? '').includes('Abrir de todos modos')),
            errores: [...(panel?.querySelectorAll('[role="alert"]') ?? [])].map((n) => n.textContent ?? ''),
            contenidoFiltrado: (panel?.textContent ?? '').includes('Nota de fuera'),
          };
        });
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
        await page.evaluate((estado) => window.__mageDev.store.setState(estado), previoStore);
        await page.waitForTimeout(CONFIG.settleMs);
      }
      const ok = medido?.aviso === true && medido.boton === true && medido.errores.length === 0 && medido.contenidoFiltrado === false;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // P-028 grupo C (puntos 3, 35 y `/clear`): la salida de un comando local se VE en el chat. Se
    // inyecta por `handleEvent` lo que normalize.ts saca de los payloads medidos en 2.1.284 (un
    // `assistant` sintetico con `local_command_run`, y `conversation_reset`). Ningun turno: el sessionId
    // es inventado y ningun evento de estos llama al CLI.
    name: 'P-028 C: comandos locales en el chat (rename, context, usage, clear)',
    async run(page) {
      const previoStore = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat, blocksByChat: s.blocksByChat };
      });
      await openTemporaryConversation(page);
      const context = '## Context Usage\n| Category | Tokens |\n|---|---|\n| System prompt | 3.1k |\n| Messages | 120 |';
      const usage = 'Current session   12%\nCurrent week      40%';
      await page.evaluate(({ context, usage }) => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        const sessionId = 'verify-local-commands';
        dev.store.setState((state) => ({ sessionIdByChat: { ...state.sessionIdByChat, [tabId]: sessionId } }));
        const handle = (event) => dev.store.getState().handleEvent(sessionId, event);
        handle({ kind: 'local_command_output', command: 'rename', args: 'verify-renombrada', text: 'Session renamed to: verify-renombrada' });
        handle({ kind: 'local_command_output', command: 'context', args: '', text: context });
        handle({ kind: 'local_command_output', command: 'usage', args: '', text: usage });
      }, { context, usage });
      await page.waitForTimeout(CONFIG.settleMs * 2);
      const antes = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        const md = document.querySelector('[data-command-output="markdown"]');
        return {
          titulo: tab?.title ?? null,
          lineas: document.querySelectorAll('[data-command-output="line"]').length,
          conTabla: md?.querySelector('table') !== null && md !== null,
          categoria: (md?.textContent ?? '').includes('System prompt'),
          cabecera: (md?.textContent ?? '').includes('/context'),
          pre: document.querySelector('[data-command-output="pre"] pre')?.textContent ?? null,
        };
      });
      await page.evaluate(() => {
        const dev = window.__mageDev;
        dev.store.getState().handleEvent('verify-local-commands', { kind: 'conversation_reset', newSessionId: 'verify-local-commands-2' });
      });
      await page.waitForTimeout(CONFIG.settleMs * 2);
      const trasClear = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return {
          sesion: s.sessionIdByChat[s.activeTabId] ?? null,
          bloques: (s.blocksByChat[s.activeTabId] ?? []).map((b) => b.kind),
          linea: [...document.querySelectorAll('[data-block="system"]')].some((n) => (n.textContent ?? '').includes('Conversación reiniciada')),
          salidasFuera: document.querySelectorAll('[data-command-output]').length === 0,
        };
      });
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previoStore);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        antes.titulo === 'verify-renombrada' &&
        antes.lineas === 1 &&
        antes.conTabla === true &&
        antes.categoria === true &&
        antes.cabecera === true &&
        antes.pre === usage &&
        trasClear.sesion === 'verify-local-commands-2' &&
        trasClear.bloques.length === 1 &&
        trasClear.linea === true &&
        trasClear.salidasFuera === true;
      return { ok, detail: JSON.stringify({ antes, trasClear }) };
    },
  },
  {
    // P-028 C, punto 7: el panel «Contexto» enseña la OCUPACION de la ventana (el desglose del CLI, el
    // mismo de la barra de estado) y no solo lo facturado. Se inyecta un `context_usage` con la forma de
    // `get_context_usage` medida en 2.1.284; ningun IPC.
    name: 'P-028 C: el panel Contexto enseña la ventana de contexto del CLI',
    async run(page) {
      const previo = await page.evaluate(() => ({
        store: (({ tabs, activeTabId, splitLayout, contextUsageByChat }) => ({ tabs, activeTabId, splitLayout, contextUsageByChat }))(window.__mageDev.store.getState()),
        layout: window.__mageDev.panelStore.getState().layout,
      }));
      await openTemporaryConversation(page);
      await page.evaluate(() => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        const usage = {
          totalTokens: 41_000,
          maxTokens: 1_000_000,
          percentage: 4,
          categories: [
            { name: 'System prompt', tokens: 3_100, isDeferred: false },
            { name: 'Messages', tokens: 37_900, isDeferred: false },
            { name: 'Free space', tokens: 959_000, isDeferred: false },
          ],
        };
        // El desglose del CLI solo existe con sesion (el CLI arranca perezoso al primer mensaje), y sin
        // ella el panel dice «Abre una conversación…» a proposito. Se le da un `resumeSessionId` de
        // mentira —el mismo truco que «Cambiar de cuenta»—, que no arranca nada.
        dev.store.setState((s) => ({
          contextUsageByChat: { ...s.contextUsageByChat, [tabId]: usage },
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, resumeSessionId: 'vg-contexto' } : t)),
        }));
      });
      await page.waitForTimeout(CONFIG.settleMs * 2);
      const medido = {};
      const boton = page.getByRole('button', { name: 'Contexto', exact: true }).first();
      if (await boton.isVisible().catch(() => false)) {
        await boton.click();
        await page.waitForTimeout(CONFIG.settleMs * 2);
        Object.assign(
          medido,
          await page.evaluate(() => {
            const pane = document.querySelector('[data-active-panel="context"]');
            const ventana = pane?.querySelector('[data-context-window="true"]');
            return {
              ventana: ventana !== null && ventana !== undefined,
              origen: ventana?.querySelector('[data-context-breakdown]')?.getAttribute('data-context-breakdown') ?? null,
              categorias: [...(ventana?.querySelectorAll('[data-context-category]') ?? [])].map((n) => n.getAttribute('data-context-category')),
              pctPanel: /· (\d+)%/.exec(ventana?.textContent ?? '')?.[1] ?? null,
              // El dato del store (lo que reporta el CLI), no otro elemento de la UI: la barra de estado ya no lo pinta.
              pctStore: String(window.__mageDev.store.getState().contextUsageByChat[window.__mageDev.store.getState().activeTabId]?.percentage ?? ''),
              acumulado: (pane?.textContent ?? '').includes('TOKENS CONSUMIDOS (acumulado)'),
            };
          }),
        );
        await boton.click();
        await page.waitForTimeout(CONFIG.settleMs);
      } else {
        medido.fallo = 'sin icono de Contexto';
      }
      await page.evaluate((p) => {
        window.__mageDev.store.setState(p.store);
        window.__mageDev.panelStore.setState({ layout: p.layout });
      }, previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok =
        medido.ventana === true &&
        medido.origen === 'cli' &&
        medido.categorias?.includes('System prompt') === true &&
        medido.categorias?.includes('Messages') === true &&
        medido.categorias?.includes('Free space') === false &&
        medido.pctPanel === '4' &&
        medido.pctStore === medido.pctPanel &&
        medido.acumulado === true;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  // --- Fase 0 de la auditoria: MEDIR, no solo comprobar -------------------------------------------
  // Las tres de abajo no miran si el DOM es correcto: miran cuanto CUESTA. Existen porque el resto del
  // plan cambia rendimiento y, sin un numero previo, "mejorado" no seria mas que una impresion. Los
  // presupuestos son deliberadamente HOLGADOS: son redes contra regresiones groseras, no benchmarks.
  // Ojo al leerlos: esto corre en DEV (Vite sin minificar, con sourcemaps y con CDP enganchado), asi
  // que los valores absolutos NO son los de la app empaquetada. Lo que vale es la comparacion consigo
  // misma antes y despues de cada fase.
  {
    // 0.1 — Coste de una rafaga de deltas. Se hidrata un hilo largo y se le inyectan deltas por el
    // reducer REAL (`__mageDev.reduceEvent`), con un frame entre medias, como haria el stream de
    // verdad. Mide el coste por delta y las tareas largas (>50 ms), que son las que se notan como tiron.
    // Pone numero a P2/P4/P5: sin `memo`, cada delta repinta los 60 bloques del hilo.
    name: '0.1: una rafaga de deltas no supera el presupuesto de frame',
    async run(page) {
      // El estado se captura ANTES de abrir nada: restaurarlo al final se lleva por delante la pestaña
      // y los bloques de golpe, sin dejar residuo para las comprobaciones siguientes.
      //
      // SELECTIVO, y esto no es un detalle: `getState()` entero cruzando el puente de CDP se serializa,
      // y un `Set` del store vuelve como objeto plano (paso con `expandedRuns`, ya retirado: el primer
      // `.has(...)` reventaba -> el ErrorBoundary se comia la app y TODO lo que corriera despues medía
      // una pantalla de error). Se copia el mismo criterio que ya usaba la comprobacion de arrastre: solo
      // las claves que esta prueba toca, y ninguna es un Set.
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat, blocksByChat: s.blocksByChat };
      });
      await openTemporaryConversation(page);
      const medido = await page.evaluate(
        async ({ bloques, deltas }) => {
          const dev = window.__mageDev;
          if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
          const tabId = dev.store.getState().activeTabId;
          const hilo = [];
          for (let i = 0; i < bloques; i += 1) {
            const slot = i % 3;
            if (slot === 0) hilo.push({ kind: 'user', id: `p0-u${i}`, text: `Mensaje del usuario ${i}`, time: '12:00', attachments: [] });
            else if (slot === 1) hilo.push({ kind: 'agent', id: `p0-a${i}`, runs: [{ code: false, text: `Respuesta del agente ${i}` }], streaming: false });
            else
              hilo.push({
                kind: 'tool',
                id: `p0-t${i}`,
                toolUseId: `p0-tu${i}`,
                tool: 'Read',
                command: `src/fichero-${i}.ts`,
                meta: 'ok · 12 ms',
                output: [{ code: false, text: `salida de la herramienta ${i}` }],
                filePath: null,
                error: false,
              });
          }
          dev.store.setState({ blocksByChat: { ...dev.store.getState().blocksByChat, [tabId]: hilo } });
          await new Promise((resolve) => requestAnimationFrame(resolve));

          // Coste de un frame EN VACIO, antes de medir nada. La rafaga se marca el ritmo con
          // `requestAnimationFrame`, y ese reloj no es constante: si la ventana queda oculta o tapada,
          // Chromium estrangula rAF a 1 Hz y la medida salia en 1005 ms/delta con CERO tareas largas —
          // o sea, esperando, no trabajando. Restando esta linea base, lo que queda es lo que cuesta el
          // delta, que es lo unico que esta comprobacion quiere saber.
          let baseTotal = 0;
          for (let i = 0; i < 10; i += 1) {
            const t = performance.now();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            baseTotal += performance.now() - t;
          }
          const msPorFrameEnVacio = baseTotal / 10;

          const largas = [];
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) largas.push(Math.round(entry.duration));
          });
          observer.observe({ entryTypes: ['longtask'] });
          const inicio = performance.now();
          for (let i = 0; i < deltas; i += 1) {
            dev.store.setState((s) => dev.reduceEvent(s, tabId, { kind: 'stream_delta', text: 'lorem ipsum ' }));
            // Un frame entre delta y delta: sin esto se medirian N setState seguidos SIN pintar, que no
            // es lo que hace el stream ni lo que sufre el usuario.
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          const totalMs = performance.now() - inicio;
          observer.disconnect();
          return {
            bloquesEnElHilo: hilo.length,
            deltas,
            totalMs: Math.round(totalMs),
            msPorFrameEnVacio: Number(msPorFrameEnVacio.toFixed(2)),
            // Nunca negativo: si el ruido deja la resta por debajo de cero, el coste medido es 0, no un
            // numero imposible que luego hay que explicar.
            msPorDelta: Number(Math.max(0, totalMs / deltas - msPorFrameEnVacio).toFixed(2)),
            tareasLargas: largas.length,
            peorTareaMs: largas.length === 0 ? 0 : Math.max(...largas),
          };
        },
        { bloques: HYDRATED_BLOCK_COUNT, deltas: DELTA_BURST_SIZE },
      );
      await page.evaluate((state) => window.__mageDev.store.setState(state), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const ok = medido.msPorDelta <= DELTA_BUDGET_MS && medido.peorTareaMs <= LONG_TASK_BUDGET_MS;
      return {
        ok,
        detail: `${JSON.stringify(medido)} presupuesto=${DELTA_BUDGET_MS} ms/delta y tarea larga <=${LONG_TASK_BUDGET_MS} ms`,
      };
    },
  },
  {
    // 0.2 — Arranque hasta que el workbench monta. Lee la marca que pone App.tsx
    // (WORKBENCH_MOUNTED_MARK) y la resta del inicio de la navegacion. No hace falta instrumentar el
    // harness: el dato ya esta en la linea de tiempo de la pagina desde que arranco.
    // AVISO al leer un rojo aqui: la PRIMERA pasada tras un `pnpm build` o un empaquetado mide la
    // reoptimizacion de dependencias de Vite, no el arranque de Mage. Medido el 2026-09-03: 28.434 ms
    // en frio y 1.258 ms en la pasada siguiente, sin tocar una linea. Si esta falla sola, re-ejecuta
    // antes de investigar nada — y por eso el presupuesto es de 6 s y no de 2.
    name: '0.2: el workbench monta dentro del presupuesto de arranque',
    async run(page) {
      const medido = await page.evaluate((markName) => {
        const marca = performance.getEntriesByName(markName)[0];
        const navegacion = performance.getEntriesByType('navigation')[0];
        if (marca === undefined) return { marca: false };
        return {
          marca: true,
          montadoMs: Math.round(marca.startTime),
          domContentLoadedMs: navegacion === undefined ? null : Math.round(navegacion.domContentLoadedEventEnd),
        };
      }, WORKBENCH_MOUNTED_MARK);
      if (medido.marca !== true) {
        return { ok: false, detail: `no existe la marca ${WORKBENCH_MOUNTED_MARK} (¿App.tsx dejo de ponerla?)` };
      }
      const ok = medido.montadoMs <= BOOT_BUDGET_MS;
      return { ok, detail: `${JSON.stringify(medido)} presupuesto=${BOOT_BUDGET_MS} ms (DEV, no empaquetado)` };
    },
  },
  {
    // 0.3 — Guardar el estado del workspace no puede bloquear el proceso MAIN. Es la medida de P1, y va
    // directa al canal en vez de por la UI: un cambio de pestaña acaba SIEMPRE en `StateSave`
    // (`setActiveTab` -> `schedulePersist` -> `saveWorkspace`), asi que llamarlo mide exactamente el
    // mismo camino sin depender de que haya dos pestañas ni de abrir un dialogo. Antes intentaba lo
    // segundo y se rompia con el residuo de la comprobacion anterior: medir la causa es mas estable
    // que reproducir el sintoma.
    //
    // Se mide con ida y vuelta de IPC y no con frames, y la razon importa: el renderer es OTRO proceso
    // y sigue pintando aunque main este atascado; lo que se congela es todo lo que necesita a main.
    // `loadConversationPrefs` es el handler mas barato y sin efectos que hay.
    //
    // Se reguarda el MISMO estado que ya habia (`loadWorkspace` -> `saveWorkspace`): no cambia nada en
    // disco, y aun asi dispara el `refreshJumpList` que escanea el disco entero.
    name: '0.3: guardar el estado del workspace no bloquea el proceso main',
    async run(page) {
      const medido = await page.evaluate(async (ventanaMs) => {
        const actual = await window.mage.loadWorkspace();
        if (actual === null) return { sinEstado: true };
        const idas = [];
        // El guardado NO se espera: se lanza y se sondea mientras main lo atiende, que es justo lo que
        // hace la app (el store persiste con debounce y sigue a lo suyo).
        void window.mage.saveWorkspace(actual);
        const inicio = Date.now();
        while (Date.now() - inicio < ventanaMs) {
          const t0 = performance.now();
          await window.mage.loadConversationPrefs('verify-gui-sonda');
          idas.push(performance.now() - t0);
        }
        const ordenadas = [...idas].sort((a, b) => a - b);
        return {
          muestras: idas.length,
          peorMs: Math.round(Math.max(...idas)),
          medianaMs: Math.round(ordenadas[Math.floor(ordenadas.length / 2)]),
        };
      }, IPC_PROBE_WINDOW_MS);
      if (medido.sinEstado === true) {
        return { ok: false, detail: 'no hay workspace persistido que reguardar (¿perfil recien creado?)' };
      }
      const ok = medido.peorMs <= IPC_BLOCK_BUDGET_MS;
      return { ok, detail: `${JSON.stringify(medido)} presupuesto=${IPC_BLOCK_BUDGET_MS} ms de ida y vuelta` };
    },
  },
  {
    // La ventana de Mage NO puede tener scroll vertical de PAGINA: es una app de escritorio con
    // paneles que scrollean por dentro, no un documento. Si el `<body>` desborda, la barra de estado y
    // el prompt se van fuera de la vista.
    //
    // El sospechoso es la columna izquierda (`AccountRail`): su contenido crece con el USO —una entrada
    // por cuenta— mientras el alto de la ventana no. El perfil aislado del harness no tiene NINGUNA
    // cuenta, asi que el caso no aparece solo: se fuerza inyectandolas por el puente de desarrollo. Sin
    // esto, la comprobacion pasaria en verde con el bug puesto.
    //
    // Se mide ANTES y DESPUES: si el rail desaparece al inyectar, el fallo es de render (lo comeria el
    // ErrorBoundary) y no de layout — y conviene distinguirlo en vez de leer un `false` a secas.
    name: 'Cascara: con muchas cuentas, el rail se las arregla solo y la pagina no scrollea',
    async run(page) {
      const RAIL = '[aria-label="Paneles del borde izquierdo, zona superior"]';
      const previo = await page.evaluate(() => window.__mageDev.store.getState().accounts);
      const antes = await page.evaluate((sel) => ({
        encontrado: document.querySelector(sel) !== null,
        // Si el ancla falla, decir QUE hay: un `false` a secas manda a buscar el bug donde no esta.
        toolbars: [...document.querySelectorAll('[role="toolbar"]')].map((n) => n.getAttribute('aria-label')),
        pestanas: document.querySelectorAll('[role="tab"]').length,
        dialogos: document.querySelectorAll('[role="dialog"]').length,
        editores: document.querySelectorAll('[data-prompt-editor="true"]').length,
        raizHijos: document.getElementById('root')?.firstElementChild?.className ?? null,
        texto: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 140),
      }), RAIL);

      await page.evaluate(
        ({ total }) => {
          const dev = window.__mageDev;
          if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
          const ventana = { pct: 12, label: '1 h 24 m' };
          const accent = { base: '#8a8a8a', tint: '#bdbdbd', bgActive: '#2a2a2a', borderInactive: '#3a3a3a' };
          dev.store.setState({
            accounts: Array.from({ length: total }, (_, i) => ({
              id: `C:/fake/.claude-${i}`,
              monogram: String.fromCharCode(65 + (i % 26)),
              alias: `cuenta-${i}`,
              provider: 'Claude',
              defaultModel: 'sonnet',
              accent,
              activity: 'idle',
              usage: { fiveHour: ventana, weekly: ventana },
              email: null,
              loginStatus: 'logged_in',
              isMain: i === 0,
            })),
          });
        },
        { total: RAIL_STRESS_ACCOUNTS },
      );
      await page.waitForTimeout(CONFIG.settleMs);

      const medido = await page.evaluate((sel) => {
        const raiz = document.documentElement;
        const toolbar = document.querySelector(sel);
        const rail = toolbar === null ? null : toolbar.parentElement;
        return {
          ventana: window.innerHeight,
          desbordaPagina: raiz.scrollHeight > raiz.clientHeight,
          bodyDesborda: document.body.scrollHeight > document.body.clientHeight,
          avatares: document.querySelectorAll('[data-tip^="cuenta-"]').length,
          rail:
            rail === null
              ? { existe: false }
              : {
                  existe: true,
                  alto: Math.round(rail.getBoundingClientRect().height),
                  contenido: rail.scrollHeight,
                  desbordaSuCaja: rail.scrollHeight > rail.clientHeight + 1,
                },
        };
      }, RAIL);

      await page.evaluate((accounts) => window.__mageDev.store.setState({ accounts }), previo);
      await page.waitForTimeout(CONFIG.settleMs);

      const ok =
        antes.encontrado &&
        medido.rail.existe === true &&
        !medido.desbordaPagina &&
        !medido.bodyDesborda &&
        medido.rail.alto <= medido.ventana &&
        !medido.rail.desbordaSuCaja;
      return { ok, detail: `railAntes=${JSON.stringify(antes)} ${JSON.stringify(medido)}` };
    },
  },
  {
    // H4 — Al agotarse el uso, el chat tiene que OFRECER continuar en otra cuenta, no solo contar que
    // se acabo. Se dispara por el reducer REAL (`__mageDev.reduceEvent`) con el mismo evento que manda
    // el CLI, y se comprueba las dos mitades: que aparece con un boton por cuenta destino con login, y
    // que se va al limpiar la marca. Lo segundo importa tanto como lo primero: un banner que se queda
    // pegado ofrece mudarse de cuenta por un limite que ya caduco.
    //
    // NO se pulsa el boton: mover la conversacion toca el disco de las cuentas reales del usuario.
    name: 'Chat: al agotarse el uso se ofrece continuar en otra cuenta',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, blocksByChat: s.blocksByChat, accounts: s.accounts, rateLimitByChat: s.rateLimitByChat };
      });
      await openTemporaryConversation(page);

      const medido = await page.evaluate(async (resumen) => {
        const dev = window.__mageDev;
        if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
        const tabId = dev.store.getState().activeTabId;
        const cuentaDelChat = dev.store.getState().tabs.find((t) => t.id === tabId)?.accountId ?? '';
        const accent = { base: '#8a8a8a', tint: '#bdbdbd', bgActive: '#2a2a2a', borderInactive: '#3a3a3a' };
        const ventana = { pct: 12, label: '1 h 24 m' };
        const cuenta = (id, alias, loginStatus) => ({
          id, alias, monogram: alias[0].toUpperCase(), provider: 'Claude', defaultModel: 'sonnet', accent,
          activity: 'idle', usage: { fiveHour: ventana, weekly: ventana }, email: null, loginStatus, isMain: false,
        });
        // Tres cuentas a proposito: la del chat (no es destino de si misma) y dos mas, una de ellas SIN
        // login — que tampoco puede ser destino. Con una sola cuenta destino el filtro pasaria por
        // casualidad.
        dev.store.setState({
          accounts: [cuenta(cuentaDelChat, 'la-del-chat', 'logged_in'), cuenta('C:/fake/.claude-alt', 'suplente', 'logged_in'), cuenta('C:/fake/.claude-off', 'desconectada', 'logged_out')],
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const antes = document.querySelectorAll('[role="status"]').length;

        // P-028, 20: el CLI manda DOS avisos del mismo limite (el rechazado con hora y el `assistant` con
        // texto). Tienen que quedar en UNA linea, en castellano, con el texto del CLI en el tooltip.
        const LINEA = 'Límite de uso alcanzado';
        dev.store.setState((s) => dev.reduceEvent(s, tabId, { kind: 'rate_limit', summary: '', resetsAtMs: Date.now() + 60 * 60 * 1000 }));
        dev.store.setState((s) => dev.reduceEvent(s, tabId, { kind: 'rate_limit', summary: resumen, resetsAtMs: null }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const banner = [...document.querySelectorAll('[role="status"]')].find((n) => (n.textContent ?? '').includes(LINEA)) ?? null;
        const lineas = (dev.store.getState().blocksByChat[tabId] ?? []).filter((b) => b.kind === 'system' && b.text.startsWith(LINEA));
        const conBanner = {
          existe: banner !== null,
          // La linea del hilo TAMBIEN tiene que estar: el banner es la accion, no el relato.
          lineasEnElHilo: lineas.length,
          conHora: /se restablece a las/.test(lineas[0]?.text ?? ''),
          tooltipCli: document.querySelector(`[data-tip="${CSS.escape(resumen)}"]`) !== null,
          casillaContinuar: banner?.querySelector('input[type="checkbox"]') !== null && banner !== null,
          destinos: banner === null ? [] : [...banner.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()),
        };

        dev.store.setState((s) => ({ rateLimitByChat: Object.fromEntries(Object.entries(s.rateLimitByChat).filter(([k]) => k !== tabId)) }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const trasLimpiar = [...document.querySelectorAll('[role="status"]')].filter((n) => (n.textContent ?? '').includes(LINEA)).length;
        return { statusAntes: antes, ...conBanner, trasLimpiar };
      }, RATE_LIMIT_SUMMARY);

      await page.evaluate((state) => window.__mageDev.store.setState(state), previo);
      await page.waitForTimeout(CONFIG.settleMs);

      const ok =
        medido.existe &&
        medido.lineasEnElHilo === 1 &&
        medido.conHora &&
        medido.tooltipCli &&
        medido.casillaContinuar &&
        medido.destinos.length === 1 &&
        medido.destinos[0] === 'suplente' &&
        medido.trasLimpiar === 0;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Tres reportes del usuario sobre las barras de iconos, medidos juntos porque comparten estado:
    //  - "la de la izquierda es mas gorda, iguala el ancho a la de la derecha";
    //  - "se pueden duplicar iconos de herramientas, solo puede haber uno";
    //  - "al arrastrar un icono, si no hay ya uno en esa zona, no aparece la zona donde soltarlo".
    name: 'Barras: mismo ancho, sin iconos repetidos y con hueco visible al arrastrar',
    async run(page) {
      const previo = await page.evaluate(() => JSON.parse(JSON.stringify(window.__mageDev.panelStore.getState().layout)));

      const anchos = await page.evaluate(() => {
        const izq = document.querySelector('[aria-label="Paneles del borde izquierdo, zona superior"]')?.closest('div[class*="border-r"]') ?? null;
        const der = document.querySelector('[role="toolbar"][aria-label="Paneles del borde derecho"]') ?? null;
        return {
          izquierda: izq === null ? null : Math.round(izq.getBoundingClientRect().width),
          derecha: der === null ? null : Math.round(der.getBoundingClientRect().width),
        };
      });

      // Unicidad: el MISMO id no puede tener dos botones en toda la ventana. Se mide sobre el DOM y no
      // sobre el layout a proposito — el bug estaba en la reconciliacion, que es justo lo que produce
      // ese DOM, y una comprobacion sobre el estado ya reconciliado no lo habria visto.
      const repetidos = await page.evaluate(() => {
        const cuenta = new Map();
        for (const b of document.querySelectorAll('[data-stripe-btn="true"]')) {
          const etiqueta = b.getAttribute('aria-label') ?? '';
          if (etiqueta.startsWith('Añadir')) continue; // el "⋮" de cada borde, que no es un panel
          cuenta.set(etiqueta, (cuenta.get(etiqueta) ?? 0) + 1);
        }
        return [...cuenta.entries()].filter(([, n]) => n > 1).map(([etiqueta, n]) => `${etiqueta} x${n}`);
      });

      // El hueco de suelta: se dispara un `dragstart` REAL sobre el primer icono y se cuenta cuantas
      // zonas reservan sitio. Tienen que ser TODAS las que no lo contienen ya — incluidas las vacias,
      // que era el reporte: existian como area de suelta pero no habia nada que mirar.
      const arrastre = await page.evaluate(() => {
        const boton = document.querySelector('[data-stripe-btn="true"]');
        if (boton === null) return null;
        const antes = document.querySelectorAll('[data-drop-ghost="true"]').length;
        const dt = new DataTransfer();
        boton.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        return { antes, etiqueta: boton.getAttribute('aria-label') };
      });
      await page.waitForTimeout(CONFIG.settleMs);
      const durante = await page.evaluate(() => ({
        huecos: document.querySelectorAll('[data-drop-ghost="true"]').length,
        // Y el hueco tiene que MEDIR: uno de 0x0 no se ve, que es como estaba la zona vacia.
        alto: Math.min(...[...document.querySelectorAll('[data-drop-ghost="true"]')].map((n) => Math.round(n.getBoundingClientRect().height)), Infinity),
      }));
      await page.evaluate(() => {
        const boton = document.querySelector('[data-stripe-btn="true"]');
        boton?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: new DataTransfer() }));
      });
      await page.waitForTimeout(CONFIG.settleMs);
      const despues = await page.evaluate(() => document.querySelectorAll('[data-drop-ghost="true"]').length);

      await page.evaluate((layout) => window.__mageDev.panelStore.setState({ layout }), previo);
      await page.waitForTimeout(CONFIG.settleMs);

      const medido = { anchos, repetidos, arrastre, durante, despues };
      const ok =
        anchos.izquierda !== null &&
        anchos.derecha !== null &&
        // El mismo ancho: 1 px de margen por el borde de cada lado.
        Math.abs(anchos.izquierda - anchos.derecha) <= 1 &&
        repetidos.length === 0 &&
        arrastre !== null &&
        arrastre.antes === 0 &&
        // Al menos las cuatro zonas que no lo contienen (dos por borde) reservan su hueco.
        durante.huecos >= 4 &&
        durante.alto >= 20 &&
        // Y al terminar el arrastre no queda ninguno: si no, la barra se queda descuadrada.
        despues === 0;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Reporte del usuario, con dos capturas: "al hacer clic sobre un log de la lista, este se expande
    // mal". Se expandia DENTRO de la fila, y las filas de react-window son hermanas absolutas de altura
    // fija: el detalle acababa entremezclado con el texto de las filas siguientes en vez de taparlas.
    // Ahora la fila SELECCIONA y el detalle vive en su propia seccion bajo la lista.
    name: 'Logs: el detalle de una linea se pinta fuera de la lista, no dentro de su fila',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        const t = window.__mageDev.transcriptStore.getState();
        return {
          store: { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat },
          transcript: { entries: t.entries, isFinal: t.isFinal, errorMessage: t.errorMessage, totalLinesSoFar: t.totalLinesSoFar },
          layout: JSON.parse(JSON.stringify(window.__mageDev.panelStore.getState().layout)),
        };
      });
      await openTemporaryConversation(page);
      await page.evaluate(() => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        dev.store.setState((s) => ({
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, resumeSessionId: 's-logs' } : t)),
          sessionIdByChat: Object.fromEntries(Object.entries(s.sessionIdByChat).filter(([k]) => k !== tabId)),
        }));
      });
      await page.waitForTimeout(CONFIG.settleMs * 4);
      await page.evaluate(() => {
        // Doce lineas: suficientes para que haya filas DEBAJO de la que se despliega, que es donde se
        // veia el estropicio.
        window.__mageDev.transcriptStore.setState({
          isFinal: true,
          errorMessage: null,
          totalLinesSoFar: 12,
          entries: Array.from({ length: 12 }, (_, i) => ({
            index: i,
            uuid: `u${i}`,
            parentUuid: null,
            isSidechain: false,
            isMeta: false,
            timestampMs: Date.now(),
            category: 'metadata',
            kind: i === 0 ? 'last-prompt' : 'attachment',
            summary: `linea ${i}`,
            tokenUsage: null,
            raw: { type: 'last-prompt', sessionId: 'c5834770-ea19-4524-a91e-f8f112c5b395', relleno: 'x'.repeat(400) },
          })),
        });
      });
      await page.waitForTimeout(CONFIG.settleMs * 2);

      const boton = page.getByRole('button', { name: 'Logs', exact: true }).first();
      const hayPanel = await boton.isVisible().catch(() => false);
      let medido = null;
      if (hayPanel) {
        await boton.click();
        await page.waitForTimeout(CONFIG.settleMs);
        await page.locator('[data-active-panel="logs"] button[aria-pressed]').first().click();
        await page.waitForTimeout(CONFIG.settleMs);
        medido = await page.evaluate(() => {
          const pane = document.querySelector('[data-active-panel="logs"]');
          const detalle = pane?.querySelector('pre') ?? null;
          const fila = pane?.querySelector('button[aria-pressed="true"]')?.closest('div') ?? null;
          const filas = [...(pane?.querySelectorAll('button[aria-pressed]') ?? [])];
          const rect = detalle?.getBoundingClientRect() ?? null;
          return {
            hayDetalle: detalle !== null,
            seleccionadas: filas.filter((b) => b.getAttribute('aria-pressed') === 'true').length,
            // La clave del arreglo: el detalle NO cuelga de la fila.
            dentroDeLaFila: fila !== null && detalle !== null ? fila.contains(detalle) : null,
            // Y no se solapa con ninguna fila de la lista.
            solapaFilas:
              rect === null
                ? null
                : filas.filter((b) => {
                    const r = b.getBoundingClientRect();
                    return r.height > 0 && r.bottom > rect.top + 1 && r.top < rect.bottom - 1;
                  }).length,
          };
        });
        await boton.click();
      }

      await page.evaluate((p) => {
        window.__mageDev.store.setState(p.store);
        window.__mageDev.transcriptStore.setState(p.transcript);
        window.__mageDev.panelStore.setState({ layout: p.layout });
      }, previo);
      await page.waitForTimeout(CONFIG.settleMs);

      const ok =
        medido !== null &&
        medido.hayDetalle &&
        medido.seleccionadas === 1 &&
        medido.dentroDeLaFila === false &&
        medido.solapaFilas === 0;
      return { ok, detail: JSON.stringify({ hayPanel, ...medido }) };
    },
  },
  {
    // Peticion del usuario: etiquetas de informacion del chat encima del input, con el DIRECTORIO
    // clicable "para ver los archivos que genera o acceder al scratchpad".
    //
    // Se comprueba lo que hace que sirvan: que estan ENCIMA del input (no dentro, donde competirian con
    // los controles del mensaje), que la carpeta es la unica pulsable, y que su etiqueta dice algo
    // — una conversacion sin friccion vive en un subdirectorio con nombre de UUID, y ahi el ultimo
    // segmento no informa de nada.
    //
    // NO se pulsa la carpeta: abriria el explorador de ficheros del sistema.
    name: 'Chat: las etiquetas de informacion van encima del input y la carpeta es accionable',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, scratchDir: s.scratchDir };
      });
      await openTemporaryConversation(page);

      const medido = await page.evaluate(() => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        const cwd = dev.store.getState().tabs.find((t) => t.id === tabId)?.cwd ?? '';
        const editor = document.querySelector('[data-prompt-editor="true"]');
        const carpeta = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('abrir la carpeta')) ?? null;
        const fila = carpeta?.parentElement ?? null;
        const etiquetas = fila === null ? [] : [...fila.children].map((n) => ({
          texto: (n.textContent ?? '').trim(),
          pulsable: n.tagName.toLowerCase() === 'button',
          titulo: n.getAttribute('aria-label'),
        }));
        return {
          cwd,
          hayFila: fila !== null,
          // Encima del input de verdad, medido en pixeles y no por el orden del DOM.
          encimaDelInput: fila !== null && editor !== null ? fila.getBoundingClientRect().bottom <= editor.getBoundingClientRect().top + 1 : null,
          etiquetas,
          pulsables: etiquetas.filter((e) => e.pulsable).length,
          // La fila no puede ensanchar el panel: las rutas largas son la norma.
          desborda: fila === null ? null : fila.scrollWidth > fila.clientWidth + 1,
        };
      });

      // Una conversacion sin friccion vive DENTRO del scratchpad, asi que la etiqueta tiene que acabar
      // diciendo "Scratchpad" y no el UUID de su subcarpeta — que es justo el caso en que el ultimo
      // segmento no informa de nada. Se SONDEA en vez de medir una sola vez: la carpeta de borradores
      // se resuelve por IPC y llega despues del primer pintado.
      let etiquetaScratch = null;
      for (let i = 0; i < 25; i += 1) {
        etiquetaScratch = await page.evaluate(
          () => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('abrir la carpeta'))?.textContent?.trim() ?? null,
        );
        if ((etiquetaScratch ?? '').includes('Scratchpad')) break;
        await page.waitForTimeout(80);
      }
      const scratchResuelto = await page.evaluate(() => window.__mageDev.store.getState().scratchDir);

      await page.evaluate((p) => window.__mageDev.store.setState(p), previo);
      await page.waitForTimeout(CONFIG.settleMs);

      const todo = { ...medido, scratchResuelto, etiquetaScratch };
      const ok =
        todo.hayFila &&
        todo.encimaDelInput === true &&
        // Carpeta + privacidad. El modelo ya NO va aqui (P-026 2.2, D18): solo en el selector del input.
        todo.etiquetas.length === 2 &&
        // Solo la carpeta hace algo: un boton que no lleva a ningun sitio es una promesa rota.
        todo.pulsables === 1 &&
        todo.desborda === false &&
        // El tooltip de la carpeta lleva la ruta ENTERA, que es lo que la etiqueta corta no puede.
        (todo.etiquetas[0]?.titulo ?? '').includes(todo.cwd) &&
        // `textContent` trae tambien el icono, asi que se compara por contenido y no por igualdad.
        (todo.etiquetaScratch ?? '').includes('Scratchpad');
      return { ok, detail: JSON.stringify(todo) };
    },
  },
  {
    // P-026 3.5 (D25–D28): git en la fila del chat. El SCRIPT (no la app) monta un repo temporal con un
    // commit, una segunda rama, un fichero cambiado y otro sin seguir; la pestaña apunta ahi. La carpeta
    // no es de confianza en el perfil aislado, asi que primero tiene que salir el dialogo de siempre
    // (D28) y solo al confiar aparecen los chips. Nunca se envia nada y nunca se cambia de rama de verdad.
    name: '3.5: git: la rama y +N −M salen al confiar, el cambio de rama se bloquea sucio y «Pedir commit al agente» no envía',
    async run(page) {
      const repo = createTempGitRepo();
      if (repo === null) return { ok: true, detail: 'saltada: no hay git en esta maquina' };
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, draftByChat: s.draftByChat, gitByCwd: s.gitByCwd };
      });
      try {
        await openTemporaryConversation(page);
        await page.evaluate((cwd) => {
          const dev = window.__mageDev;
          const tabId = dev.store.getState().activeTabId;
          dev.store.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, cwd } : t)) }));
        }, repo);
        const dialogo = page.getByRole('button', { name: 'Confiar en esta carpeta' });
        await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const chipsAntesDeConfiar = await page.locator('[data-git-diff]').count();
        await dialogo.click();
        await page.locator('[data-git-diff]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const sucio = await page.evaluate(() => {
          const rama = document.querySelector('[aria-label^="Cambiar de rama"]');
          return {
            rama: rama?.textContent?.trim() ?? null,
            bloqueada: rama?.getAttribute('aria-disabled') === 'true',
            motivo: rama?.getAttribute('aria-label') ?? '',
            cambios: document.querySelector('[data-git-diff]')?.textContent?.trim() ?? null,
            boton: document.querySelectorAll('[data-git-commit]').length,
          };
        });
        await page.locator('[data-git-commit]').first().click();
        await page.waitForTimeout(CONFIG.settleMs);
        const trasConfirmar = await page.evaluate(() => {
          const s = window.__mageDev.store.getState();
          return {
            borrador: s.draftByChat[s.activeTabId]?.text ?? '',
            enElEditor: document.querySelector('[data-prompt-editor="true"] .cm-content')?.textContent ?? '',
            estado: s.statusByChat[s.activeTabId] ?? 'idle',
            mensajes: (s.blocksByChat[s.activeTabId] ?? []).filter((b) => b.kind === 'user').length,
          };
        });
        // Arbol limpio: el cambio de rama se habilita y lista las dos ramas (sin elegir ninguna).
        cleanTempGitRepo(repo);
        await page.waitForTimeout(GIT_STATUS_FRESH_MS);
        await page.evaluate(() => window.__mageDev.store.getState().refreshGit(window.__mageDev.store.getState().activeTabId));
        await page.locator('button[aria-label="Cambiar de rama"]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        await page.locator('button[aria-label="Cambiar de rama"]').first().click();
        const ramas = await page.evaluate(() => [...document.querySelectorAll('[role="listbox"][aria-label="Cambiar de rama"] [role="option"]')].map((n) => n.textContent?.trim() ?? ''));
        await page.keyboard.press('Escape');
        const ok =
          chipsAntesDeConfiar === 0 &&
          (sucio.rama ?? '').includes('main') &&
          sucio.bloqueada &&
          sucio.motivo.includes('sin confirmar') &&
          sucio.cambios === '+2−0' &&
          sucio.boton === 1 &&
          trasConfirmar.borrador.startsWith('Haz commit de los cambios pendientes') &&
          trasConfirmar.enElEditor.includes('Haz commit') &&
          trasConfirmar.estado === 'idle' &&
          trasConfirmar.mensajes === 0 &&
          ramas.join(',') === 'main,otra';
        return { ok, detail: `antes=${chipsAntesDeConfiar} sucio=${JSON.stringify(sucio)} confirmar=${JSON.stringify({ ...trasConfirmar, enElEditor: trasConfirmar.enElEditor.slice(0, 30) })} ramas=${JSON.stringify(ramas)}` };
      } finally {
        await page.evaluate((cwd) => window.__mageDev.store.getState().revokeTrustedFolder(cwd), repo);
        await page.evaluate((state) => window.__mageDev.store.setState(state), previo);
        await page.waitForTimeout(CONFIG.settleMs);
        fs.rmSync(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Grupo D (PR como Claude Desktop): con MAGE_GH_FAKE=1 main contesta con un `gh` FALSO en proceso
    // (src/main/gh/ghFakeRunner.ts), nunca el real. El repo temporal tiene un remoto de github.com y esta
    // en `main`, que en el falso no tiene PR: sale «Crear PR», que deja el prompt SIN enviar. Despues un
    // `gh pr create` falso con la URL en su resultado vincula el PR #7 a la pestaña, la ✕ lo quita, y en
    // una rama sin sesion de gh sale el aviso, que se descarta para siempre.
    name: 'Grupo D: «Crear PR» no envía, la URL de gh pr create vincula el PR y el aviso de gh se descarta',
    async run(page) {
      const repo = createTempGhRepo('main');
      if (repo === null) return { ok: true, detail: 'saltada: no hay git en esta maquina' };
      const previo = await capturePrState(page);
      try {
        await pointActiveTabAtTrustedRepo(page, repo);
        await page.locator('[data-pr-create]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        await page.locator('[data-pr-create]').first().click();
        await page.waitForTimeout(CONFIG.settleMs);
        const trasCrear = await page.evaluate(() => {
          const s = window.__mageDev.store.getState();
          return {
            borrador: s.draftByChat[s.activeTabId]?.text ?? '',
            estado: s.statusByChat[s.activeTabId] ?? 'idle',
            mensajes: (s.blocksByChat[s.activeTabId] ?? []).filter((b) => b.kind === 'user').length,
          };
        });
        // El `gh pr create` del agente, por el reducer real: tool_use + tool_result con la URL.
        await page.evaluate(() => {
          const dev = window.__mageDev;
          const tabId = dev.store.getState().activeTabId;
          dev.store.setState((s) => ({ sessionIdByChat: { ...s.sessionIdByChat, [tabId]: 'vg-pr-sesion' } }));
          const st = dev.store.getState();
          st.handleEvent('vg-pr-sesion', { kind: 'tool_use', tool: { toolUseId: 'vg-pr-u1', toolName: 'Bash', input: { command: 'git push -u origin HEAD && gh pr create --fill' } } });
          st.handleEvent('vg-pr-sesion', { kind: 'tool_result', result: { toolUseId: 'vg-pr-u1', isError: false, output: 'https://github.com/acme/demo/pull/7\n', durationMs: 5 } });
        });
        await page.locator('[data-pr-chip]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const vinculado = await page.evaluate(() => {
          const s = window.__mageDev.store.getState();
          return { prNumber: s.tabs.find((t) => t.id === s.activeTabId)?.prNumber ?? null, chip: document.querySelector('[data-pr-chip]')?.textContent?.trim() ?? '' };
        });
        await page.getByRole('button', { name: 'Dejar de seguir el PR #7', exact: true }).click();
        await page.locator('[data-pr-chip]').first().waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
        const quitado = await page.evaluate(() => {
          const s = window.__mageDev.store.getState();
          const t = s.tabs.find((x) => x.id === s.activeTabId);
          return { prNumber: t?.prNumber ?? null, prDismissed: t?.prDismissed ?? null };
        });
        // Rama sin sesion de gh en el falso (salida 4): aviso «inicia sesión», y su ✕ lo descarta para siempre.
        runGit(repo, ['switch', '-c', 'vg-sin-sesion']);
        await page.waitForTimeout(GIT_STATUS_FRESH_MS);
        await page.evaluate(async () => {
          const st = window.__mageDev.store.getState();
          await st.refreshGit(st.activeTabId);
          await st.refreshPr(st.activeTabId);
        });
        await page.locator('[data-gh-notice]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const aviso = await page.locator('[data-gh-notice]').first().textContent();
        await page.getByRole('button', { name: 'No volver a avisar de gh', exact: true }).click();
        await page.locator('[data-gh-notice]').first().waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
        const descartado = await page.evaluate(() => window.__mageDev.store.getState().settings.ghNoticeDismissed);
        const ok =
          trasCrear.borrador.includes('gh pr create') &&
          trasCrear.estado === 'idle' &&
          trasCrear.mensajes === 0 &&
          vinculado.prNumber === 7 &&
          vinculado.chip.includes('#7') &&
          quitado.prNumber === null &&
          quitado.prDismissed === 7 &&
          (aviso ?? '').includes('inicia sesión en gh') &&
          descartado === true;
        return { ok, detail: `crear=${JSON.stringify({ ...trasCrear, borrador: trasCrear.borrador.slice(0, 40) })} vinculado=${JSON.stringify(vinculado)} quitado=${JSON.stringify(quitado)} aviso=${JSON.stringify(aviso)} descartado=${descartado}` };
      } finally {
        await restorePrState(page, previo, repo);
      }
    },
  },
  {
    // Grupo D: en una rama con PR abierto (el #7 del `gh` falso: borrador, un check roto y otro en
    // marcha) la pestaña lo vincula sola, la barra enseña sus cuentas, y relanzar, cancelar y el
    // auto-merge piden confirmacion antes de llegar al runner falso (que cambia de estado al recibirlos).
    name: 'Grupo D: la barra del PR enseña sus checks y relanzar, cancelar y el auto-merge piden confirmación',
    async run(page) {
      const repo = createTempGhRepo('vg-pr');
      if (repo === null) return { ok: true, detail: 'saltada: no hay git en esta maquina' };
      const previo = await capturePrState(page);
      const runsText = () => page.evaluate(() => [...document.querySelectorAll('[data-pr-runs] li')].map((li) => li.textContent?.trim() ?? ''));
      try {
        await pointActiveTabAtTrustedRepo(page, repo);
        await page.locator('[data-pr-chip]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const chip = (await page.locator('[data-pr-chip]').first().textContent())?.trim() ?? '';
        await page.locator('[data-pr-chip]').first().click();
        await page.locator('[data-pr-runs]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const runsAntes = await runsText();
        const fallan = await page.locator('[data-pr-failing] li').allTextContents();
        await page.locator('[data-pr-runs]').getByRole('button', { name: 'Relanzar', exact: true }).click();
        await page.locator('[data-pr-confirm]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const sinConfirmar = await runsText();
        await page.locator('[data-pr-confirm]').getByRole('button', { name: 'Confirmar', exact: true }).click();
        await waitForRunText(page, 'checken marcha');
        await page.locator('[data-pr-runs] li', { hasText: /^lint/ }).getByRole('button', { name: 'Cancelar run', exact: true }).click();
        await page.locator('[data-pr-confirm]').getByRole('button', { name: 'Confirmar', exact: true }).click();
        await waitForRunText(page, 'lintcancelado');
        const autoMerge = page.locator('[data-pr-details]').getByRole('checkbox', { name: 'Auto-merge', exact: true });
        await autoMerge.click();
        await page.locator('[data-pr-confirm]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const marcadoSinConfirmar = await autoMerge.isChecked();
        await page.locator('[data-pr-confirm]').getByRole('button', { name: 'Confirmar', exact: true }).click();
        await page.locator('[data-pr-details]').getByText('Auto-merge activo', { exact: true }).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        // Se deja el falso como estaba: auto-merge apagado otra vez (tambien con confirmacion).
        await autoMerge.click();
        await page.locator('[data-pr-confirm]').getByRole('button', { name: 'Confirmar', exact: true }).click();
        await page.locator('[data-pr-details]').getByText('Auto-merge activo', { exact: true }).waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
        const ok =
          chip.includes('#7 · Borrador') &&
          chip.includes('✗1') &&
          chip.includes('●1') &&
          fallan.some((t) => t.includes('check')) &&
          runsAntes.some((t) => t.startsWith('checkfalla')) &&
          sinConfirmar.some((t) => t.startsWith('checkfalla')) &&
          marcadoSinConfirmar === false;
        return { ok, detail: `chip=${JSON.stringify(chip)} fallan=${JSON.stringify(fallan)} runs=${JSON.stringify(runsAntes)} sinConfirmar=${JSON.stringify(sinConfirmar)} autoMergeSinConfirmar=${marcadoSinConfirmar}` };
      } finally {
        await restorePrState(page, previo, repo);
      }
    },
  },
  {
    // Grupo D, bloque 3 (worktrees como Claude Desktop), con el git REAL en un repo temporal y sin enviar
    // nada: en una conversacion nueva en la raiz del repo la casilla «Worktree» sale marcada; el worktree
    // se crea por el mismo IPC que usa el arranque de la sesion; dentro, la fila enseña el chip y bloquea
    // el cambio de rama; y archivar (cerrar la pestaña) lo borra limpio y lo conserva con cambios.
    name: 'Grupo D: worktree: casilla marcada, chip y rama bloqueada dentro, y archivar borra el limpio y conserva el sucio',
    async run(page) {
      const repo = createTempGhRepo('main');
      if (repo === null) return { ok: true, detail: 'saltada: no hay git en esta maquina' };
      const previo = await capturePrState(page);
      try {
        await pointActiveTabAtTrustedRepo(page, repo);
        await page.locator('[data-worktree-toggle]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const casilla = await page.locator('[data-worktree-toggle] input').first().isChecked();
        const crear = (mensaje) =>
          page.evaluate(async ({ cwd, mensaje }) => {
            const st = window.__mageDev.store.getState();
            const tab = st.tabs.find((t) => t.id === st.activeTabId);
            return window.mage.worktreeCreate({ cwd, accountDir: tab.accountId, base: 'main', firstMessage: mensaje });
          }, { cwd: repo, mensaje });
        const limpio = await crear('Arreglar el login');
        // La pestaña pasa a vivir en el worktree, como tras el arranque de su sesion.
        await page.evaluate((cwd) => {
          const dev = window.__mageDev;
          const tabId = dev.store.getState().activeTabId;
          dev.store.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, cwd } : t)) }));
        }, limpio.path);
        await page.locator('[data-worktree-chip]').first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const rama = await page.evaluate(() => {
          const el = document.querySelector('[aria-label^="Cambiar de rama"]');
          return { texto: el?.textContent?.trim() ?? '', bloqueada: el?.getAttribute('aria-disabled') === 'true', motivo: el?.getAttribute('aria-label') ?? '' };
        });
        const sucio = await crear('Arreglar el login');
        fs.writeFileSync(path.join(sucio.path, 'a.txt'), 'cambiado\n');
        const archivar = (cwd) =>
          page.evaluate(async (cwd) => {
            const st = window.__mageDev.store.getState();
            return window.mage.worktreeRemove({ cwd, accountDir: st.tabs.find((t) => t.id === st.activeTabId).accountId });
          }, cwd);
        const archivadoSucio = await archivar(sucio.path);
        const archivadoLimpio = await archivar(limpio.path);
        const ramas = spawnSync('git', ['branch', '--list', 'claude/*'], { cwd: repo, encoding: 'utf8', windowsHide: true }).stdout.trim();
        const ok =
          casilla &&
          limpio.branch === 'claude/arreglar-el-login' &&
          sucio.branch === 'claude/arreglar-el-login-2' &&
          rama.texto.includes('claude/arreglar-el-login') &&
          rama.bloqueada &&
          rama.motivo.includes('worktree') &&
          archivadoSucio.removed === false &&
          fs.existsSync(sucio.path) &&
          archivadoLimpio.removed === true &&
          !fs.existsSync(limpio.path) &&
          ramas.includes('claude/arreglar-el-login');
        return { ok, detail: `casilla=${casilla} limpio=${limpio.branch} sucio=${sucio.branch} rama=${JSON.stringify(rama)} archivar=${JSON.stringify({ sucio: archivadoSucio, limpio: archivadoLimpio })} ramas=${JSON.stringify(ramas)}` };
      } finally {
        await restorePrState(page, previo, repo);
      }
    },
  },
  {
    // Peticion del usuario: "tests para generar todos los tipos de artifacts que puede generar Claude y
    // probar como se ven y como se interactua con ellos". Las FORMAS se cubren en los tests puros
    // (artifactView.test.ts); aqui se comprueba lo que aquellos no pueden: que la tarjeta las PINTA
    // bien y que sus controles responden.
    //
    // Se inyecta una galeria con las siete formas de golpe, en el hilo y en el panel nuevo. NO se pulsa
    // "Abrir": abriria una ventana de verdad contra claude.ai con la sesion de una cuenta real. Si se
    // pulsa lo que no sale de la app: "Copiar enlace" y el desplegable de elegir cuenta.
    name: 'Artifacts: la tarjeta cubre todas las formas y sus controles responden',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return {
          store: { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, blocksByChat: s.blocksByChat },
          layout: JSON.parse(JSON.stringify(window.__mageDev.panelStore.getState().layout)),
        };
      });
      await openTemporaryConversation(page);

      const formas = await page.evaluate(() => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        const url = (n) => `https://claude.ai/code/artifact/${String(n).repeat(8)}-1111-2222-3333-444444444444`;
        // Las siete formas que de verdad cambian lo que se ve. Los bloques se construyen aqui a mano (no
        // por el reducer) porque lo que se mide es el RENDER, y asi cada forma queda a la vista.
        const casos = [
          { k: 'completo', title: 'Informe de packaging', description: 'Analisis previo del empaquetado.', favicon: '📦', localPath: 'C:/tmp/informe.html' },
          { k: 'markdown', title: 'Notas de la reunion', description: 'Resumen en Markdown.', favicon: '📝', localPath: 'C:/tmp/notas.md' },
          { k: 'sinDescripcion', title: 'Solo titulo', description: '', favicon: '📄', localPath: 'C:/tmp/solo.html' },
          { k: 'sinFavicon', title: 'Sin icono', description: 'Debe caer al icono por defecto.', favicon: '', localPath: 'C:/tmp/sinicono.html' },
          { k: 'dosEmoji', title: 'Dos emoji', description: 'El favicon admite dos.', favicon: '⚡🔥', localPath: 'C:/tmp/dos.html' },
          { k: 'tituloLargo', title: 'Un titulo larguisimo que no cabe de ninguna manera en el ancho de la tarjeta y tiene que recortarse sin ensancharla', description: 'd'.repeat(300), favicon: '📚', localPath: 'C:/tmp/largo.html' },
          { k: 'sinFicheroLocal', title: 'Sin fichero local', description: 'No debe ofrecer abrir el fichero.', favicon: '🌐', localPath: '' },
        ];
        const blocks = casos.map((c, i) => ({
          kind: 'tool',
          id: `art-${i}`,
          toolUseId: `tu-${i}`,
          tool: 'Artifact',
          command: c.localPath,
          meta: 'ok · 120 ms',
          output: [{ code: false, text: `Published at ${url(i)}` }],
          filePath: null,
          error: false,
          artifact: { url: url(i), title: c.title, description: c.description, favicon: c.favicon, localPath: c.localPath },
        }));
        dev.store.setState((s) => ({ blocksByChat: { ...s.blocksByChat, [tabId]: blocks } }));
        return casos.map((c) => c.k);
      });
      await page.waitForTimeout(CONFIG.settleMs * 2);

      // 1) En el HILO: una tarjeta por forma, con su icono, y ninguna ensanchada por su contenido.
      const enElHilo = await page.evaluate(() => {
        const abrir = [...document.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') ?? '').startsWith('Abrir'));
        const tarjetas = abrir.map((b) => b.closest('div.flex.min-w-0')).filter((n) => n !== null);
        return {
          tarjetas: tarjetas.length,
          // El icono por defecto cuando no viene favicon: sin el, la tarjeta se queda sin nada a la
          // izquierda y su titulo baila respecto a las demas.
          // El hueco del icono: o el favicon que trae el artifact (texto), o el icono por defecto de
          // Mage (SVG, sin texto). Se devuelve '<icono>' para el segundo caso para poder distinguir
          // "cayo al icono por defecto" de "se quedo en blanco", que es lo que esta comprobacion vigila.
          iconos: tarjetas.map((n) => {
            const hueco = n.querySelector('[data-artifact-favicon]');
            const texto = (hueco?.textContent ?? '').trim();
            return texto.length > 0 ? texto : hueco?.querySelector('svg') !== null && hueco !== null ? '<icono>' : '';
          }),
          desbordanAlAncho: tarjetas.filter((n) => n.scrollWidth > n.clientWidth + 1).length,
          conFicheroLocal: [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Abrir el fichero local').length,
          copiar: [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Copiar enlace').length,
        };
      });

      // 2) INTERACCION, solo lo que no sale de la app.
      const primeraCopiar = page.getByRole('button', { name: 'Copiar enlace' }).first();
      await primeraCopiar.click();
      // Se busca el boton que YA dice "Copiado", no se relee el que se pulso: al cambiar de texto deja
      // de casar `name: 'Copiar enlace'` y ese localizador pasa a resolver al de la SIGUIENTE tarjeta,
      // que obviamente sigue sin copiar. Ademas se sondea, porque `navigator.clipboard.writeText`
      // resuelve por el proceso de navegador y una espera ciega lo pillaba a medias.
      let trasCopiar = '';
      for (let i = 0; i < 20; i += 1) {
        trasCopiar = (await page.getByRole('button', { name: /Copiado/ }).count()) === 1 ? '✓ Copiado' : '';
        if (trasCopiar.length > 0) break;
        await page.waitForTimeout(50);
      }
      // Se SONDEA el portapapeles en vez de leerlo una vez. `writeText` ya resolvio —la app solo pinta
      // "Copiado" en el `.then()`, nunca antes—, pero la lectura posterior salia vacia: el portapapeles
      // es un recurso EXCLUSIVO del SO y cualquier proceso que lo toque entre medias gana la carrera
      // (mismo motivo documentado en la comprobacion de copiar del hilo). Una lectura unica convertia
      // eso en un fallo rojo que no era de la app.
      let portapapeles = '';
      for (let i = 0; i < 20; i += 1) {
        portapapeles = await page.evaluate(() => navigator.clipboard.readText().catch(() => '(sin permiso)'));
        if (portapapeles.length > 0) break;
        await page.waitForTimeout(50);
      }

      const abrirCon = page.getByRole('button', { name: /^Abrir con…/ }).first();
      const hayDesplegable = await abrirCon.isVisible().catch(() => false);
      let cuentasOfrecidas = 0;
      if (hayDesplegable) {
        await abrirCon.click();
        await page.waitForTimeout(CONFIG.settleMs);
        cuentasOfrecidas = await page.getByRole('group', { name: 'Elegir cuenta con la que abrir' }).getByRole('button').count();
        await abrirCon.click(); // se cierra sin abrir nada
        await page.waitForTimeout(CONFIG.settleMs);
      }

      // 3) En el PANEL nuevo: las mismas, sin tener que scrollear el hilo.
      const boton = page.getByRole('button', { name: 'Artifacts', exact: true }).first();
      const hayPanel = await boton.isVisible().catch(() => false);
      let enElPanel = null;
      if (hayPanel) {
        await boton.click();
        await page.waitForTimeout(CONFIG.settleMs);
        enElPanel = await page.evaluate(() => {
          const pane = document.querySelector('[data-active-panel="artifacts"]');
          const texto = (pane?.innerText ?? '').replace(/\s+/g, ' ');
          return { cabecera: /ARTIFACTS \((\d+)\)/.exec(texto)?.[1] ?? null, desborda: pane === null ? null : pane.scrollWidth > pane.clientWidth + 1 };
        });
        await boton.click();
        await page.waitForTimeout(CONFIG.settleMs);
      }

      await page.evaluate((p) => {
        window.__mageDev.store.setState(p.store);
        window.__mageDev.panelStore.setState({ layout: p.layout });
      }, previo);
      await page.waitForTimeout(CONFIG.settleMs);

      const medido = {
        formas,
        enElHilo,
        trasCopiar,
        portapapeles: portapapeles.slice(0, 60),
        // Deja dicho en el informe si el portapapeles del SO estuvo disponible, para que un vacio no
        // se lea como "la copia no funciona".
        portapapelesDelSo: portapapeles.length === 0 ? 'no disponible en esta maquina' : 'leido',
        cuentasOfrecidas,
        enElPanel,
      };
      const ok =
        formas.length === 7 &&
        enElHilo.tarjetas === 7 &&
        // El que no trae favicon cae al icono por defecto de Mage, no se queda en blanco.
        enElHilo.iconos.includes('<icono>') &&
        enElHilo.iconos.includes('⚡🔥') &&
        // Ni el titulo larguisimo ni la descripcion de 300 caracteres pueden ensanchar la tarjeta.
        enElHilo.desbordanAlAncho === 0 &&
        // Seis traen fichero local; el septimo NO debe ofrecer abrirlo.
        enElHilo.conFicheroLocal === 6 &&
        enElHilo.copiar === 7 &&
        trasCopiar.includes('Copiado') &&
        // El portapapeles del SO NO puede ser el criterio, por lo mismo que ya documenta 2.9.b: en
        // Windows es un recurso EXCLUSIVO y cualquier proceso que lo tenga abierto hace que la
        // escritura no aterrice, en silencio. Medido el 2026-09-21: las DOS comprobaciones de
        // portapapeles leyeron '' en la misma tanda, y el portapapeles del SO estaba vacio tambien
        // desde fuera de la app.
        //
        // Lo que SI prueba que la copia funciona es que el boton pase a "Copiado": `ArtifactCard.tsx`
        // solo lo pinta dentro del `.then()` de `writeText`, nunca antes. Asi que si el SO deja leer,
        // se exige que sea la URL del artifact; si devuelve vacio, se anota en el detalle y no se
        // suspende por algo que no es de la app.
        (medido.portapapeles.length === 0 || medido.portapapeles.startsWith('https://claude.ai/code/artifact/')) &&
        cuentasOfrecidas > 0 &&
        enElPanel !== null &&
        enElPanel.cabecera === '7' &&
        enElPanel.desborda === false;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Reporte del usuario: "cuando abro una conversacion que tiene bastante, las pestañas de contexto,
    // MCP y logs me salen vacias". La causa: esos paneles miraban `sessionIdByChat` —sesiones VIVAS— y
    // en Mage la sesion arranca perezosa, asi que una conversacion recien abierta del historial tiene
    // el .jsonl entero leido y ninguna sesion viva. Contestaban "Sin conversacion activa" encima de una
    // conversacion abierta y llena.
    //
    // Se monta justo ese estado: pestaña con `resumeSessionId` y SIN entrada en `sessionIdByChat`, con
    // la transcripcion ya cargada en su store. Es el unico estado donde el bug se ve.
    name: 'Inspector: una conversacion reabierta sin sesion viva no dice que no hay conversacion',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        const t = window.__mageDev.transcriptStore.getState();
        return {
          store: { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, sessionIdByChat: s.sessionIdByChat },
          transcript: { entries: t.entries, isFinal: t.isFinal, errorMessage: t.errorMessage, totalLinesSoFar: t.totalLinesSoFar },
          layout: JSON.parse(JSON.stringify(window.__mageDev.panelStore.getState().layout)),
        };
      });
      await openTemporaryConversation(page);

      // DOS pasos, y el orden importa: al fijar `resumeSessionId` se dispara `useTranscriptLifecycle`,
      // que abre la transcripcion de verdad y RESETEA el store (el fichero no existe en el perfil
      // aislado). Inyectar las entradas en la misma tanda las borraba ese `open()` — el primer intento
      // media "Cargando transcripcion…" por eso, no por el bug.
      await page.evaluate(() => {
        const dev = window.__mageDev;
        const tabId = dev.store.getState().activeTabId;
        // La marca del bug: hay `resumeSessionId` y NO hay sesion viva.
        dev.store.setState((s) => ({
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, resumeSessionId: 's-reabierta' } : t)),
          sessionIdByChat: Object.fromEntries(Object.entries(s.sessionIdByChat).filter(([k]) => k !== tabId)),
        }));
      });
      await page.waitForTimeout(CONFIG.settleMs * 4);
      await page.evaluate(() => {
        const uso = { inputTokens: 4200, outputTokens: 900, cacheCreationInputTokens: 1200, cacheReadInputTokens: 30000, model: 'claude-sonnet-5' };
        window.__mageDev.transcriptStore.setState({
          isFinal: true,
          errorMessage: null,
          totalLinesSoFar: 2,
          entries: [
            { index: 0, uuid: 'u1', parentUuid: null, isSidechain: false, isMeta: false, timestampMs: Date.now() - 60000, category: 'turn', kind: 'user', summary: 'Hola', tokenUsage: null, raw: {} },
            { index: 1, uuid: 'a1', parentUuid: 'u1', isSidechain: false, isMeta: false, timestampMs: Date.now(), category: 'turn', kind: 'assistant', summary: 'Respuesta', tokenUsage: uso, raw: {} },
          ],
        });
      });
      await page.waitForTimeout(CONFIG.settleMs * 2);

      const medido = { paneles: {} };
      for (const [nombre, panelId] of [['Contexto', 'context'], ['Logs', 'logs'], ['MCP', 'mcp']]) {
        const boton = page.getByRole('button', { name: nombre, exact: true }).first();
        if (!(await boton.isVisible().catch(() => false))) {
          medido.paneles[nombre] = 'sin icono';
          continue;
        }
        await boton.click();
        await page.waitForTimeout(CONFIG.settleMs);
        // Por `data-active-panel` y no por "el primer pane": con varias zonas abiertas (Conversaciones
        // esta siempre) el primero no es el que se acaba de abrir.
        medido.paneles[nombre] = await page.evaluate((id) => {
          const pane = document.querySelector(`[data-active-panel="${id}"]`);
          return (pane?.innerText ?? '(no se monto)').replace(/\s+/g, ' ').slice(0, 140);
        }, panelId);
        await boton.click();
        await page.waitForTimeout(CONFIG.settleMs);
      }

      await page.evaluate((p) => {
        window.__mageDev.store.setState(p.store);
        window.__mageDev.transcriptStore.setState(p.transcript);
        window.__mageDev.panelStore.setState({ layout: p.layout });
      }, previo);
      await page.waitForTimeout(CONFIG.settleMs);

      const textos = Object.values(medido.paneles);
      const ok =
        textos.length === 3 &&
        // Ninguno puede negar que hay conversacion...
        !textos.some((t) => t.includes('Sin conversación activa')) &&
        // ...Contexto y Logs tienen que enseñar CONTENIDO de la transcripcion cargada...
        medido.paneles.Contexto.includes('TOKENS') &&
        medido.paneles.Logs.length > 20 &&
        // ...y MCP, que de verdad no puede saberlo sin sesion, tiene que decir POR QUE en vez de
        // afirmar en falso que esta conversacion no cargo ninguno.
        medido.paneles.MCP.includes('al arrancar');
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Reporte del usuario: "el drawer izquierdo saca scroll vertical, SOLO en modo ventana". La
    // comprobacion que ya habia media con la ventana como la deja el harness (grande), asi que el caso
    // no aparecia. Aqui se ENCOGE el viewport a tamanos de ventana reales y pequenos, que es la
    // condicion exacta del reporte, y ademas se dice QUE elemento desborda — un `true/false` manda a
    // buscar el bug a ciegas.
    //
    // Dos tamanos, porque los dos reportes lo fueron: una ventana BAJA (el alto es lo que aprieta a las
    // columnas de iconos) y una ESTRECHA (el ancho es lo que aprieta a los paneles del dock).
    name: 'Cascara: en ventana pequena la pagina no saca scroll',
    async run(page) {
      const previo = page.viewportSize();

      // Con TODOS los paneles repartidos entre los dos bordes, que es lo que acaba pasando en cuanto el
      // usuario mueve iconos de un borde a otro (y es el estado del reporte: nueve iconos en la columna).
      const previoLayout = await page.evaluate(() => {
        const dev = window.__mageDev;
        if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
        const antes = JSON.parse(JSON.stringify(dev.panelStore.getState().layout));
        // `movePanel` lanza si el panel YA esta en el destino: el catalogo se filtra antes en vez de
        // tragarse el error, que taparia un fallo de verdad de la misma llamada.
        // La MITAD a cada lado: el primer arreglo solo contenia la barra izquierda y el usuario volvio
        // a ver el scroll, esta vez por la derecha. Las dos tienen que aguantar.
        const registro = dev.panelRegistry;
        registro.forEach((p, i) => {
          const anchor = i % 2 === 0 ? 'left' : 'right';
          const zona = dev.panelStore.getState().layout.stripes[anchor].a;
          if (!zona.panelIds.includes(p.id)) dev.panelStore.getState().movePanel(p.id, anchor, 'a');
        });
        return antes;
      });

      const medido = {};
      for (const tamano of VENTANAS_PEQUENAS) {
        await page.setViewportSize({ width: tamano.width, height: tamano.height });
        await page.waitForTimeout(CONFIG.settleMs * 3);
        medido[tamano.etiqueta] = await medirDesborde(page);
      }

      await page.evaluate((layout) => window.__mageDev.panelStore.setState({ layout }), previoLayout);
      if (previo !== null) await page.setViewportSize(previo);
      await page.waitForTimeout(CONFIG.settleMs * 3);
      const ok = Object.values(medido).every(
        (m) =>
          !m.desbordaPagina &&
          !m.desbordaPaginaX &&
          !m.bodyDesborda &&
          m.railScrollea === false &&
          m.barras.every((b) => !b.scrollea) &&
          // Reporte del usuario: "en las barras de menu laterales has añadido un scroll horizontal,
          // quitalo". El eje X de una columna de iconos no debe desbordar NUNCA, y ninguna de las dos
          // barras debe robar sitio: con `overflow-y:auto` el navegador promociona `overflow-x` de
          // `visible` a `auto`, asi que un pixel de sobra a lo ancho saca barra horizontal, esa barra
          // roba 11 px de alto y con ellos puede aparecer tambien la vertical. Se mide el efecto.
          m.columnas.length > 0 &&
          m.columnas.every((c) => !c.desbordaX && c.barraV === 0 && c.barraH === 0 && c.ocultaBarra === 'none'),
      );
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // El reporte que reaparecio DOS veces despues de "arreglado": «el drawer izquierdo es mas grande a
    // lo vertical, haciendo que aparezca un scroll de toda la app». Las dos veces se midio lo que NO
    // era: las columnas de iconos. El culpable es otro y esta comprobacion es su reproduccion exacta —
    // las DOS zonas del borde izquierdo abiertas y un `splitPx` guardado con la ventana GRANDE, que es
    // lo que pasa en cuanto alguien ajusta el reparto maximizado y luego restaura la ventana.
    //
    // Con la zona 'a' declarada `flex: 0 0 <splitPx>`, ese envoltorio se quedaba clavado a 700 px en un
    // borde de 500: la caja del borde si encogia, pero su CONTENIDO desbordaba, y un desborde visible
    // amplia el area scrollable del DOCUMENTO. De ahi la barra en la pagina entera.
    name: 'Cascara: el drawer izquierdo con un reparto heredado de una ventana grande no desborda',
    async run(page) {
      const previo = page.viewportSize();
      const previoLayout = await page.evaluate(() => JSON.parse(JSON.stringify(window.__mageDev.panelStore.getState().layout)));
      await page.setViewportSize({ width: 900, height: 600 });
      await page.waitForTimeout(CONFIG.settleMs * 3);
      // Las dos zonas del borde izquierdo abiertas y un reparto MAS ALTO que la ventana entera.
      const SPLIT_PX = 900;
      await page.evaluate((splitPx) => {
        const store = window.__mageDev.panelStore.getState();
        const layout = store.layout;
        const left = layout.stripes.left;
        const abrir = (zona) => (zona.activePanelId === null ? { ...zona, activePanelId: zona.panelIds[0] ?? null } : zona);
        window.__mageDev.panelStore.setState({
          layout: { ...layout, stripes: { ...layout.stripes, left: { ...left, a: abrir(left.a), b: abrir(left.b), splitPx } } },
        });
      }, SPLIT_PX);
      await page.waitForTimeout(CONFIG.settleMs * 3);

      const medido = await page.evaluate(() => {
        const raiz = document.documentElement;
        const paneA = document.querySelector('[data-zone-pane="left-a"]');
        const paneB = document.querySelector('[data-zone-pane="left-b"]');
        const caja = (n) => {
          if (n === null) return null;
          const r = n.getBoundingClientRect();
          return { alto: Math.round(r.height), abajo: Math.round(r.bottom) };
        };
        return {
          ventana: window.innerHeight,
          zonasAbiertas: document.querySelectorAll('[data-zone-pane]').length,
          desbordaPagina: raiz.scrollHeight > raiz.clientHeight,
          altoDocumento: raiz.scrollHeight,
          zonaA: caja(paneA),
          zonaB: caja(paneB),
          // Culpables, para que un fallo diga DONDE mirar en vez de mandar a buscar a ciegas. Se
          // descarta lo que cuelga de un contenedor que SCROLLEA: un mensaje del hilo o una fila de la
          // lista de conversaciones esta por debajo de la ventana a proposito — eso es contenido
          // desplazado, no cascara desbordada. Lo que no puede pasar es que se salga una CAJA de la
          // cascara, que es lo que ampliaba el area scrollable del documento.
          culpables: [...document.querySelectorAll('*')]
            .filter((n) => {
              if (n.getBoundingClientRect().bottom - window.innerHeight <= 1) return false;
              for (let p = n.parentElement; p !== null; p = p.parentElement) {
                const overflowY = getComputedStyle(p).overflowY;
                if (overflowY === 'auto' || overflowY === 'scroll') return false;
              }
              return true;
            })
            .map((n) => ({
              sel: `${n.tagName.toLowerCase()}${n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`,
              zona: n.getAttribute('data-zone-pane'),
              excesoAbajo: Math.round(n.getBoundingClientRect().bottom - window.innerHeight),
            }))
            .sort((a, b) => b.excesoAbajo - a.excesoAbajo)
            .slice(0, 4),
        };
      });

      await page.evaluate((layout) => window.__mageDev.panelStore.setState({ layout }), previoLayout);
      if (previo !== null) await page.setViewportSize(previo);
      await page.waitForTimeout(CONFIG.settleMs * 3);
      const ok =
        medido.zonasAbiertas >= 2 && // si no, la reproduccion no llego a montarse y esto no mide nada
        !medido.desbordaPagina &&
        // Y lo que de verdad importa: NADA del borde se sale por debajo de la ventana. Sin esto, el
        // `overflow: hidden` de la pagina taparia el sintoma y la comprobacion pasaria en verde con el
        // bug puesto — que es exactamente como se escapo dos veces.
        medido.culpables.length === 0;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Reporte del usuario: "en modo ventana mira como se ve el input". Con la ventana baja, la caja del
    // prompt se comia media pantalla ESTANDO VACIA, con los chips de la fila de controles flotando a
    // media altura (van `self-center`) y el `>` pegado al fondo (la fila va `items-end`). Se mide con la
    // ventana pequena porque el numero solo canta ahi: en una ventana alta, la misma caja de mas pasa
    // por un margen generoso.
    name: 'Prompt: en ventana pequena el input no se estira',
    async run(page) {
      const previo = page.viewportSize();
      // Con pestaña ABIERTA: sin ella la fila no pinta los chips (modo de permiso, esfuerzo, modelo) ni el
      // menu de acciones, que son justo los items `shrink-0` que estrujaban al editor en el reporte.
      const previoStore = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout };
      });
      await openTemporaryConversation(page);
      const medido = {};
      for (const tamano of VENTANAS_PEQUENAS) {
        await page.setViewportSize({ width: tamano.width, height: tamano.height });
        await page.waitForTimeout(CONFIG.settleMs * 3);
        medido[tamano.etiqueta] = await page.evaluate(() => {
          const host = document.querySelector('[data-prompt-editor="true"]');
          if (host === null) throw new Error('no hay editor de prompt en el DOM');
          const alto = (n) => (n === null ? null : Math.round(n.getBoundingClientRect().height));
          const fila = host.parentElement;
          return {
            ventana: window.innerHeight,
            panel: alto(host.closest('[data-pane-tab-id]')),
            barra: alto(fila?.parentElement ?? null),
            fila: alto(fila),
            host: alto(host),
            anchoPanel: host.closest('[data-pane-tab-id]')?.offsetWidth ?? null,
            anchoHost: host.offsetWidth,
            editor: alto(host.querySelector('.cm-editor')),
            scroller: alto(host.querySelector('.cm-scroller')),
            contenido: alto(host.querySelector('.cm-content')),
            lineas: host.querySelectorAll('.cm-line').length,
            texto: host.querySelector('.cm-content')?.textContent?.slice(0, 40) ?? null,
          };
        });
      }
      if (previo !== null) await page.setViewportSize(previo);
      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previoStore);
      await page.waitForTimeout(CONFIG.settleMs * 3);
      // Vacio, el editor es una linea o dos: la caja entera es eso mas su relleno. El presupuesto deja
      // aire para el chip mas alto de la fila de controles, no para 200 px de nada.
      const ok = Object.values(medido).every(
        (m) => m.fila !== null && m.fila <= Math.round(m.panel * PROMPT_ROW_MAX_SHARE) && m.anchoHost >= PROMPT_EDITOR_MIN_PX,
      );
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Panel "Herramientas": el CLI manda la lista completa en el `session_init` y hasta ahora Mage se
    // quedaba solo con el numero — que ademas no leia nadie. Se inyecta por el reducer REAL con el
    // mismo evento que manda el CLI y se comprueba lo que hace el panel: agrupar por origen (nativas
    // primero, luego un grupo por servidor MCP) y filtrar por el nombre COMPLETO.
    name: 'Inspector: el panel de Herramientas agrupa por origen y filtra',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, toolsByChat: s.toolsByChat };
      });
      await openTemporaryConversation(page);
      await page.evaluate(() => {
        const dev = window.__mageDev;
        if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
        const tabId = dev.store.getState().activeTabId;
        dev.store.setState((s) =>
          dev.reduceEvent(s, tabId, {
            kind: 'session_init',
            sessionId: 's-tools',
            model: 'sonnet',
            tools: ['Read', 'Bash', 'mcp__database__run_query', 'mcp__playwright__browser_click'],
            mcpServers: [],
            slashCommands: [],
            // P-026 2.6: lo que cargo la sesion, con la forma medida en 2.1.283.
            skills: ['obsidian:obsidian-cli', 'caveman'],
            plugins: [{ name: 'obsidian', source: 'obsidian@obsidian-skills' }],
            pluginErrors: [],
          }),
        );
      });
      await page.waitForTimeout(CONFIG.settleMs);

      // Los paneles del dock son BOTONES con `aria-label`, no `role="tab"` — mismo selector que usa la
      // comprobacion de 2.9.b para los tres iconos de aquella ronda.
      const boton = page.getByRole('button', { name: 'Herramientas', exact: true }).first();
      const enElInspector = await boton.isVisible().catch(() => false);
      // Contrato de `reconcileLayoutWithRegistry`: un id nuevo aparece pero NO se abre solo. Si esto
      // falla, una instalacion existente se encontraria el panel activo cambiado al actualizar.
      const abiertoSolo = await page.evaluate(
        () => document.querySelector('[aria-label="Herramientas"]')?.getAttribute('aria-pressed') === 'true',
      );
      if (enElInspector) await boton.click();
      await page.waitForTimeout(CONFIG.settleMs);

      const medido = await page.evaluate(() => {
        const buscador = document.querySelector('[aria-label="Buscar herramienta"]');
        const panel = buscador?.closest('div')?.parentElement ?? null;
        const texto = panel === null ? '' : (panel.innerText ?? '');
        return {
          conBuscador: buscador !== null,
          // Las cabeceras de grupo, en el ORDEN en que se pintan: nativas primero y los servidores
          // en alfabetico. Es lo unico que distingue "agrupa" de "lista todo junto".
          grupos: texto.split('\n').filter((line) => /^[A-Za-z-]+ \(\d+\)$/.test(line.trim()) && !/^(plugins|skills) /i.test(line.trim())).map((line) => line.trim()),
          // P-026 2.6: skills y plugins de la sesion, plegados con su recuento.
          extensiones: [...(panel?.querySelectorAll('[data-session-extensions] summary') ?? [])].map((n) => (n.textContent ?? '').trim()),
          // El nombre completo tiene que seguir estando (es el que se copia para una regla de permisos),
          // aunque dentro de su grupo se pinte el corto.
          nombresCompletos: [...(panel?.querySelectorAll('[title^="mcp__"]') ?? [])].map((n) => n.getAttribute('title')),
        };
      });

      await page.evaluate((state) => window.__mageDev.store.setState(state), previo);
      await page.waitForTimeout(CONFIG.settleMs);

      if (enElInspector) await boton.click(); // se cierra: se deja el dock como estaba
      const ok =
        enElInspector &&
        !abiertoSolo &&
        medido.conBuscador &&
        // En minusculas para comparar: el panel pinta las cabeceras con `uppercase` de CSS y `innerText`
        // devuelve el texto YA transformado. Lo que se comprueba es el agrupamiento y el orden, no de
        // que color son las letras.
        medido.grupos.map((g) => g.toLowerCase()).join(' | ') === 'nativas (2) | database (1) | playwright (1)' &&
        medido.nombresCompletos.length === 2 &&
        medido.extensiones.join(' | ') === 'Plugins (1) | Skills (2)';
      return { ok, detail: JSON.stringify({ enElInspector, abiertoSolo, ...medido }) };
    },
  },
  {
    // Frontera de confianza: lanzar un agente dentro de una carpeta ejecuta lo que esa carpeta traiga
    // (hooks, `.claude/settings.json`, MCP del repo), y el CLI en headless —el unico modo que usa
    // Mage— NO pregunta. Se comprueba que el dialogo aparece, que nombra la carpeta, y sobre todo que
    // NO se puede descartar sin contestar: ni con Escape ni con un clic fuera. Un descarte accidental
    // que cayera en "confiar" seria un agujero.
    //
    // Se pulsa "No confiar" a proposito: es la respuesta que NO escribe nada en los ajustes.
    name: 'Seguridad: la carpeta sin autorizar pide confianza y el dialogo no se descarta solo',
    async run(page) {
      const CARPETA = 'C:/carpeta/que/no/existe/de/prueba';
      const previo = await page.evaluate(() => window.__mageDev.store.getState().trustRequests);
      await page.evaluate((folder) => {
        const dev = window.__mageDev;
        if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
        dev.store.setState({ trustRequests: [folder] });
      }, CARPETA);
      await page.waitForTimeout(CONFIG.settleMs);

      const dialogo = page.getByRole('dialog').filter({ hasText: 'Confías en los archivos' });
      const visible = await dialogo.isVisible().catch(() => false);
      const nombraLaCarpeta = visible ? (await dialogo.innerText()).includes(CARPETA) : false;

      // Ni Escape ni clic fuera lo cierran: la pregunta se contesta.
      await page.keyboard.press('Escape');
      await page.mouse.click(4, 4);
      await page.waitForTimeout(CONFIG.settleMs);
      const sigueTrasDescartar = await page.evaluate(() => window.__mageDev.store.getState().trustRequests.length);

      const botones = visible ? await dialogo.getByRole('button').allInnerTexts() : [];
      await dialogo.getByRole('button', { name: 'No confiar' }).click();
      await page.waitForTimeout(CONFIG.settleMs);
      const trasResponder = await page.evaluate(() => ({
        pendientes: window.__mageDev.store.getState().trustRequests.length,
        // Decir "no" no puede escribir nada: si esto sube, el dialogo esta autorizando por su cuenta.
        autorizadas: window.__mageDev.store.getState().settings.trustedFolders.length,
      }));

      await page.evaluate((trustRequests) => window.__mageDev.store.setState({ trustRequests }), previo);
      const medido = { visible, nombraLaCarpeta, sigueTrasDescartar, botones, ...trasResponder };
      // La otra mitad de la frontera: lo que se autoriza se tiene que poder RETIRAR. Una lista de
      // confianza que solo crece es una puerta de un solo sentido, y se autoriza al vuelo en un
      // dialogo. Se comprueba que la seccion existe y que lista lo que hay en los ajustes.
      medido.enAjustes = await medirSeccionDeConfianza(page, CARPETA);
      const ok =
        medido.visible &&
        medido.nombraLaCarpeta &&
        medido.sigueTrasDescartar === 1 &&
        medido.botones.length === 2 &&
        medido.pendientes === 0 &&
        medido.autorizadas === 0 &&
        medido.enAjustes.listada &&
        medido.enAjustes.trasRetirar === 0;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // La barra de estado muestra la version de Mage, pegada al estado del servicio. Se comprueba el
    // TEXTO y la POSICION: que exista un `vX.Y.Z` no vale si acaba en la otra punta de la barra, que es
    // justo lo que se pidio evitar ("al lado del estado del servidor").
    name: 'Barra de estado: la version de la app, junto al estado del servicio',
    async run(page) {
      const medido = await page.evaluate(() => {
        const estado = document.querySelector('[aria-label^="Estado del servicio"]');
        const barra = estado?.closest('div[class*="border-t"]') ?? null;
        const textos = barra === null ? [] : [...barra.querySelectorAll('span')].map((n) => (n.textContent ?? '').trim());
        const version = textos.find((t) => /^v\d+\.\d+\.\d+/.test(t)) ?? null;
        const nodoVersion = barra === null ? null : [...barra.querySelectorAll('span')].find((n) => /^v\d+\.\d+\.\d+/.test((n.textContent ?? '').trim()));
        const x = (el) => (el === null || el === undefined ? null : Math.round(el.getBoundingClientRect().left));
        return {
          version,
          xEstado: x(estado),
          xVersion: x(nodoVersion),
          // Distancia entre el final del estado y el inicio de la version: "al lado" es medible.
          separacionPx:
            estado === null || nodoVersion === undefined
              ? null
              : Math.round(nodoVersion.getBoundingClientRect().left - estado.getBoundingClientRect().right),
        };
      });
      const ok =
        medido.version !== null &&
        medido.xVersion !== null &&
        medido.xEstado !== null &&
        medido.xVersion > medido.xEstado &&
        medido.separacionPx !== null &&
        medido.separacionPx <= 40;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Punto 21: reordenar iconos dentro de su propia zona. Antes soltar un icono en su propio grupo lanzaba
    // una excepcion (`ya esta en ...`). Con `DragEvent` sintetico se suelta el ultimo icono de una zona
    // sobre la mitad de arriba del primero: el orden cambia, no hay error de pagina, y se vuelve a soltar
    // al final para dejar el layout como estaba. El gesto real con el raton sigue siendo manual.
    name: 'Stripe: soltar un icono sobre otro de su zona lo reordena sin error',
    async run(page) {
      const medido = await page.evaluate(async () => {
        const errores = [];
        const onError = (e) => errores.push(String(e.message ?? e));
        window.addEventListener('error', onError);
        const MIME = 'application/x-mage-panel-id';
        const zonas = [...document.querySelectorAll('[role="toolbar"]')]
          .flatMap((t) => [...t.querySelectorAll('div')])
          .filter((d) => [...d.children].filter((c) => c.matches('button[data-stripe-btn="true"]')).length >= 2);
        const zona = zonas[0];
        if (zona === undefined) return { saltado: true };
        const orden = () => [...zona.children].filter((c) => c.matches('button[data-stripe-btn="true"]')).map((b) => b.getAttribute('aria-label'));
        const soltar = (origen, destino, arriba) => {
          const dt = new DataTransfer();
          dt.setData(MIME, origen.dataset.panelId ?? '');
          const rect = destino.getBoundingClientRect();
          const init = { bubbles: true, cancelable: true, dataTransfer: dt, clientY: arriba ? rect.top + 2 : rect.bottom - 2 };
          destino.dispatchEvent(new DragEvent('dragover', init));
          destino.dispatchEvent(new DragEvent('drop', init));
          // React 19 pinta lo que cambia el drop en una microtarea/frame, no dentro del dispatch: leer el
          // orden en la misma pila daba siempre el de antes.
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        };
        const botones = [...zona.children].filter((c) => c.matches('button[data-stripe-btn="true"]'));
        const antes = orden();
        const ultimo = botones[botones.length - 1];
        const primero = botones[0];
        await soltar(ultimo, primero, true);
        const despues = orden();
        const ultimoAhora = [...zona.children].filter((c) => c.matches('button[data-stripe-btn="true"]')).at(-1);
        await soltar(ultimo, ultimoAhora, false); // restaurar: al final
        window.removeEventListener('error', onError);
        return { saltado: false, antes, despues, restaurado: orden(), errores };
      });
      const ok =
        medido.saltado === true ||
        (medido.despues[0] === medido.antes[medido.antes.length - 1] && JSON.stringify(medido.restaurado) === JSON.stringify(medido.antes) && medido.errores.length === 0);
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Cursor de mano sobre lo clicable (revision 0.1.1, punto 4): Tailwind v4 quito `cursor: pointer` del
    // preflight y la regla global vive en `@layer base`. Se mide el cursor CALCULADO: un boton habilitado
    // y un icono de la stripe dicen `pointer`; uno deshabilitado NO; y una utilidad `cursor-not-allowed`
    // sigue mandando sobre la regla global (si la regla estuviera fuera de capa, la aplastaria).
    name: 'Cursor: pointer sobre lo clicable, y las utilidades siguen mandando',
    async run(page) {
      const medido = await page.evaluate(() => {
        const cursorDe = (el) => getComputedStyle(el).cursor;
        const probe = document.createElement('div');
        probe.innerHTML =
          '<button id="mg-probe-on">a</button><button id="mg-probe-off" disabled>b</button>' +
          '<button id="mg-probe-util" class="cursor-not-allowed">c</button>';
        document.body.appendChild(probe);
        const r = {
          habilitado: cursorDe(probe.querySelector('#mg-probe-on')),
          deshabilitado: cursorDe(probe.querySelector('#mg-probe-off')),
          utilidad: cursorDe(probe.querySelector('#mg-probe-util')),
          stripe: (() => {
            const b = document.querySelector('button[data-stripe-btn="true"]');
            return b === null ? null : cursorDe(b);
          })(),
        };
        probe.remove();
        return r;
      });
      const ok = medido.habilitado === 'pointer' && medido.deshabilitado !== 'pointer' && medido.utilidad === 'not-allowed' && (medido.stripe === null || medido.stripe === 'pointer');
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Iconografia: NINGUN emoji de color en la interfaz. El repo ya declaraba la regla por escrito en
    // `panelRegistry.ts` y en `toolClassify.ts` ("MONOCROMO a proposito… un emoji de color se sale de
    // la paleta del tema y no conmuta con el"), y estaba incumplida en ~70 sitios del renderer.
    //
    // Se mide sobre el DOM REAL y no con un grep del codigo a proposito: un emoji puede llegar a la
    // pantalla desde una plantilla, una constante compartida o un texto del propio CLI, y lo que
    // importa es lo que ve el usuario. Se recorren los nodos de TEXTO —no `innerText` del body, que
    // duplicaria cada nodo por cada ancestro— y se ignoran a conciencia las dos fuentes legitimas:
    // el contenido que llega del agente (transcripcion, mensajes) y los favicon de artifact, que son
    // datos del artifact publicado y no iconografia de Mage.
    name: 'Iconos: la interfaz no usa ni un emoji de color',
    async run(page) {
      const medido = await page.evaluate(() => {
        const PICTO = /\p{Extended_Pictographic}/u;
        // Vocabulario MONOCROMO propio del proyecto: NO son emoji de color, son los glifos que
        // `panelRegistry.ts` y `toolClassify.ts` declaran por escrito como el estilo de la casa.
        // Unicode clasifica varios de ellos como pictograficos, asi que sin esta lista la comprobacion
        // marcaria como defecto justo lo que la regla del repo manda usar.
        const VOCABULARIO = new Set([...'☰◇◔«»⌕⇲▸▾']);
        // Zonas cuyo texto NO es iconografia de Mage: lo escribe el usuario o lo devuelve el agente.
        const AJENO = ['[data-transcript]', '[role="log"]', '.mg-markdown', '[data-artifact-favicon]', '[contenteditable="true"]'];
        const esAjeno = (nodo) => {
          for (let el = nodo.parentElement; el !== null; el = el.parentElement) {
            if (AJENO.some((sel) => el.matches(sel))) return true;
          }
          return false;
        };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const hallazgos = [];
        for (let nodo = walker.nextNode(); nodo !== null; nodo = walker.nextNode()) {
          const texto = nodo.nodeValue ?? '';
          if (!PICTO.test(texto) || esAjeno(nodo)) continue;
          const emojis = [...texto].filter((ch) => PICTO.test(ch) && !VOCABULARIO.has(ch));
          if (emojis.length === 0) continue;
          hallazgos.push({
            emojis: emojis.join(''),
            // Contexto suficiente para encontrarlo sin volver a ejecutar nada.
            texto: texto.trim().slice(0, 40),
            donde: nodo.parentElement?.getAttribute('aria-label') ?? nodo.parentElement?.className?.toString().slice(0, 50) ?? '',
          });
        }
        // Y de paso: los glifos de clase de herramienta tienen que ocupar todos la MISMA caja. `›_`
        // son dos caracteres y descuadraba la fila frente a los monocaracter (◇ ⌕ ✎ ⇲ ▣).
        const glifos = [...document.querySelectorAll('[data-tool-glyph]')].map((n) => ({
          texto: (n.textContent ?? '').trim(),
          ancho: Math.round(n.getBoundingClientRect().width),
        }));
        const anchos = [...new Set(glifos.map((g) => g.ancho))];
        return { hallazgos, glifos, anchosDistintos: anchos.length };
      });
      // Los glifos de herramienta solo estan en pantalla si hay una conversacion con tools a la vista:
      // cuando no los hay, esa mitad de la comprobacion no aplica y no debe fallar.
      const ok = medido.hallazgos.length === 0 && (medido.glifos.length === 0 || medido.anchosDistintos === 1);
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // El slider de opacidad tiene que cambiar el COLOR CALCULADO de las superficies, no solo guardar un
    // numero. Se mide `--color-mg-window` resuelto: con 100 es opaco y con menos tiene alfa. Y se
    // comprueba que volver a 100 lo deja opaco otra vez — un ajuste que no es reversible del todo deja
    // residuo y tapa el siguiente cambio de tema, que es el fallo de verdad aqui.
    //
    // No se toca el DOM del slider: se llama a la ACCION del store, que es el contrato real (la UI es
    // un llamante mas). Asi la comprobacion no se rompe si mañana el control cambia de forma.
    name: 'Apariencia: la opacidad de fondo cambia las superficies y vuelve atras',
    async run(page) {
      const leer = () =>
        page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-mg-window').trim());
      const previo = await page.evaluate(() => window.__mageDev.store.getState().settings.backgroundOpacity);

      const opaco = await leer();
      await page.evaluate(() => window.__mageDev.store.getState().setBackgroundOpacity(60));
      await page.waitForTimeout(CONFIG.settleMs);
      const translucido = await leer();
      await page.evaluate(() => window.__mageDev.store.getState().setBackgroundOpacity(100));
      await page.waitForTimeout(CONFIG.settleMs);
      const restaurado = await leer();

      // Se deja como estaba, por si el usuario tenia otro valor persistido.
      await page.evaluate((v) => window.__mageDev.store.getState().setBackgroundOpacity(v), previo);

      const conAlfa = (color) => color.includes('color-mix') || /rgba?\([^)]*[,/]\s*0?\.\d+\s*\)/.test(color);
      const medido = { opaco, translucido, restaurado, previo };
      const ok = opaco.length > 0 && conAlfa(translucido) && !conAlfa(restaurado) && restaurado === opaco;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // Menu de aplicacion plegado en tres puntos (peticion del usuario, estilo IntelliJ). Se comprueba el
    // ciclo COMPLETO y las cuatro cosas que fallaron en el primer intento:
    //   1. el boton no puede ser diminuto (tiene que medir como el resto de la cabecera),
    //   2. al desplegar, el menu SUSTITUYE al contenido de la barra en vez de empujarlo,
    //   3. NO se abre ningun submenu solo al desplegar,
    //   4. el hover CONMUTA de un menu a otro (antes un backdrop a pantalla completa se comia el raton).
    //
    // Los clics van por `dispatchEvent`: la cabecera es region de ARRASTRE de ventana y Electron se come
    // los eventos de raton sinteticos que caen sobre ella. El hover si funciona, porque no es un clic.
    name: 'Cabecera: el menu se pliega en tres puntos, reemplaza la barra y el hover conmuta',
    async run(page) {
      const contar = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
      const abierto = () => page.evaluate(() => document.querySelector('[role="menu"]')?.getAttribute('aria-label') ?? null);
      const pulsarPuntos = () =>
        page.evaluate(() => document.querySelector('[data-app-menu-toggle="true"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      const medido = {
        puntosAlInicio: await contar('[data-app-menu-toggle="true"]'),
        altoDeLosPuntos: await page.evaluate(
          () => Math.round(document.querySelector('[data-app-menu-toggle="true"]')?.getBoundingClientRect().height ?? 0),
        ),
        cuentasAlInicio: await contar('[role="group"][aria-label="Cuentas"]'),
      };

      await pulsarPuntos();
      await page.waitForTimeout(CONFIG.settleMs);
      medido.etiquetas = await page.evaluate(() =>
        [...document.querySelectorAll('[role="menubar"] > [role="menuitem"]')].map((n) => (n.textContent ?? '').trim()),
      );
      // Reemplaza, no empuja: con el menu desplegado no queda el selector de cuentas. El icono de la app
      // SI se queda (es el ancla de la barra y su acceso a los ajustes), asi que se comprueba justo eso:
      // que sigue habiendo exactamente uno.
      medido.cuentasConMenu = await contar('[role="group"][aria-label="Cuentas"]');
      // ANCLADO al icono de la app, no a cualquier boton cuyo nombre EMPIECE por 'Mage': hay etiquetas
      // de la UI que tambien empiezan asi ('Mage (común)', el origen de una regla de permisos). Y si
      // vuelve a contar de mas, que el informe diga CUALES: un numero suelto no se puede diagnosticar
      // sin volver a ejecutar los diez minutos de harness.
      medido.iconoAppConMenu = await contar('button[aria-label="Mage · Configuración"]');
      medido.botonesQueEmpiezanPorMage = await page.evaluate(() =>
        [...document.querySelectorAll('button[aria-label^="Mage"]')].map((n) => n.getAttribute('aria-label')),
      );
      medido.submenusTrasDesplegar = await contar('[role="menu"]');

      // HOVER sobre la primera y despues sobre la SEGUNDA: lo que se mide es que conmute.
      //
      // El hover mueve el raton DE VERDAD, asi que necesita la ventana delante y con el foco del SO —
      // la misma condicion de entorno que hacia parpadear a la 2.8. Y se SONDEA el resultado en vez de
      // esperar un tiempo fijo: el desplegable entra con una animacion, y una espera ciega lo pillaba
      // a medias segun lo cargada que estuviera la maquina.
      await page.bringToFront().catch(() => undefined);
      await page.evaluate(async () => {
        for (let i = 0; i < 40 && !document.hasFocus(); i += 1) {
          window.focus();
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      });
      const hoverHasta = async (indice, esperado) => {
        const etiquetas = page.locator('[role="menubar"] > [role="menuitem"]');
        for (let i = 0; i < 20; i += 1) {
          await etiquetas.nth(indice).hover();
          await page.waitForTimeout(50);
          const actual = await abierto();
          if (actual === esperado) return actual;
        }
        return abierto();
      };
      medido.trasHover1 = await hoverHasta(0, 'Conversación');
      medido.trasHover2 = await hoverHasta(1, 'Sesión');

      // Clic fuera: sobre la barra de estado, que no es interactiva ni abre nada.
      await page.mouse.click(600, 790);
      await page.waitForTimeout(CONFIG.settleMs);
      medido.puntosAlFinal = await contar('[data-app-menu-toggle="true"]');
      medido.barraAlFinal = await contar('[role="menubar"]');
      medido.cuentasAlFinal = await contar('[role="group"][aria-label="Cuentas"]');

      const ok =
        medido.puntosAlInicio === 1 &&
        medido.altoDeLosPuntos >= 24 &&
        medido.cuentasAlInicio === 1 &&
        medido.etiquetas.length >= 3 &&
        medido.cuentasConMenu === 0 &&
        medido.iconoAppConMenu === 1 &&
        medido.submenusTrasDesplegar === 0 &&
        medido.trasHover1 === medido.etiquetas[0] &&
        medido.trasHover2 === medido.etiquetas[1] &&
        medido.puntosAlFinal === 1 &&
        medido.barraAlFinal === 0 &&
        medido.cuentasAlFinal === 1;
      return { ok, detail: JSON.stringify(medido) };
    },
  },
  {
    // H2: la burbuja del usuario se pintaba en PLANO (`whitespace-pre-wrap`), asi que un `**negrita**`
    // o un bloque de codigo enviados se veian en crudo (reporte del usuario). Decision del usuario
    // (2026-09-09): tiene que renderizar Markdown, igual que el mensaje del agente.
    // Se mide en el DOM: los elementos que el Markdown produce EXISTEN y los delimitadores literales
    // NO estan. Un solo `includes('**')` no bastaria — el texto plano tambien pasaria si hubiera
    // <strong> por otro motivo.
    name: 'H2: el mensaje del usuario renderiza Markdown en la burbuja',
    async run(page) {
      const bloques = await hydrateFromEntries(page, [
        {
          index: 0,
          uuid: 'h2-0',
          parentUuid: null,
          isSidechain: false,
          isMeta: false,
          timestampMs: Date.now(),
          category: 'turn',
          kind: 'user',
          summary: '',
          tokenUsage: null,
          raw: { message: { content: 'Con **negrita**, `codigo` y una lista:\n\n- uno\n- dos' } },
        },
      ]);
      const medido = await page.evaluate(() => {
        const bubble = document.querySelector('[data-block="user"]');
        if (bubble === null) return null;
        const texto = bubble.textContent ?? '';
        return {
          strong: bubble.querySelectorAll('strong').length,
          code: bubble.querySelectorAll('code').length,
          itemsDeLista: bubble.querySelectorAll('li').length,
          // Los delimitadores no deben quedar visibles.
          asteriscosLiterales: (texto.match(/\*\*/g) ?? []).length,
          acentosGravesLiterales: (texto.match(/`/g) ?? []).length,
          guionesDeLista: (texto.match(/^- /gm) ?? []).length,
          // Y el contenido sigue ahi.
          conTexto: texto.includes('negrita') && texto.includes('codigo') && texto.includes('uno'),
        };
      });
      const ok =
        bloques === 1 &&
        medido !== null &&
        medido.strong >= 1 &&
        medido.code >= 1 &&
        medido.itemsDeLista === 2 &&
        medido.asteriscosLiterales === 0 &&
        medido.acentosGravesLiterales === 0 &&
        medido.guionesDeLista === 0 &&
        medido.conTexto;
      return { ok, detail: JSON.stringify({ bloques, ...medido }) };
    },
  },
  {
    // 4.3 de la auditoria: con el workspace dividido, el panel NO enfocado se quedaba con el chat
    // VACIO aunque su conversacion tuviera historial en disco. La causa era 4.1: habia UN solo store de
    // transcripcion siguiendo a `activeTabId`, asi que la hidratacion del panel no enfocado comparaba
    // `lastParams.sessionId` (la del panel enfocado) con la suya, no coincidian nunca y salia por su
    // guard. Ahora hay un store por pestaña.
    //
    // Se monta el unico estado donde el bug se ve: DOS conversaciones reanudadas (con `resumeSessionId`
    // y sin sesion viva) en dos paneles, cada una con SU transcripcion cargada en SU store. La medida es
    // que los dos paneles pintan bloques — con el store global, el no enfocado marcaba 0.
    // Va la ULTIMA: deja dos paneles montados a mitad de la prueba, y con dos paneles los localizadores
    // de prompt de cualquier otra comprobacion dejarian de ser unicos.
    name: '4.3: en un split, los DOS paneles hidratan su conversacion reanudada',
    async run(page) {
      const previo = await page.evaluate(() => {
        const s = window.__mageDev.store.getState();
        return {
          tabs: s.tabs,
          activeTabId: s.activeTabId,
          splitLayout: s.splitLayout,
          sessionIdByChat: s.sessionIdByChat,
          blocksByChat: s.blocksByChat,
        };
      });

      await openTemporaryConversation(page);
      const tabA = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      await openTemporaryConversation(page);
      const tabB = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);

      // Las dos como conversaciones REABIERTAS del historial: `resumeSessionId` puesto y ninguna
      // sesion viva. Y se dividen por la accion del store (el arrastre real ya lo cubre la #38).
      await page.evaluate((p) => {
        const dev = window.__mageDev;
        dev.store.setState((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === p.tabA ? { ...t, resumeSessionId: p.sesionA } : t.id === p.tabB ? { ...t, resumeSessionId: p.sesionB } : t,
          ),
          sessionIdByChat: Object.fromEntries(
            Object.entries(s.sessionIdByChat).filter(([k]) => k !== p.tabA && k !== p.tabB),
          ),
          blocksByChat: Object.fromEntries(Object.entries(s.blocksByChat).filter(([k]) => k !== p.tabA && k !== p.tabB)),
        }));
        // El destino de un drop es el CAMINO del panel (grupos de pestañas): con un unico panel, la raiz.
        dev.store.getState().movePaneTab(p.tabA, [], 'left');
      }, { tabA, tabB, sesionA: SPLIT_HYDRATION_SESSIONS.a, sesionB: SPLIT_HYDRATION_SESSIONS.b });
      // Espera LARGA a proposito: el ciclo de vida de cada panel intenta abrir su transcripcion de
      // verdad y falla (la carpeta temporal no tiene ninguna). Hay que dejar que ese fallo aterrice
      // ANTES de inyectar, o el lote de error llegaria despues y borraria lo inyectado.
      await page.waitForTimeout(CONFIG.settleMs * 4);

      const inyectados = await page.evaluate((p) => {
        const dev = window.__mageDev;
        if (dev.transcriptStoreFor === undefined) throw new Error('__mageDev.transcriptStoreFor no existe');
        const entradas = (texto) => [
          {
            index: 0,
            uuid: 'u0',
            parentUuid: null,
            isSidechain: false,
            isMeta: false,
            timestampMs: Date.now(),
            category: 'turn',
            kind: 'user',
            summary: texto,
            tokenUsage: null,
            raw: { message: { content: texto } },
          },
        ];
        const cargar = (tabId, sessionId, texto) => {
          const store = dev.transcriptStoreFor(tabId);
          store.setState({
            entries: entradas(texto),
            errors: [],
            isFinal: true,
            errorMessage: null,
            totalLinesSoFar: 1,
            lastParams: { accountDir: 'vg', cwd: 'vg', sessionId },
          });
        };
        cargar(p.tabA, p.sesionA, p.textoA);
        cargar(p.tabB, p.sesionB, p.textoB);
        return true;
      }, {
        tabA,
        tabB,
        sesionA: SPLIT_HYDRATION_SESSIONS.a,
        sesionB: SPLIT_HYDRATION_SESSIONS.b,
        textoA: SPLIT_HYDRATION_SESSIONS.textoA,
        textoB: SPLIT_HYDRATION_SESSIONS.textoB,
      });
      await page.waitForTimeout(CONFIG.settleMs * 2);

      const medido = await page.evaluate((p) => {
        const bloquesDe = (tabId) => {
          const pane = document.querySelector(`[data-pane-tab-id="${tabId}"]`);
          if (pane === null) return null;
          return {
            bloques: pane.querySelectorAll('[data-block]').length,
            texto: pane.textContent ?? '',
          };
        };
        const s = window.__mageDev.store.getState();
        return {
          paneles: document.querySelectorAll('[data-pane-tab-id]').length,
          a: bloquesDe(p.tabA),
          b: bloquesDe(p.tabB),
          // El resultado de la hidratacion en el estado, no solo en el DOM.
          bloquesA: s.blocksByChat[p.tabA]?.length ?? 0,
          bloquesB: s.blocksByChat[p.tabB]?.length ?? 0,
        };
      }, { tabA, tabB });

      await page.evaluate((estado) => window.__mageDev.store.setState(estado), previo);
      await page.waitForTimeout(CONFIG.settleMs);
      const panelesAlFinal = await promptAreas(page).count();

      const ok =
        medido.paneles === 2 &&
        medido.bloquesA >= 1 &&
        medido.bloquesB >= 1 &&
        medido.a !== null &&
        medido.b !== null &&
        medido.a.bloques >= 1 &&
        medido.b.bloques >= 1 &&
        // Y cada panel pinta LO SUYO, no dos veces la misma conversacion.
        medido.a.texto.includes(SPLIT_HYDRATION_SESSIONS.textoA) &&
        !medido.a.texto.includes(SPLIT_HYDRATION_SESSIONS.textoB) &&
        medido.b.texto.includes(SPLIT_HYDRATION_SESSIONS.textoB) &&
        panelesAlFinal === 1;
      return {
        ok,
        detail: JSON.stringify({
          paneles: medido.paneles,
          bloquesA: medido.bloquesA,
          bloquesB: medido.bloquesB,
          domA: medido.a?.bloques ?? null,
          domB: medido.b?.bloques ?? null,
          soloLoSuyoA: medido.a !== null && medido.a.texto.includes(SPLIT_HYDRATION_SESSIONS.textoA) && !medido.a.texto.includes(SPLIT_HYDRATION_SESSIONS.textoB),
          panelesAlFinal,
          inyectados,
        }),
      };
    },
  },
  {
    // Grupo F (0.1.2, respuesta 19): Configuracion › Notas de version abre la pseudo-pestaña de novedades
    // en la version instalada, sin prompt, con el menu lateral de versiones; elegir otra la cambia, y al
    // cerrarla se DESMONTA (error n.º 6 de la skill). Llega y se va sin dialogo ni pestaña de mas.
    name: 'Grupo F: Ajustes › Notas de versión abre la pestaña de novedades sin prompt',
    async run(page) {
      await openSettingsDialog(page);
      await openSection(page, /Notas de versión/);
      await page.getByRole('button', { name: 'Abrir las notas de versión', exact: true }).click();
      const modales = await waitForModalsGone(page);
      await page.locator(RELEASE_NOTES_PANE).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const alAbrir = await measureReleaseNotes(page);
      const otra = alAbrir.versiones.find((version) => version !== APP_VERSION) ?? null;
      if (otra !== null) await page.locator(`${RELEASE_NOTES_PANE} nav button`).filter({ hasText: otra }).first().click();
      await page.waitForTimeout(CONFIG.settleMs);
      const trasElegir = await measureReleaseNotes(page);
      const cerrado = await closeReleaseNotesTab(page);
      const ok =
        modales === 0 &&
        alAbrir.pestañas === 1 &&
        alAbrir.activa &&
        alAbrir.prompts === 0 &&
        alAbrir.titulo === `Mage ${APP_VERSION}` &&
        alAbrir.versiones.length >= 3 &&
        alAbrir.marcada === APP_VERSION &&
        otra !== null &&
        trasElegir.titulo === `Mage ${otra}` &&
        cerrado.paneles === 0 &&
        cerrado.pestañas === 0;
      return { ok, detail: JSON.stringify({ modales, alAbrir, otra, trasElegir: trasElegir.titulo, cerrado }) };
    },
  },
  {
    // Grupo F: la apertura AUTOMATICA, que es el camino real. Se simula una actualizacion desde la 0.1.0
    // guardando esa version como la ultima vista y recargando el renderer (el arranque vuelve a decidir).
    // Se exige que la pestaña este abierta al montar, sin prompt, en la version instalada, y que EN DISCO
    // (no en la UI) ya diga la version actual. La cierra al acabar.
    name: 'Grupo F: tras actualizar desde 0.1.0 se abren solas las novedades y se guarda la versión',
    async run(page, { userDataDir }) {
      await page.evaluate(async () => {
        const { settings } = window.__mageDev.store.getState();
        await window.mage.saveSettings({ ...settings, lastSeenReleaseNotesVersion: '0.1.0' });
      });
      await page.reload();
      await page.locator('[role="toolbar"]').first().waitFor({ state: 'attached', timeout: CONFIG.bootTimeoutMs });
      const aparecio = await page
        .locator(RELEASE_NOTES_PANE)
        .waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs })
        .then(() => true)
        .catch(() => false);
      const medido = await measureReleaseNotes(page);
      const file = path.join(userDataDir, 'app-settings.json');
      const enDisco = await waitForFile(file, (text) => JSON.parse(text).lastSeenReleaseNotesVersion === APP_VERSION);
      const guardada = enDisco === null ? null : JSON.parse(enDisco).lastSeenReleaseNotesVersion;
      const cerrado = await closeReleaseNotesTab(page);
      const ok =
        aparecio &&
        medido.pestañas === 1 &&
        medido.activa &&
        medido.prompts === 0 &&
        medido.titulo === `Mage ${APP_VERSION}` &&
        guardada === APP_VERSION &&
        cerrado.paneles === 0;
      return { ok, detail: JSON.stringify({ aparecio, ...medido, guardadaEnDisco: guardada, cerrado }) };
    },
  },
  {
    // Grupo F (0.1.2): un enlace del chat (o de las notas de version) tiene `target="_blank"`, y sin
    // `setWindowOpenHandler` Electron abria con el una BrowserWindow propia en vez del navegador. Se
    // clica un enlace `http://` a un puerto cerrado: main solo abre https en el navegador, asi que la
    // medida es limpia (no abre nada fuera) y lo que se afirma es que NO nace otra ventana. El camino
    // https -> navegador lo cubre el test de `externalLinks`. Autosuficiente: abre su pestaña y la cierra.
    name: 'Grupo F: clic en un enlace externo no abre otra ventana de Mage',
    async run(page) {
      await openTemporaryConversation(page);
      const bloques = await hydrateFromEntries(page, [
        {
          index: 0,
          uuid: 'vg-enlace-0',
          parentUuid: null,
          isSidechain: false,
          isMeta: false,
          timestampMs: Date.now(),
          category: 'turn',
          kind: 'user',
          summary: '',
          tokenUsage: null,
          raw: { message: { content: `Mira [el enlace de prueba](${EXTERNAL_LINK_PROBE_URL}).` } },
        },
      ]);
      const enlace = page.locator(`[data-block="user"] a[href="${EXTERNAL_LINK_PROBE_URL}"]`);
      const enlaces = await enlace.count();
      const antes = countMainPages(page);
      const paginasAntes = new Set(allPages(page));
      if (enlaces === 1) await enlace.click();
      await page.waitForTimeout(EXTERNAL_LINK_WAIT_MS);
      const despues = countMainPages(page);
      const nuevas = await closeNewPages(page, paginasAntes);
      await page.evaluate(() => {
        const state = window.__mageDev.store.getState();
        return state.closeTab(state.activeTabId);
      });
      const ok = bloques === 1 && enlaces === 1 && despues === antes && nuevas.length === 0;
      return { ok, detail: JSON.stringify({ bloques, enlaces, ventanasAntes: antes, ventanasDespues: despues, ventanasNuevas: nuevas }) };
    },
  },
  {
    // Grupo B (0.1.2, respuesta 21): la X de la ultima ventana, con «Preguntar», pinta el dialogo PROPIO
    // (no el de Windows) y dice cuantas conversaciones trabajan. Se provoca con `window.close()` (entra
    // por el mismo `close` que la X) y se contesta SIEMPRE Cancelar o Escape: «Cerrar Mage» mataria la
    // instancia medida. Tres rondas: con una conversacion marcada como trabajando (cuenta 1 mas), con
    // Escape, y tras RECARGAR el renderer con el dialogo abierto —la trampa del informe: si main no
    // libera la pregunta pendiente, la X queda muerta para siempre—. Sin dos ventanas: con otra visible,
    // `window.close()` cerraria de verdad esta.
    name: 'Grupo B: la X pregunta con el diálogo propio, cuenta las que trabajan y sobrevive a una recarga',
    async run(page) {
      const previo = await page.evaluate(() => window.__mageDev.store.getState().settings.closeBehavior);
      const ventanas = countMainPages(page);
      if (previo !== 'ask' || ventanas !== 1) {
        return { ok: false, detail: `No se provoca el cierre (cerraria de verdad): closeBehavior=${previo}, ventanas=${ventanas}` };
      }
      await openTemporaryConversation(page);
      const esperado = await page.evaluate(() => {
        const store = window.__mageDev.store;
        const tabId = store.getState().activeTabId;
        store.setState((s) => ({ statusByChat: { ...s.statusByChat, [tabId]: 'streaming' } }));
        const s = store.getState();
        const pestañas = s.tabs.filter((t) => ['streaming', 'needs_permission'].includes(s.statusByChat[t.id])).length;
        return pestañas + Object.values(s.backgroundSessions).filter((b) => b.state !== 'done').length;
      });
      const conTrabajo = await askCloseAndAnswer(page, 'Cancelar');
      await page.evaluate(() => {
        const store = window.__mageDev.store;
        const tabId = store.getState().activeTabId;
        store.setState((s) => ({ statusByChat: { ...s.statusByChat, [tabId]: 'idle' } }));
        return store.getState().closeTab(tabId);
      });
      const conEscape = await askCloseAndAnswer(page, 'Escape');
      // Recarga con el dialogo abierto: el renderer que tenia que contestar desaparece.
      await page.evaluate(() => window.close());
      await page.locator(CLOSE_DIALOG).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      await page.reload();
      await page.locator('[role="toolbar"]').first().waitFor({ state: 'attached', timeout: CONFIG.bootTimeoutMs });
      const trasRecargar = await askCloseAndAnswer(page, 'Cancelar');
      const viva = !page.isClosed() && countMainPages(page) === 1;
      const ok =
        esperado >= 1 &&
        conTrabajo.aparecio &&
        conTrabajo.trabajando === esperado &&
        conTrabajo.botones.join('|') === 'Cancelar|Cerrar Mage|Mantener en segundo plano' &&
        conTrabajo.enfocado === 'Mantener en segundo plano' &&
        conTrabajo.recordar &&
        conTrabajo.cerrado &&
        conEscape.aparecio &&
        conEscape.trabajando === esperado - 1 &&
        conEscape.cerrado &&
        trasRecargar.aparecio &&
        trasRecargar.cerrado &&
        viva;
      return { ok, detail: JSON.stringify({ esperado, conTrabajo, conEscape, trasRecargar, viva }) };
    },
  },
  {
    // Grupo B: actualizacion lista. En dev no hay updater (no esta empaquetada), asi que se inyecta en el
    // store el estado que difundiria main y se mide lo que ve el usuario: dialogo con las notas de la
    // version que llega, indicador en la barra de estado, «Más tarde» cierra el dialogo y el indicador
    // SE QUEDA, y pulsarlo lo reabre. Se comprueba ademas la guarda de main: sin actualizacion descargada,
    // `installUpdate` rechaza (en dev el estado de main es idle) — no reinicia nada. Nunca se pulsa
    // «Reiniciar ahora». El camino real (servidor `generic` local) lo documenta scripts/update-test.mjs.
    name: 'Grupo B: actualización lista: diálogo con sus notas, «Más tarde» y el indicador se queda',
    async run(page) {
      const principal = await page.evaluate(() => window.mage.getUpdateState());
      const guarda = await page.evaluate(() =>
        window.mage.installUpdate().then(
          () => 'instalo',
          (err) => String(err?.message ?? err),
        ),
      );
      await page.evaluate((notes) => {
        window.__mageDev.store.setState({
          updateState: { kind: 'ready', version: '9.9.9', releaseNotes: notes },
          updatePromptVersion: '9.9.9',
        });
      }, UPDATE_PROBE_NOTES);
      const dialogo = page.locator(UPDATE_DIALOG);
      await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const alAbrir = await dialogo.evaluate((node) => ({
        titulo: node.querySelector('#update-ready-title')?.textContent ?? null,
        notas: [...node.querySelectorAll('[data-update-notes] li')].map((li) => li.textContent),
        enfocado: node.ownerDocument.activeElement?.textContent ?? null,
      }));
      // La captura, con la animacion de entrada ya terminada (es para el vistazo humano).
      await page.waitForTimeout(MODAL_ENTER_MS);
      await page.screenshot({ path: path.join(CONFIG.outDir, 'grupo-b-actualizacion.png') });
      await dialogo.getByRole('button', { name: 'Más tarde', exact: true }).click();
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const indicador = page.locator(UPDATE_INDICATOR);
      const trasMasTarde = { indicador: await indicador.count(), texto: (await indicador.textContent().catch(() => null))?.trim() ?? null };
      await indicador.click();
      const reabre = await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs }).then(() => true, () => false);
      await page.keyboard.press('Escape');
      await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      await page.evaluate(() => window.__mageDev.store.setState({ updateState: { kind: 'idle' }, updatePromptVersion: null }));
      const alLimpiar = await indicador.count();
      const ok =
        principal.kind === 'idle' &&
        /idle/.test(guarda) &&
        alAbrir.titulo === 'Mage 9.9.9 está lista para instalarse' &&
        alAbrir.notas.includes('Nota de prueba de verify:gui') &&
        alAbrir.enfocado === 'Reiniciar ahora' &&
        trasMasTarde.indicador === 1 &&
        trasMasTarde.texto === '9.9.9 lista · Reiniciar' &&
        reabre &&
        alLimpiar === 0;
      return { ok, detail: JSON.stringify({ principal, guarda, alAbrir, trasMasTarde, reabre, alLimpiar }) };
    },
  },
  {
    // Integracion 0.1.2: cerrar la pestaña de un worktree con cambios lo conserva, y antes no se veia en
    // ningun sitio (solo el log). El aviso va a la barra de estado: no bloquea, dice el motivo y la ruta,
    // y cabe sin estirar la barra aunque la ruta sea larga. Se inyecta el estado que deja `closeTab` (el
    // cableado lo cubre el test del store) y se descarta con su ✕.
    name: 'Worktree conservado al cerrar: aviso en la barra de estado con la ruta, descartable',
    async run(page) {
      const ruta = 'C:\\proyectos\\un-repo-con-un-nombre-largo\\.claude\\worktrees\\arreglar-el-cierre-de-pestanas-con-cambios';
      await page.evaluate((path) => window.__mageDev.store.setState({ keptWorktreeNotice: { path, reason: 'dirty' } }), ruta);
      const aviso = page.locator('[data-kept-worktree-notice="true"]');
      await aviso.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
      const medido = await aviso.evaluate((node) => {
        const barra = node.parentElement.getBoundingClientRect();
        const caja = node.getBoundingClientRect();
        return { texto: node.textContent, rol: node.getAttribute('role'), altoBarra: barra.height, dentro: caja.right <= barra.right + 0.5 && caja.bottom <= barra.bottom + 0.5, titulo: node.querySelector('[title]')?.getAttribute('title') ?? null };
      });
      await aviso.getByRole('button', { name: 'Descartar el aviso del worktree conservado' }).click();
      await aviso.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
      const trasDescartar = await page.evaluate(() => window.__mageDev.store.getState().keptWorktreeNotice);
      const ok =
        medido.rol === 'status' &&
        medido.texto.includes('Worktree conservado (tiene cambios sin confirmar)') &&
        medido.titulo === ruta &&
        medido.altoBarra === 26 &&
        medido.dentro &&
        trasDescartar === null;
      return { ok, detail: JSON.stringify({ ...medido, trasDescartar }) };
    },
  },
  {
    // P-032 R3: una pestaña de un proveedor del usuario va por el RUNTIME PROPIO, que ofrece los cinco
    // modos de Mage (con su Auto a lo Codex) y los rota con Shift+Tab. Sin Enter: no envia nada (el unico
    // turno de la ejecucion es la ultima comprobacion). Abre su pestaña y la cierra, y borra su proveedor.
    name: 'Runtime propio: una pestaña de un proveedor del usuario ofrece los 5 modos y Shift+Tab los rota',
    async run(page) {
      const previo = await page.evaluate(() => window.__mageDev.store.getState().activeTabId);
      await page.evaluate(async ({ provider }) => {
        const state = window.__mageDev.store.getState();
        await state.saveCustomProvider({ id: provider.id, label: provider.label, baseUrl: 'http://127.0.0.1:9/v1', hasApiKey: false, models: [{ id: 'fake:eco', label: 'fake:eco' }] });
        const cwd = await window.mage.getScratchDir();
        await state.newTab({ accountId: state.activeAccountId, cwd, model: 'fake:eco', provider: provider.id, title: 'VG runtime modos', privacy: 'shared' });
      }, { provider: RUNTIME_MODES_PROVIDER });
      const tab = await activeTurnTab(page);
      try {
        if (tab === null || tab.provider !== RUNTIME_MODES_PROVIDER.id) return { ok: false, detail: `pestaña activa inesperada: ${JSON.stringify(tab)}` };
        const chip = page.locator('button[aria-label^="Modo de permiso:"]').first();
        await chip.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        await chip.click();
        const popover = page.locator('[data-step-slider-popover="true"]');
        await popover.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
        const pasos = await popover.locator('input[type="range"]').evaluate((el) => Number(el.max) + 1);
        await page.keyboard.press('Escape');
        await popover.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
        const antes = await permissionModeLabel(page);
        await clearPrompt(page);
        await page.getByRole('textbox', { name: 'Escribe una instrucción para el agente' }).press('Shift+Tab');
        await page.waitForFunction((label) => !(document.querySelector('button[aria-label^="Modo de permiso:"]')?.getAttribute('aria-label') ?? '').endsWith(label), antes, { timeout: CONFIG.actionTimeoutMs });
        const despues = await permissionModeLabel(page);
        const modo = await page.evaluate((id) => window.__mageDev.store.getState().tabs.find((t) => t.id === id)?.permissionMode ?? null, tab.id);
        const ok = pasos === 5 && antes === 'Manual' && despues !== antes && modo === 'acceptEdits';
        return { ok, detail: JSON.stringify({ pasos, antes, despues, modo }) };
      } finally {
        if (tab !== null) await page.evaluate((id) => window.__mageDev.store.getState().closeTab(id), tab.id);
        await page.evaluate((id) => window.__mageDev.store.getState().removeCustomProvider(id), RUNTIME_MODES_PROVIDER.id);
        if (previo !== '') await page.evaluate((id) => window.__mageDev.store.getState().setActiveTab(id), previo);
      }
    },
  },
  {
    // Grupo 0 (0.1.2, ficha D11 de P-032): UN turno minimo de verdad, de punta a punta — teclear, Enter,
    // proceso del CLI, respuesta pintada. Es la unica comprobacion que envia: todas las demas miden sin
    // gastar. Contra Claude con el modelo y el esfuerzo mas bajos; si la cuenta lleva gastado mas del
    // 70 %, la guarda de uso pregunta (o, sin terminal, elige el servidor falso y lo dice aqui).
    // Antes de pulsar Enter se AFIRMA el proveedor y el modelo de la pestaña activa: si no son los
    // esperados, no se envia nada. La ULTIMA de la lista a proposito: deja un proceso y una transcripcion
    // que no deben medir las demas; cierra su pestaña y, en local, borra su proveedor.
    name: 'Grupo 0: turno mínimo de verdad (Claude, o servidor falso si la guarda de uso lo pide)',
    async run(page, { userDataDir }) {
      const decision = await chooseTurnTarget(page);
      const fake = decision.target === 'local' ? await startFakeOpenAiServer() : null;
      try {
        const expected = await openTurnTab(page, { target: decision.target, fake, userDataDir });
        const outcome = await sendMinimalTurn(page, expected);
        if (outcome.tab !== null) await page.evaluate((tabId) => window.__mageDev.store.getState().closeTab(tabId), outcome.tab.id);
        const viaFake =
          fake === null || (fake.stats.completions === 2 && outcome.tools.includes('Read') && outcome.agentText.includes(FAKE_TURN_FINAL_TEXT));
        // P-032 R4: la conversacion del runtime se reabre desde el historial con su Read y su texto (sin
        // enviar nada: la hidratacion sale de la transcripcion de userData/runtime).
        const reabierta = fake !== null && outcome.sent ? await reopenTurnFromHistory(page, outcome.tab) : null;
        const reabiertaOk = reabierta === null || (reabierta.tools.includes('Read') && reabierta.agentText.includes(FAKE_TURN_FINAL_TEXT));
        const ok = outcome.sent && outcome.status === 'idle' && outcome.agentText.trim().length > 0 && outcome.errors.length === 0 && viaFake && reabiertaOk;
        const detail = {
          modo: decision.target,
          motivo: decision.reason,
          ...(decision.usageError === null ? {} : { errorDeUso: decision.usageError }),
          pestaña: outcome.tab,
          enviado: outcome.sent,
          estado: outcome.status,
          respuesta: outcome.agentText.slice(0, 120),
          errores: outcome.errors,
          bloques: outcome.kinds,
          ms: outcome.ms,
          ...(fake === null ? {} : { peticionesAlFalso: fake.stats.completions, conStream: fake.stats.streamed, herramientas: outcome.tools, reabierta }),
        };
        return { ok, detail: JSON.stringify(detail) };
      } finally {
        if (fake !== null) {
          await page.evaluate((id) => window.__mageDev.store.getState().removeCustomProvider(id), FAKE_TURN_PROVIDER.id);
          await fake.close();
        }
      }
    },
  },
];

// Ventanas PRINCIPALES abiertas ahora mismo (ni widget ni debug).
function countMainPages(page) {
  return page
    .context()
    .browser()
    .contexts()
    .flatMap((context) => context.pages())
    .filter((candidate) => {
      const url = candidate.url();
      return !url.includes('widget.html') && !url.includes('debug.html') && !url.startsWith('devtools://');
    }).length;
}

// --- Grupo B: dialogos propios de cierre y de actualizacion ----------------------------------------

// Anclas `data-*` de CloseMageDialog.tsx, UpdateReadyDialog.tsx y StatusBar.tsx.
const CLOSE_DIALOG = '[data-close-mage-dialog="true"]';
const UPDATE_DIALOG = '[data-update-ready-dialog="true"]';
const UPDATE_INDICATOR = '[data-update-indicator="true"]';
// Notas de la actualizacion inyectada: Markdown como el que trae `latest.yml`.
// Lo que dura la entrada de un modal (MODAL_PANEL_VARIANTS de motionPresets.ts: 200 ms) con margen.
const MODAL_ENTER_MS = 300;
const UPDATE_PROBE_NOTES = '### Añadido\n- Nota de prueba de verify:gui\n- Otra nota';

// Provoca el cierre de la ventana (el mismo `close` que la X), mide el dialogo propio y lo contesta con
// `how` ('Cancelar' o 'Escape': nunca «Cerrar Mage»). Espera al DESMONTAJE (error n.º 6 de la skill).
async function askCloseAndAnswer(page, how) {
  await page.evaluate(() => window.close());
  const dialogo = page.locator(CLOSE_DIALOG);
  const aparecio = await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs }).then(
    () => true,
    () => false,
  );
  if (!aparecio) return { aparecio };
  await page.waitForTimeout(MODAL_ENTER_MS);
  const medido = await dialogo.evaluate((node) => ({
    trabajando: Number(node.querySelector('[data-close-working]')?.getAttribute('data-close-working') ?? 0),
    botones: [...node.querySelectorAll('button')].map((button) => (button.textContent ?? '').trim()),
    enfocado: (node.ownerDocument.activeElement?.textContent ?? '').trim() || null,
    recordar: node.querySelector('input[type="checkbox"]') !== null,
  }));
  await page.screenshot({ path: path.join(CONFIG.outDir, `grupo-b-cierre-${how.toLowerCase()}.png`) });
  if (how === 'Escape') await page.keyboard.press('Escape');
  else await dialogo.getByRole('button', { name: how, exact: true }).click();
  const cerrado = await dialogo.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs }).then(
    () => true,
    () => false,
  );
  return { aparecio, ...medido, cerrado };
}

// Panel de la pseudo-pestaña de novedades (ancla `data-release-notes` de ReleaseNotesPane.tsx).
const RELEASE_NOTES_PANE = '[data-release-notes]';
const RELEASE_NOTES_TAB = '[role="tab"][data-tab-id="mage:novedades"]';

// Lo que enseña la pestaña de novedades: cuantas hay, si es la seleccionada, prompts montados en su
// panel (0: no es una conversacion), el titulo de la version y el menu lateral.
function measureReleaseNotes(page) {
  return page.evaluate(
    ({ pane, tab }) => {
      const panel = document.querySelector(pane);
      const island = panel?.closest('[data-workspace="pane"]') ?? null;
      const nav = panel?.querySelector('nav[aria-label="Versiones de Mage"]') ?? null;
      const buttons = nav === null ? [] : [...nav.querySelectorAll('button')];
      const versionOf = (button) => button.querySelector('span')?.textContent?.trim() ?? '';
      return {
        pestañas: document.querySelectorAll(tab).length,
        activa: document.querySelector(tab)?.getAttribute('aria-selected') === 'true',
        prompts: island === null ? -1 : island.querySelectorAll('.cm-editor, textarea').length,
        titulo: panel?.querySelector('h2')?.textContent?.trim() ?? null,
        versiones: buttons.map(versionOf),
        marcada: buttons.filter((button) => button.getAttribute('aria-current') === 'page').map(versionOf)[0] ?? null,
      };
    },
    { pane: RELEASE_NOTES_PANE, tab: RELEASE_NOTES_TAB },
  );
}

// Cierra la pestaña de novedades con su ✕ y espera al DESMONTAJE del panel.
async function closeReleaseNotesTab(page) {
  const close = page.getByRole('button', { name: 'Cerrar pestaña Novedades', exact: true });
  if ((await close.count()) === 1) await close.click();
  await page.locator(RELEASE_NOTES_PANE).waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs }).catch(() => undefined);
  return { paneles: await page.locator(RELEASE_NOTES_PANE).count(), pestañas: await page.locator(RELEASE_NOTES_TAB).count() };
}

// Enlace de la comprobacion de enlaces externos: http (no https) a un puerto cerrado, para que ni la
// app arreglada abra nada fuera ni la rota cargue nada dentro.
const EXTERNAL_LINK_PROBE_URL = 'http://127.0.0.1:9/vg-enlace';
// Lo que se deja a Electron para crear la ventana del `window.open` antes de contar.
const EXTERNAL_LINK_WAIT_MS = 1500;

// Todas las paginas que ve CDP ahora mismo.
function allPages(page) {
  return page
    .context()
    .browser()
    .contexts()
    .flatMap((context) => context.pages());
}

// Cierra las paginas que no estaban en `before` (la que crearia un `target="_blank"` sin manejador) y
// devuelve sus URL. Es limpieza de la comprobacion: con el fallo presente no puede quedarse la ventana.
async function closeNewPages(page, before) {
  const fresh = allPages(page).filter((candidate) => !before.has(candidate));
  const urls = fresh.map((candidate) => candidate.url());
  for (const candidate of fresh) await candidate.close().catch(() => undefined);
  return urls;
}

// Ventanas del widget abiertas ahora mismo (widget.html es su propia entrada del build).
function countWidgetPages(page) {
  return page
    .context()
    .browser()
    .contexts()
    .flatMap((context) => context.pages())
    .filter((candidate) => candidate.url().includes('widget.html')).length;
}

// Espera a que el numero de ventanas del widget llegue al esperado. El ciclo de vida de la ventana lo
// decide el proceso MAIN tras un IPC, asi que no basta con mirar justo despues del clic.
async function waitForWidgetPages(page, expected) {
  const deadline = Date.now() + CONFIG.actionTimeoutMs;
  while (Date.now() < deadline) {
    if (countWidgetPages(page) === expected) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

// Areas de prompt montadas ahora mismo: 1 normalmente, 2 con el workspace dividido. Desde 2.7 el
// prompt es un editor de CodeMirror (contenteditable), no un <textarea>: el ancla sigue siendo el
// nombre accesible, pero el texto se lee/escribe distinto (ver `promptText`/`typeInPrompt`).
function promptAreas(page) {
  return page.getByRole('textbox', { name: 'Escribe una instrucción para el agente' });
}

// Texto ACTUAL del editor, leido del DOM de CodeMirror. Cada linea es un `.cm-line`, asi que hay que
// unirlas con `\n` a mano: el `textContent` del contenedor las pegaria sin salto y "- uno\n- dos"
// pasaria por "- uno- dos".
function promptText(page) {
  return page.evaluate(() => {
    const editor = document.querySelector('[data-prompt-editor="true"] .cm-content');
    if (editor === null) return null;
    return [...editor.querySelectorAll('.cm-line')]
      .map((line) => {
        // El placeholder vive DENTRO de la linea: sin quitarlo, un editor vacio se leeria como
        // "Escribe una instrucción…" y una comprobacion de "quedo vacio" pasaria en verde por el texto
        // equivocado.
        const clone = line.cloneNode(true);
        for (const node of clone.querySelectorAll('.cm-placeholder')) node.remove();
        return clone.textContent ?? '';
      })
      .join('\n');
  });
}

// Escribe en el editor sin pulsar Enter jamas. `click` para enfocar y `type` para que pase por el
// mismo camino de teclado que usaria una persona (que es justo lo que hay que medir del puente).
// Retardo entre teclas al escribir en el prompt. NO es cosmetico: el input es un `contenteditable`
// controlado por React, y con el 0 ms que pone Playwright por defecto las teclas entran mas rapido de
// lo que el componente confirma su estado — el cursor salta y el texto sale entremezclado ("holao",
// "ie- unnoe"). Con eso las dos comprobaciones del input rico salian verdes o rojas segun la pasada, y
// un intermitente en el harness es peor que una comprobacion de menos (error #6 de la skill). Nadie
// teclea a 0 ms: esto acerca la medida a un humano, no la maquilla.
const PROMPT_TYPE_DELAY_MS = 25;

async function typeInPrompt(page, text) {
  const prompt = promptAreas(page).first();
  await prompt.click();
  await page.keyboard.type(text, { delay: PROMPT_TYPE_DELAY_MS });
  await page.waitForTimeout(CONFIG.settleMs);
}

// Vacia el editor por teclado (Ctrl+A + Backspace): no hay `fill` en un contenteditable.
// Seccion "Carpetas de confianza" de Configuracion: mete una carpeta en los ajustes, comprueba que
// aparece listada y que "Retirar" la quita. Deja los ajustes como estaban.
async function medirSeccionDeConfianza(page, folder) {
  const previo = await page.evaluate(() => window.__mageDev.store.getState().settings.trustedFolders);
  await page.evaluate((f) => {
    const dev = window.__mageDev;
    dev.store.setState((s) => ({ settings: { ...s.settings, trustedFolders: [f] } }));
    dev.store.getState().openSettings();
  }, folder);
  await page.waitForTimeout(CONFIG.settleMs);
  await page.getByRole('tab', { name: /Carpetas de confianza/ }).click();
  await page.waitForTimeout(CONFIG.settleMs);

  const listada = await page.getByTitle(folder).isVisible().catch(() => false);
  if (listada) {
    await page.getByRole('button', { name: `Retirar la confianza de ${folder}` }).click();
    await page.waitForTimeout(CONFIG.settleMs);
  }
  const trasRetirar = await page.evaluate(() => window.__mageDev.store.getState().settings.trustedFolders.length);

  await page.evaluate((trustedFolders) => {
    const dev = window.__mageDev;
    dev.store.setState((s) => ({ settings: { ...s.settings, trustedFolders } }));
    dev.store.getState().closeSettings();
  }, previo);
  await page.waitForTimeout(CONFIG.settleMs);
  return { listada, trasRetirar };
}

async function clearPrompt(page) {
  const prompt = promptAreas(page).first();
  await prompt.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(CONFIG.settleMs);
}

// Etiqueta de la pestaña SELECCIONADA dentro de un tablist concreto. Se lee con `textContent` igual que
// `focusedTabLabel`: con `innerText` la misma pestaña daba "id\n✕" y aqui "id✕", y las dos se comparan
// entre si.
async function selectedTabLabel(tablist) {
  const selected = tablist.locator('[role="tab"][aria-selected="true"]');
  if ((await selected.count()) !== 1) return '';
  return selected.evaluate((node) => node.textContent?.trim() ?? '');
}

// --- Seccion "Notificaciones" ---------------------------------------------------------------------

// Reglas guardadas: se cuenta el campo de patron, que existe una vez por regla.
function notificationRuleRows(page) {
  return page.getByRole('textbox', { name: 'Patrón (expresión regular)' });
}

// Motivo del rechazo de la ULTIMA regla, o null si su patron compila.
async function patternErrorText(page) {
  const alerts = page.locator('[id^="rule-pattern-error-"]');
  return (await alerts.count()) === 0 ? null : (await alerts.last().innerText()).trim();
}

// Veredicto del banco de pruebas ("✓ notificaría" / "✗ no casa") para un texto dado. Se ancla al input de
// prueba y se sube a su contenedor: un `[role=status]` suelto casaria con el chip de la PromptBar.
async function probeVerdict(page, sample) {
  await page.getByRole('textbox', { name: 'Texto de prueba para este patrón' }).last().fill(sample);
  await page.waitForTimeout(CONFIG.settleMs);
  return page.evaluate(() => {
    const inputs = [...document.querySelectorAll('[aria-label="Texto de prueba para este patrón"]')];
    const probe = inputs[inputs.length - 1];
    return probe?.parentElement?.querySelector('[role="status"]')?.textContent?.trim() ?? null;
  });
}

// --- Dock, prompt y dropdowns ---------------------------------------------------------------------

// `aria-valuenow` de un separador, ya como numero (o null si no lo lleva).
async function separatorValue(handle) {
  const raw = await handle.getAttribute('aria-valuenow');
  const value = Number(raw);
  return raw === null || !Number.isFinite(value) ? null : value;
}

// Modo de permiso que declara el chip de la PromptBar ("Manual", "Aceptar ediciones", "Plan", "Auto", "Omitir permisos").
async function permissionModeLabel(page) {
  const chip = page.locator('[aria-label^="Modo de permiso:"]').first();
  return ((await chip.getAttribute('aria-label')) ?? '').replace('Modo de permiso:', '').trim();
}

// Nombres ("/mcp") de las sugerencias abiertas ahora mismo en el popover de comandos. Se lee el PRIMER
// hijo, no el textContent: nombre y descripcion son dos spans hermanos sin espacio entre ellos, asi que
// partir por espacios devolvia "/mcpServidores".
async function slashOptionNames(page) {
  return page
    .getByRole('listbox', { name: 'Comandos disponibles' })
    .getByRole('option')
    .evaluateAll((nodes) => nodes.map((node) => node.firstElementChild?.textContent?.trim() ?? ''));
}

// Descripcion corta de donde esta el foco: etiqueta util + si cae dentro del modal abierto.
async function focusLocation(page) {
  return page.evaluate((modal) => {
    const active = document.activeElement;
    if (active === null || active === document.body) return 'body (fuera de todo)';
    const name = active.getAttribute('aria-label') ?? active.tagName.toLowerCase();
    const inside = document.querySelector(modal)?.contains(active) === true;
    return `${name} (${inside ? 'dentro' : 'fuera'} del modal)`;
  }, MODAL);
}

// Abre un Dropdown propio por su aria-label, elige la primera opcion que case y devuelve su texto (null si
// ninguna casa: el menu se cierra con Escape para no dejar un popover abierto).
async function pickDropdownOption(page, ariaLabel, pattern) {
  await page.getByRole('button', { name: ariaLabel }).click();
  const listbox = page.getByRole('listbox', { name: ariaLabel });
  await listbox.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
  const labels = await listbox.getByRole('option').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  const match = labels.find((label) => pattern.test(label));
  if (match === undefined) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(CONFIG.settleMs);
    return null;
  }
  await listbox.getByRole('option', { name: match, exact: true }).first().click();
  return match;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Etiqueta de la pestaña que tiene el foco ('' si el foco no esta en una).
async function focusedTabLabel(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active.getAttribute('role') !== 'tab') return '';
    return active.textContent?.trim() ?? '';
  });
}

// Abre una seccion de Configuracion por su etiqueta. Extraido porque lo usan cuatro comprobaciones.
// Grupo E, fase 2: el editor de carpetas extra del perfil de agy (Ajustes › Proveedores y modelos).
async function measureAgyProfileLinks(page, userDataDir) {
  await openSection(page, /Proveedores y modelos/);
  const editor = page.locator('[data-agy-profile-links="true"]');
  await editor.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs }).catch(() => undefined);
  if ((await editor.count()) !== 1) return { ok: false, detail: `editores de carpetas de agy=${await editor.count()} (¿agy no instalado?)` };
  const ajustes = path.join(userDataDir, 'app-settings.json');
  const campo = editor.getByRole('textbox', { name: 'Carpeta extra para el perfil de agy' });
  await campo.fill('../fuera');
  await editor.getByRole('button', { name: 'Enlazar', exact: true }).click();
  const error = await editor.getByRole('alert').count();
  await campo.fill(AGY_VG_LINK);
  await editor.getByRole('button', { name: 'Enlazar', exact: true }).click();
  const guardada = await waitForFile(ajustes, (t) => (JSON.parse(t).agyLinkedPaths ?? []).includes(AGY_VG_LINK));
  await editor.getByRole('button', { name: `Dejar de enlazar ${AGY_VG_LINK}`, exact: true }).click();
  const quitada = await waitForFile(ajustes, (t) => !(JSON.parse(t).agyLinkedPaths ?? []).includes(AGY_VG_LINK));
  const ok = error === 1 && guardada !== null && quitada !== null;
  return { ok, detail: `error con ../fuera=${error} guardada=${guardada !== null} quitada=${quitada !== null}` };
}

async function openSection(page, namePattern) {
  await page.getByRole('tab', { name: namePattern }).click();
  await page.waitForTimeout(150);
}

// Estado del paso "motor" del asistente, ya resuelto (el sondeo del CLI es asincrono). Devuelve si se
// detecto instalado o si, no estandolo, se ofrece el comando de instalacion.
async function waitForEngineStatus(page) {
  const deadline = Date.now() + CONFIG.actionTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const caja = document.querySelector('[data-onboarding="engine-status"]');
      if (caja === null) return null;
      const texto = caja.textContent ?? '';
      return {
        comprobando: texto.includes('Comprobando'),
        instalado: texto.includes('Instalado y listo'),
        conComando: caja.querySelector('code') !== null && document.querySelector('[data-onboarding="recheck"]') !== null,
      };
    });
    if (last !== null && !last.comprobando) return last;
    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }
  return last;
}

// Avisos de terceros ya pintados en «Acerca de». Se sondea porque el texto llega por IPC (main lee el
// fichero del asar), no con el primer render.
async function waitForNotices(page) {
  const deadline = Date.now() + CONFIG.actionTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const pre = document.querySelector('[data-about="notices"]');
      if (pre === null) return null;
      const texto = pre.textContent ?? '';
      const cabecera = /Paquetes: (\d+)/.exec(texto);
      return {
        caracteres: texto.length,
        paquetes: cabecera === null ? 0 : Number(cabecera[1]),
        conClausulaMit: texto.includes('Permission is hereby granted'),
        conCopyright: texto.includes('Copyright'),
        versiones: /Electron \d/.test(document.querySelector('[role="tabpanel"]')?.textContent ?? ''),
      };
    });
    if (last !== null && last.paquetes > 0) return last;
    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }
  return last;
}

// Abre Configuracion (Ctrl+,) y espera su dialogo. Lo usan las comprobaciones que llegan sin ningun
// dialogo abierto y necesitan el suyo.
async function openSettingsDialog(page) {
  await page.keyboard.press('Control+Comma');
  await page.locator(MODAL).first().waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
}

// Cierra con Escape el dialogo abierto y devuelve cuantos quedan (0 esperado). Espera al DESMONTAJE, no
// a un tiempo fijo: la animacion de salida tarda lo que tarde el hilo de render (con 2.7 el panel monta
// un editor de CodeMirror, y un `waitForTimeout` empezo a quedarse corto).
async function closeDialog(page) {
  await page.keyboard.press('Escape');
  return waitForModalsGone(page);
}

// Espera a que no quede ningun modal montado y devuelve cuantos quedan. Nunca lanza: el numero es la
// MEDIDA que la comprobacion afirma, asi que un fallo tiene que salir como "quedan 1", no como timeout.
async function waitForModalsGone(page) {
  const modals = page.locator(MODAL);
  await modals.first().waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs }).catch(() => {});
  return modals.count();
}

// --- E2: seccion "Proveedores" -------------------------------------------------------------------

// Proveedor de la comprobacion de la boveda (grupo 0). La clave es un CENTINELA: si aparece en el
// renderer o en claro en disco, la comprobacion lo canta. La URL no se consulta de verdad (el sondeo
// falla y la ficha lo dice, que aqui da igual). El texto del aviso repite SAVED_API_KEY_PLACEHOLDER de
// ProvidersSection.tsx, como el resto de anclas de este fichero.
const SECRET_PROVIDER = { label: 'VG boveda', baseUrl: 'http://127.0.0.1:9/v1', key: 'sk-vg-centinela-que-no-debe-verse' };
const SAVED_API_KEY_PLACEHOLDER = 'Clave guardada y cifrada · escribe otra para sustituirla';

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

// Espera a que un fichero del perfil cumpla `predicate` (los ajustes se guardan con debounce, la boveda
// al momento) y devuelve su texto, o el ultimo leido si no llega a cumplirlo.
async function waitForFile(file, predicate) {
  const deadline = Date.now() + CONFIG.actionTimeoutMs;
  let text = readIfExists(file);
  while (Date.now() < deadline && (text === null || !predicate(text))) {
    await new Promise((resolve) => setTimeout(resolve, CONFIG.pollIntervalMs));
    text = readIfExists(file);
  }
  return text;
}

// Filas de proveedor GUARDADAS. Se ancla al boton de borrar (`aria-label` explicito): un contador de
// divs de la seccion incluiria el formulario y los textos de ayuda.
function providerRows(page) {
  return page.locator('[aria-label^="Eliminar el proveedor "]');
}

// Valores que tiene ahora mismo el formulario de alta (para comprobar que una plantilla PRERRELLENA).
async function readProviderForm(page) {
  return {
    label: await page.getByRole('textbox', { name: 'Nombre del proveedor' }).inputValue(),
    baseUrl: await page.getByRole('textbox', { name: 'URL base del endpoint compatible con la API de OpenAI' }).inputValue(),
    models: await page.getByRole('textbox', { name: 'Modelos del proveedor, separados por comas' }).inputValue(),
  };
}

// Rellena el formulario de alta, pulsa "Añadir" y devuelve el motivo del rechazo que pinta la UI, o null
// si lo acepto. La API key no se toca: es opcional y va en un input type=password.
async function submitNewProvider(page, draft) {
  await page.getByRole('textbox', { name: 'Nombre del proveedor' }).fill(draft.label);
  await page.getByRole('textbox', { name: 'URL base del endpoint compatible con la API de OpenAI' }).fill(draft.baseUrl);
  await page.getByRole('textbox', { name: 'Modelos del proveedor, separados por comas' }).fill(draft.models);
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await page.waitForTimeout(CONFIG.settleMs);
  const alert = page.locator(PROVIDER_NEW_ERROR);
  return (await alert.count()) === 0 ? null : (await alert.innerText()).trim();
}

// Resumen (URL + nº de modelos) de la fila de un proveedor guardado, o null si no esta.
async function providerRowSummary(page, label) {
  return page.evaluate((name) => {
    const remove = document.querySelector(`[aria-label="Eliminar el proveedor ${name}"]`);
    return remove?.parentElement?.textContent?.trim() ?? null;
  }, label);
}

// Etiquetas de los selectores de modelo (uno por proveedor OFRECIDO), en "Proveedores y modelos".
// Abre la seccion por su
// cuenta: las tres comprobaciones que la consultan vienen de otra.
async function modelSelectorLabels(page) {
  // La seccion "Modelos" se fundio con "Proveedores" el 2026-09-18.
  await openSection(page, /Proveedores y modelos/);
  return page
    .locator('[aria-label^="Modelo por defecto de"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
}

// --- Dialogo "Nueva conversacion" ----------------------------------------------------------------

// `<select>` de un campo del dialogo, localizado por la ETIQUETA de su campo (el `<label>` envuelve al
// control). Necesario porque el dialogo tiene hasta cinco `<select>` y un `select` suelto casaria con
// cualquiera de ellos: quien lo use debe comprobar el conteo antes de tocarlo.
function newTabSelect(page, fieldLabel) {
  return page.locator(`${NEW_TAB_DIALOG} label`).filter({ hasText: fieldLabel }).locator('select');
}

// Opciones ("value|texto") de ese campo, o null si no hay exactamente un selector con esa etiqueta.
async function selectOptionsOf(page, fieldLabel) {
  const select = newTabSelect(page, fieldLabel);
  if ((await select.count()) !== 1) return null;
  return select.evaluate((node) => [...node.options].map((option) => `${option.value}|${option.textContent?.trim() ?? ''}`));
}

// Abre el dialogo de nueva conversacion, ejecuta la medida y lo CIERRA con Escape. Abrirlo no crea
// ninguna pestaña ni spawnea nada: eso solo pasa al pulsar "Abrir pestaña".
async function withNewTabDialog(page, measure) {
  // El dialogo ya no cuelga de Ctrl+N (camino por defecto = abrir directo): se llega por clic
  // derecho sobre el ＋ de la barra de pestañas.
  await page.locator('button[aria-label="Nueva pestaña"]').first().click({ button: 'right' });
  await page.locator(NEW_TAB_DIALOG).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
  try {
    return await measure(page);
  } finally {
    await closeDialog(page);
  }
}

// --- Diff del chat: fondo por linea + resaltado ---------------------------------------------------

// Fondos DISTINTOS de las filas del diff y numero de colores de token. El resaltado es asincrono
// (gramatica + tokenizacion), asi que se sondea igual que el bloque de codigo del chat.
async function waitForDiffPaint(page) {
  const deadline = Date.now() + CONFIG.actionTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-diff="lines"] > div')];
      if (rows.length === 0) return null;
      const fondos = [...new Set(rows.map((row) => getComputedStyle(row).backgroundColor))];
      const colores = new Set(
        [...document.querySelectorAll('[data-diff="lines"] span[style*="color"]')]
          .map((span) => span.style.color)
          .filter((color) => color.length > 0),
      );
      return { fondos, colores: colores.size };
    });
    if (last !== null && last.fondos.length === 3 && last.colores > 1) return last;
    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }
  return last;
}

// --- F4: bloque de codigo resaltado DENTRO DEL CHAT -----------------------------------------------

// Bloque de codigo del hilo: lenguaje declarado, texto y los colores DISTINTOS de sus spans de token.
function readChatCode(page) {
  return page.evaluate(() => {
    const pre = document.querySelector('[data-block="agent"] pre');
    if (pre === null) return null;
    const spans = [...pre.querySelectorAll('span[style]')];
    const colors = [...new Set(spans.map((span) => span.style.color).filter((color) => color.length > 0))];
    // La cabecera del bloque lleva la etiqueta del lenguaje Y el boton Copiar (W-B, punto 8): se lee
    // solo su primer hijo, que es la etiqueta; el texto entero de la cabecera saldria `tsCopiar`.
    return { lang: pre.previousElementSibling?.firstElementChild?.textContent?.trim() ?? null, text: pre.textContent ?? '', spans: spans.length, colors };
  });
}

// Sondea hasta que la medida cumpla `predicate` (el resaltado es asincrono: carga de gramatica +
// primera tokenizacion) y devuelve la ULTIMA medida, cumpla o no.
async function waitForChatCode(page, predicate) {
  const deadline = Date.now() + CONFIG.actionTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readChatCode(page);
    if (last !== null && predicate(last)) return last;
    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }
  return last;
}

// --- F4 (historico): vista previa del markdown del prompt, eliminada en 2.7 -----------------------

// Bloque de codigo de la vista previa: lenguaje declarado, texto, y los colores DISTINTOS de sus spans de

// --- Fase B: cache del catalogo de comandos sembrada ANTES de arrancar ----------------------------

// Comando namespaced y comando con pista de argumento que se siembran en la cache. Son los dos rasgos
// que 2.2 anade al popover, y ninguno existe en la lista curada de Mage: si aparecen, vienen de la
// cache.
const SEEDED_NAMESPACED_COMMAND = 'itb-skills:verify-gui';
const SEEDED_HINT = '[carpeta]';

// Escribe `command-catalog.json` en el perfil AISLADO antes de lanzar la app. Funciona porque ese
// fichero vive en `userData`, que si esta aislado (las transcripciones y las cuentas, no: cuelgan de
// `homedir()`). Se siembra una entrada por cada cuenta que el harness encuentre, con la MISMA regla de
// nombre que usa main, porque la clave de la cache es el config dir de la cuenta.
// El perfil aislado es una instalacion LIMPIA, asi que el asistente de primer arranque saldria en cada
// tanda y taparia la app entera: las ~98 comprobaciones medirian un modal. Se siembra como ya visto, y
// el asistente tiene su propia comprobacion, que lo reabre a proposito y lo vuelve a cerrar.
function seedOnboardingDone(userDataDir) {
  const file = path.join(userDataDir, 'app-settings.json');
  // El resto de ajustes se quedan en sus defaults: main los completa al leer (esquema tolerante).
  // Se siembra un numero ALTO y no `ONBOARDING_VERSION` (que vive en un .ts que este script no puede
  // importar): cualquier version futura del asistente sigue quedando por debajo, asi que subirla no
  // vuelve a tapar la tanda entera. La comprobacion del asistente no depende de esto — lo reabre
  // llamando al store.
  // Grupo F: las notas de version, dadas por vistas en la version actual. Sin esto, con el asistente
  // completado y el campo vacio, la app lo tomaria por una actualizacion desde la 0.1.1 y abriria la
  // pestaña de novedades en cada tanda (el harness levanta la condicion de dev, ver `launchApp`).
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, notificationRules: [], onboardingCompletedVersion: 9999, lastSeenReleaseNotesVersion: APP_VERSION }, null, 2),
    'utf-8',
  );
}

// P-026 2.5: sin `mcp-common.json`, main lo IMPORTA al arrancar desde el `~/.claude/mcp-shared.json` y
// los `.claude.json` REALES del usuario —con los `env` de sus servidores— y lo escribiria en este
// perfil. Se siembra uno falso: la importacion no corre y la seccion tiene algo conocido que enseñar.
// P-028: un local con `env` y un HTTP con cabecera, los dos con un valor centinela que NO puede llegar
// al DOM; mas fuentes falsas de cuenta y de Claude Desktop (MAGE_MCP_FAKE_SOURCES, ver main).
const SEEDED_MCP_LOCAL = 'vg-comun-local';
const SEEDED_MCP_HTTP = 'vg-comun-http';
const SEEDED_MCP_SERVERS = [SEEDED_MCP_LOCAL, SEEDED_MCP_HTTP];
const SEEDED_MCP_ACCOUNT_SERVER = 'vg-cuenta';
const SEEDED_MCP_DESKTOP_SERVER = 'vg-escritorio';
const SEEDED_MCP_SECRET = 'vg-valor-que-no-debe-verse';
// El servidor que reporta el CLI falso de main con MAGE_MCP_FAKE_CLI=1 (src/main/config/mcpFakeCli.ts).
const FAKE_MCP_AUTH_SERVER = 'vg-auth';
// Y su conector de claude.ai (nombre del CLI y como se enseña en Conectores, sin el prefijo).
const FAKE_MCP_CONNECTOR = 'claude.ai VG Conector';
const FAKE_MCP_CONNECTOR_NAME = 'VG Conector';
// 0.1.2 grupo C: lo propio de agy (su mcp_config.json falso), una extension de Mage con un user_config
// sensible y una extension de Claude Desktop para importar.
const SEEDED_AGY_SERVER = 'vg-agy-suyo';
const SEEDED_EXTENSION = 'vg-ext';
const SEEDED_EXTENSION_SECRET = 'vg-secreto-de-extension';
const SEEDED_DESKTOP_EXTENSION = 'vg-desk';
const SEEDED_DESKTOP_EXTENSION_DIR = 'local.mcpb.vg.desk';

function mcpFakeSourcesDir(userDataDir) {
  return path.join(userDataDir, 'mcp-fake-sources');
}

function seedMcpCommon(userDataDir) {
  const dir = path.join(userDataDir, 'shared-config');
  fs.mkdirSync(dir, { recursive: true });
  const mcpServers = {
    [SEEDED_MCP_LOCAL]: { type: 'stdio', command: 'npx', args: ['-y', SEEDED_MCP_LOCAL], env: { VG_TOKEN: SEEDED_MCP_SECRET } },
    [SEEDED_MCP_HTTP]: { type: 'http', url: 'https://vg.invalid/mcp', headers: { Authorization: SEEDED_MCP_SECRET } },
  };
  fs.writeFileSync(path.join(dir, 'mcp-common.json'), JSON.stringify({ mcpServers }, null, 2), 'utf-8');
  // Fuentes ajenas FALSAS: el `.claude.json` de la cuenta principal (`.claude`) y Claude Desktop.
  const fake = mcpFakeSourcesDir(userDataDir);
  fs.mkdirSync(path.join(fake, 'Claude'), { recursive: true });
  const local = { type: 'stdio', command: 'npx', args: ['-y', 'vg'], env: { VG_TOKEN: SEEDED_MCP_SECRET } };
  fs.writeFileSync(path.join(fake, '.claude.json'), JSON.stringify({ mcpServers: { [SEEDED_MCP_ACCOUNT_SERVER]: local } }), 'utf-8');
  fs.writeFileSync(path.join(fake, 'Claude', 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { [SEEDED_MCP_DESKTOP_SERVER]: local } }), 'utf-8');
  seedMcpExtensions(userDataDir, fake);
}

// Grupo C: el mcp_config.json de agy (falso), una extension .mcpb de Mage ya descomprimida y otra de
// Claude Desktop. Ninguna se lanza: la verificacion no abre conversaciones con ellas.
function seedMcpExtensions(userDataDir, fake) {
  fs.mkdirSync(path.join(fake, 'agy'), { recursive: true });
  const agy = { mcpServers: { [SEEDED_AGY_SERVER]: { command: 'suyo', args: [], env: {}, disabled: false } } };
  fs.writeFileSync(path.join(fake, 'agy', 'mcp_config.json'), JSON.stringify(agy, null, 2), 'utf-8');
  const manifest = (name) => ({
    manifest_version: '0.3',
    name,
    version: '1.0.0',
    author: { name: 'verify:gui' },
    server: { type: 'binary', mcp_config: { command: '${__dirname}${/}server${/}vg.exe', args: [], env: { VG_KEY: '${user_config.api_key}' } } },
    user_config: { api_key: { type: 'string', title: 'Clave API', sensitive: true, required: true } },
  });
  const ext = path.join(userDataDir, 'extensions', SEEDED_EXTENSION);
  fs.mkdirSync(ext, { recursive: true });
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest(SEEDED_EXTENSION)), 'utf-8');
  const desk = path.join(fake, 'Claude', 'Claude Extensions', SEEDED_DESKTOP_EXTENSION_DIR);
  fs.mkdirSync(desk, { recursive: true });
  fs.writeFileSync(path.join(desk, 'manifest.json'), JSON.stringify({ ...manifest(SEEDED_DESKTOP_EXTENSION), user_config: {}, server: { type: 'binary', mcp_config: { command: 'vg' } } }), 'utf-8');
}

function seedCommandCatalog(userDataDir) {
  const home = os.homedir();
  const accounts = fs
    .readdirSync(home, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\.claude(-.*|\d*)$/.test(entry.name))
    .map((entry) => path.join(home, entry.name));
  if (accounts.length === 0) return 0;
  // Los 12 curados de `slashCommands.ts` MAS los dos rasgos nuevos. Los curados van con descripcion
  // vacia a proposito (el catalogo cae a la castellana de Mage) y estan aqui por una razon concreta: sin
  // ellos, la cache DEJARIA SIN CATALOGO a la comprobacion del popover de comandos, que mide sobre esa
  // misma lista. Sembrar solo lo nuevo cambiaba lo que mide una comprobacion anterior — el error §5 de
  // la skill `verificacion-gui`, visto otra vez.
  const curated = ['agents', 'clear', 'compact', 'config', 'context', 'doctor', 'init', 'mcp', 'model', 'review', 'security-review', 'usage'];
  const commands = [
    ...curated.map((name) => ({
      name,
      description: '',
      argumentHint: name === 'compact' ? SEEDED_HINT : null,
      aliases: name === 'compact' ? ['compactar'] : [],
    })),
    { name: SEEDED_NAMESPACED_COMMAND, description: 'Comando sembrado por verify:gui', argumentHint: null, aliases: [] },
  ];
  const byAccount = Object.fromEntries(accounts.map((dir) => [dir, { measuredAtMs: 1, commands }]));
  fs.writeFileSync(path.join(userDataDir, 'command-catalog.json'), JSON.stringify({ version: 1, byAccount }, null, 2), 'utf-8');
  return accounts.length;
}

// --- Fase A: hidratacion del chat por el puente de desarrollo -------------------------------------

// Cuantos bloques hidrata la comprobacion de 2.6. El colapso a 2 px SOLO aparece con desbordamiento:
// con pocos bloques la medida seria verde con el bug puesto.
const HYDRATED_BLOCK_COUNT = 60;

// Las dos conversaciones reanudadas de la comprobacion de 4.3. Los ids son inventados a proposito (no
// hay fichero en disco: la transcripcion se inyecta), y los textos son DISTINTOS porque la mitad de la
// medida es que cada panel pinte lo suyo y no dos veces el mismo hilo.
const SPLIT_HYDRATION_SESSIONS = {
  a: 'vg-split-a',
  b: 'vg-split-b',
  textoA: 'Conversacion del panel izquierdo',
  textoB: 'Conversacion del panel derecho',
};

// PNG REAL de 1x1 (el mismo del fixture de la Fase A): lo escribe el harness en SU directorio de
// salida para probar el adjuntado sin depender de ningun fichero del usuario.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const FIXTURE_FILE = path.join(repoRoot, 'src', 'main', 'transcripts', 'fixtures', 'meta-and-image.jsonl');

// Las tres lineas REALES del fixture, convertidas a `TranscriptEntry` como lo hace
// `main/transcripts/normalize.ts`. Se re-declara aqui (igual que las anclas del DOM) porque este
// fichero es un .mjs sin el pipeline de TS: si el mapeo cambia, lo canta esta comprobacion.
function readRealTranscriptEntries() {
  return fs
    .readFileSync(FIXTURE_FILE, 'utf-8')
    .trim()
    .split('\n')
    .map((line, index) => {
      const raw = JSON.parse(line);
      const timestampMs = Date.parse(raw.timestamp ?? '');
      return {
        index,
        uuid: raw.uuid ?? null,
        parentUuid: raw.parentUuid ?? null,
        isSidechain: raw.isSidechain === true,
        isMeta: raw.isMeta === true,
        timestampMs: Number.isNaN(timestampMs) ? null : timestampMs,
        category: 'turn',
        kind: raw.type,
        summary: '',
        tokenUsage: null,
        raw,
      };
    });
}

const REAL_TRANSCRIPT_ENTRIES = readRealTranscriptEntries();

// Desborde de la cascara en el viewport ACTUAL: quien se pasa de su caja, si la pagina saca scroll y si
// alguna columna de iconos pinta barra. La usa la comprobacion de ventana pequena en cada tamano.
function medirDesborde(page) {
  return page.evaluate(() => {
      const raiz = document.documentElement;
      // Quien desborda de verdad: el elemento cuyo contenido no cabe en su caja. Se listan los peores
      // para que el fallo diga donde mirar.
      const culpables = [...document.querySelectorAll('*')]
        .map((n) => ({
          sel: `${n.tagName.toLowerCase()}${n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`,
          etiqueta: n.getAttribute('aria-label'),
          exceso: n.scrollHeight - n.clientHeight,
          alto: Math.round(n.getBoundingClientRect().height),
        }))
        .filter((n) => n.exceso > 1 && n.alto > 0)
        .sort((a, b) => b.exceso - a.exceso)
        .slice(0, 4);
      // Las columnas de iconos, medidas aparte: son las que reporto el usuario y las que no deben
      // scrollear NUNCA. Un panel puede scrollear su contenido; una barra de herramientas que se
      // scrollea es una barra en la que no encuentras el icono que buscas.
      const barras = [...document.querySelectorAll('[role="toolbar"]')].map((n) => ({
        etiqueta: n.getAttribute('aria-label'),
        alto: Math.round(n.getBoundingClientRect().height),
        contenido: n.scrollHeight,
        scrollea: n.scrollHeight > n.clientHeight + 1,
        iconos: n.querySelectorAll('[data-stripe-btn="true"]').length,
      }));
      // Por el contenedor con borde derecho, no por una clase de ancho: el rail iguala su ancho al de
      // la barra derecha (36 px) y ese numero vive en una constante compartida, no en este selector.
      const rail = document.querySelector('[aria-label="Paneles del borde izquierdo, zona superior"]')?.closest('div[class*="border-r"]') ?? null;
      // Los contenedores que SI scrollean por dentro (el div con overflow, no el role="toolbar" que
      // lleva dentro: ese nunca desborda porque el de fuera se lo come). Se miden LOS DOS EJES y,
      // sobre todo, si la barra OCUPA SITIO (`offset - client`), que es lo que el usuario ve: la
      // columna puede desplazarse con la rueda, pero sin pintar ninguna barra en 36 px.
      const columnas = [...document.querySelectorAll('[data-stripe-scroll="true"]')].map((n) => ({
        etiqueta: n.parentElement?.getAttribute('aria-label') ?? n.querySelector('[role="toolbar"]')?.getAttribute('aria-label'),
        alto: n.offsetHeight,
        contenidoY: n.scrollHeight,
        contenidoX: n.scrollWidth,
        anchoUtil: n.clientWidth,
        desbordaX: n.scrollWidth > n.clientWidth + 1,
        barraV: n.offsetWidth - n.clientWidth,
        barraH: n.offsetHeight - n.clientHeight,
        // Que el ocultado de la barra este APLICADO de verdad, no solo escrito: con los iconos que hay
        // hoy la columna no llega a desbordar en la ventana minima, asi que `barraV === 0` pasaria en
        // verde tambien con el ocultado roto (fue el caso: la utilidad `[scrollbar-width:none]` de
        // Tailwind perdia la cascada contra el `*` sin @layer de index.css y no hacia nada).
        ocultaBarra: getComputedStyle(n).scrollbarWidth,
      }));
      return {
        ventana: window.innerHeight,
        desbordaPagina: raiz.scrollHeight > raiz.clientHeight,
        desbordaPaginaX: raiz.scrollWidth > raiz.clientWidth,
        bodyDesborda: document.body.scrollHeight > document.body.clientHeight,
        altoRaiz: raiz.scrollHeight,
        railScrollea: rail === null ? null : rail.scrollHeight > rail.clientHeight + 1,
        railAlto: rail === null ? null : Math.round(rail.getBoundingClientRect().height),
        railContenido: rail === null ? null : rail.scrollHeight,
        columnas,
        barras: barras.filter((b) => b.iconos > 0 || b.scrollea),
        culpables,
      };
  });
}

// Abre una conversacion nueva con "Carpeta temporal" (sin enviar nada: `ensureSession` es perezoso, asi
// que no spawnea el CLI). Mismo camino que la comprobacion de Ctrl+N, extraido para el grupo final.
// Avisos TEMPORALES de «Omitir permisos» (el del prompt). El panel Permiso describe el modo actual con
// la MISMA frase, y es permanente a proposito: contarlo daba 2 al entrar y 1 tras los 8 s cuando el
// panel estaba abierto. Se excluye todo lo que vive dentro de un panel del dock.
function countBypassAdvice(page, text) {
  return page.evaluate(
    (t) => [...document.querySelectorAll('body *')].filter((n) => n.childElementCount === 0 && (n.textContent ?? '').trim() === t && n.closest('[data-active-panel]') === null).length,
    text,
  );
}

// Tolerancia de «no se ha movido» del chip y del popover de un StepSlider entre pasos (subpixel).
const SLIDER_STILL_TOLERANCE_PX = 0.5;

// Espera a que TERMINEN las animaciones finitas del documento (WAAPI de motion y transiciones CSS; las
// infinitas, como la constelacion, no). No vale un tiempo fijo: con la ventana tapada por otras (el usuario
// trabajando mientras corre el harness), Windows deja de consumir frames y una animacion compuesta se
// queda en `currentTime` 0 hasta un segundo. Medido: el popover a escala 0,97 (264 -> 256,08 px, la deriva
// de 7,92 px) y el pulgar a medio camino tras los 300/250 ms que se esperaban antes.
async function waitForFiniteAnimations(page) {
  await page.evaluate(async (timeoutMs) => {
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
    // Una cancelada (el componente se desmonta) tambien cuenta como terminada.
    const settled = Promise.all(finite.map((a) => a.finished.catch(() => undefined))).then(() => true);
    let timer;
    const expired = new Promise((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
    const done = await Promise.race([settled, expired]);
    clearTimeout(timer);
    if (!done) throw new Error(`${finite.length} animaciones sin terminar tras ${timeoutMs} ms`);
  }, CONFIG.actionTimeoutMs);
}

const STEP_SLIDER_POPOVER = '[data-step-slider-popover="true"]';

// Frames seguidos con la caja quieta para darla por asentada.
const STILL_FRAMES = 3;

// Espera a que la caja de `selector` deje de moverse: STILL_FRAMES frames seguidos sin cambiar, y las
// animaciones finitas terminadas. Para lo que mueve motion con `layout` (FLIP por rAF, invisible para
// `getAnimations()`): con un tiempo fijo, si los frames van lentos se mide a mitad del recorrido.
async function waitForStillBox(page, selector) {
  await waitForFiniteAnimations(page);
  await page.evaluate(
    ({ selector, frames, timeoutMs }) =>
      new Promise((resolve, reject) => {
        const started = performance.now();
        let last = '';
        let still = 0;
        const tick = () => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          const key = box === undefined ? 'ausente' : `${box.x},${box.y},${box.width},${box.height}`;
          still = key === last ? still + 1 : 0;
          last = key;
          if (still >= frames) return resolve();
          if (performance.now() - started > timeoutMs) return reject(new Error(`${selector} sigue moviendose tras ${timeoutMs} ms`));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { selector, frames: STILL_FRAMES, timeoutMs: CONFIG.actionTimeoutMs },
  );
}

// Abre el deslizador de `caso.chip`, lo lleva al primer paso con Home y lo recorre con ArrowRight hasta el
// ultimo. En CADA paso mide la caja del chip y la del popover (su mayor desviacion respecto a la de
// apertura) y, pasada la transicion, donde esta el pulgar dibujado respecto a la fraccion que le toca.
// Deja el valor como lo encontro (Home + tantos ArrowRight como su posicion inicial) y cierra con Escape.
async function walkStepSlider(page, caso) {
  const trigger = page.locator(caso.chip).first();
  await trigger.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
  await trigger.click();
  const popover = page.locator('[data-step-slider-popover="true"]');
  await popover.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
  // La entrada del popover: opacidad por WAAPI y escala 0,97 -> 1 por el bucle de motion.
  await waitForStillBox(page, STEP_SLIDER_POPOVER);
  const range = popover.locator('input[type="range"]');
  const inicio = await range.evaluate((el) => ({ value: Number(el.value), max: Number(el.max), valuetext: el.getAttribute('aria-valuetext') ?? '' }));
  const fila = page.locator('[data-prompt-controls="true"]').first();
  // El chip se mide RELATIVO a su fila de controles y la fila, aparte: son dos fallos distintos. El chip
  // cambiaba de ancho (Manual sin icono); la fila bajaba 5,5 px cuando el aviso de coste de «Muy alto»
  // pasaba a dos lineas y la columna, con el estado vacio sin encoger, desbordaba.
  const chipEnFila = async () => {
    const [chip, row] = [await trigger.boundingBox(), await fila.boundingBox()];
    return { x: chip.x - row.x, y: chip.y - row.y, width: chip.width, height: chip.height };
  };
  const chipAbs = await trigger.boundingBox();
  const chip0 = await chipEnFila();
  const fila0 = await fila.boundingBox();
  const pop0 = await popover.boundingBox();
  // Mayor desviacion por eje ({x, y, width, height}) de una caja respecto a la de apertura.
  const chipDeriva = { x: 0, y: 0, width: 0, height: 0 };
  const popDeriva = { x: 0, y: 0, width: 0, height: 0 };
  const filaDeriva = { x: 0, y: 0, width: 0, height: 0 };
  const acumular = (acc, box, base) => {
    for (const eje of Object.keys(acc)) acc[eje] = Math.max(acc[eje], Number(Math.abs(box[eje] - base[eje]).toFixed(2)));
  };
  let errorPulgar = 0;
  let recorridos = 0;
  await range.press('Home');
  for (let paso = 0; paso <= inicio.max; paso += 1) {
    if (paso > 0) await range.press('ArrowRight');
    await waitForStillBox(page, STEP_SLIDER_POPOVER); // la transicion del pulgar y lo que mueva el cambio de paso
    const pulgar = await popover.evaluate((el) => {
      const pista = el.querySelector('.mg-step-thumb-track').getBoundingClientRect();
      const punto = el.querySelector('.mg-step-thumb-dot').getBoundingClientRect();
      return { offset: punto.left - pista.left, recorrido: pista.width, value: Number(el.querySelector('input[type="range"]').value) };
    });
    if (pulgar.value === paso) recorridos += 1;
    const esperado = inicio.max === 0 ? 0 : (paso / inicio.max) * pulgar.recorrido;
    errorPulgar = Math.max(errorPulgar, Math.abs(pulgar.offset - esperado));
    acumular(chipDeriva, await chipEnFila(), chip0);
    acumular(filaDeriva, await fila.boundingBox(), fila0);
    acumular(popDeriva, await popover.boundingBox(), pop0);
  }
  const transicion = await popover.locator('.mg-step-thumb').evaluate((el) => getComputedStyle(el).transitionDuration);
  await range.press('Home');
  for (let paso = 0; paso < inicio.value; paso += 1) await range.press('ArrowRight');
  const final = await range.evaluate((el) => Number(el.value));
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
  const gapBelow = Math.abs(pop0.y - (chipAbs.y + chipAbs.height));
  const gapAbove = Math.abs(chipAbs.y - (pop0.y + pop0.height));
  return {
    chip: caso.chip,
    gap: Math.min(gapBelow, gapAbove),
    pasos: inicio.max + 1,
    esperados: caso.pasos,
    recorridos,
    desplazamientoChip: Math.max(...Object.values(chipDeriva)),
    desplazamientoPopover: Math.max(...Object.values(popDeriva)),
    chipDeriva,
    popDeriva,
    filaDeriva,
    errorPulgar: Number(errorPulgar.toFixed(2)),
    transicion,
    vuelveAlInicio: final === inicio.value,
    valuetext: inicio.valuetext,
  };
}

async function openTemporaryConversation(page) {
  // CAMBIO DEL 2026-09-18: `Ctrl+N` ya NO abre el formulario de "Nueva conversacion" — abre la
  // conversacion directamente, en carpeta temporal y con los valores por defecto, que es lo que el
  // usuario pidio. El dialogo sigue existiendo para elegir carpeta/proveedor/modelo, pero como camino
  // SECUNDARIO (clic derecho sobre el ＋); lo cubre `openTemporaryConversationConDialogo`.
  //
  // Este helper lo usan ~40 comprobaciones para montarse su estado, asi que se queda con el camino por
  // DEFECTO: es el que de verdad recorre un usuario, y ademas es mas rapido y menos fragil.
  const antes = await page.locator('[role="tablist"][aria-label^="Conversaciones abiertas"] [role="tab"]').count();
  await page.keyboard.press('Control+KeyN');
  // Se espera a que la pestaña EXISTA, no a un tiempo fijo: la creacion pasa por el main (carpeta
  // temporal en disco) y tarda lo que tarde la maquina.
  await page
    .locator('[role="tablist"][aria-label^="Conversaciones abiertas"] [role="tab"]')
    .nth(antes)
    .waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
}

// El camino SECUNDARIO: el formulario completo, al que se llega con clic derecho sobre el ＋ de la
// barra de pestañas. Se conserva porque sigue siendo la unica via para elegir carpeta, proveedor,
// modelo, esfuerzo y tope de gasto.
async function openTemporaryConversationConDialogo(page) {
  await page.locator('button[aria-label="Nueva pestaña"]').first().click({ button: 'right' });
  await page.locator(NEW_TAB_DIALOG).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
  await page.getByRole('button', { name: 'Carpeta temporal', exact: true }).click();
  await page.getByRole('button', { name: /Abrir pestaña|Abriendo/ }).click();
  await page.locator(MODAL).first().waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
}

// Hidrata el chat de la pestaña ACTIVA con los bloques que produce el propio `transcriptToBlocks` de la
// app a partir de entradas de transcripcion reales. Devuelve cuantos bloques salieron.
async function hydrateFromEntries(page, entries) {
  const blocks = await page.evaluate((payload) => {
    const dev = window.__mageDev;
    if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
    const tabId = dev.store.getState().activeTabId;
    const built = dev.transcriptToBlocks(payload);
    dev.store.setState({ blocksByChat: { ...dev.store.getState().blocksByChat, [tabId]: built } });
    return built.length;
  }, entries);
  await page.waitForTimeout(CONFIG.settleMs);
  return blocks;
}

// Alturas reales de los bloques del hilo. Se anclan por `data-block` y no por "hijos del contenedor":
// el primer hijo es la region aria-live (1 px), que daria un falso negativo eterno.
function measureBlockHeights(page) {
  return page.evaluate(() => {
    const first = document.querySelector('[data-block]');
    const scroller = first?.parentElement ?? null;
    if (scroller === null) return null;
    const items = [...scroller.querySelectorAll(':scope > [data-block]')];
    const heights = items.map((node) => node.offsetHeight);
    return {
      bloques: items.length,
      tools: items.filter((node) => node.dataset.block === 'tool' || node.dataset.block === 'tool-failed').length,
      minAltura: heights.length === 0 ? 0 : Math.min(...heights),
      pordebajode8: heights.filter((height) => height < 8).length,
      desborda: scroller.scrollHeight > scroller.clientHeight,
    };
  });
}

// Medida de las burbujas del usuario: cuantas hay, cuantas traen contenido interno del protocolo, y la
// que lleva imagen + texto en la MISMA burbuja (con su `naturalWidth`, que es lo que demuestra que el
// `data:` decodifica). La hora se descuenta del texto: si no, ninguna burbuja estaria "vacia".
function measureUserBubbles(page) {
  return page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('[data-block="user"]')];
    const texts = bubbles.map((node) => (node.textContent ?? '').replace(/\d{2}:\d{2}/, '').trim());
    const conImagen = bubbles.filter((node) => node.querySelector('img[src^="data:image/"]') !== null);
    const img = conImagen[0]?.querySelector('img') ?? null;
    return {
      burbujas: bubbles.length,
      conSystemReminder: texts.filter((text) => text.includes('<system-reminder>')).length,
      conAvisoDeImagen: texts.filter((text) => text.includes('[Image: source:')).length,
      conImagenYTexto: conImagen.filter((node) => (node.textContent ?? '').replace(/\d{2}:\d{2}/, '').trim().length > 0).length,
      naturalWidth: img === null ? 0 : img.naturalWidth,
    };
  });
}

// Sondea hasta que la medida cumpla `predicate` (la decodificacion de un `data:` de 34 KB no es
// instantanea) y devuelve la ULTIMA medida, cumpla o no: el informe tiene que llevar el valor real.
async function waitForUserBubbles(page, predicate) {
  const deadline = Date.now() + CONFIG.actionTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await measureUserBubbles(page);
    if (last !== null && predicate(last)) return last;
    await page.waitForTimeout(200);
  }
  return last;
}

// Texto del CLI para el limite de uso. Literal del que se ve de verdad ("You've hit your session limit
// · resets 3pm"). Desde P-028 (20) va al tooltip de la linea, no al texto visible.
const RATE_LIMIT_SUMMARY = "You've hit your session limit · resets 3pm";


const ASK_USER_QUESTION_INPUT = {
  questions: [
    {
      question: '¿Prefieres el color rojo o el azul?',
      header: 'Preferencia de color',
      options: [
        { label: 'Rojo', description: 'El color del fuego' },
        { label: 'Azul', description: 'El color del cielo' },
      ],
      multiSelect: false,
    },
  ],
};

// Inyecta un `permission_request` sintetico por el puente de desarrollo, como si lo hubiera emitido el
// CLI. NO spawnea nada ni gasta turno: entra por el mismo reducer que el evento real.
async function injectPermissionRequest(page, input, requestId, toolName = 'AskUserQuestion') {
  await page.evaluate(
    ([payload, id, tool]) => {
      const dev = window.__mageDev;
      if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
      const tabId = dev.store.getState().activeTabId;
      const event = {
        kind: 'permission_request',
        request: {
          requestId: id,
          toolUseId: `tu-${id}`,
          toolName: tool,
          input: payload,
          description: null,
          requiresUserInteraction: true,
          displayName: tool,
        },
      };
      // Se pasa por el reducer REAL (no se fabrica el bloque a mano): lo que se mide es lo que hace la
      // app con el evento del CLI, no lo que el harness sabe construir.
      dev.store.setState((state) => dev.reduceEvent(state, tabId, event));
    },
    [input, requestId, toolName],
  );
  await page.waitForTimeout(CONFIG.settleMs);
}

// Cancela el permiso inyectado por el MISMO camino que el CLI (`permission_cancelled`), para no dejar
// una peticion pendiente a la siguiente comprobacion. Contestarlo de verdad no vale: sin sesion viva,
// `answerPermission` lanzaria.
async function cancelInjectedPermission(page, requestId) {
  await page.evaluate((id) => {
    const dev = window.__mageDev;
    const tabId = dev.store.getState().activeTabId;
    dev.store.setState((state) => dev.reduceEvent(state, tabId, { kind: 'permission_cancelled', requestId: id }));
  }, requestId);
  await page.waitForTimeout(CONFIG.settleMs);
}

// Que ofrece ahora mismo el panel "Permiso" del dock. Con una pregunta pendiente NO puede ofrecer
// Permitir/Denegar: es el mismo can_use_tool que la tarjeta y se contesta una sola vez.
function measurePermissionPanel(page) {
  return page.evaluate(() => {
    const texts = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
    return {
      permitir: texts.filter((t) => t === 'Permitir').length,
      denegar: texts.filter((t) => t.startsWith('Denegar')).length,
      avisoDePregunta: document.body.innerText.includes('se contesta encima del input'),
    };
  });
}

// Publicacion de artifact LITERAL medida en una transcripcion real del usuario (2.4).
const REAL_ARTIFACT = {
  input: {
    file_path: 'C:\\tmp\\scratchpad\\packaging-informe.html',
    favicon: '📦',
    title: 'Packaging — informe previo',
    description: 'Análisis previo de la normalización.',
  },
  url: 'https://claude.ai/code/artifact/477497ff-717a-4375-a39e-a47e383648a8',
};

// Bloque de tool que YA publico un artifact, con la forma que produce el reducer.
function artifactBlock(id = 'a1') {
  return {
    ...toolBlock(id, 'other'),
    tool: 'Artifact',
    command: REAL_ARTIFACT.input.file_path,
    artifactDraft: {
      title: REAL_ARTIFACT.input.title,
      description: REAL_ARTIFACT.input.description,
      favicon: REAL_ARTIFACT.input.favicon,
      localPath: REAL_ARTIFACT.input.file_path,
    },
    artifact: {
      title: REAL_ARTIFACT.input.title,
      description: REAL_ARTIFACT.input.description,
      favicon: REAL_ARTIFACT.input.favicon,
      localPath: REAL_ARTIFACT.input.file_path,
      url: REAL_ARTIFACT.url,
    },
  };
}

// Hunk LITERAL medido en una transcripcion real (M2): con el se comprueba que el diff sale NUMERADO.
const REAL_HUNK = {
  oldStart: 13,
  oldLines: 7,
  newStart: 13,
  newLines: 6,
  lines: [' import type { Foo } from "./foo";', '-const a = 1;', '+const a = 2;', ' export default a;'],
};

// Hidrata el chat de la pestaña activa con bloques ya construidos (objetos planos, la misma forma que
// produce el reducer). Devuelve cuantos se inyectaron.
// Pega FICHEROS en el editor del prompt con un `ClipboardEvent` sintetico, que es lo que recibe
// `PromptEditor` al hacer Ctrl+V con imagenes. `files` = [{ name, type, base64 }]. No envia nada.
async function pasteFiles(page, files) {
  await page.evaluate((payload) => {
    const target = document.querySelector('[data-prompt-editor="true"] .cm-content');
    if (target === null) throw new Error('no hay editor del prompt donde pegar');
    const transfer = new DataTransfer();
    for (const file of payload) {
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: file.type }));
    }
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, files);
}

// --- Git (P-026 3.5): repo temporal que monta el SCRIPT, nunca la app ------------------------------

// Lo que main guarda un estado de git leido (`STATUS_FRESH_MS` de gitService.ts), mas un margen.
const GIT_STATUS_FRESH_MS = 1_700;

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} fallo en ${cwd}: ${result.stderr}`);
}

// Repo con un commit en `main`, una rama `otra`, un fichero cambiado (+2 −0) y otro sin seguir. null si
// no hay git: la comprobacion se salta en vez de fallar.
function createTempGitRepo() {
  if (spawnSync('git', ['--version'], { windowsHide: true }).status !== 0) return null;
  // Ruta LARGA: en Windows `os.tmpdir()` puede venir en 8.3 y la confianza compara la cadena guardada.
  const repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mage-verify-git-')));
  const identity = ['-c', 'user.name=verify', '-c', 'user.email=verify@example.invalid', '-c', 'commit.gpgsign=false'];
  runGit(repo, ['-c', 'init.defaultBranch=main', 'init']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'uno\n');
  runGit(repo, ['add', 'a.txt']);
  runGit(repo, [...identity, 'commit', '-m', 'primero']);
  runGit(repo, ['branch', 'otra']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'uno\ndos\ntres\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'sin seguir\n');
  return repo;
}

function cleanTempGitRepo(repo) {
  runGit(repo, ['checkout', '--', 'a.txt']);
  fs.rmSync(path.join(repo, 'b.txt'), { force: true });
}

// Repo temporal de grupo D: el de 3.5, limpio, con un remoto de github.com (el `gh` falso no lo toca) y en
// la rama pedida. null si no hay git.
function createTempGhRepo(branch) {
  const repo = createTempGitRepo();
  if (repo === null) return null;
  cleanTempGitRepo(repo);
  runGit(repo, ['remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
  if (branch !== 'main') runGit(repo, ['switch', '-c', branch]);
  return repo;
}

// Espera a que un run de la lista empiece por `prefix`; si no llega, lanza con lo que hay (y el error del panel).
async function waitForRunText(page, prefix) {
  const read = () => page.evaluate(() => ({ runs: [...document.querySelectorAll('[data-pr-runs] li')].map((li) => li.textContent ?? ''), error: document.querySelector('[data-pr-details] [role="alert"]')?.textContent ?? null }));
  const deadline = Date.now() + CONFIG.actionTimeoutMs;
  for (;;) {
    const seen = await read();
    if (seen.runs.some((text) => text.startsWith(prefix))) return;
    if (Date.now() > deadline) throw new Error(`ningun run empieza por ${JSON.stringify(prefix)}: ${JSON.stringify(seen)}`);
    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }
}

async function capturePrState(page) {
  return page.evaluate(() => {
    const s = window.__mageDev.store.getState();
    return { tabs: s.tabs, activeTabId: s.activeTabId, splitLayout: s.splitLayout, draftByChat: s.draftByChat, gitByCwd: s.gitByCwd, sessionIdByChat: s.sessionIdByChat, prByTab: s.prByTab, ghRunsByTab: s.ghRunsByTab };
  });
}

// Pestaña temporal apuntando al repo, con la confianza concedida en el dialogo de siempre (D28).
async function pointActiveTabAtTrustedRepo(page, repo) {
  await openTemporaryConversation(page);
  await page.evaluate((cwd) => {
    const dev = window.__mageDev;
    const tabId = dev.store.getState().activeTabId;
    dev.store.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, cwd } : t)) }));
  }, repo);
  const dialogo = page.getByRole('button', { name: 'Confiar en esta carpeta' });
  await dialogo.waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
  await dialogo.click();
}

// Suelta la vigilancia del PR de la pestaña temporal, repone el aviso de gh, el estado y la confianza.
async function restorePrState(page, previo, repo) {
  await page.evaluate(async (cwd) => {
    const st = window.__mageDev.store.getState();
    await window.mage.ghUnwatch(st.activeTabId);
    st.setGhNoticeDismissed(false);
    st.revokeTrustedFolder(cwd);
  }, repo);
  await page.evaluate((state) => window.__mageDev.store.setState(state), previo);
  await page.waitForTimeout(CONFIG.settleMs);
  fs.rmSync(repo, { recursive: true, force: true });
}

// Claves del store que tocan las comprobaciones de un turno inyectado (P-026 3.4). Selectivo, como el
// resto: ninguna es un Set, que no sobreviviria al viaje por CDP.
async function captureTurnState(page) {
  return page.evaluate(() => {
    const s = window.__mageDev.store.getState();
    return {
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      splitLayout: s.splitLayout,
      blocksByChat: s.blocksByChat,
      statusByChat: s.statusByChat,
      streamingIdByChat: s.streamingIdByChat,
      activitySubagentByChat: s.activitySubagentByChat,
    };
  });
}

async function restoreTurnState(page, previo) {
  await page.evaluate((state) => window.__mageDev.store.setState(state), previo);
  await page.waitForTimeout(CONFIG.settleMs);
}

// Un mensaje del usuario y detras los eventos del motor, por el reducer REAL, en la pestaña activa.
async function injectTurn(page, events) {
  await page.evaluate((payload) => {
    const dev = window.__mageDev;
    const tabId = dev.store.getState().activeTabId;
    const user = { kind: 'user', id: 'v34-u', text: 'revisa esto', time: '12:00', attachments: [] };
    dev.store.setState((s) => ({ blocksByChat: { ...s.blocksByChat, [tabId]: [user] } }));
    for (const event of payload) dev.store.setState((s) => dev.reduceEvent(s, tabId, event));
  }, events);
  await page.waitForTimeout(CONFIG.settleMs);
}

async function hydrateBlocks(page, blocks) {
  const count = await page.evaluate((payload) => {
    const dev = window.__mageDev;
    if (dev === undefined) throw new Error('window.__mageDev no existe (¿la app no esta en modo desarrollo?)');
    const tabId = dev.store.getState().activeTabId;
    dev.store.setState({ blocksByChat: { ...dev.store.getState().blocksByChat, [tabId]: payload } });
    return payload.length;
  }, blocks);
  await page.waitForTimeout(CONFIG.settleMs);
  return count;
}

// Caja de tool sintetica, con la forma del modelo de la Fase D.
function toolBlock(id, toolClass, over = {}) {
  return {
    kind: 'tool',
    id,
    toolUseId: `u-${id}`,
    tool: toolClass === 'read' ? 'Read' : toolClass === 'search' ? 'Grep' : toolClass === 'edit' ? 'Edit' : 'Bash',
    toolClass,
    command: `src/fichero-${id}.ts`,
    meta: 'ok · 12 ms',
    isError: false,
    output: [{ code: false, text: `salida de ${id}` }],
    filePath: null,
    diff: null,
    writtenContent: null,
    artifact: null,
    artifactDraft: null,
    parentToolUseId: null,
    ...over,
  };
}

// Etiqueta del boton de menu que tiene el foco ahora mismo ('' si el foco no esta en la barra).
function focusedMenuLabel(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active.getAttribute('role') !== 'menuitem') return '';
    return active.closest('[role="menubar"]') === null ? '' : (active.textContent?.trim() ?? '');
  });
}

const TAB_MENU = '[role="menu"][aria-label^="Acciones de la pestaña"]';

// Abre el menu contextual de la pestaña ACTIVA con un clic derecho de verdad, lo mide y lo cierra con
// Escape (quien abre el suyo, lo cierra). Se cuenta ANTES de clicar: si hay mas de una pestaña
// seleccionada, no se clica nada (leccion §2 de la skill `verificacion-gui`).
async function measureTabContextMenu(page) {
  const active = page.locator('[role="tablist"][aria-label^="Conversaciones abiertas"] [role="tab"][aria-selected="true"]');
  const selected = await active.count();
  if (selected !== 1) return { menus: 0, seleccionadas: selected, items: 0, subtitulos: 0, color: 0, contadores: 0, cerrado: -1 };

  await active.click({ button: 'right' });
  await page.locator(TAB_MENU).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
  const measured = await page.evaluate((selector) => {
    const menu = document.querySelector(selector);
    if (menu === null) return null;
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const nodes = [...menu.querySelectorAll('*')];
    return {
      menus: document.querySelectorAll(selector).length,
      items: items.length,
      // Un subtitulo era un elemento DENTRO del item con su propia linea de texto tenue.
      subtitulos: items.filter((item) => item.querySelector('span, div') !== null).length,
      color: nodes.filter((node) => node.textContent?.trim() === 'COLOR').length,
      contadores: items.filter((item) => /\(\d+\)/.test(item.textContent ?? '')).length,
      etiquetas: items.map((item) => (item.textContent ?? '').trim()),
    };
  }, TAB_MENU);
  await page.keyboard.press('Escape');
  await page.locator(TAB_MENU).waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
  return { seleccionadas: selected, ...measured, cerrado: await page.locator(TAB_MENU).count() };
}

// Clamp del menu: se dispara el `contextmenu` en la esquina INFERIOR DERECHA de la ventana (un clic
// derecho de raton no puede caer ahi, porque las pestañas estan arriba) y se comprueba que el menu se
// queda dentro. Precedente real: `TooltipLayer` clampaba solo el centro. Ademas mide su alto, que es
// lo que el clamp usa ahora: si la medida se quedara en 0, este numero lo canta.
async function measureTabContextMenuClamp(page) {
  const opened = await page.evaluate(() => {
    const tab = document.querySelector('[role="tablist"][aria-label^="Conversaciones abiertas"] [role="tab"][aria-selected="true"]');
    if (tab === null) return false;
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: window.innerWidth - 4, clientY: window.innerHeight - 4 }));
    return true;
  });
  if (!opened) return null;
  await page.locator(TAB_MENU).waitFor({ state: 'visible', timeout: CONFIG.actionTimeoutMs });
  const measured = await page.evaluate((selector) => {
    const menu = document.querySelector(selector);
    if (menu === null) return null;
    const rect = menu.getBoundingClientRect();
    return {
      alto: menu.offsetHeight,
      dentroDeLaVentana: Math.ceil(rect.right) <= window.innerWidth && Math.ceil(rect.bottom) <= window.innerHeight,
      rect: { right: Math.round(rect.right), bottom: Math.round(rect.bottom), ventana: `${window.innerWidth}x${window.innerHeight}` },
    };
  }, TAB_MENU);
  await page.keyboard.press('Escape');
  await page.locator(TAB_MENU).waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs });
  return measured;
}

// --- Grupo 0: el turno minimo de verdad -----------------------------------------------------------

// Lo mas barato que acepta el CLI: el modelo pequeño, el esfuerzo minimo y una respuesta de una palabra.
const MINIMAL_TURN = {
  model: 'haiku',
  effort: 'low',
  prompt: 'Contesta solo con la palabra ok. No uses herramientas.',
  timeoutMs: 180_000,
};
// Proveedor del usuario que apunta al servidor falso (modo local). Id con el prefijo de los del usuario.
const FAKE_TURN_PROVIDER = { id: 'custom:vg-servidor-falso', label: 'VG servidor falso' };
// El turno local va por el RUNTIME PROPIO (P-032 R3) con el escenario que llama a Read y Glob en
// paralelo: dos peticiones al falso, un bloque Read en el hilo y el texto final.
const FAKE_TURN_MODEL = 'fake:openai-troceado';
const FAKE_TURN_FINAL_TEXT = 'Leído: el fichero dice hola.';
const RUNTIME_MODES_PROVIDER = { id: 'custom:vg-runtime-modos', label: 'VG runtime modos' };
const TRUST_DIALOG = '[role="dialog"][aria-labelledby="trust-title"]';

function forcedTurnTarget() {
  return process.argv.find((arg) => arg.startsWith('--turn='))?.slice('--turn='.length) ?? null;
}

// La guarda de uso: lee el uso de la cuenta activa por el mismo IPC que el panel de Uso (no gasta nada)
// y decide. Si hay que preguntar y hay alguien delante, pregunta en la terminal.
async function chooseTurnTarget(page) {
  const read = await page.evaluate(async () => {
    const accountId = window.__mageDev.store.getState().activeAccountId;
    try {
      return { usage: await window.mage.getUsage(accountId), error: null };
    } catch (error) {
      return { usage: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const spent = spentPercent(read.usage);
  const decision = decideTurnTarget({ spent, forced: forcedTurnTarget(), interactive: process.stdin.isTTY === true });
  if (decision.target !== 'ask') return { ...decision, usageError: read.error };
  console.log(`[verify:gui] AVISO: ${decision.reason}.`);
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const target = parseTurnAnswer(await terminal.question('¿Turno real (gasta cuota) o local (servidor falso)? [r/L] '));
    return { target, reason: `${decision.reason}; elegido en la terminal: ${target}`, usageError: read.error };
  } finally {
    terminal.close();
  }
}

// Abre la pestaña del turno y devuelve lo que TIENE que tener antes de enviar. Real: Ctrl+N (el camino
// de siempre) con modelo y esfuerzo minimos. Local: un proveedor del usuario apuntando al servidor
// falso; el gateway lee los proveedores del DISCO, asi que se espera a que el guardado llegue.
async function openTurnTab(page, { target, fake, userDataDir }) {
  if (target === 'real') {
    await openTemporaryConversation(page);
    await page.evaluate(({ model, effort }) => {
      const state = window.__mageDev.store.getState();
      state.setActiveModel(model);
      state.setActiveEffort(effort);
    }, MINIMAL_TURN);
    return { provider: 'claude', model: MINIMAL_TURN.model };
  }
  await page.evaluate(
    async ({ provider, baseUrl, model }) => {
      const state = window.__mageDev.store.getState();
      await state.saveCustomProvider({ id: provider.id, label: provider.label, baseUrl, hasApiKey: false, models: [{ id: model, label: model }] });
      const cwd = await window.mage.getScratchDir();
      await state.newTab({ accountId: state.activeAccountId, cwd, model, provider: provider.id, title: 'VG turno local', privacy: 'shared' });
    },
    { provider: FAKE_TURN_PROVIDER, baseUrl: fake.baseUrl, model: FAKE_TURN_MODEL },
  );
  await waitForFile(path.join(userDataDir, 'app-settings.json'), (text) => text.includes(FAKE_TURN_PROVIDER.id));
  return { provider: FAKE_TURN_PROVIDER.id, model: FAKE_TURN_MODEL };
}

// Reabre desde el historial la conversacion del turno local y espera a que se hidrate. Cierra la pestaña.
async function reopenTurnFromHistory(page, tab) {
  const opened = await page.evaluate(async (sessionTitle) => {
    const state = window.__mageDev.store.getState();
    await state.loadConversationHistory();
    const item = window.__mageDev.store.getState().conversationHistory.find((entry) => entry.title.startsWith(sessionTitle.slice(0, 20))) ?? null;
    if (item === null) return null;
    window.__mageDev.store.getState().openConversation(item);
    return item.sessionId;
  }, MINIMAL_TURN.prompt);
  if (opened === null) return { encontrada: false, tools: [], agentText: '' };
  const deadline = Date.now() + CONFIG.actionTimeoutMs;
  let last = { tools: [], agentText: '' };
  while (Date.now() < deadline) {
    const reopened = await activeTurnTab(page);
    if (reopened !== null) last = await readTurnState(page, reopened);
    if (last.tools.includes('Read') && last.agentText.length > 0) {
      await page.evaluate((id) => window.__mageDev.store.getState().closeTab(id), reopened.id);
      return { encontrada: true, provider: reopened.provider, ...last };
    }
    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }
  return { encontrada: true, ...last, agotado: true, tab: tab?.id ?? null };
}

// La pestaña activa, lo justo para la guarda y el informe.
function activeTurnTab(page) {
  return page.evaluate(() => {
    const state = window.__mageDev.store.getState();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return tab === undefined ? null : { id: tab.id, provider: tab.provider, model: tab.model, effort: tab.effort ?? null, cwd: tab.cwd };
  });
}

// GUARDA: se afirma proveedor y modelo de la pestaña activa ANTES de pulsar Enter. Si no casan, no se
// envia nada (un Enter en la pestaña equivocada es un turno en una conversacion de verdad).
async function sendMinimalTurn(page, expected) {
  const tab = await activeTurnTab(page);
  const matches = tab !== null && tab.provider === expected.provider && tab.model === expected.model;
  if (!matches) return { sent: false, tab, status: null, agentText: '', errors: [`pestaña activa inesperada; se esperaba ${JSON.stringify(expected)}`], kinds: [], tools: [], ms: 0 };
  await typeInPrompt(page, MINIMAL_TURN.prompt);
  const startedAt = Date.now();
  await page.keyboard.press('Enter');
  const outcome = await waitForTurnEnd(page, tab);
  return { sent: true, tab, ...outcome, ms: Date.now() - startedAt };
}

// Espera a que el turno termine (idle o error) o se pare pidiendo permiso. La carpeta temporal del
// perfil aislado no es de confianza: si la app pregunta por ESA carpeta, se confia (queda en los
// ajustes del perfil aislado, que se tira al acabar).
async function waitForTurnEnd(page, tab) {
  const deadline = Date.now() + MINIMAL_TURN.timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readTurnState(page, tab);
    if (last.askingTrust && (await page.locator(TRUST_DIALOG).count()) === 1) {
      await page.locator(TRUST_DIALOG).getByRole('button', { name: 'Confiar en esta carpeta', exact: true }).click();
    }
    if (last.status === 'idle' || last.status === 'error' || last.status === 'needs_permission') break;
    await page.waitForTimeout(CONFIG.pollIntervalMs);
  }
  return { status: last?.status ?? null, agentText: last?.agentText ?? '', errors: last?.errors ?? ['sin estado'], kinds: last?.kinds ?? [], tools: last?.tools ?? [] };
}

function readTurnState(page, tab) {
  return page.evaluate(({ id, cwd }) => {
    const state = window.__mageDev.store.getState();
    const blocks = state.blocksByChat[id] ?? [];
    const agentText = blocks
      .filter((block) => block.kind === 'agent' && !block.streaming)
      .map((block) => block.runs.map((run) => run.text).join(''))
      .join('\n');
    const errors = blocks.filter((block) => block.kind === 'error').map((block) => block.message);
    const kinds = blocks.map((block) => `${block.kind}${block.streaming === true ? '*' : ''}`);
    const tools = blocks.filter((block) => block.kind === 'tool').map((block) => block.tool);
    return { status: state.statusByChat[id] ?? 'idle', agentText, errors, kinds, tools, askingTrust: state.trustRequests.includes(cwd) };
  }, tab);
}

// --- Arranque y conexion -------------------------------------------------------------------------

function launchApp(userDataDir) {
  // electron-vite reenvia a Electron lo que va tras `--`. `--user-data-dir` es un switch nativo de
  // Electron/Chromium, asi que no hace falta nada en el codigo de Mage para aislarlo.
  // Se lanza el JS de electron-vite con el propio node, NO `pnpm`/`pnpm.cmd`: en Windows, `pnpm` es
  // un .cmd y desde Node 24 spawnearlo sin `shell: true` da EINVAL (mitigacion de CVE-2024-27980),
  // mientras que con `shell: true` los argumentos se concatenan sin escapar. Con `node <ruta.js>` no
  // hay ni shell ni .cmd, y ademas funciona igual en los tres SO.
  const args = [
    path.join(repoRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
    'dev',
    '--',
    `--remote-debugging-port=${CONFIG.port}`,
    `--user-data-dir=${userDataDir}`,
  ];
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    // Sin el sondeo de modelos del arranque (P-026 2.4): lanzaria el CLI real por cada cuenta con
    // sesion, y aqui el CLI solo lo lanza el turno minimo, a proposito.
    // MAGE_MCP_FAKE_SOURCES: el inventario de MCP lee las fuentes falsas sembradas, nunca las reales.
    // MAGE_MCP_FAKE_CLI: «Comprobar estado» y «Autenticar» hablan con un CLI falso en proceso, nunca el real.
    // VITE_MAGE_RELEASE_NOTES_IN_DEV: la apertura automatica de novedades corre tambien en dev, para
    // poder medirla; el seed de `seedOnboardingDone` la deja sin nada que abrir salvo en su comprobacion.
    env: {
      ...process.env,
      MAGE_SKIP_MODEL_PROBE: '1',
      MAGE_MCP_FAKE_SOURCES: mcpFakeSourcesDir(userDataDir),
      MAGE_MCP_FAKE_CLI: '1',
      // MAGE_GH_FAKE: el PR y el CI salen de un `gh` falso en proceso; nunca se lanza el real.
      MAGE_GH_FAKE: '1',
      // MAGE_AGY_USAGE_FAKE: el uso de agy del panel sale de su salida medida; nunca se lanza agy.
      MAGE_AGY_USAGE_FAKE: path.join(repoRoot, 'src', 'main', 'usage', '__fixtures__', 'agy-usage.json'),
      VITE_MAGE_RELEASE_NOTES_IN_DEV: '1',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX: grupo de procesos propio, para poder señalizar a TODO el arbol con kill(-pid). En
    // Windows no cambia nada relevante (la terminacion va por taskkill /T).
    detached: process.platform !== 'win32',
  });
  const log = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => log.push(chunk));
  child.stderr.on('data', (chunk) => log.push(chunk));
  return { child, log };
}

async function waitForCdp() {
  const deadline = Date.now() + CONFIG.bootTimeoutMs;
  const url = `http://127.0.0.1:${CONFIG.port}/json/version`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // aun no escucha: reintentar
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG.pollIntervalMs));
  }
  throw new Error(`El puerto de depuracion ${CONFIG.port} no respondio en ${CONFIG.bootTimeoutMs} ms`);
}

// La ventana principal es la de index.html: debug.html y widget.html son otras entradas del build.
async function findMainPage(browser) {
  const deadline = Date.now() + CONFIG.bootTimeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url();
        if (url.includes('debug.html') || url.includes('widget.html')) continue;
        if (url.startsWith('devtools://')) continue;
        if (url.includes('index.html') || url.endsWith('/')) return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG.pollIntervalMs));
  }
  throw new Error('No se encontro la ventana principal (index.html) por CDP');
}

// Termina el arbol: electron-vite spawnea electron, que spawnea renderers, GPU y utility. Un kill del
// hijo directo los dejaria vivos (misma razon que src/main/os/processTree.ts).
//
// SINCRONO a proposito: con `spawn` asincrono, el `process.exit()` del final se adelantaba al taskkill
// y quedaban CUATRO electron.exe vivos apuntando al perfil de la verificacion. Medido.
function killTree(child) {
  if (!child || child.pid == null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM'); // grupo entero (spawn con detached)
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // ya muerto
    }
  }
}

// --- Informe -------------------------------------------------------------------------------------

function writeReport(runDir, results, consoleErrors) {
  const lines = ['# Verificacion GUI de Mage', ''];
  lines.push(`- Fecha: ${new Date().toISOString()}`);
  lines.push(`- Plataforma: ${process.platform}`);
  lines.push('');
  lines.push('| Resultado | Comprobacion | Medida |');
  lines.push('|---|---|---|');
  for (const result of results) {
    const mark = result.ok ? 'OK' : 'FALLA';
    lines.push(`| ${mark} | ${result.name} | ${result.detail.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push(`## Errores de consola del renderer (${consoleErrors.length})`);
  lines.push('');
  if (consoleErrors.length === 0) lines.push('_Ninguno._');
  else for (const error of consoleErrors) lines.push(`- ${error}`);
  lines.push('');
  lines.push('> Esto MIDE el DOM real. NO juzga si el resultado se ve bien: ese vistazo es del usuario.');
  fs.writeFileSync(path.join(runDir, 'session.md'), `${lines.join('\n')}\n`, 'utf-8');
}

// --- Main ----------------------------------------------------------------------------------------

async function main() {
  const keepOpen = process.argv.includes('--keep');
  // Filtro por SUBCADENA del nombre (`--only=ventana`): iterar sobre UNA comprobacion sin pagar las 84
  // de la suite. Sin el flag corren todas, que es lo que hace `pnpm verify:gui`.
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length) ?? '';
  // Varias subcadenas con `|` (`--only=Ctrl+,|MCP y conectores`): una comprobacion que llega con un
  // dialogo abierto se puede probar junto a la que lo abre, en su orden de siempre.
  const needles = only.toLowerCase().split('|').filter((needle) => needle.length > 0);
  const checks = only === '' ? CHECKS : CHECKS.filter((c) => needles.some((needle) => c.name.toLowerCase().includes(needle)));
  if (checks.length === 0) throw new Error(`--only=${only} no casa con ninguna comprobacion`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(CONFIG.outDir, stamp);
  // Perfil NUEVO por ejecucion (no uno fijo que se borra): Electron mantiene el lock del perfil un
  // rato despues de morir, asi que un `rm` al arrancar fallaba con EPERM y tumbaba la verificacion
  // entera antes de empezar. Con un directorio por ejecucion no hay nada que borrar en caliente.
  const userDataDir = path.join(CONFIG.outDir, 'user-data', stamp);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  prunePreviousProfiles(userDataDir);
  seedCommandCatalog(userDataDir);
  seedOnboardingDone(userDataDir);
  seedMcpCommon(userDataDir);

  console.log(`[verify:gui] perfil aislado: ${userDataDir}`);
  const { child, log } = launchApp(userDataDir);
  let browser = null;
  const results = [];
  const consoleErrors = [];

  try {
    const wsEndpoint = await waitForCdp();
    browser = await chromium.connectOverCDP(wsEndpoint);
    const page = await findMainPage(browser);
    // Puerta de arranque: `panels-layout.json` se carga por IPC, asi que las stripes del dock montan
    // DESPUES del primer render. Sin esperarlas, la primera comprobacion medía una UI a medio montar
    // y daba un falso negativo (toolbars=0 con la app perfectamente arrancada).
    await page.locator('[role="toolbar"]').first().waitFor({ state: 'attached', timeout: CONFIG.bootTimeoutMs });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    for (const [index, check] of checks.entries()) {
      try {
        const outcome = await check.run(page, { userDataDir, runDir });
        results.push({ name: check.name, ...outcome });
        console.log(`  ${outcome.ok ? '✓' : '✗'} ${check.name} — ${outcome.detail}`);
      } catch (error) {
        results.push({ name: check.name, ok: false, detail: `excepcion: ${error.message}` });
        console.log(`  ✗ ${check.name} — excepcion: ${error.message}`);
        // RESCATE. Las comprobaciones comparten UNA ventana y tienen un contrato de estado: quien abre
        // un dialogo lo cierra. Ese contrato lo cumple el camino feliz — cuando una LANZA, su limpieza
        // no corre y el modal se queda abierto, tapando la app para todas las siguientes.
        //
        // Medido el 2026-09-18: tres comprobaciones de Proveedores se quedaron a medias con
        // Configuracion abierta y arrastraron a ~35 detras. Un informe donde un fallo produce treinta y
        // seis no se puede leer: no distingue la causa del daño colateral.
        //
        // Solo corre TRAS UN FALLO, asi que no puede enmascarar nada: lo que una comprobacion en verde
        // deje abierto a proposito sigue llegando intacto a la siguiente.
        await rescatarEstado(page).catch(() => undefined);
      }
      // El INDICE va delante del slug: `slug()` trunca a 60 caracteres y ya hay nombres de comprobacion
      // que solo se diferencian mas alla de ese corte -> dos capturas colisionaban y la segunda
      // sobrescribia a la primera EN SILENCIO (una captura que no es de lo que dice ser es peor que
      // ninguna). Con el indice delante, el nombre del PNG es unico por construccion y ademas queda
      // ordenado como el informe.
      const fileName = `${String(index + 1).padStart(2, '0')}-${slug(check.name)}.png`;
      await page.screenshot({ path: path.join(runDir, fileName) }).catch(() => {});
    }
  } catch (error) {
    results.push({ name: 'Arranque', ok: false, detail: error.message });
    console.error(`[verify:gui] ${error.message}`);
    fs.writeFileSync(path.join(runDir, 'launch.log'), log.join(''), 'utf-8');
  } finally {
    writeReport(runDir, results, consoleErrors);
    if (browser !== null) await browser.close().catch(() => {});
    if (!keepOpen) killTree(child);
    else console.log('[verify:gui] --keep: la app sigue abierta; ciérrala tú.');
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n[verify:gui] informe: ${path.join(runDir, 'session.md')}`);
  console.log(`[verify:gui] ${results.length - failed.length}/${results.length} comprobaciones en verde`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// Borra los perfiles de ejecuciones anteriores. Best-effort: si Electron aun tiene el lock, se deja
// para la proxima -- es basura en un directorio ignorado por git, nunca un motivo para no verificar.
function prunePreviousProfiles(currentDir) {
  const parent = path.dirname(currentDir);
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    const dir = path.join(parent, entry.name);
    if (!entry.isDirectory() || dir === currentDir) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // bloqueado por un Electron que aun no ha soltado el perfil: se intentara la proxima vez
    }
  }
}

function slug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

void main();

// Deja la ventana en un estado del que la siguiente comprobacion pueda partir, despues de que una haya
// LANZADO. No es cosmetica: sin esto un fallo se propaga a todas las que vienen detras y el informe
// deja de servir para diagnosticar (ver el comentario del bucle).
//
// Se usa Escape y no un boton de cerrar concreto: es lo que cierra CUALQUIER dialogo de la app (el
// contrato de `useDialogA11y`), y no depende de que exista tal o cual control. Se espera al
// DESMONTAJE, no a un tiempo fijo: los modales salen con animacion y medir a medias fue un
// intermitente real de este harness.
async function rescatarEstado(page) {
  for (let intento = 0; intento < 3; intento += 1) {
    if ((await page.locator(MODAL).count()) === 0) break;
    await page.keyboard.press('Escape');
    await page.locator(MODAL).first().waitFor({ state: 'detached', timeout: CONFIG.actionTimeoutMs }).catch(() => undefined);
  }
  // Un menu contextual abierto tapa clics igual que un modal, y no responde al mismo Escape en todos
  // los casos: un clic en una zona muerta lo cierra.
  if ((await page.locator('[role="menu"]').count()) > 0) {
    await page.mouse.click(2, 2).catch(() => undefined);
  }
}
