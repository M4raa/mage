// Benchmark F0-B, ruta R2 (headless directo). Una fila JSONL por tarea y repeticion en --out.
// Uso: node spike/bench-r2.mjs --real --provider=claude|codex --rep=<n> --out=<fichero> [--tasks=T1,T2]
// Antes de cada tarea mira el uso de la cuenta: con mas del 70 % gastado no lanza y la marca pendiente.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cleanupProfile, credentialDigest } from './f0-profile-cleanup.mjs';
import { TASKS, createWorkspace } from './bench/tasks.mjs';
import { CLAUDE_MODEL, CODEX_MODEL, claudeUsage, codexRateLimits, prepareCodexHome, runClaude, runCodex, guardedUsage } from './bench/headless.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
if (!process.argv.includes('--real')) throw new Error('--real obligatorio: este spike gasta turnos reales');
const provider = arg('provider');
const rep = Number(arg('rep'));
const out = arg('out');
if (!['claude', 'codex'].includes(provider) || !Number.isInteger(rep) || out === undefined) throw new Error(`Argumentos invalidos: ${process.argv.slice(2).join(' ')}`);
const wanted = (arg('tasks') ?? TASKS.map((t) => t.id).join(',')).split(',');

function claudeBinary() {
  return execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find((p) => p.endsWith('.exe'));
}

// Prepara la raiz desechable de una ejecucion: perfil con copia de credencial y clon de trabajo.
function prepareRoot(task) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mage-f0-bench-${provider}-${task.id}-`));
  const profile = path.join(root, 'profile');
  if (provider === 'claude') {
    fs.mkdirSync(profile);
    fs.copyFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), path.join(profile, '.credentials.json'));
    fs.writeFileSync(path.join(profile, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
  } else prepareCodexHome(profile);
  const credential = path.join(profile, provider === 'claude' ? '.credentials.json' : 'auth.json');
  return { root, profile, credential, initial: credentialDigest(credential), cwd: createWorkspace(root) };
}

// La lectura usa la credencial COPIADA de la primera tarea; la caché evita el 429 del endpoint.
let readUsage = null;
function usageAllows(ctx) {
  readUsage ??= guardedUsage(() => (provider === 'claude' ? claudeUsage(ctx.credential) : codexRateLimits(ctx.profile)));
  return readUsage();
}

async function runTask(task) {
  const ctx = prepareRoot(task);
  const row = { route: 'R2', provider, task: task.id, rep, model: provider === 'claude' ? CLAUDE_MODEL : CODEX_MODEL };
  try {
    const guard = await usageAllows(ctx);
    row.usageBefore = guard.usage;
    if (!guard.allowed) return { ...row, pending: guard.error === undefined ? 'uso-sobre-70' : `uso-no-legible: ${guard.error}` };
    const prepared = task.prepare(ctx.cwd);
    const run = provider === 'claude' ? await runClaude({ bin: claudeBinary(), profile: ctx.profile, cwd: ctx.cwd, task }) : await runCodex({ home: ctx.profile, cwd: ctx.cwd, task });
    const verdict = task.check(ctx.cwd, run, prepared);
    return { ...row, ...summarizeRun(run), realTurns: task.turns, ok: verdict.ok, detail: verdict.detail };
  } catch (error) {
    return { ...row, ok: false, error: String(error.message).slice(0, 300) };
  } finally {
    cleanupProfile(ctx.root, ctx.credential, ctx.initial);
  }
}

function summarizeRun(run) {
  return {
    ttfeMs: run.firstUsefulAt === null ? null : run.firstUsefulAt - run.startedAt,
    totalMs: (run.endedAt ?? Date.now()) - run.startedAt,
    tools: run.tools,
    permissions: run.permissions,
    tokens: run.tokens,
    costUsd: run.costUsd,
    errors: run.errors,
    serverRequests: run.serverRequests ?? [],
    // Diagnóstico: el final de lo que dijo el agente (sin rutas del perfil).
    textTail: run.text.slice(-240),
  };
}

for (const task of TASKS.filter((t) => wanted.includes(t.id))) {
  const row = await runTask(task);
  fs.appendFileSync(out, JSON.stringify(row) + '\n');
  console.log(JSON.stringify({ task: row.task, ok: row.ok, pending: row.pending, error: row.error, detail: row.detail, totalMs: row.totalMs }));
}
