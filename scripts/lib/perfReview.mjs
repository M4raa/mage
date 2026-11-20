// Revisión de rendimiento: SOLO mide, no cambia nada de la app. La usa `verify-gui.mjs --perf-review` con el perfil
// aislado, el HOME de prueba y el servidor OpenAI falso local (ningún turno real). Mide:
// - el arranque: del lanzamiento a la marca `mage:workbench-mounted` (reloj de pared en los dos lados);
// - el bloqueo de main: la sonda de 0.3 (idas y vueltas de IPC al handler más barato) durante cada operación y el perfil
//   de CPU de main por su inspector (`--inspect` en 127.0.0.1, solo en la app sin empaquetar que lanza el harness);
// - el renderer: tareas largas (Long Tasks API) e intervalos entre frames (rAF) durante cada operación;
// - la memoria: heap de main y del renderer tras un GC, y la de los procesos de la tanda (solo Windows);
// - el IPC: eventos de sesión que recibe el renderer en un turno largo en streaming (por tipo y tamaño);
// - el historial grande: conversaciones sembradas en la cuenta de prueba, «Cuentas y consumo» y listar el historial.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLongTranscript, encodeProjectFolderName } from './longTranscriptFixture.mjs';
import { measureInteraction, measureTabSwitch, profileWhile, summarize, tabIdsInBar, topSelfTime } from './perfBaseline.mjs';
import { ui } from './uiText.mjs';

export const PERF_HISTORY_CONVERSATIONS = 300;
const PERF_HISTORY_BLOCKS = 40;
const PERF_HISTORY_PROJECTS = 10;
const HISTORY_SPREAD_DAYS = 7;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const PERF_TABS = 30;
const SETTINGS_REPEATS = 10;
const USAGE_REPEATS = 5;
const IPC_REPEATS = 5;
// Más que HISTORY_POLL_MS (App.tsx) y TASK_SCHEDULER_TICK_MS (main), los dos de 30 s: caza dos pasadas de cada uno.
const IDLE_WINDOW_MS = 65_000;
const PROBE_GAP_MS = 10;
// Umbral de la Long Tasks API y presupuesto de ida y vuelta de 0.3 (IPC_BLOCK_BUDGET_MS de verify-gui.mjs).
const LONG_TASK_MS = 50;
const IPC_BLOCK_BUDGET_MS = 120;
const MAIN_PROFILE_INTERVAL_US = 1000;
const INSPECTOR_TIMEOUT_MS = 10_000;
const INSPECTOR_POLL_MS = 250;
const INSPECTOR_CALL_TIMEOUT_MS = 60_000;
const DATA_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 15_000;
const TURN_TIMEOUT_MS = 90_000;
const TURN_POLL_MS = 100;
const TYPE_DELAY_MS = 25;
const KB = 1024;
const MB = 1024 * 1024;
const PROMPT = ui('prompt.editor.ariaLabel');
const MODAL = '[role="dialog"][aria-modal="true"]';
const USAGE_VIEW = '[data-accounts-usage]';
const PERF_PROVIDER = { id: 'custom:vg-perf', label: 'VG perf' };
const PERF_MODEL = 'fake:largo';
const TURN_PROMPT = 'mide';
// Solo lee: los electron.exe con su padre y su memoria (WorkingSetSize en bytes, PageFileUsage en KB).
const PS_ELECTRON_PROCESSES = "Get-CimInstance -ClassName Win32_Process | Where-Object Name -eq 'electron.exe' | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PageFileUsage,CommandLine | ConvertTo-Json -Compress";

const round1 = (value) => Math.round(value * 10) / 10;
const errorText = (error) => (error instanceof Error ? error.message : String(error));
const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Historial sembrado ---

// Id con forma de UUID (el historial solo lista `<uuid>.jsonl`), con el índice en la última parte.
function perfSessionId(index) {
  return `7e5f0000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

// El historial de consumo cuenta el uso UNA vez por `message.id`: sin él, la siembra no sumaría nada.
function withMessageId(line, id) {
  const entry = JSON.parse(line);
  if (entry.type !== 'assistant') return line;
  return JSON.stringify({ ...entry, message: { ...entry.message, id: `msg_${id}` } });
}

function writeSeededConversation(accountDir, index, { blocks, nowMs }) {
  const cwd = path.join(path.dirname(accountDir), 'vg-perf-proyectos', `proyecto-${index % PERF_HISTORY_PROJECTS}`);
  const sessionId = perfSessionId(index);
  const startMs = nowMs - (index % HISTORY_SPREAD_DAYS) * DAY_MS - (index + 1) * MINUTE_MS;
  const lines = buildLongTranscript({ sessionId, cwd, blocks, startMs }).map((line, n) => withMessageId(line, `${sessionId}-${n}`));
  const dir = path.join(accountDir, 'projects', encodeProjectFolderName(cwd));
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  const text = `${lines.join('\n')}\n`;
  fs.writeFileSync(file, text, 'utf-8');
  return { file, bytes: Buffer.byteLength(text) };
}

// Siembra `conversations` transcripciones de Claude en `<accountDir>/projects/`, repartidas en PERF_HISTORY_PROJECTS
// proyectos y en los últimos HISTORY_SPREAD_DAYS días. Devuelve las rutas y los bytes escritos.
export function seedPerfHistory(accountDir, { conversations = PERF_HISTORY_CONVERSATIONS, blocks = PERF_HISTORY_BLOCKS, nowMs }) {
  if (typeof accountDir !== 'string' || !path.isAbsolute(accountDir)) throw new Error(`accountDir no absoluto: ${JSON.stringify(accountDir)}`);
  if (!Number.isFinite(nowMs)) throw new Error(`nowMs no valido: ${JSON.stringify(nowMs)}`);
  const files = [];
  let bytes = 0;
  for (let index = 0; index < conversations; index += 1) {
    const written = writeSeededConversation(accountDir, index, { blocks, nowMs });
    files.push(written.file);
    bytes += written.bytes;
  }
  return { files, bytes };
}

// --- Resúmenes (puros) ---

// Idas y vueltas de la sonda de main: resumen y cuántas pasaron del umbral de tarea larga y del presupuesto de 0.3.
export function summarizeLag(samples) {
  if (samples.length === 0) return null;
  return { ...summarize(samples), sobre50Ms: samples.filter((ms) => ms > LONG_TASK_MS).length, sobre120Ms: samples.filter((ms) => ms > IPC_BLOCK_BUDGET_MS).length };
}

// Tareas largas e intervalos entre frames del renderer.
export function summarizeRenderer({ longTasks, frames }) {
  return {
    tareasLargas: longTasks.length,
    tareasLargasTotalMs: Math.round(longTasks.reduce((sum, ms) => sum + ms, 0)),
    peorTareaMs: longTasks.length === 0 ? 0 : Math.round(Math.max(...longTasks)),
    frames: frames.length === 0 ? null : summarize(frames),
    framesSobre50Ms: frames.filter((ms) => ms > LONG_TASK_MS).length,
  };
}

// El main de la tanda (electron.exe sin `--type=` con el perfil en su línea de órdenes) y sus hijos directos.
export function pickProcessTree(raw, profileDir) {
  const list = Array.isArray(raw) ? raw : [raw];
  const line = (p) => p.CommandLine ?? '';
  const main = list.find((p) => line(p).includes(profileDir) && !line(p).includes('--type='));
  if (main === undefined) throw new Error(`Ningún electron.exe principal con el perfil ${profileDir} (de ${list.length})`);
  return [main, ...list.filter((p) => p.ParentProcessId === main.ProcessId)].map((p) => ({
    pid: p.ProcessId,
    tipo: /--type=([\w-]+)/.exec(line(p))?.[1] ?? 'main',
    workingSetMb: round1(Number(p.WorkingSetSize) / MB),
    privadaMb: round1(Number(p.PageFileUsage) / KB),
  }));
}

// --- En la página (se serializan con page.evaluate: no pueden usar nada de este módulo) ---

function startWatchInPage(gapMs) {
  const watch = { probe: [], longTasks: [], frames: [], stop: false, last: performance.now() };
  watch.observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) watch.longTasks.push(entry.duration);
  });
  watch.observer.observe({ entryTypes: ['longtask'] });
  const tick = (now) => {
    watch.frames.push(now - watch.last);
    watch.last = now;
    if (!watch.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  watch.probing = (async () => {
    while (!watch.stop) {
      const t0 = performance.now();
      await window.mage.loadConversationPrefs('verify-gui-sonda');
      watch.probe.push(performance.now() - t0);
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  })();
  window.__perfWatch = watch;
}

async function stopWatchInPage() {
  const watch = window.__perfWatch;
  watch.stop = true;
  watch.observer.disconnect();
  await watch.probing;
  delete window.__perfWatch;
  return { probe: watch.probe, longTasks: watch.longTasks, frames: watch.frames.slice(1) };
}

function startEventCountInPage() {
  const count = { total: 0, caracteresJson: 0, porTipo: {} };
  count.off = window.mage.onSessionEvent((payload) => {
    const kind = payload.event?.kind ?? '(sin kind)';
    count.total += 1;
    count.caracteresJson += JSON.stringify(payload).length;
    count.porTipo[kind] = (count.porTipo[kind] ?? 0) + 1;
  });
  window.__perfEvents = count;
}

function stopEventCountInPage() {
  const count = window.__perfEvents;
  count.off();
  delete window.__perfEvents;
  return { total: count.total, caracteresJson: count.caracteresJson, porTipo: count.porTipo };
}

// --- Inspector de main ---

async function fetchJsonUntil(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'sin intentos';
  while (Date.now() < deadline) {
    const outcome = await settle(fetch(url).then((response) => response.json()));
    if (outcome.error === undefined) return outcome.value;
    last = errorText(outcome.error);
    await sleep(INSPECTOR_POLL_MS);
  }
  throw new Error(`Sin respuesta de ${url} en ${timeoutMs} ms: ${last}`);
}

function settleReply(pending, message) {
  const waiter = pending.get(message.id);
  if (waiter === undefined) return; // eventos del inspector (sin id): nadie los espera
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.error !== undefined) waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(message.error)}`));
  else waiter.resolve(message.result);
}

// Cliente mínimo del inspector de main: el WebSocket global de Node y un id por petición, con plazo.
export async function connectMainInspector(port) {
  const targets = await fetchJsonUntil(`http://127.0.0.1:${port}/json/list`, INSPECTOR_TIMEOUT_MS);
  const url = targets.find((target) => typeof target.webSocketDebuggerUrl === 'string')?.webSocketDebuggerUrl;
  if (url === undefined) throw new Error(`El inspector de main no da webSocketDebuggerUrl: ${JSON.stringify(targets)}`);
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error(`No se pudo abrir ${url}`)), { once: true });
  });
  const pending = new Map();
  socket.addEventListener('message', (event) => settleReply(pending, JSON.parse(String(event.data))));
  let nextId = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    nextId += 1;
    const id = nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: sin respuesta en ${INSPECTOR_CALL_TIMEOUT_MS} ms`)); }, INSPECTOR_CALL_TIMEOUT_MS);
    pending.set(id, { method, resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => socket.close() };
}

async function openInspector(port) {
  const outcome = await settle(connectMainInspector(port));
  if (outcome.error !== undefined) return { inspector: null, error: errorText(outcome.error) };
  await outcome.value.send('Profiler.enable');
  await outcome.value.send('HeapProfiler.enable');
  return { inspector: outcome.value, error: null };
}

// --- Medir una operación ---

// Sonda de main y vigilancia del renderer mientras corre `action`.
async function measureDuring(page, action) {
  await page.evaluate(startWatchInPage, PROBE_GAP_MS);
  const started = Date.now();
  const outcome = await settle(action());
  const duracionMs = Date.now() - started;
  const raw = await page.evaluate(stopWatchInPage);
  if (outcome.error !== undefined) throw outcome.error;
  return { valor: outcome.value ?? null, duracionMs, sondaMain: summarizeLag(raw.probe), renderer: summarizeRenderer(raw) };
}

// Lo de `measureDuring` y, con inspector, el perfil de CPU de main (funciones con más tiempo propio).
async function measure(m, action) {
  const inspector = m.main.inspector;
  if (inspector === null) return { ...(await measureDuring(m.page, action)), perfilMain: `sin inspector: ${m.main.error}` };
  await inspector.send('Profiler.setSamplingInterval', { interval: MAIN_PROFILE_INTERVAL_US });
  await inspector.send('Profiler.start');
  const outcome = await settle(measureDuring(m.page, action));
  const { profile } = await inspector.send('Profiler.stop');
  if (outcome.error !== undefined) throw outcome.error;
  return { ...outcome.value, perfilMain: topSelfTime(profile) };
}

// Un apartado que falla deja su error en el JSON y no se lleva por delante a los demás: el error ES su medida.
async function safeStep(out, key, run) {
  const outcome = await settle(run());
  out[key] = outcome.error === undefined ? outcome.value : { error: errorText(outcome.error) };
}

// --- Memoria ---

async function heapMb(send) {
  await send('HeapProfiler.collectGarbage');
  const usage = await send('Runtime.getHeapUsage');
  return { usadoMb: round1(usage.usedSize / MB), totalMb: round1(usage.totalSize / MB) };
}

export function processMemory(profileDir) {
  if (process.platform !== 'win32') return 'solo Windows';
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_ELECTRON_PROCESSES], { encoding: 'utf8', windowsHide: true });
  if (run.status !== 0) throw new Error(`Get-CimInstance falló (${run.status}): ${run.stderr}`);
  const text = run.stdout.trim();
  return pickProcessTree(text.length === 0 ? [] : JSON.parse(text), profileDir);
}

function processMemoryOrError(profileDir) {
  try {
    return processMemory(profileDir);
  } catch (error) {
    return { error: errorText(error) };
  }
}

async function memorySnapshot(m) {
  const heapMain = m.main.inspector === null ? `sin inspector: ${m.main.error}` : await heapMb(m.main.inspector.send);
  return { heapRenderer: await heapMb(m.cdpSend), heapMain, procesos: processMemoryOrError(m.ctx.userDataDir) };
}

// --- Operaciones ---

async function measureBoot(page, { spawnAtMs, mountedMark }) {
  const boot = await page.evaluate((mark) => {
    const entry = performance.getEntriesByName(mark)[0];
    const nav = performance.getEntriesByType('navigation')[0];
    if (entry === undefined) return null;
    return { montadoEpochMs: performance.timeOrigin + entry.startTime, montadoMs: entry.startTime, dclMs: nav === undefined ? null : nav.domContentLoadedEventEnd };
  }, mountedMark);
  if (boot === null) throw new Error(`No existe la marca ${mountedMark}`);
  return { desdeLanzarMs: Math.round(boot.montadoEpochMs - spawnAtMs), desdeNavegacionMs: Math.round(boot.montadoMs), domContentLoadedMs: boot.dclMs === null ? null : Math.round(boot.dclMs) };
}

function timeIpc(page, method, args) {
  return page.evaluate(async ({ name, params }) => {
    const t0 = performance.now();
    const result = await window.mage[name](...params);
    return { ms: Math.round((performance.now() - t0) * 10) / 10, elementos: Array.isArray(result) ? result.length : null };
  }, { name: method, params: args });
}

async function repeatIpc(page, method, args) {
  const samples = [];
  for (let i = 0; i < IPC_REPEATS; i += 1) samples.push((await timeIpc(page, method, args)).ms);
  return summarize(samples);
}

// Listar el historial sembrado: en frío (mtime nuevo en todas: main vuelve a leer cabeza y cola) y en caliente.
async function measureHistoryList(page, ctx) {
  const now = new Date();
  for (const file of ctx.history.files) fs.utimesSync(file, now, now);
  const frio = await timeIpc(page, 'listConversations', [ctx.accountDir]);
  const caliente = await repeatIpc(page, 'listConversations', [ctx.accountDir]);
  return { frio, caliente, filasEnElLateral: await page.locator('[data-history-session]').count() };
}

async function closeUsage(page) {
  const view = page.locator(USAGE_VIEW);
  if ((await view.count()) === 0) return;
  await view.getByRole('button', { name: ui('accountsUsage.close'), exact: true }).click();
  await view.waitFor({ state: 'detached', timeout: CLOSE_TIMEOUT_MS });
}

// Una apertura de «Cuentas y consumo»: hasta que pinta (desde el pointerdown) y hasta su primera fila con datos.
async function openUsageOnce(page) {
  const started = Date.now();
  try {
    const visibleMs = await measureInteraction(page, 'pointerdown', `document.querySelector('${USAGE_VIEW}') !== null`, () => page.locator('[data-usage-summary]').first().click());
    await page.locator(`${USAGE_VIEW} [data-ranked-row]`).first().waitFor({ state: 'visible', timeout: DATA_TIMEOUT_MS });
    return { visibleMs: round1(visibleMs), datosMs: Date.now() - started };
  } finally {
    await closeUsage(page);
  }
}

async function measureUsageOpen(page) {
  const aperturas = [];
  for (let i = 0; i < USAGE_REPEATS; i += 1) aperturas.push(await openUsageOnce(page));
  return { aperturas, getUsageHistoryCaliente: await repeatIpc(page, 'getUsageHistory', []) };
}

async function openSettingsOnce(page) {
  try {
    return await measureInteraction(page, 'keydown', `document.querySelector('${MODAL}') !== null`, () => page.keyboard.press('Control+Comma'));
  } finally {
    if ((await page.locator(MODAL).count()) > 0) {
      await page.keyboard.press('Escape');
      await page.locator(MODAL).first().waitFor({ state: 'detached', timeout: CLOSE_TIMEOUT_MS });
    }
  }
}

async function measureSettingsOpen(page) {
  const samples = [];
  for (let i = 0; i < SETTINGS_REPEATS; i += 1) samples.push(await openSettingsOnce(page));
  return { primeraMs: round1(samples[0]), siguientes: summarize(samples.slice(1)) };
}

async function openTabs(page, ctx) {
  const samples = [];
  for (let i = 0; i < PERF_TABS; i += 1) {
    const started = Date.now();
    await ctx.openConversation(page);
    samples.push(Date.now() - started);
  }
  return { pestanas: (await tabIdsInBar(page)).length, abrirUna: summarize(samples) };
}

async function switchFirstLast(page) {
  const ids = await tabIdsInBar(page);
  return measureTabSwitch(page, [ids[0], ids.at(-1)]);
}

// --- Turno largo contra el servidor falso (solo con el puente de desarrollo) ---

async function waitUntil(condition, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${what} en ${timeoutMs} ms`);
    await sleep(TURN_POLL_MS);
  }
}

function lastAgentLength(page, tabId) {
  return page.evaluate((id) => {
    const agents = (window.__mageDev.store.getState().blocksByChat[id] ?? []).filter((block) => block.kind === 'agent');
    return agents.at(-1)?.runs.map((run) => run.text).join('').length ?? 0;
  }, tabId);
}

async function sendTurn(page, fake, tabId) {
  const before = fake.stats.completions;
  await page.getByRole('textbox', { name: PROMPT }).first().click();
  await page.keyboard.type(TURN_PROMPT, { delay: TYPE_DELAY_MS });
  const started = Date.now();
  await page.keyboard.press('Enter');
  await waitUntil(() => fake.stats.completions > before, TURN_TIMEOUT_MS, 'el servidor falso no recibió la petición');
  await page.waitForFunction((id) => window.__mageDev.store.getState().statusByChat[id] === 'idle', tabId, { timeout: TURN_TIMEOUT_MS, polling: TURN_POLL_MS });
  const turnoMs = Date.now() - started;
  return { turnoMs, caracteresRespuesta: await lastAgentLength(page, tabId), nodosDom: await page.evaluate(() => document.getElementsByTagName('*').length) };
}

async function countEventsDuring(page, action) {
  await page.evaluate(startEventCountInPage);
  const outcome = await settle(action());
  const eventos = await page.evaluate(stopEventCountInPage);
  if (outcome.error !== undefined) throw outcome.error;
  return { ...outcome.value, eventos };
}

// Tres turnos en la misma pestaña: con sonda y perfil de main, contando el IPC (sin sonda) y con el perfil del renderer.
async function measureLongTurn(m) {
  const fake = await m.ctx.startFake();
  try {
    const { tabId } = await m.ctx.openRuntimeTab(m.page, { fake, userDataDir: m.ctx.userDataDir, provider: PERF_PROVIDER, model: PERF_MODEL });
    const conMedidas = await measure(m, () => sendTurn(m.page, fake, tabId));
    const ipc = await countEventsDuring(m.page, () => sendTurn(m.page, fake, tabId));
    const perfilRenderer = await profileWhile(m.page, () => sendTurn(m.page, fake, tabId));
    return { conMedidas, ipc, perfilRenderer };
  } finally {
    await fake.close();
  }
}

// --- Orquestación ---

function environment() {
  return { plataforma: process.platform, cpu: os.cpus()[0]?.model ?? null, nucleos: os.cpus().length, memoriaGb: round1(os.totalmem() / KB / MB) };
}

async function runCommonSteps(m, out) {
  const { page, ctx } = m;
  await safeStep(out, 'arranque', () => measureBoot(page, ctx));
  await safeStep(out, 'memoriaTrasArrancar', () => memorySnapshot(m));
  await safeStep(out, 'reposo65s', () => measure(m, () => page.waitForTimeout(IDLE_WINDOW_MS)));
  await safeStep(out, 'abrirConsumo', () => measure(m, () => measureUsageOpen(page)));
  await safeStep(out, 'listarHistorial', () => measure(m, () => measureHistoryList(page, ctx)));
  await safeStep(out, 'abrirConfiguracion', () => measure(m, () => measureSettingsOpen(page)));
  await safeStep(out, 'abrir30Pestanas', () => measure(m, () => openTabs(page, ctx)));
  await safeStep(out, 'cambioPestanaCon30', () => measure(m, () => switchFirstLast(page)));
  await safeStep(out, 'memoriaTrasOperaciones', () => memorySnapshot(m));
}

async function runDevSteps(m, out) {
  await safeStep(out, 'turnoLargo', () => measureLongTurn(m));
  await safeStep(out, 'memoriaTrasTurno', () => memorySnapshot(m));
}

// `ctx`: openConversation, openRuntimeTab, startFake, userDataDir, accountDir, history, devBridge, inspectPort, spawnAtMs y mountedMark.
export async function runPerfReview(page, ctx) {
  const out = {
    modo: ctx.devBridge ? 'desarrollo (electron-vite dev)' : 'producción (electron-vite preview del build)',
    entorno: environment(),
    historialSembrado: { conversaciones: ctx.history.files.length, bytes: ctx.history.bytes },
  };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const main = await openInspector(ctx.inspectPort);
  out.inspectorMain = main.error ?? 'conectado';
  const m = { page, ctx, main, cdpSend: (method, params) => cdp.send(method, params) };
  try {
    await runCommonSteps(m, out);
    if (ctx.devBridge) await runDevSteps(m, out);
    else out.turnoLargo = 'omitido: sin puente de desarrollo (--prod)';
  } finally {
    main.inspector?.close();
    await cdp.detach().catch((error) => { out.cierreCdp = errorText(error); });
  }
  return out;
}
