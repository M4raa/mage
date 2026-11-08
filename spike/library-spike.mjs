// Punto de control (a) de la biblioteca de capacidades (carril P). Recorre el ciclo instalar, desactivar, activar, actualizar y
// quitar con el CÓDIGO DE PRODUCCIÓN de `LibraryService` (spike/library-entry.ts, empaquetado aquí con esbuild) contra los CLI
// REALES de Claude Code y Codex, con un config dir y un CODEX_HOME DESECHABLES bajo `os.tmpdir()`. Mide por primera vez, de
// punta a punta: M1 `claude plugin marketplace add <url>#v2.2.3` fija la versión; M2 `codex plugin marketplace add --ref`;
// M3 `claude plugin install ecc@ecc` y `codex plugin add ecc@ecc`; M4 `claude mcp add` con un nombre ocupado falla y no lo
// sobrescribe (D-P6); M5 `cmd /c npx …` como servidor MCP en Windows; M6 lo instalado se ve en la sesión SIGUIENTE (D-P7).
// Uso:  node spike/library-spike.mjs [claude|codex ...] [--turn]     (sin motores, los dos; --turn gasta UN turno por motor)
//       node spike/library-spike.mjs --build-only                    (compila e importa la entrada; no toca ningún CLI)
// Turnos (solo con --turn): Claude (haiku) necesita `MAGE_SPIKE_ANTHROPIC_API_KEY` (una clave de API DESECHABLE; se pone como
// ANTHROPIC_API_KEY solo en el entorno de ese hijo y nunca se imprime); Codex (gpt-6-luna, esfuerzo low) necesita
// `MAGE_SPIKE_CODEX_HOME` (un CODEX_HOME desechable con `codex login` hecho, bajo `os.tmpdir()`; el ciclo de Codex se hace en ESE
// home y la sesión que lo prepara es quien lo borra). Sin esas variables, el turno de ese motor sale como SKIP y el resto corre.
// El plugin ECC se descarga de GitHub y context7 se instala con npx: hace falta red.
// Escrito contra Claude Code 2.1.314 y Codex 0.164.0. Líneas: PASS|FAIL <motor> <id>[: detalle], INFO, SKIP y RESUMEN.
// Salida: 0 si no hay ningún FAIL, 1 si lo hay, 2 si la guarda de carpetas rechaza el montaje.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linguiCatalogPlugin } from '../scripts/lib/linguiEsbuildPlugin.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRepo = createRequire(join(repo, 'package.json'));
const esbuild = createRequire(requireFromRepo.resolve('vite/package.json'))('esbuild');

const PREVIEW_CHARS = 300;
const EXPECTED_CATALOG_ENTRIES = 13;
const IS_WINDOWS = process.platform === 'win32';
const SKILL_ID = 'ecc-tdd-workflow';
const SKILL_SHA256 = '8887afa786ef30de834e7567115d3df71934b343c3d9d849714f8ea43f979ee0';
const MCP_ID = 'context7';
const MCP_VERSION = '4.4.2';
const MCP_OLD_VERSION = '4.4.1';
const PLUGIN_ID = 'ecc';
const PLUGIN_VERSION = '2.2.3';
const FOREIGN_MCP_ARGS = ['--', 'node', '-e', '0'];
const TURN_PROMPT = 'Reply with the single word OK.';
const CLAUDE_TURN_MODEL = 'haiku';
const CODEX_TURN_MODEL = 'gpt-6-luna';
const TURN_EFFORT = 'low';
const CLAUDE_TURN_TIMEOUT_MS = 180_000;
const CODEX_TURN_TIMEOUT_MS = 90_000;
const RPC_TIMEOUT_MS = 60_000;
const SCHEMA_TIMEOUT_MS = 60_000;
const EFFORT_FIELDS = ['effort', 'reasoningEffort', 'reasoning_effort'];
const REQUIRED_EXPORTS = [
  'LibraryService', 'loadBundledCatalog', 'bundledContents', 'nodeCapabilityFs', 'execFileRunner', 'runNativeCommand',
  'nativeListCommand', 'parseCodexMcpList', 'resolveClaudeBinary', 'findCodexBinary', 'saveLibraryState', 'libraryStatePath',
  'parseCapabilityPackage', 'scrubAgentEnv', 'NativeCommandError',
];

const counts = { pass: 0, fail: 0, skip: 0 };
const clip = (text) => String(text).trim().slice(0, PREVIEW_CHARS);
const errText = (err) => (err instanceof Error ? err.message : String(err));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const pass = (engine, id) => { counts.pass += 1; console.log(`PASS ${engine} ${id}`); };
const fail = (engine, id, detail) => { counts.fail += 1; console.log(`FAIL ${engine} ${id}: ${clip(detail)}`); };
const skip = (engine, id, why) => { counts.skip += 1; console.log(`SKIP ${engine} ${id} (${why})`); };
const info = (engine, id, text) => console.log(`INFO ${engine} ${id} ${clip(text)}`);

// ---------------------------------------------------------------- Compilación y guarda

async function build() {
  const buildDir = mkdtempSync(join(tmpdir(), 'mage-lib-spike-build-'));
  const outfile = join(buildDir, 'library-bundle.mjs');
  await esbuild.build({
    entryPoints: [join(repo, 'spike', 'library-entry.ts')], bundle: true, format: 'esm', platform: 'node', outfile,
    alias: { '@shared': join(repo, 'src', 'shared') }, external: ['node:*'], loader: { '.json': 'json' },
    plugins: [linguiCatalogPlugin(repo)], logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  return { buildDir, outfile };
}

function isUnsafeDir(dir) {
  const underTmp = resolve(dir).startsWith(resolve(tmpdir()));
  return !underTmp || dir === join(homedir(), '.claude') || dir === join(homedir(), '.codex');
}

function checkBuildOnly(lib) {
  const missing = REQUIRED_EXPORTS.find((name) => typeof lib[name] !== 'function');
  if (missing !== undefined) return failBuild(`falta la exportación ${missing}`);
  const entries = lib.loadBundledCatalog().length;
  if (entries !== EXPECTED_CATALOG_ENTRIES) return failBuild(`el catálogo tiene ${entries} entradas, no ${EXPECTED_CATALOG_ENTRIES}`);
  console.log('PASS build');
  return 0;
}

function failBuild(detail) {
  console.log(`FAIL build: ${detail}`);
  return 1;
}

// ---------------------------------------------------------------- Utilidades de disco y de listas

function readClaudeServers(claudeDir) {
  const file = join(claudeDir, '.claude.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).mcpServers ?? {}) : {};
}

// Recorre un JSON y devuelve todos sus objetos: `plugin list --json` no está medido y su forma puede variar.
function allObjects(node, out = []) {
  if (Array.isArray(node)) node.forEach((item) => allObjects(item, out));
  else if (node !== null && typeof node === 'object') {
    out.push(node);
    Object.values(node).forEach((value) => allObjects(value, out));
  }
  return out;
}

// Los plugins `ecc` de un `plugin list --json`: id o nombre que empieza por `ecc` y que no se declare no instalado.
function eccPlugins(text) {
  const named = (o) => [o.id, o.name].some((v) => typeof v === 'string' && (v === PLUGIN_ID || v.startsWith(`${PLUGIN_ID}@`)));
  return allObjects(JSON.parse(text)).filter((o) => named(o) && o.installed !== false);
}

function claudeMcpDiskDetail(claudeDir, version) {
  const entry = readClaudeServers(claudeDir)[MCP_ID];
  if (entry === undefined) return `no hay mcpServers.${MCP_ID} en .claude.json`;
  const args = entry.args ?? [];
  const launcherOk = IS_WINDOWS ? entry.command === 'cmd' && args[0] === '/c' && args[1] === 'npx' : entry.command === 'npx';
  const lastOk = args.at(-1) === `@upstash/context7-mcp@${version}`;
  return launcherOk && lastOk ? null : `entrada inesperada: ${JSON.stringify({ command: entry.command, args })}`;
}

// ---------------------------------------------------------------- Pasos comunes (los dos motores)

// `check`: una comprobación con una sola línea PASS/FAIL. El cuerpo devuelve null si va bien o el detalle del fallo.
async function check(engine, id, body) {
  try {
    const detail = await body();
    if (detail === null || detail === undefined) pass(engine, id);
    else fail(engine, id, detail);
    return detail === null || detail === undefined;
  } catch (err) {
    fail(engine, id, errText(err));
    return false;
  }
}

// `apply` del servicio de producción; null si terminó en `done`, o el resultado recortado.
async function applyDone(service, target, action) {
  const result = await service.apply(action, target);
  return result.status === 'done' ? null : `${action} ${target.packageId}: ${JSON.stringify(result)}`;
}

// Una acción por cada paquete, en serie; el primer fallo corta.
async function applyAll(service, engineCtx, steps) {
  for (const [action, packageId] of steps) {
    const detail = await applyDone(service, targetOf(engineCtx, packageId), action);
    if (detail !== null) return detail;
  }
  return null;
}

const targetOf = (engineCtx, packageId) => ({ engine: engineCtx.engine, accountDir: engineCtx.dir, packageId });
const nativeOf = (engineCtx, args) => ({ engine: engineCtx.engine, args });
const runNative = (engineCtx, args) => engineCtx.lib.runNativeCommand(engineCtx.native, nativeOf(engineCtx, args));

async function installDisabledEnabled(engineCtx, mcpGone, mcpBack) {
  const { service } = engineCtx;
  const target = targetOf(engineCtx, MCP_ID);
  await check(engineCtx.engine, 'disable-mcp', async () =>
    (await applyDone(service, target, 'disable')) ?? ((await mcpGone()) ? null : 'sigue instalado tras desactivar'));
  await check(engineCtx.engine, 'enable-mcp', async () =>
    (await applyDone(service, target, 'enable')) ?? ((await mcpBack()) ? null : 'no vuelve tras activar'));
}

// Actualizar: con un catálogo cuyo context7 es 4.4.1 se quita e instala esa versión; con el real, `update` la sube a 4.4.2.
async function checkUpdateMcp(engineCtx, diskDetail) {
  const { engine, service, oldService } = engineCtx;
  await check(engine, 'update-mcp', async () => {
    const prepared = (await applyAll(oldService, engineCtx, [['remove', MCP_ID], ['install', MCP_ID]])) ?? diskDetail(MCP_OLD_VERSION);
    if (prepared !== null) return `preparación 4.4.1: ${prepared}`;
    const updated = (await applyDone(service, targetOf(engineCtx, MCP_ID), 'update')) ?? diskDetail(MCP_VERSION);
    return updated;
  });
}

function olderCatalog(lib) {
  const bump = (text) => text.replaceAll(MCP_VERSION, MCP_OLD_VERSION);
  return lib.loadBundledCatalog().map((entry) => {
    if (entry.package.id !== MCP_ID) return entry;
    const { native } = entry.package;
    const raw = { ...structuredClone(entry.package), version: MCP_OLD_VERSION, native: { ...native, args: native.args.map(bump) } };
    return { ...entry, package: lib.parseCapabilityPackage(raw) };
  });
}

// ---------------------------------------------------------------- Claude

async function claudeCollision(engineCtx) {
  const { lib, service, dir } = engineCtx;
  const removed = await applyDone(service, targetOf(engineCtx, MCP_ID), 'remove');
  if (removed !== null) return `quitar context7: ${removed}`;
  await runNative(engineCtx, ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', MCP_ID, ...FOREIGN_MCP_ARGS]);
  try {
    const outcome = await service.apply('install', targetOf(engineCtx, MCP_ID)).then(
      (result) => ({ result }), (error) => ({ error }));
    if (outcome.result !== undefined) return 'Claude sobrescribe un MCP ajeno';
    info('claude', 'collision', errText(outcome.error));
    if (!(outcome.error instanceof lib.NativeCommandError)) return `esperaba NativeCommandError: ${errText(outcome.error)}`;
    const command = readClaudeServers(dir)[MCP_ID]?.command;
    return command === 'node' ? null : `el context7 ajeno ya no es node: ${command}`;
  } finally {
    await runNative(engineCtx, ['mcp', 'remove', MCP_ID, '--scope', 'user']);
  }
}

async function claudePluginVersion(engineCtx) {
  const text = await runNative(engineCtx, ['plugin', 'list', '--json']);
  info('claude', 'plugin-list', text);
  const versions = eccPlugins(text).filter((o) => String(o.id).startsWith('ecc@ecc')).map((o) => o.version);
  if (versions.includes(PLUGIN_VERSION)) return null;
  return `versión ${JSON.stringify(versions)}: el #ref no fija la versión`;
}

async function claudeDiskClean(engineCtx) {
  const skill = join(engineCtx.dir, 'skills', SKILL_ID, 'SKILL.md');
  if (existsSync(skill)) return 'sigue skills/ecc-tdd-workflow/SKILL.md';
  if (readClaudeServers(engineCtx.dir)[MCP_ID] !== undefined) return 'sigue mcpServers.context7';
  const plugins = eccPlugins(await runNative(engineCtx, ['plugin', 'list', '--json']));
  return plugins.some((o) => String(o.id).startsWith('ecc@ecc')) ? 'sigue ecc@ecc en plugin list' : null;
}

async function runClaude(engineCtx, options) {
  const { engine, dir } = engineCtx;
  const skillFile = join(dir, 'skills', SKILL_ID, 'SKILL.md');
  await check(engine, 'install-skill', () => applyDone(engineCtx.service, targetOf(engineCtx, SKILL_ID), 'install'));
  await check(engine, 'disk-skill', () => {
    if (!existsSync(skillFile)) return 'no existe skills/ecc-tdd-workflow/SKILL.md';
    const digest = sha256(readFileSync(skillFile));
    return digest === SKILL_SHA256 ? null : `sha256 ${digest}`;
  });
  await check(engine, 'install-mcp', () => applyDone(engineCtx.service, targetOf(engineCtx, MCP_ID), 'install'));
  await check(engine, 'disk-mcp', () => claudeMcpDiskDetail(dir, MCP_VERSION));
  await installDisabledEnabled(engineCtx, () => readClaudeServers(dir)[MCP_ID] === undefined, () => readClaudeServers(dir)[MCP_ID] !== undefined);
  await checkUpdateMcp(engineCtx, (version) => claudeMcpDiskDetail(dir, version));
  await check(engine, 'collision-mcp', () => claudeCollision(engineCtx));
  await check(engine, 'reinstall-mcp', () => applyDone(engineCtx.service, targetOf(engineCtx, MCP_ID), 'install'));
  await check(engine, 'install-plugin', () => applyDone(engineCtx.service, targetOf(engineCtx, PLUGIN_ID), 'install'));
  await check(engine, 'plugin-version', () => claudePluginVersion(engineCtx));
  await claudeTurn(engineCtx, options);
  await check(engine, 'remove-all', () =>
    applyAll(engineCtx.service, engineCtx, [['remove', PLUGIN_ID], ['remove', MCP_ID], ['remove', SKILL_ID]]));
  await check(engine, 'disk-clean', () => claudeDiskClean(engineCtx));
}

// ---------------------------------------------------------------- Turno de Claude (M6)

// Un hijo con su salida recogida; se para por su PID al agotar el plazo.
function collectProcess(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), options.timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => { clearTimeout(timer); rejectRun(err); });
    child.on('close', (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}

function parseLines(stdout) {
  const messages = [];
  let skipped = 0;
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      skipped += 1; // avisos del CLI que no son NDJSON; se cuentan y se informan
    }
  }
  if (skipped > 0) info('claude', 'turn non-json-lines', String(skipped));
  return messages;
}

const namesOf = (list) => (Array.isArray(list) ? list.map((item) => (typeof item === 'string' ? item : String(item?.name ?? ''))) : []);

function reportClaudeInit(init) {
  const engine = 'claude';
  info(engine, 'init-keys', Object.keys(init).join(','));
  const servers = namesOf(init.mcp_servers);
  const skills = [...namesOf(init.skills), ...namesOf(init.slash_commands)];
  const plugins = namesOf(init.plugins);
  if (servers.includes(MCP_ID)) pass(engine, 'turn-mcp');
  else fail(engine, 'turn-mcp', `mcp_servers: ${servers.join(',')}`);
  if (skills.some((name) => name.includes('tdd-workflow'))) pass(engine, 'turn-skill');
  else fail(engine, 'turn-skill', `skills/slash_commands sin tdd-workflow (${skills.length} nombres)`);
  const hasPlugin = plugins.includes(PLUGIN_ID) || skills.some((name) => name.startsWith(`${PLUGIN_ID}:`));
  if (hasPlugin) pass(engine, 'turn-plugin');
  else fail(engine, 'turn-plugin', `plugins: ${plugins.join(',')}`);
}

async function claudeTurn(engineCtx, options) {
  const engine = 'claude';
  if (!options.turn) return skip(engine, 'turn', 'sin --turn');
  const apiKey = process.env.MAGE_SPIKE_ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === '') return skip(engine, 'turn', 'sin cuenta');
  const { lib, dir } = engineCtx;
  const env = { ...lib.scrubAgentEnv(process.env), CLAUDE_CONFIG_DIR: dir, ANTHROPIC_API_KEY: apiKey };
  const args = ['-p', TURN_PROMPT, '--model', CLAUDE_TURN_MODEL, '--output-format', 'stream-json', '--verbose', '--max-turns', '1'];
  await check(engine, 'turn', async () => {
    const run = await collectProcess(lib.resolveClaudeBinary(), args, { cwd: options.root, env, timeoutMs: CLAUDE_TURN_TIMEOUT_MS });
    const messages = parseLines(run.stdout);
    const init = messages.find((m) => m.type === 'system' && m.subtype === 'init');
    if (init === undefined) return `sin mensaje system/init (código ${run.code}): ${clip(run.stderr)}`;
    reportClaudeInit(init);
    const result = messages.find((m) => m.type === 'result');
    const usage = result?.usage ?? {};
    info(engine, 'turn usage', `input=${usage.input_tokens} output=${usage.output_tokens}`);
    return result !== undefined && result.is_error !== true ? null : `el turno terminó con error (código ${run.code})`;
  });
}

// ---------------------------------------------------------------- Codex

async function codexMcpServers(engineCtx) {
  const text = await runNative(engineCtx, engineCtx.lib.nativeListCommand('codex', 'mcpStdio').args);
  return engineCtx.lib.parseCodexMcpList(text);
}

function codexTomlDetail(engineCtx) {
  const toml = readFileSync(join(engineCtx.dir, 'config.toml'), 'utf8');
  if (!toml.includes(`@upstash/context7-mcp@${MCP_VERSION}`)) return 'config.toml sin @upstash/context7-mcp@4.4.2';
  if (IS_WINDOWS && !(toml.includes('"cmd"') && toml.includes('"/c"'))) return 'config.toml sin "cmd" y "/c"';
  return null;
}

async function codexDiskMcp(engineCtx) {
  const servers = await codexMcpServers(engineCtx);
  if (!servers.some((s) => s.name === MCP_ID)) return `mcp list --json sin ${MCP_ID}`;
  return codexTomlDetail(engineCtx);
}

async function codexSkillBlocked(engineCtx) {
  const outcome = await engineCtx.service.apply('install', targetOf(engineCtx, SKILL_ID)).then(
    (result) => ({ result }), (error) => ({ error }));
  if (outcome.result !== undefined) return `esperaba rechazo y resolvió: ${JSON.stringify(outcome.result)}`;
  const message = JSON.stringify(outcome.error?.localized ?? outcome.error?.key ?? errText(outcome.error));
  info('codex', 'skill-blocked', message);
  return message.includes('errors.capabilities.blocked') ? null : `rechazo distinto de errors.capabilities.blocked: ${message}`;
}

async function codexCollision(engineCtx) {
  const { service } = engineCtx;
  const removed = await applyDone(service, targetOf(engineCtx, MCP_ID), 'remove');
  if (removed !== null) return `quitar context7: ${removed}`;
  await runNative(engineCtx, ['mcp', 'add', MCP_ID, ...FOREIGN_MCP_ARGS]);
  try {
    const result = await service.apply('install', targetOf(engineCtx, MCP_ID));
    const expected = { status: 'collision', items: [`codex mcp: ${MCP_ID}`] };
    if (JSON.stringify(result) !== JSON.stringify(expected)) return `resultado inesperado: ${JSON.stringify(result)}`;
    const foreign = (await codexMcpServers(engineCtx)).find((s) => s.name === MCP_ID);
    return foreign?.config?.command === 'node' ? null : `el context7 ajeno ya no es node: ${JSON.stringify(foreign?.config)}`;
  } finally {
    await runNative(engineCtx, ['mcp', 'remove', MCP_ID]);
  }
}

async function codexPluginVersion(engineCtx) {
  const text = await runNative(engineCtx, ['plugin', 'list', '--json']);
  info('codex', 'plugin-list', text);
  const plugins = eccPlugins(text);
  if (plugins.some((o) => o.version === PLUGIN_VERSION)) return null;
  return `versiones ${JSON.stringify(plugins.map((o) => o.version))} (${plugins.length} elementos ecc)`;
}

async function codexDiskClean(engineCtx) {
  if ((await codexMcpServers(engineCtx)).some((s) => s.name === MCP_ID)) return 'sigue context7 en mcp list';
  const plugins = eccPlugins(await runNative(engineCtx, ['plugin', 'list', '--json']));
  return plugins.length > 0 ? 'sigue ecc en plugin list' : null;
}

async function runCodex(engineCtx, options) {
  const { engine } = engineCtx;
  const service = () => engineCtx.service;
  await check(engine, 'skill-blocked', () => codexSkillBlocked(engineCtx));
  await check(engine, 'install-mcp', () => applyDone(service(), targetOf(engineCtx, MCP_ID), 'install'));
  await check(engine, 'disk-mcp', () => codexDiskMcp(engineCtx));
  const listed = async () => (await codexMcpServers(engineCtx)).some((s) => s.name === MCP_ID);
  await installDisabledEnabled(engineCtx, async () => !(await listed()), listed);
  await checkUpdateMcp(engineCtx, (version) => codexTomlVersionDetail(engineCtx, version));
  await check(engine, 'collision-mcp', () => codexCollision(engineCtx));
  await check(engine, 'reinstall-mcp', () => applyDone(service(), targetOf(engineCtx, MCP_ID), 'install'));
  await check(engine, 'install-plugin', () => applyDone(service(), targetOf(engineCtx, PLUGIN_ID), 'install'));
  await check(engine, 'plugin-version', () => codexPluginVersion(engineCtx));
  await codexTurn(engineCtx, options);
  await check(engine, 'remove-all', () => applyAll(service(), engineCtx, [['remove', PLUGIN_ID], ['remove', MCP_ID]]));
  await check(engine, 'disk-clean', () => codexDiskClean(engineCtx));
}

// La versión que hay ahora en config.toml: lo único de `update-mcp` que cambia entre Claude y Codex es dónde se mira.
function codexTomlVersionDetail(engineCtx, version) {
  const toml = readFileSync(join(engineCtx.dir, 'config.toml'), 'utf8');
  return toml.includes(`@upstash/context7-mcp@${version}`) ? null : `config.toml no tiene @${version}`;
}

// ---------------------------------------------------------------- Cliente mínimo de `codex app-server` (JSON-RPC por líneas)

class AppServer {
  constructor(binary, env, cwd) {
    this.child = spawn(binary, ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.pid = this.child.pid;
    this.env = env;
    this.waiting = new Map();
    this.seen = [];
    this.seq = 0;
    this.buffer = '';
    this.child.stderr.resume();
    this.child.stdout.setEncoding('utf8').on('data', (chunk) => this.onData(chunk));
  }

  onData(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      this.onLine(this.buffer.slice(0, index).trim());
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf('\n');
    }
  }

  onLine(line) {
    if (line === '') return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // un aviso del CLI que no es JSON-RPC
    }
    if (message.method === undefined && typeof message.id === 'number') {
      this.waiting.get(message.id)?.(message);
      this.waiting.delete(message.id);
    } else if (message.method !== undefined && message.id !== undefined) {
      this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no soportado por el spike' } });
    } else {
      this.seen.push(message);
    }
  }

  write(message) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  // Devuelve la respuesta entera (`result` o `error`): quien llama decide si un error es esperable.
  rpc(method, params) {
    this.seq += 1;
    const id = this.seq;
    return new Promise((resolveRpc, rejectRpc) => {
      const timer = setTimeout(() => rejectRpc(new Error(`sin respuesta a ${method} en ${RPC_TIMEOUT_MS} ms`)), RPC_TIMEOUT_MS);
      this.waiting.set(id, (message) => { clearTimeout(timer); resolveRpc(message); });
      this.write({ id, method, params });
    });
  }

  async request(method, params) {
    const reply = await this.rpc(method, params);
    if (reply.error !== undefined) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  }

  async waitNotification(method, matches, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.seen.find((m) => m.method === method && matches(m.params));
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(`${method} no llegó en ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async init() {
    await this.request('initialize', { clientInfo: { name: 'mage-spike', title: 'Mage spike', version: '0.1.4' }, capabilities: { experimentalApi: true } });
    this.write({ method: 'initialized' });
  }

  // Se para por su PID (el proceso es el nuestro) y se espera a que muera.
  close() {
    return new Promise((resolveClose) => {
      if (this.child.exitCode !== null) return resolveClose();
      this.child.once('exit', () => resolveClose());
      process.kill(this.pid);
    });
  }
}

// ---------------------------------------------------------------- Turno de Codex (M6)

// El campo del esfuerzo en `turn/start` lo dice el esquema de 0.164.0, que se genera ahora (y solo ahora) en una carpeta desechable.
async function effortFieldFor(engineCtx, root, env) {
  const out = join(root, 'schema');
  mkdirSync(out, { recursive: true });
  try {
    const run = await collectProcess(engineCtx.binary, ['app-server', 'generate-json-schema', '--out', out], { cwd: root, env, timeoutMs: SCHEMA_TIMEOUT_MS });
    if (run.code !== 0) throw new Error(`código ${run.code}: ${clip(run.stderr)}`);
    const file = readdirSync(out, { recursive: true }).find((name) => String(name).endsWith('TurnStartParams.json'));
    if (file === undefined) throw new Error('el esquema no trae TurnStartParams.json');
    const properties = Object.keys(JSON.parse(readFileSync(join(out, String(file)), 'utf8')).properties ?? {});
    const field = EFFORT_FIELDS.find((name) => properties.includes(name));
    info('codex', 'turn effort-field', `${field ?? 'ninguno de ' + EFFORT_FIELDS.join('/')} (campos: ${properties.join(',')})`);
    return field ?? EFFORT_FIELDS[0];
  } catch (err) {
    info('codex', 'turn effort-field', `esquema no disponible (${errText(err)}); se usa ${EFFORT_FIELDS[0]}`);
    return EFFORT_FIELDS[0];
  }
}

async function codexPluginsSeen(server) {
  const first = await server.rpc('plugin/installed', {});
  const reply = first.error === undefined ? first : await server.rpc('plugin/list', {});
  if (reply.error !== undefined) throw new Error(`plugin/installed y plugin/list fallan: ${JSON.stringify(reply.error)}`);
  return allObjects(reply.result).filter((o) => [o.id, o.name].some((v) => typeof v === 'string' && v.startsWith(PLUGIN_ID)));
}

function reportCodexUsage(server) {
  const updates = server.seen.filter((m) => m.method === 'thread/tokenUsage/updated');
  const total = updates.at(-1)?.params?.tokenUsage?.total;
  if (total === undefined) return info('codex', 'turn usage', 'no recibido');
  info('codex', 'turn usage', `input=${total.inputTokens} output=${total.outputTokens} total=${total.totalTokens}`);
}

async function codexTurnBody(engineCtx, options, server) {
  const engine = 'codex';
  await server.init();
  const status = await server.request('mcpServerStatus/list', {});
  if (JSON.stringify(status).includes(MCP_ID)) pass(engine, 'turn-mcp');
  else fail(engine, 'turn-mcp', `mcpServerStatus/list sin ${MCP_ID}`);
  const plugins = await codexPluginsSeen(server);
  if (plugins.length > 0) pass(engine, 'turn-plugin');
  else fail(engine, 'turn-plugin', 'sin ecc en plugin/installed ni plugin/list');
  const thread = await server.request('thread/start', { model: CODEX_TURN_MODEL, cwd: options.root, approvalPolicy: 'never' });
  const threadId = thread?.thread?.id;
  if (typeof threadId !== 'string') return `thread/start sin thread.id: ${JSON.stringify(thread)}`;
  const effortField = await effortFieldFor(engineCtx, options.root, server.env);
  const input = [{ type: 'text', text: TURN_PROMPT, text_elements: [] }];
  const started = await server.request('turn/start', { threadId, input, model: CODEX_TURN_MODEL, approvalPolicy: 'never', [effortField]: TURN_EFFORT });
  const turnId = started?.turn?.id;
  const done = await server.waitNotification('turn/completed', (p) => p?.turn?.id === turnId, CODEX_TURN_TIMEOUT_MS);
  reportCodexUsage(server);
  return done.params?.turn?.status === 'completed' ? null : `turn/completed con estado ${JSON.stringify(done.params?.turn?.status)}`;
}

async function codexTurn(engineCtx, options) {
  const engine = 'codex';
  if (!options.turn) return skip(engine, 'turn', 'sin --turn');
  if (!engineCtx.usesVerificationHome) return skip(engine, 'turn', 'sin cuenta');
  const env = { ...engineCtx.lib.scrubAgentEnv(process.env), CODEX_HOME: engineCtx.dir };
  const server = new AppServer(engineCtx.binary, env, options.root);
  try {
    await check(engine, 'turn-completed', () => codexTurnBody(engineCtx, options, server));
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------- Montaje

function makeService(lib, mount, catalog) {
  return new lib.LibraryService({
    catalog, contentsOf: lib.bundledContents, fs: lib.nodeCapabilityFs(), userDataDir: mount.userData, platform: process.platform,
    caseInsensitivePaths: process.platform === 'win32' || process.platform === 'darwin',
    listAccounts: () => [{ configDir: mount.claudeDir, engine: 'claude' }, { configDir: mount.codexHome, engine: 'codex' }],
    binaryFor: (engine) => mount.binaries[engine](), runner: lib.execFileRunner, baseEnv: () => process.env,
    isCommandAvailable: () => true,
  });
}

function engineContext(lib, mount, engine) {
  const dir = engine === 'claude' ? mount.claudeDir : mount.codexHome;
  const binary = mount.binaries[engine]();
  const native = { engine, binary, configDir: dir, runner: lib.execFileRunner, baseEnv: process.env };
  return {
    engine, lib, dir, binary, native, service: mount.service, oldService: mount.oldService,
    usesVerificationHome: engine === 'codex' && mount.codexHome === mount.verificationCodexHome,
  };
}

function prepareMount(lib, options) {
  const root = mkdtempSync(join(tmpdir(), 'mage-lib-spike-'));
  const verificationCodexHome = options.turn && process.env.MAGE_SPIKE_CODEX_HOME ? resolve(process.env.MAGE_SPIKE_CODEX_HOME) : null;
  const mount = {
    root, userData: join(root, 'userData'), claudeDir: join(root, 'claude-cfg'),
    codexHome: verificationCodexHome ?? join(root, 'codex-home'), verificationCodexHome,
    binaries: {
      claude: () => lib.resolveClaudeBinary(),
      codex: () => {
        const found = lib.findCodexBinary();
        if (found === null) throw new Error('No se encontró el binario de codex');
        return found;
      },
    },
  };
  for (const dir of [mount.userData, mount.claudeDir, mount.codexHome]) mkdirSync(dir, { recursive: true });
  mount.service = makeService(lib, mount, lib.loadBundledCatalog());
  mount.oldService = makeService(lib, mount, olderCatalog(lib));
  return mount;
}

// ---------------------------------------------------------------- Config real: solo se lee (nunca se imprime) su sha256

function realConfigFiles() {
  return [join(homedir(), '.claude.json'), join(homedir(), '.claude', 'settings.json'), join(homedir(), '.codex', 'config.toml')]
    .filter((file) => existsSync(file));
}

const fingerprint = (files) => new Map(files.map((file) => [file, sha256(readFileSync(file))]));

function reportRealConfig(before) {
  for (const [file, digest] of before) {
    const after = existsSync(file) ? sha256(readFileSync(file)) : null;
    if (after === digest) pass('real', `real-config-untouched ${file}`);
    else fail('real', 'real-config-untouched', file);
  }
}

// ---------------------------------------------------------------- Principal

async function runAll(lib, options) {
  const mount = prepareMount(lib, options);
  const dirs = [mount.userData, mount.claudeDir, mount.codexHome];
  if (dirs.some(isUnsafeDir)) {
    console.log('FAIL guarda: alguna carpeta no cuelga de os.tmpdir() o es la real del usuario');
    rmSync(mount.root, { recursive: true, force: true });
    return 2;
  }
  const before = fingerprint(realConfigFiles());
  const ctxOptions = { ...options, root: mount.root };
  try {
    for (const engine of options.engines) {
      const engineCtx = engineContext(lib, mount, engine);
      if (engine === 'claude') await runClaude(engineCtx, ctxOptions);
      else await runCodex(engineCtx, ctxOptions);
    }
  } finally {
    reportRealConfig(before);
    rmSync(mount.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (!existsSync(mount.root)) pass('spike', 'cleanup');
    else fail('spike', 'cleanup', mount.root);
  }
  console.log(`RESUMEN ${counts.pass} PASS, ${counts.fail} FAIL, ${counts.skip} SKIP`);
  return counts.fail > 0 ? 1 : 0;
}

function parseArgs(argv) {
  const flags = argv.filter((a) => a.startsWith('--'));
  const unknownFlag = flags.find((f) => f !== '--turn' && f !== '--build-only');
  if (unknownFlag !== undefined) throw new Error(`Opción desconocida: ${JSON.stringify(unknownFlag)} (--turn, --build-only)`);
  const engines = argv.filter((a) => !a.startsWith('--'));
  const unknown = engines.find((e) => e !== 'claude' && e !== 'codex');
  if (unknown !== undefined) throw new Error(`Motor desconocido: ${JSON.stringify(unknown)} (claude|codex)`);
  return { engines: engines.length > 0 ? engines : ['claude', 'codex'], turn: flags.includes('--turn'), buildOnly: flags.includes('--build-only') };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const codexHome = process.env.MAGE_SPIKE_CODEX_HOME;
  if (options.turn && codexHome && isUnsafeDir(resolve(codexHome))) {
    console.log('FAIL guarda: MAGE_SPIKE_CODEX_HOME no cuelga de os.tmpdir()');
    return 2;
  }
  const { buildDir, outfile } = await build();
  try {
    const lib = await import(pathToFileURL(outfile).href);
    return options.buildOnly ? checkBuildOnly(lib) : await runAll(lib, options);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
