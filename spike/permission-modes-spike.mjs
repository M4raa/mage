// Spike: ¿de donde se leen los MODOS DE PERMISO de cada CLI? (respuesta 18 del usuario: los modos
// tienen que salir del CLI, no de una lista fija de Mage). Es la medicion en la que se apoya
// `src/main/engine/permissionModes.ts`. Medido el 2026-10-01 contra claude 2.1.286, agy 1.2.14 y
// codex-cli 0.144.4 (sin cuenta).
//
// GRATIS: ningun turno. Cada CLI falla ANTES de arrancar una conversacion:
//   - claude: un valor invalido en `--permission-mode` -> «Allowed choices are acceptEdits, auto,
//     bypassPermissions, manual, dontAsk, plan.» (`manual` = el `default` de siempre: con `manual`, el
//     `initialize` responde `current_permission_mode: "default"`). Lanzado con un CLAUDE_CONFIG_DIR vacio.
//   - agy: `--mode <invalido>` -> «warning: unrecognized --mode value "x" (valid: accept-edits, plan)»;
//     se le da un mensaje SIN contenido, que el CLI rechaza sin turno.
//   - codex: `permissionProfile/list` de `codex app-server` con un CODEX_HOME temporal.
// No toca la configuracion real de nadie (directorios temporales que se borran).
//
// Uso: node spike/permission-modes-spike.mjs

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ORACLE = '__mage_probe__';
const TIMEOUT_MS = 30_000;
const isWindows = process.platform === 'win32';

function scrubbedEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[name];
  return env;
}

function withTemp(prefix, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

function probeClaude() {
  return withTemp('mage-pm-claude-', (configDir) => {
    const result = spawnSync(isWindows ? 'claude.exe' : 'claude', ['-p', '--permission-mode', ORACLE], {
      env: scrubbedEnv({ CLAUDE_CONFIG_DIR: configDir }),
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      windowsHide: true,
      input: '',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const choices = /Allowed choices are ([^.]+)\./.exec(output)?.[1] ?? null;
    console.log(`claude: ${choices === null ? `SIN LISTA — ${output.trim().slice(0, 160)}` : choices}`);
  });
}

function probeAgy() {
  withTemp('mage-pm-agy-', (workspace) => {
    const result = spawnSync(isWindows ? 'agy.exe' : 'agy', ['--output-format', 'stream-json', '--input-format', 'stream-json', '--add-dir', workspace, '--mode', ORACLE], {
      env: scrubbedEnv({}),
      cwd: workspace,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      windowsHide: true,
      input: `${JSON.stringify({ event: 'user', message: {} })}\n`,
    });
    const valid = /\(valid: ([^)]+)\)/.exec(`${result.stdout ?? ''}${result.stderr ?? ''}`)?.[1] ?? null;
    console.log(`agy:    ${valid ?? 'SIN LISTA'} (+ el modo por defecto, sin --mode)`);
  });
}

async function probeCodex() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-pm-codex-'));
  const child = spawn('codex', ['app-server'], { env: scrubbedEnv({ CODEX_HOME: home }), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const profiles = await new Promise((resolve) => {
    let buffer = '';
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    child.on('error', () => resolve(null));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const message = JSON.parse(line);
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'permissionProfile/list', params: {} })}\n`);
        }
        if (message.id === 2) {
          clearTimeout(timer);
          resolve(message.result?.data ?? null);
        }
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'mage-spike', version: '0' } } })}\n`);
  });
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  console.log(`codex:  ${profiles === null ? 'SIN LISTA' : profiles.map((p) => `${p.id}${p.allowed ? '' : ' (no permitido)'}`).join(', ')}`);
}

probeClaude();
probeAgy();
await probeCodex();
