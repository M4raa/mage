// Baseline de interfaz (#40, apartado c): SOLO mide, no optimiza nada. Lo usa `verify-gui.mjs
// --perf-baseline`, que arranca la app con perfil aislado. Cada interaccion se repite y se resume en
// mediana, p90 y maximo (ms). La latencia es «de la entrada al siguiente pintado»: desde el `timeStamp`
// del evento (keydown/pointerdown) hasta un `setTimeout(0)` encadenado al primer `requestAnimationFrame`
// en que la condicion de «listo» se cumple. Con el perfil de CPU de Chromium (CDP Profiler) se
// atribuye el tiempo a funciones para buscar las causas antes de tocar nada.

export const PERF_REPEATS = 20;
const PROMPT = 'Escribe una instrucción para el agente';
const PROFILE_TOP = 15;

// Resumen estadistico de muestras en ms. Lanza con muestras vacias: un resumen de nada no es un dato.
export function summarize(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error(`Sin muestras que resumir: ${JSON.stringify(samples)}`);
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (v) => Math.round(v * 10) / 10;
  return { n: sorted.length, medianaMs: round(at(0.5)), p90Ms: round(at(0.9)), maxMs: round(sorted[sorted.length - 1]) };
}

// Agrega un perfil de CPU de CDP (`Profiler.stop`) por funcion: tiempo propio en ms, las `top` primeras.
export function topSelfTime(profile, top = PROFILE_TOP) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfMs = new Map();
  const deltas = profile.timeDeltas ?? [];
  profile.samples.forEach((nodeId, index) => {
    const node = byId.get(nodeId);
    if (node === undefined) return;
    const frame = node.callFrame;
    const file = frame.url.length === 0 ? '(nativo)' : frame.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '');
    const key = `${frame.functionName || '(anónima)'} · ${file}:${frame.lineNumber + 1}`;
    selfMs.set(key, (selfMs.get(key) ?? 0) + (deltas[index] ?? 0) / 1000);
  });
  return [...selfMs.entries()]
    .filter(([key]) => !key.startsWith('(idle)') && !key.startsWith('(program)'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([fn, ms]) => ({ fn, selfMs: Math.round(ms * 10) / 10 }));
}

// Mide UNA interaccion en dos pasos para no perder el evento: primero se arma en la pagina (listener de
// captura para la siguiente entrada de `eventType`) y se CONFIRMA armada; despues `act()` la provoca y se
// espera el resultado. «Listo» = `readyExpr` (JS evaluado en la pagina) verdadero en un frame. El plazo
// corre desde que se arma, haya llegado el evento o no: una medida que no llega lanza, nunca cuelga.
async function measureInteraction(page, eventType, readyExpr, act) {
  await page.evaluate(({ eventType, readyExpr, timeoutMs }) => {
    const ready = new Function(`return (${readyExpr});`);
    window.__perfResult = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Sin «listo» en ${timeoutMs} ms tras ${eventType}: ${readyExpr}`)), timeoutMs);
      const onInput = (event) => {
        document.removeEventListener(eventType, onInput, true);
        const t0 = event.timeStamp;
        const tick = () => {
          if (!ready()) return requestAnimationFrame(tick);
          setTimeout(() => { clearTimeout(timer); resolve(performance.now() - t0); }, 0);
        };
        requestAnimationFrame(tick);
      };
      document.addEventListener(eventType, onInput, true);
    });
  }, { eventType, readyExpr, timeoutMs: INTERACTION_TIMEOUT_MS });
  await act();
  return page.evaluate(() => window.__perfResult);
}

const INTERACTION_TIMEOUT_MS = 15_000;
// Texto del editor del prompt SIN el placeholder (CodeMirror lo pinta dentro de la linea).
const PROMPT_TEXT_EXPR = `[...document.querySelectorAll('[data-prompt-editor="true"] .cm-line')].map((l) => [...l.childNodes].filter((n) => !(n instanceof Element && n.classList.contains('cm-placeholder'))).map((n) => n.textContent).join('')).join('\\n')`;

async function measureRepeated(repeats, once) {
  const samples = [];
  for (let i = 0; i < repeats; i++) samples.push(await once(i));
  return summarize(samples);
}

// Escritura en el prompt: una tecla imprimible cada vez; «listo» = el editor ya tiene un caracter mas.
export async function measureTyping(page, repeats = PERF_REPEATS) {
  await page.getByRole('textbox', { name: PROMPT }).click();
  const result = await measureRepeated(repeats, async () => {
    const before = await page.evaluate((expr) => new Function(`return (${expr});`)().length, PROMPT_TEXT_EXPR);
    return measureInteraction(page, 'keydown', `(${PROMPT_TEXT_EXPR}).length > ${before}`, () => page.keyboard.press('x'));
  });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  return result;
}

// Cambio de pestaña con el raton entre dos pestañas: «listo» = el panel enseña la de destino.
export async function measureTabSwitch(page, tabIds, repeats = PERF_REPEATS) {
  if (tabIds.length < 2) throw new Error(`Hacen falta dos pestañas para medir el cambio: ${JSON.stringify(tabIds)}`);
  return measureRepeated(repeats, async (i) => {
    const target = tabIds[(i + 1) % 2];
    return measureInteraction(page, 'pointerdown', `document.querySelector('[data-pane-tab-id="${target}"]') !== null`, () => page.locator(`[role="tab"][data-tab-id="${target}"]`).click());
  });
}

// Abrir un panel del dock con su icono: «listo» = el icono queda pulsado. Se cierra entre muestras.
export async function measurePanelOpen(page, panelId, repeats = PERF_REPEATS) {
  const button = page.locator(`button[data-stripe-btn="true"][data-panel-id="${panelId}"]`).first();
  if ((await button.getAttribute('aria-pressed')) === 'true') await button.click();
  return measureRepeated(repeats, async () => {
    const ms = await measureInteraction(page, 'pointerdown', `document.querySelector('button[data-panel-id="${panelId}"]')?.getAttribute('aria-pressed') === 'true'`, () => button.click());
    await button.click();
    await page.waitForFunction((id) => document.querySelector(`button[data-panel-id="${id}"]`)?.getAttribute('aria-pressed') === 'false', panelId);
    return ms;
  });
}

// Render de una conversacion larga ya en memoria (necesita el puente de desarrollo): se inyectan
// `count` bloques usuario/agente con Markdown y se mide hasta el frame en que estan en el DOM.
export async function measureLongConversation(page, count) {
  return page.evaluate((n) => new Promise((resolve) => {
    const store = window.__mageDev.store;
    const id = store.getState().activeTabId;
    const text = 'Párrafo de prueba con **negrita**, `código` y una lista:\n\n- uno\n- dos\n\n' + 'Texto largo de relleno. '.repeat(20);
    const blocks = Array.from({ length: n }, (_, i) => (i % 2 === 0
      ? { kind: 'user', id: `pb-u${i}`, text: `Mensaje ${i}: ${text}`, time: '12:00', attachments: [] }
      : { kind: 'agent', id: `pb-a${i}`, runs: [{ code: false, text: `Respuesta ${i}: ${text}` }], streaming: false }));
    const t0 = performance.now();
    store.setState((s) => ({ blocksByChat: { ...s.blocksByChat, [id]: blocks } }));
    const tick = () => {
      if (document.querySelectorAll(`[data-pane-tab-id="${id}"] [data-block]`).length < n) return requestAnimationFrame(tick);
      setTimeout(() => resolve({ bloques: n, ms: Math.round(performance.now() - t0), nodosDom: document.getElementsByTagName('*').length }), 0);
    };
    requestAnimationFrame(tick);
  }), count);
}

// Eco de IPC a main (`getUpdateState`, sin trabajo): mide si el proceso main responde con holgura.
export async function measureIpcEcho(page, repeats = PERF_REPEATS) {
  const samples = await page.evaluate(async (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await window.mage.getUpdateState();
      out.push(performance.now() - t0);
    }
    return out;
  }, repeats);
  return summarize(samples);
}

// Perfil de CPU del renderer mientras corre `action`; devuelve las funciones con mas tiempo propio.
export async function profileWhile(page, action) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await action();
    const { profile } = await cdp.send('Profiler.stop');
    return topSelfTime(profile);
  } finally {
    await cdp.detach();
  }
}

const LONG_CONVERSATION_SIZES = [200, 1000, 3000];
const PANELS = ['activity', 'context', 'logs'];
const PROFILE_KEYS = 30;

// Ids de las pestañas visibles en la barra, por el DOM (vale tambien sin el puente de desarrollo).
function tabIdsInBar(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role="tab"][data-tab-id]')].map((el) => el.getAttribute('data-tab-id')));
}

async function measureLongConversations(page) {
  const result = [];
  for (const size of LONG_CONVERSATION_SIZES) result.push(await measureLongConversation(page, size));
  return result;
}

// Toda la medicion del baseline. `openConversation` es el helper del harness (Ctrl+N); con `devBridge`
// falso (build de produccion) se omite lo que necesita inyectar estado.
export async function runPerfBaseline(page, { openConversation, devBridge }) {
  await openConversation(page);
  await openConversation(page);
  const tabs = (await tabIdsInBar(page)).slice(-2);
  const out = { modo: devBridge ? 'desarrollo (electron-vite dev, React de desarrollo)' : 'producción (electron-vite preview del build)', repeticiones: PERF_REPEATS };
  out.escrituraPrompt = await measureTyping(page);
  out.cambioPestana = await measureTabSwitch(page, tabs);
  out.aperturaPanel = {};
  for (const panel of PANELS) out.aperturaPanel[panel] = await measurePanelOpen(page, panel);
  out.ecoIpcMain = await measureIpcEcho(page);
  out.perfilEscritura = await profileWhile(page, async () => { for (let i = 0; i < PROFILE_KEYS; i++) await page.keyboard.press('x'); });
  out.perfilCambioPestana = await profileWhile(page, async () => { for (let i = 0; i < 10; i++) await page.locator(`[role="tab"][data-tab-id="${tabs[i % 2]}"]`).click(); });
  if (!devBridge) return out;
  out.conversacionLarga = await measureLongConversations(page);
  out.escrituraConConversacionLarga = await measureTyping(page);
  out.cambioPestanaConConversacionLarga = await measureTabSwitch(page, tabs);
  out.perfilEscrituraConConversacionLarga = await profileWhile(page, async () => { for (let i = 0; i < PROFILE_KEYS; i++) await page.keyboard.press('x'); });
  return out;
}
