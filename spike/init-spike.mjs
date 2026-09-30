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
// Modo `--mcp` (P-028 fase 2, grupo F): mide sin turno
//   M1. si `mcp_status` contesta antes del primer turno y con que campos (solo NOMBRES de clave de
//       `config`: sus valores llevan `env`/`headers` y no se imprimen nunca);
//   M2. si aparecen los conectores de claude.ai y con que nombre/estado/scope;
//   M3. si `mcp_toggle`/`mcp_reconnect` contestan (con un nombre que no existe: no cambia nada real);
//   M4. si el CLI acepta un `--mcp-config` con una clave de nivel superior propia de Mage.
//
// Modo `--bypass` (0.1.1 R2, punto 6): si el CLI ARRANCA en `bypassPermissions` con
// `--allow-dangerously-skip-permissions --permission-mode bypassPermissions` (lo que haria Mage con ese
// modo por defecto en Ajustes) y que modo reporta `initialize`.
//
// Modo `--mcp-auth <servidor> [--config-dir <dir>] [--wait <s>]` (0.1.1 R2, punto 18): pide
// `mcp_authenticate` para ese servidor y registra la forma de la respuesta (de `authUrl` solo origen,
// ruta y NOMBRES de parametro), si el puerto de callback local escucha y el `mcp_status` del servidor
// cada 5 s hasta `--wait` (60 s por defecto). NO abre el navegador ni completa el OAuth: sin callback
// el servidor debe seguir en `needs-auth`; lo que se mide es que el CLI espera vivo el callback.
//
// Nunca manda un mensaje de usuario. El hijo muere siempre (tambien si algo lanza). No imprime nada
// de la cuenta: la respuesta de initialize trae `account` y se descarta sin leerla.
// Uso: node spike/init-spike.mjs [--mcp | --bypass | --mcp-auth <servidor>]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
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

// Resume `mcp_status` sin valores: nombre, estado, scope, tipo y NOMBRES de clave de config.
function summarizeMcpStatus(result) {
  if (result.error) return { error: result.error };
  const { subtype, error, response } = result.response;
  const servers = Array.isArray(response?.mcpServers) ? response.mcpServers : null;
  return {
    ms: result.ms,
    subtype,
    error,
    responseKeys: Object.keys(response ?? {}),
    serverFields: servers === null ? [] : [...new Set(servers.flatMap((s) => Object.keys(s)))],
    servers: (servers ?? []).map((s) => ({
      name: s.name,
      status: s.status,
      scope: s.scope,
      type: s.config?.type,
      configKeys: s.config && typeof s.config === 'object' ? Object.keys(s.config) : [],
      hasError: typeof s.error === 'string',
    })),
  };
}

// Fichero temporal con un servidor falso (comando inexistente: nunca arranca nada) y una clave propia.
function writeFakeMcpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-mcp-spike-'));
  const file = path.join(dir, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({
    mcpServers: { 'mage-spike-fake': { command: 'mage-spike-no-existe', args: [] } },
    mageDisabledServers: { 'mage-spike-off': { command: 'mage-spike-no-existe' } },
  }));
  return file;
}

async function runMcp() {
  const fakeConfig = writeFakeMcpConfig();
  const requests = [
    INIT,
    { subtype: 'mcp_status' },
    { subtype: 'mcp_toggle', serverName: 'mage-spike-inexistente', enabled: false },
    { subtype: 'mcp_reconnect', serverName: 'mage-spike-inexistente' },
    { subtype: 'mcp_status' },
  ];
  for (const [label, configDir] of [['MCP-A · ~/.claude', MAIN], ['MCP-B · ~/.claude-p', SECOND]]) {
    if (!fs.existsSync(configDir)) continue;
    const { results, otherEvents, stderr, exit } = await probe({ configDir, extraArgs: ['--mcp-config', fakeConfig], requests });
    console.log(`
===== ${label} (con --mcp-config falso) =====  exit=${JSON.stringify(exit)}`);
    for (const r of results) {
      if (r.request === 'initialize') console.log(`initialize: ${r.error ?? `${r.response?.subtype} (${r.ms} ms)`}`);
      else if (r.request === 'mcp_status') console.log(`mcp_status: ${JSON.stringify(summarizeMcpStatus(r), null, 1)}`);
      else console.log(`${r.request}: ${JSON.stringify(r.error ? { error: r.error } : { subtype: r.response.subtype, error: r.response.error, responseKeys: Object.keys(r.response.response ?? {}) })}`);
    }
    console.log(`otros eventos: ${JSON.stringify(otherEvents)}`);
    if (stderr.length > 0) console.log(`stderr: ${stderr}`);
  }
  fs.rmSync(path.dirname(fakeConfig), { recursive: true, force: true });
}

// Valor del argumento que sigue a `flag`, o `fallback`.
function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1];
}

// `authUrl` sin valores: el `state`/`code_challenge`/`client_id` no son secretos, pero no hace falta verlos.
function describeAuthUrl(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    const url = new URL(raw);
    return { origin: url.origin, pathname: url.pathname, params: [...url.searchParams.keys()], redirectUri: url.searchParams.get('redirect_uri') };
  } catch {
    return 'authUrl no es una URL';
  }
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
  });
}

// Un CLI vivo al que se le pueden mandar peticiones de control sueltas (probe() las manda todas y mata).
function openSession(configDir) {
  const child = spawn(resolveClaudeBinary(), BASE_ARGS, { env: childEnv(configDir), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map();
  const events = [];
  let buffer = '';
  let counter = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      let event;
      try { event = JSON.parse(line); } catch { events.push({ unparseable: line.slice(0, 120) }); continue; }
      const id = event?.response?.request_id;
      if (event.type === 'control_response' && pending.has(id)) { pending.get(id)(event.response); pending.delete(id); }
      else events.push({ ms: Date.now(), type: event.type, subtype: event.subtype ?? event.request?.subtype });
    }
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { stderr += d; });
  const send = (request) => new Promise((resolve, reject) => {
    const requestId = `a${counter++}`;
    pending.set(requestId, resolve);
    setTimeout(() => reject(new Error(`sin respuesta a ${request.subtype}`)), RESPONSE_TIMEOUT_MS);
    child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: requestId, request })}\n`);
  });
  return { child, send, events, stderr: () => stderr.trim().slice(0, 600) };
}

async function statusOf(session, serverName) {
  const response = await session.send({ subtype: 'mcp_status' });
  const server = (response?.response?.mcpServers ?? []).find((s) => s.name === serverName);
  return server === undefined ? 'no aparece' : { status: server.status, scope: server.scope, type: server.config?.type };
}

async function runMcpAuth(serverName) {
  const configDir = argValue('--config-dir', MAIN);
  const waitMs = Number(argValue('--wait', '60')) * 1000;
  const session = openSession(configDir);
  const startedAt = Date.now();
  const log = (label, value) => console.log(`[+${((Date.now() - startedAt) / 1000).toFixed(1)} s] ${label}: ${JSON.stringify(value)}`);
  try {
    log('initialize', (await session.send(INIT)).subtype);
    log('mcp_status antes', await statusOf(session, serverName));
    const auth = await session.send({ subtype: 'mcp_authenticate', serverName });
    const body = auth.response ?? {};
    log('mcp_authenticate', { subtype: auth.subtype, error: auth.error, keys: Object.keys(body), authUrl: describeAuthUrl(body.authUrl), requiresUserAction: body.requiresUserAction, callbackExpected: body.callbackExpected, redirectScheme: body.redirectScheme, callbackPort: body.callbackPort, hasState: typeof body.state === 'string' });
    if (typeof body.callbackPort === 'number') log(`puerto ${body.callbackPort} escucha`, await isPortListening(body.callbackPort));
    const repeat = await session.send({ subtype: 'mcp_authenticate', serverName });
    log('mcp_authenticate otra vez', { subtype: repeat.subtype, error: repeat.error, callbackPort: repeat.response?.callbackPort });
    while (Date.now() - startedAt < waitMs) {
      await new Promise((r) => setTimeout(r, 5000));
      log('mcp_status', await statusOf(session, serverName));
    }
    if (typeof body.callbackPort === 'number') log(`puerto ${body.callbackPort} escucha al final`, await isPortListening(body.callbackPort));
  } finally {
    session.child.kill();
    log('otros eventos', session.events.map(({ type, subtype }) => `${type}/${subtype}`));
    if (session.stderr().length > 0) log('stderr', session.stderr());
  }
}

async function main() {
  console.log(`[init-spike] bin=${resolveClaudeBinary()}`);
  const authServer = argValue('--mcp-auth', null);
  if (authServer !== null) return runMcpAuth(authServer);
  if (process.argv.includes('--mcp')) return runMcp();
  if (process.argv.includes('--bypass')) {
    await run('BYPASS · ~/.claude arrancando en bypassPermissions', {
      configDir: MAIN,
      extraArgs: ['--allow-dangerously-skip-permissions', '--permission-mode', 'bypassPermissions'],
      requests: [INIT, { subtype: 'set_permission_mode', mode: 'default' }, { subtype: 'set_permission_mode', mode: 'bypassPermissions' }],
    });
    return;
  }
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
