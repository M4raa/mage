// Benchmark F0-B, ruta R2 (headless directo). Una fila JSONL por tarea y repeticion en --out.
// Uso: node spike/bench-r2.mjs --real --provider=claude --rep=<n> --out=<fichero> [--tasks=T1,T2]
// Solo Claude, con MAGE_BENCH_ANTHROPIC_API_KEY = clave de API DESECHABLE; nunca copia credenciales del usuario.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cleanupProfile, credentialDigest } from './f0-profile-cleanup.mjs';
import { createWorkspace, tasksFor } from './bench/tasks.mjs';
import { initSummary, roundsOf } from './bench/transcript.mjs';
import { CLAUDE_MODEL, runClaude } from './bench/headless.mjs';
import { benchApiKey } from '../scripts/lib/benchCredentials.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
if (!process.argv.includes('--real')) throw new Error('--real obligatorio: este spike gasta turnos reales');
const provider = arg('provider');
const rep = Number(arg('rep'));
const out = arg('out');
if (!['claude', 'codex'].includes(provider) || !Number.isInteger(rep) || out === undefined) throw new Error(`Argumentos invalidos: ${process.argv.slice(2).join(' ')}`);
const wanted = arg('tasks')?.split(',');
const apiKey = benchApiKey(provider, process.env);

function claudeBinary() {
  return execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find((p) => p.endsWith('.exe'));
}

// Prepara la raiz desechable de una ejecucion: perfil sin credenciales (la clave viaja por entorno) y clon de trabajo.
function prepareRoot(task) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mage-f0-bench-${provider}-${task.id}-`));
  const profile = path.join(root, 'profile');
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
  const credential = path.join(profile, '.credentials.json'); // no existe: cleanupProfile lo admite
  return { root, profile, credential, initial: credentialDigest(credential), cwd: createWorkspace(root) };
}

// Una clave de API no tiene ventanas de suscripcion que vigilar.
const usageAllows = async () => ({ usage: [], allowed: true });

async function runTask(task) {
  const ctx = prepareRoot(task);
  const row = { route: 'R2', provider, task: task.id, rep, model: CLAUDE_MODEL };
  try {
    const guard = await usageAllows(ctx);
    row.usageBefore = guard.usage;
    if (!guard.allowed) return { ...row, pending: guard.error === undefined ? 'uso-sobre-70' : `uso-no-legible: ${guard.error}` };
    const prepared = task.prepare(ctx.cwd);
    const run = await runClaude({ bin: claudeBinary(), profile: ctx.profile, cwd: ctx.cwd, task, env: { ANTHROPIC_API_KEY: apiKey, DISABLE_AUTOUPDATER: '1' } });
    const verdict = task.check(ctx.cwd, run, prepared);
    // Claude: rondas y contexto fijo de la transcripción (antes de retirar el perfil) y, en la sonda, el init.
    const claudeExtra = { ...roundsOf(ctx.profile, run.sessionId), ...(task.probe ? { init: initSummary(run.init) } : {}) };
    return { ...row, ...summarizeRun(run), ...claudeExtra, realTurns: task.turns, ok: verdict.ok, detail: verdict.detail };
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

for (const task of tasksFor(wanted)) {
  const row = await runTask(task);
  fs.appendFileSync(out, JSON.stringify(row) + '\n');
  console.log(JSON.stringify({ task: row.task, ok: row.ok, pending: row.pending, error: row.error, detail: row.detail, totalMs: row.totalMs }));
}
