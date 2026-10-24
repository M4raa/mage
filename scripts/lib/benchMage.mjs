// Benchmark F0-B, ruta R3: las mismas tareas que spike/bench-r2.mjs, pero ejecutadas POR MAGE (pestaña,
// sesión y motor reales), conducidas por el store desde el harness. Excepción explícita a «un turno real
// por ejecución» de verify:gui, autorizada por dirección para el baseline (DEVOLUCION-012 H7); la guarda
// de uso del 70 % se aplica antes de cada tarea. Solo mide: no cambia el producto.
import fs from 'node:fs';
import path from 'node:path';
import { TASKS, createWorkspace } from '../../spike/bench/tasks.mjs';
import { CLAUDE_MODEL, CODEX_MODEL } from '../../spike/bench/headless.mjs';

const TASK_TIMEOUT_MS = 300_000;

// Escucha en la pagina los eventos de sesion (todas las pestañas) y concede permisos y confianza igual
// que el conductor de R2. Idempotente: se instala una vez por ejecucion.
async function installCollector(page) {
  await page.evaluate(() => {
    if (window.__bench !== undefined) return;
    window.__bench = { bySession: {} };
    window.mage.onSessionEvent(({ sessionId, event }) => {
      const run = (window.__bench.bySession[sessionId] ??= { firstUsefulAt: null, text: '', tools: [], init: '', results: 0, usage: [], costMicroUsd: 0, permissions: 0, errors: [] });
      const now = performance.now();
      if ((event.kind === 'stream_delta' || event.kind === 'tool_use') && run.firstUsefulAt === null) run.firstUsefulAt = now;
      if (event.kind === 'assistant_text') run.text += event.text;
      if (event.kind === 'tool_use') run.tools.push(event.tool.toolName);
      if (event.kind === 'session_init') run.init = JSON.stringify(event);
      if (event.kind === 'error') run.errors.push(event.message.slice(0, 160));
      if (event.kind === 'result') {
        run.results += 1;
        if (event.result.usage !== undefined) run.usage.push(event.result.usage);
        run.costMicroUsd += event.result.costMicroUsd ?? 0;
      }
      if (event.kind === 'elicitation_request') {
        run.permissions += 1;
        const store = window.__mageDev.store;
        const tabId = Object.entries(store.getState().sessionIdByChat).find(([, id]) => id === sessionId)?.[0];
        if (tabId !== undefined) void store.getState().answerElicitation(tabId, { requestId: event.request.requestId, action: 'accept', ...(event.request.mode === 'url' ? {} : { content: {} }) });
      }
      if (event.kind === 'permission_request') {
        run.permissions += 1;
        const store = window.__mageDev.store;
        const tabId = Object.entries(store.getState().sessionIdByChat).find(([, id]) => id === sessionId)?.[0];
        if (tabId !== undefined) store.getState().answerPermissionFor(tabId, { behavior: 'allow', updatedInput: event.request.input }, event.request.requestId);
      }
    });
    // Confianza de la carpeta de trabajo: la concede el conductor (como R2, que no pregunta).
    window.__mageDev.store.subscribe((s) => { for (const folder of s.trustRequests) void s.answerTrustRequest(folder, true); });
  });
}

// Abre la pestaña de la tarea y envía sus prompts (el segundo, a mitad del primero si la tarea lo pide).
async function sendTask(page, { cwd, task, provider }) {
  const model = provider === 'claude' ? CLAUDE_MODEL : CODEX_MODEL;
  return page.evaluate(async ({ cwd, prompts, midTurnDelayMs, provider, model }) => {
    const store = window.__mageDev.store;
    const account = store.getState().accounts.find((a) => a.providerId === provider);
    if (account === undefined) throw new Error(`Mage no ve ninguna cuenta de ${provider}`);
    // Claude: `acceptEdits`, como R2. Codex no admite ese modo en Mage: su modo por defecto equivale a la
    // política `on-request` con sandbox de escritura en el proyecto que usa R2.
    const permissionMode = provider === 'claude' ? { permissionMode: 'acceptEdits' } : {};
    await store.getState().newTab({ accountId: account.id, cwd, model: model.model, effort: model.effort, provider, privacy: 'shared', ...permissionMode });
    const tabId = store.getState().activeTabId;
    const startedAt = performance.now();
    await store.getState().sendMessageToTab(tabId, prompts[0]);
    for (const prompt of prompts.slice(1)) {
      await new Promise((r) => setTimeout(r, midTurnDelayMs ?? 0));
      await store.getState().sendMessageToTab(tabId, prompt);
    }
    return { tabId, startedAt };
  }, { cwd, prompts: task.prompts, midTurnDelayMs: task.midTurnDelayMs, provider, model });
}

// Espera a que la pestaña acabe (resultados, cola vacía y en reposo; o la marca final) y lee sus métricas.
async function collect(page, { tabId, startedAt, task }) {
  return page.evaluate(async ({ tabId, startedAt, turns, doneText, timeoutMs }) => {
    const store = window.__mageDev.store;
    const deadline = performance.now() + timeoutMs;
    const runOf = () => window.__bench.bySession[store.getState().sessionIdByChat[tabId]];
    const finished = () => {
      const s = store.getState(); const run = runOf();
      if (run === undefined) return false;
      const idle = (s.statusByChat[tabId] ?? 'idle') === 'idle' && (s.queuedByChat[tabId]?.length ?? 0) === 0;
      return idle && (run.results >= turns || (doneText !== undefined && run.text.includes(doneText)));
    };
    while (!finished() && performance.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    const run = runOf() ?? { firstUsefulAt: null, text: '', tools: [], init: '', results: 0, usage: [], costMicroUsd: 0, permissions: 0, errors: ['sin-sesion'] };
    return { ...run, timedOut: !finished(), endedAt: performance.now(), startedAt };
  }, { tabId, startedAt, turns: task.turns, doneText: task.doneText, timeoutMs: TASK_TIMEOUT_MS });
}

function summarize(run) {
  const tokens = run.usage.reduce((sum, u) => ({ input: sum.input + (u.inputTokens ?? 0), output: sum.output + (u.outputTokens ?? 0), cacheRead: sum.cacheRead + (u.cacheReadTokens ?? 0), cacheCreate: sum.cacheCreate + (u.cacheCreationTokens ?? 0) }), { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
  return {
    ttfeMs: run.firstUsefulAt === null ? null : Math.round(run.firstUsefulAt - run.startedAt),
    totalMs: Math.round(run.endedAt - run.startedAt),
    tools: run.tools, permissions: run.permissions, tokens,
    costUsd: run.costMicroUsd > 0 ? run.costMicroUsd / 1e6 : null,
    errors: run.timedOut ? [...run.errors, 'timeout'] : run.errors,
  };
}

// Corre las tareas pedidas de un proveedor. `usageAllows` (inyectada) aplica la guarda del 70 %;
// `root` es la raíz desechable de la ejecución (la retira quien llama).
export async function runMageBench(page, { provider, rep, tasks, root, usageAllows, out }) {
  await installCollector(page);
  for (const task of TASKS.filter((t) => tasks.includes(t.id))) {
    const row = { route: 'R3', provider, task: task.id, rep, model: provider === 'claude' ? CLAUDE_MODEL : CODEX_MODEL };
    try {
      const guard = await usageAllows();
      row.usageBefore = guard.usage;
      if (!guard.allowed) {
        const pending = guard.error === undefined ? 'uso-sobre-70' : `uso-no-legible: ${guard.error}`;
        fs.appendFileSync(out, JSON.stringify({ ...row, pending }) + '\n');
        continue;
      }
      const cwd = createWorkspace(fs.mkdtempSync(path.join(root, `${task.id}-`)));
      const prepared = task.prepare(cwd);
      const sent = await sendTask(page, { cwd, task, provider });
      const run = await collect(page, { ...sent, task });
      const verdict = task.check(cwd, run, prepared);
      Object.assign(row, summarize(run), { realTurns: task.turns, ok: verdict.ok, detail: verdict.detail });
      await page.evaluate((id) => window.__mageDev.store.getState().closeTab(id), sent.tabId);
    } catch (error) {
      Object.assign(row, { ok: false, error: String(error.message).slice(0, 300) });
    }
    fs.appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(JSON.stringify({ route: 'R3', task: row.task, ok: row.ok, pending: row.pending, error: row.error, detail: row.detail, totalMs: row.totalMs }));
  }
}
