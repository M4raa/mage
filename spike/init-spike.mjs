// Mage — Spike S1 del plan P-026.
// Objetivo: medir lo que el CLI contesta a `initialize` SIN mandar ningun turno (coste cero):
//   1. `models` en headless (entradas y campos).
//   2. `current_permission_mode` sin `--permission-mode`.
//   3. `set_permission_mode auto` (exito o el error de la puerta de auto).
//   4. Con `--permission-mode manual`: que modo reporta.
//   5. `set_permission_mode bypassPermissions` con y sin `--allow-dangerously-skip-permissions`.
//   6. Con CLAUDE_CONFIG_DIR=~/.claude/mage-private: si faltan las skills de plugin en `commands`.
//   7. Cuanto tarda del spawn al `control_response`.
//
// Nunca manda un mensaje de usuario. El hijo muere siempre (tambien si algo lanza). No imprime nada
// de la cuenta: la respuesta de initialize trae `account` y se descarta sin leerla.
// Uso: node spike/init-spike.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mismos argumentos base que BASE_ARGS de src/main/engine/claudeAdapter.ts.
const BASE_ARGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--permission-prompt-tool', 'stdio',
  '--include-partial-messages',
];

const RESPONSE_TIMEOUT_MS = 30_000;
// Variables que desactivan OAuth o redirigen el Bearer (las mismas que borra scrubAgentEnv).
const CREDENTIAL_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'];

// Resolutor minimo, el mismo de spike/engine-spike.mjs.
function resolveClaudeBinary() {
  const override = process.env.MAGE_CLAUDE_BIN;
  if (override) return override;
  const winLocal = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (process.platform === 'win32' && fs.existsSync(winLocal)) return winLocal;
  return 'claude';
}

function childEnv(configDir) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  for (const name of CREDENTIAL_ENV) delete env[name];
  return env;
}

// Lanza el CLI, manda las peticiones de control EN SERIE y devuelve sus respuestas. Mata el hijo al
// acabar pase lo que pase.
async function probe({ configDir, extraArgs = [], requests }) {
  const startedAt = Date.now();
  const child = spawn(resolveClaudeBinary(), [...BASE_ARGS, ...extraArgs], {
    env: childEnv(configDir),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const pending = new Map();
  const otherEvents = [];
  let stderr = '';
  let exitInfo = null;
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        otherEvents.push({ unparseable: line.slice(0, 120) });
        continue;
      }
      const id = event?.response?.request_id;
      if (event.type === 'control_response' && pending.has(id)) {
        pending.get(id)(event.response);
        pending.delete(id);
      } else {
        otherEvents.push({ type: event.type, subtype: event.subtype ?? event.request?.subtype });
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => { exitInfo = { code, signal }; resolve(); }));
  child.on('error', (err) => { stderr += `\n[spawn error] ${err.message}`; });

  const results = [];
  try {
    for (const [index, request] of requests.entries()) {
      const requestId = `r${index}`;
      const response = new Promise((resolve, reject) => {
        pending.set(requestId, resolve);
        const timer = setTimeout(() => reject(new Error(`sin control_response para ${request.subtype} en ${RESPONSE_TIMEOUT_MS} ms`)), RESPONSE_TIMEOUT_MS);
        exited.then(() => { clearTimeout(timer); reject(new Error(`el CLI salio antes de contestar ${request.subtype}`)); });
      });
      child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: requestId, request })}\n`);
      try {
        const value = await response;
        results.push({ request: request.subtype, ms: Date.now() - startedAt, response: value });
      } catch (err) {
        results.push({ request: request.subtype, ms: Date.now() - startedAt, error: err.message });
        break;
      }
    }
  } finally {
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  }
  return { results, otherEvents, stderr: stderr.trim().slice(0, 600), exit: exitInfo };
}

// Resume la respuesta de initialize sin tocar `account` (datos de la cuenta: no se imprimen).
function summarizeInit(response) {
  const body = response?.response ?? {};
  const models = Array.isArray(body.models) ? body.models : null;
  const commands = Array.isArray(body.commands) ? body.commands : [];
  return {
    subtype: response?.subtype,
    error: response?.error,
    keys: Object.keys(body).filter((k) => k !== 'account'),
    currentPermissionMode: body.current_permission_mode ?? body.permissionMode ?? body.permission_mode,
    modelCount: models === null ? 'no hay campo models' : models.length,
    modelFields: models === null ? [] : [...new Set(models.flatMap((m) => Object.keys(m)))],
    models: models === null ? [] : models.map((m) => ({ value: m.value, displayName: m.displayName, description: m.description, resolvedModel: m.resolvedModel, disabled: m.disabled, supportsAutoMode: m.supportsAutoMode, supportedEffortLevels: m.supportedEffortLevels })),
    commandCount: commands.length,
    pluginCommands: commands.map((c) => c.name).filter((name) => typeof name === 'string' && name.includes(':')),
  };
}

function summarizeControl(result) {
  if (result.error) return { request: result.request, error: result.error };
  const { subtype, error, response } = result.response;
  return { request: result.request, ms: result.ms, subtype, error, response };
}

const INIT = { subtype: 'initialize' };
const HOME = os.homedir();
const MAIN = path.join(HOME, '.claude');
const PRIVATE = path.join(MAIN, 'mage-private');
const SECOND = path.join(HOME, '.claude-p');

async function run(label, options) {
  const { results, otherEvents, stderr, exit } = await probe(options);
  const [init, ...rest] = results;
  console.log(`\n===== ${label} =====`);
  console.log(`args extra: ${JSON.stringify(options.extraArgs ?? [])}  exit=${JSON.stringify(exit)}`);
  if (init?.error) console.log(`initialize: ERROR ${init.error}`);
  else if (init) console.log(`initialize (${init.ms} ms): ${JSON.stringify(summarizeInit(init.response), null, 1)}`);
  for (const r of rest) console.log(`control: ${JSON.stringify(summarizeControl(r))}`);
  console.log(`otros eventos: ${JSON.stringify(otherEvents)}`);
  if (stderr.length > 0) console.log(`stderr: ${stderr}`);
}

async function main() {
  console.log(`[init-spike] bin=${resolveClaudeBinary()}`);
  // 1, 2, 3, 5 (sin flag) y 7: cuenta principal sin --permission-mode.
  await run('A · ~/.claude sin --permission-mode', {
    configDir: MAIN,
    requests: [
      INIT,
      { subtype: 'set_permission_mode', mode: 'auto' },
      { subtype: 'set_permission_mode', mode: 'bypassPermissions' },
      { subtype: 'set_permission_mode', mode: 'default' },
    ],
  });
  // 4: --permission-mode manual.
  await run('B · ~/.claude --permission-mode manual', { configDir: MAIN, extraArgs: ['--permission-mode', 'manual'], requests: [INIT] });
  await run('B2 · ~/.claude --permission-mode auto', { configDir: MAIN, extraArgs: ['--permission-mode', 'auto'], requests: [INIT] });
  // 5 (con flag).
  await run('C · ~/.claude --allow-dangerously-skip-permissions', {
    configDir: MAIN,
    extraArgs: ['--allow-dangerously-skip-permissions'],
    requests: [INIT, { subtype: 'set_permission_mode', mode: 'bypassPermissions' }, { subtype: 'set_permission_mode', mode: 'auto' }],
  });
  // 6: perfil privado.
  await run('D · ~/.claude/mage-private', { configDir: PRIVATE, requests: [INIT] });
  // El `/model` del terminal enseña 12 entradas: ¿la 12ª es el modelo en uso cuando no esta en la lista?
  await run('F · ~/.claude --model opus[1m]', { configDir: MAIN, extraArgs: ['--model', 'opus[1m]'], requests: [INIT] });
  // Segunda cuenta, para comparar catalogo y modo inicial.
  if (fs.existsSync(SECOND)) await run('E · ~/.claude-p', { configDir: SECOND, requests: [INIT, { subtype: 'set_permission_mode', mode: 'auto' }] });
}

main().catch((err) => {
  console.error(`[init-spike] ERROR: ${err.message}`);
  process.exit(1);
});
