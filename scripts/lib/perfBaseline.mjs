// Baseline de interfaz (#40, apartado c): SOLO mide, no optimiza nada. Lo usa `verify-gui.mjs
// --perf-baseline`, que arranca la app con perfil aislado. Cada interaccion se repite y se resume en
// mediana, p90 y maximo (ms). La latencia es «de la entrada al siguiente pintado»: desde el `timeStamp`
// del evento (keydown/pointerdown) hasta un `setTimeout(0)` encadenado al primer `requestAnimationFrame`
// en que la condicion de «listo» se cumple. Con el perfil de CPU de Chromium (CDP Profiler) se
// atribuye el tiempo a funciones para buscar las causas antes de tocar nada.

export const PERF_REPEATS = 20;
const PROMPT = 'Escribe una instrucción para el agente';
const PROFILE_TOP = 15;
// Funciones que se conservan aunque no esten entre las primeras: el sidebar (criterio de F2.5, «el sidebar ya no
// aparece en el perfil del cambio de pestaña»). Con muestreo de 200 µs, un render mas corto puede no salir.
const PROFILE_KEEP = /components\/ChatSidebar\.tsx/;

// Resumen estadistico de muestras en ms. Lanza con muestras vacias: un resumen de nada no es un dato.
export function summarize(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error(`Sin muestras que resumir: ${JSON.stringify(samples)}`);
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (v) => Math.round(v * 10) / 10;
  return { n: sorted.length, medianaMs: round(at(0.5)), p90Ms: round(at(0.9)), maxMs: round(sorted[sorted.length - 1]) };
}

// Agrega un perfil de CPU de CDP (`Profiler.stop`) por funcion: tiempo propio en ms, las `top` primeras y,
// detras, las que casan con `keep` aunque no lleguen.
export function topSelfTime(profile, top = PROFILE_TOP, keep = PROFILE_KEEP) {
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
  const ranked = [...selfMs.entries()]
    .filter(([key]) => !key.startsWith('(idle)') && !key.startsWith('(program)'))
    .sort((a, b) => b[1] - a[1]);
  const kept = ranked.slice(top).filter(([key]) => keep.test(key));
  return [...ranked.slice(0, top), ...kept].map(([fn, ms]) => ({ fn, selfMs: Math.round(ms * 10) / 10 }));
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

// «Listo» del cambio de pestaña: el panel de destino esta montado y, si es un chat con lista virtual, ya
// pinto su ultima fila (con lista virtual, «panel montado» no implica «ultima fila pintada»).
export function tabSwitchReadyExpr(target) {
  return `(() => { const p = document.querySelector('[data-pane-tab-id="${target}"]'); return p !== null && (p.querySelector('[data-chat-scroller]') === null || p.querySelector('[data-last-row="true"]') !== null); })()`;
}

// Cambio de pestaña con el raton entre dos pestañas: «listo» = el panel enseña la de destino.
export async function measureTabSwitch(page, tabIds, repeats = PERF_REPEATS) {
  if (tabIds.length < 2) throw new Error(`Hacen falta dos pestañas para medir el cambio: ${JSON.stringify(tabIds)}`);
  return measureRepeated(repeats, async (i) => {
    const target = tabIds[(i + 1) % 2];
    return measureInteraction(page, 'pointerdown', tabSwitchReadyExpr(target), () => page.locator(`[role="tab"][data-tab-id="${target}"]`).click());
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
// `count` bloques usuario/agente con Markdown y se mide hasta el frame en que la lista virtual pinto la ultima fila y esta al final (con lista virtual nunca
// llegan a estar los `count` bloques en el DOM).
export async function measureLongConversation(page, count) {
  return page.evaluate(({ n, timeoutMs }) => new Promise((resolve, reject) => {
    const store = window.__mageDev.store;
    const id = store.getState().activeTabId;
    const text = 'Párrafo de prueba con **negrita**, `código` y una lista:\n\n- uno\n- dos\n\n' + 'Texto largo de relleno. '.repeat(20);
    const blocks = Array.from({ length: n }, (_, i) => (i % 2 === 0
      ? { kind: 'user', id: `pb-u${i}`, text: `Mensaje ${i}: ${text}`, time: '12:00', attachments: [] }
      : { kind: 'agent', id: `pb-a${i}`, runs: [{ code: false, text: `Respuesta ${i}: ${text}` }], streaming: false }));
    const t0 = performance.now();
    const deadline = t0 + timeoutMs;
    store.setState((s) => ({ blocksByChat: { ...s.blocksByChat, [id]: blocks } }));
    const tick = () => {
      const pane = document.querySelector(`[data-pane-tab-id="${id}"]`);
      const scroller = pane?.querySelector('[data-chat-scroller]') ?? null;
      const atBottom = scroller !== null && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2;
      if (pane?.querySelector('[data-last-row="true"]') == null || !atBottom) {
        if (performance.now() > deadline) {
          const medido = { ultimaFila: pane?.querySelector('[data-last-row="true"]') != null, distanciaAlFondo: scroller === null ? null : Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) };
          reject(new Error(`Sin la última fila al fondo en ${timeoutMs} ms con ${n} bloques: ${JSON.stringify(medido)}`));
          return undefined;
        }
        return requestAnimationFrame(tick);
      }
      setTimeout(() => resolve({ bloques: n, ms: Math.round(performance.now() - t0), nodosDom: document.getElementsByTagName('*').length }), 0);
    };
    requestAnimationFrame(tick);
  }), { n: count, timeoutMs: LONG_CONVERSATION_TIMEOUT_MS });
}

// Ancla al anteponer historial (necesita el puente): con la pestaña activa ya en 3000 bloques, lee una fila
// a mitad del hilo, antepone 200 bloques y mide cuanto se movio esa fila (debe ser 0 px).
export async function measurePrependAnchor(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const frames = (n, done) => (n === 0 ? done() : requestAnimationFrame(() => frames(n - 1, done)));
    const store = window.__mageDev.store;
    const id = store.getState().activeTabId;
    const scroller = document.querySelector(`[data-pane-tab-id="${id}"] [data-chat-scroller]`);
    if (scroller === null) return resolve({ anclaAlAnteponerPx: null, motivo: 'no hay lista virtual en la pestaña activa' });
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
    frames(2, () => {
      const box = scroller.getBoundingClientRect();
      const read = [...scroller.querySelectorAll('[data-block]')].find((el) => { const top = el.getBoundingClientRect().top; return top >= box.top && top <= box.bottom; });
      const key = read?.closest('[data-row-key]')?.getAttribute('data-row-key') ?? null;
      if (read === undefined || key === null) return resolve({ anclaAlAnteponerPx: null, motivo: 'ninguna fila de lectura dentro del scroller' });
      const before = read.getBoundingClientRect().top;
      const text = 'Párrafo de prueba con **negrita**, `código` y una lista:\n\n- uno\n- dos\n\n' + 'Texto largo de relleno. '.repeat(20);
      const fresh = Array.from({ length: 200 }, (_, i) => (i % 2 === 0
        ? { kind: 'user', id: `pb-pre${i}`, text: `Mensaje ${i}: ${text}`, time: '12:00', attachments: [] }
        : { kind: 'agent', id: `pb-pre${i}`, runs: [{ code: false, text: `Respuesta ${i}: ${text}` }], streaming: false }));
      store.setState((s) => ({ blocksByChat: { ...s.blocksByChat, [id]: [...fresh, ...s.blocksByChat[id]] } }));
      frames(2, () => {
        const after = scroller.querySelector(`[data-row-key="${key}"] [data-block]`);
        if (after === null) return resolve({ anclaAlAnteponerPx: null, motivo: 'la fila de lectura salió del DOM' });
        resolve({ anclaAlAnteponerPx: Math.round((after.getBoundingClientRect().top - before) * 10) / 10 });
      });
    });
  }));
}

// Cambio de pestaña con una conversacion REAL larga abierta desde el historial (vale en produccion, sin
// puente): busca la del fixture en el lateral, la abre (solo lee su transcripcion), abre una vacia y mide el
// cambio entre ambas.
export async function measureLongTranscriptTabSwitch(page, { openConversation, title }) {
  const before = await tabIdsInBar(page);
  await page.getByRole('textbox', { name: SIDEBAR_SEARCH_LABEL }).fill(LONG_TRANSCRIPT_SEARCH);
  await page.locator('[data-history-session]').filter({ hasText: title }).first().click();
  await page.waitForFunction((count) => document.querySelectorAll('[role="tab"][data-tab-id]').length > count, before.length, { timeout: INTERACTION_TIMEOUT_MS });
  const longId = (await tabIdsInBar(page)).at(-1);
  await page.waitForSelector(`[data-pane-tab-id="${longId}"] [data-last-row="true"]`, { timeout: INTERACTION_TIMEOUT_MS });
  await openConversation(page);
  const emptyId = (await tabIdsInBar(page)).at(-1);
  return measureTabSwitch(page, [longId, emptyId]);
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
// Plazo de la espera «última fila al fondo»: `page.evaluate` no tiene plazo propio y, sin él, una condición que no llega cuelga la medición para siempre.
const LONG_CONVERSATION_TIMEOUT_MS = 60_000;
// Texto del buscador del lateral (catalogo `sidebar.search.label` de es.json) y lo que se teclea para hallar el fixture.
const SIDEBAR_SEARCH_LABEL = 'Buscar conversaciones';
const LONG_TRANSCRIPT_SEARCH = 'VG-T3';
const PANELS = ['activity', 'context', 'logs'];
const PROFILE_KEYS = 30;

// Para nombrar el modal que tapa una medida sin copiar texto que pueda ser del usuario: rol, id de su título y nombres de atributos.
export async function describeOverlays(page) {
  return page.evaluate(() => {
    const dataNames = (root, depth, into) => {
      for (const attr of root.attributes) if (attr.name.startsWith('data-')) into.add(attr.name);
      if (depth > 0) for (const child of root.children) dataNames(child, depth - 1, into);
      return into;
    };
    return [...document.querySelectorAll('.fixed.inset-0')]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return getComputedStyle(el).display !== 'none' && box.width > 0 && box.height > 0;
      })
      .map((el) => {
        const withRole = el.getAttribute('role') !== null ? el : el.querySelector('[role]');
        const withLabel = el.getAttribute('aria-labelledby') !== null ? el : el.querySelector('[aria-labelledby]');
        return {
          clase: el.className,
          rol: withRole?.getAttribute('role') ?? null,
          labelledby: withLabel?.getAttribute('aria-labelledby') ?? null,
          datos: [...dataNames(el, 2, new Set())].sort(),
        };
      });
  });
}

// Ejecuta un paso de la medición con nombre: si falla, el error dice en qué paso fue y, con `page`, qué overlays había encima.
export async function withStep(name, run, page) {
  try {
    return await run();
  } catch (error) {
    const overlays = page === undefined ? [] : await describeOverlays(page).catch((overlayError) => [{ error: String(overlayError) }]);
    const suffix = overlays.length === 0 ? '' : ` · overlays: ${JSON.stringify(overlays)}`;
    throw new Error(`Paso «${name}»: ${error instanceof Error ? error.message : String(error)}${suffix}`, { cause: error });
  }
}

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
export async function runPerfBaseline(page, { openConversation, devBridge, longTranscriptTitle }) {
  await withStep('abrirConversaciones', async () => { await openConversation(page); await openConversation(page); }, page);
  const tabs = (await tabIdsInBar(page)).slice(-2);
  const out = { modo: devBridge ? 'desarrollo (electron-vite dev, React de desarrollo)' : 'producción (electron-vite preview del build)', repeticiones: PERF_REPEATS };
  out.escrituraPrompt = await withStep('escrituraPrompt', () => measureTyping(page), page);
  out.cambioPestana = await withStep('cambioPestana', () => measureTabSwitch(page, tabs), page);
  out.aperturaPanel = {};
  for (const panel of PANELS) out.aperturaPanel[panel] = await withStep(`aperturaPanel.${panel}`, () => measurePanelOpen(page, panel), page);
  out.ecoIpcMain = await withStep('ecoIpcMain', () => measureIpcEcho(page), page);
  out.perfilEscritura = await withStep('perfilEscritura', () => profileWhile(page, async () => { for (let i = 0; i < PROFILE_KEYS; i++) await page.keyboard.press('x'); }), page);
  out.perfilCambioPestana = await withStep('perfilCambioPestana', () => profileWhile(page, async () => { for (let i = 0; i < 10; i++) await page.locator(`[role="tab"][data-tab-id="${tabs[i % 2]}"]`).click(); }), page);
  if (devBridge) await measureWithDevBridge(page, out, tabs);
  // Al final: abrir la conversacion larga cambia la pestaña activa, y las medidas con puente van sobre `tabs`.
  out.cambioPestanaConTranscripcionLarga = await withStep('cambioPestanaConTranscripcionLarga', () => measureLongTranscriptTabSwitch(page, { openConversation, title: longTranscriptTitle }), page);
  return out;
}

// Las medidas que inyectan estado por el puente de desarrollo.
async function measureWithDevBridge(page, out, tabs) {
  out.conversacionLarga = await withStep('conversacionLarga', () => measureLongConversations(page), page);
  out.anclaAlAnteponer = await withStep('anclaAlAnteponer', () => measurePrependAnchor(page), page);
  out.escrituraConConversacionLarga = await withStep('escrituraConConversacionLarga', () => measureTyping(page), page);
  out.cambioPestanaConConversacionLarga = await withStep('cambioPestanaConConversacionLarga', () => measureTabSwitch(page, tabs), page);
  out.perfilEscrituraConConversacionLarga = await withStep('perfilEscrituraConConversacionLarga', () => profileWhile(page, async () => { for (let i = 0; i < PROFILE_KEYS; i++) await page.keyboard.press('x'); }), page);
}
