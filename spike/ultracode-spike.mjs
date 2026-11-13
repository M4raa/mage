// Mage — Spike: ¿activa `--settings {"ultracode":true}` Ultracode en el CLI headless?
// Lanza DOS veces `claude` (modelo sonnet, esfuerzo low): A sin --settings, B con ella. A cada una le manda
// «Responde solo: hola», espera el `result` y cierra stdin. Guarda el evento `system/init` (sin claves de
// credenciales ni de identidad) y las diferencias entre A y B en --out (por defecto, una carpeta nueva en el temporal del sistema).
// Gasta DOS turnos reales; no es codigo de produccion.
//
// La señal de que Ultracode está activo no está en el init: es la entrada `attachment` `ultra_effort_enter`
// de la transcripción (medido el 12-11 con 2.1.319). Por eso, tras los dos turnos, el spike lee las dos
// transcripciones (`<config dir>/projects/<cwd codificado>/<session_id>.jsonl`) y escribe si cada una la lleva.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path, { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const TURN_TIMEOUT_MS = 180_000;
const PROMPT = 'Responde solo: hola';
const MODEL = 'sonnet';
const EFFORT = 'low';
// Mismos BASE_ARGS que `claudeAdapter.ts`.
const BASE_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--include-partial-messages'];
// Claves que se borran del init antes de guardarlo (credenciales e identidad).
const SENSITIVE_KEY = /token|oauth|userid|machineid|email|account/i;
// Variables de credencial que no deben llegar al hijo (como `scrubAgentEnv`).
const CREDENTIAL_ENV = /^(ANTHROPIC_|GEMINI_|GOOGLE_API|OPENAI_|CODEX_)/;

const outDir = process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
  ?? mkdtempSync(join(tmpdir(), 'mage-ultracode-spike-'));

function resolveClaudeBinary() {
  if (process.env.MAGE_CLAUDE_BIN) return process.env.MAGE_CLAUDE_BIN;
  const winLocal = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (process.platform === 'win32' && fs.existsSync(winLocal)) return winLocal;
  return 'claude';
}

// Copia profunda sin las claves sensibles.
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, v]) => [key, redact(v)]));
}

function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !CREDENTIAL_ENV.test(key)));
}

// Un turno: devuelve { init, others, stderr, result }.
function runOnce(label, extraArgs) {
  return new Promise((resolve, reject) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `mage-ultracode-${label}-`));
    const args = [...BASE_ARGS, '--session-id', randomUUID(), '--model', MODEL, '--effort', EFFORT, ...extraArgs];
    const child = spawn(resolveClaudeBinary(), args, { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const state = { init: null, others: [], stderr: '', result: null };
    let buffer = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${label}: sin result tras ${TURN_TIMEOUT_MS} ms`)); }, TURN_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) onEvent(line);
      }
    });
    function onEvent(line) {
      let event;
      try { event = JSON.parse(line); } catch { state.others.push({ unparsable: line.slice(0, 200) }); return; }
      if (event.type === 'system' && event.subtype === 'init') { state.init = redact(event); state.sessionId = event.session_id; state.cwd = event.cwd; }
      else if (event.type === 'system') state.others.push(redact({ type: event.type, subtype: event.subtype, ...event }));
      else if (event.type === 'result') {
        state.result = { subtype: event.subtype, is_error: event.is_error, result: String(event.result ?? '').slice(0, 200) };
        child.stdin.end();
      }
    }
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { state.stderr += d; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ...state, code }); });
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: PROMPT }, parent_tool_use_id: null })}\n`);
  });
}

// Diferencias entre dos objetos de primer nivel: claves nuevas, quitadas o con otro valor; `tools` aparte.
function diffInit(a, b) {
  const lines = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const key of [...keys].sort()) {
    if (key === 'tools') continue;
    const av = JSON.stringify(a?.[key]);
    const bv = JSON.stringify(b?.[key]);
    if (av !== bv) lines.push(`${key}: A=${av?.slice(0, 300)} | B=${bv?.slice(0, 300)}`);
  }
  const at = new Set(a?.tools ?? []);
  const bt = new Set(b?.tools ?? []);
  lines.push(`tools añadidas en B: ${JSON.stringify([...bt].filter((t) => !at.has(t)))}`);
  lines.push(`tools quitadas en B: ${JSON.stringify([...at].filter((t) => !bt.has(t)))}`);
  return lines;
}

// Directorio de config del CLI (el de por defecto del usuario salvo CLAUDE_CONFIG_DIR).
function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
}

// ¿La transcripción de la sesión lleva la entrada `attachment` `ultra_effort_enter`?
// Devuelve 'sí', 'no' o 'transcripción no encontrada: <ruta>' (nunca adivina).
function hasUltraEffortEnter(run) {
  if (!run.sessionId || !run.cwd) return 'transcripción no encontrada: sin session_id/cwd en el init';
  const encodedCwd = run.cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const file = path.join(claudeConfigDir(), 'projects', encodedCwd, `${run.sessionId}.jsonl`);
  if (!fs.existsSync(file)) return `transcripción no encontrada: ${file}`;
  const found = fs.readFileSync(file, 'utf8').split('\n').some((line) => line.includes('"ultra_effort_enter"'));
  return found ? 'sí' : 'no';
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const a = await runOnce('A', []);
  const b = await runOnce('B', ['--settings', JSON.stringify({ ultracode: true })]);
  fs.writeFileSync(path.join(outDir, 'a-init.json'), JSON.stringify(a.init, null, 2));
  fs.writeFileSync(path.join(outDir, 'b-init.json'), JSON.stringify(b.init, null, 2));
  const report = [
    ...diffInit(a.init, b.init),
    '',
    `ultra_effort_enter en la transcripción de A: ${hasUltraEffortEnter(a)}`,
    `ultra_effort_enter en la transcripción de B: ${hasUltraEffortEnter(b)}`,
    '',
    `A: exit=${a.code} result=${JSON.stringify(a.result)} otros_system=${JSON.stringify(a.others)} stderr=${JSON.stringify(a.stderr.slice(0, 500))}`,
    `B: exit=${b.code} result=${JSON.stringify(b.result)} otros_system=${JSON.stringify(b.others)} stderr=${JSON.stringify(b.stderr.slice(0, 500))}`,
  ];
  fs.writeFileSync(path.join(outDir, 'diff.txt'), report.join('\n'));
  console.log(report.join('\n'));
}

main().catch((error) => { console.error(error); process.exit(1); });
