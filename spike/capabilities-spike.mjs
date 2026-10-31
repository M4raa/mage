// Punto de control cp/D-02. Instala, lista y quita un MCP stdio de prueba en Claude Code y en Codex con el CÓDIGO DE
// PRODUCCIÓN de `src/main/capabilities/` (nativeCommands, nativeRunner, commandRunner), y comprueba en disco
// `.claude.json` y `config.toml`. Usa un `CLAUDE_CONFIG_DIR` y un `CODEX_HOME` DESECHABLES y vacíos bajo `os.tmpdir()`;
// no hay turnos de modelo (`mcp` no habla con ninguno) y borra todo al terminar.
// Uso:  node spike/capabilities-spike.mjs [claude|codex ...]    (sin argumentos, los dos)
//       node spike/capabilities-spike.mjs --build-only          (solo compila e importa el módulo; no toca ningún CLI)
// Escrito contra Claude Code 2.1.314 y Codex 0.164.0.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRepo = createRequire(join(repo, 'package.json'));
const esbuild = createRequire(requireFromRepo.resolve('vite/package.json'))('esbuild');
const PREVIEW_CHARS = 300;
const REQUIRED_EXPORTS = [
  'parseCapabilityPackage', 'nativeInstallCommands', 'nativeUninstallCommands', 'nativeListCommand', 'runNativeCommand',
  'runNativeCommands', 'execFileRunner', 'NativeCommandError', 'resolveClaudeBinary', 'resolveCodexBinary', 'parseCodexMcpList',
];

let passCount = 0;
let failCount = 0;
function pass(engine, id) { passCount += 1; console.log(`PASS ${engine} ${id}`); }
function fail(engine, id, detail) { failCount += 1; console.log(`FAIL ${engine} ${id}: ${detail}`); }
const clip = (text) => String(text).trim().slice(0, PREVIEW_CHARS);
const errText = (err) => (err instanceof Error ? err.message : String(err));

// Compila los módulos TS de producción a un .mjs temporal (alias @shared como en el proyecto).
function build() {
  const buildDir = mkdtempSync(join(tmpdir(), 'mage-cap-spike-build-'));
  const outfile = join(buildDir, 'capabilities.mjs');
  const contents = [
    "export * from './src/main/capabilities/capabilityPackage.ts';",
    "export * from './src/main/capabilities/commandRunner.ts';",
    "export * from './src/main/capabilities/nativeCommands.ts';",
    "export * from './src/main/capabilities/nativeRunner.ts';",
    "export { resolveClaudeBinary } from './src/main/os/claudeBinaryResolver.ts';",
    "export { resolveCodexBinary } from './src/main/os/codexBinaryResolver.ts';",
    "export { parseCodexMcpList } from './src/main/config/codexMcp.ts';",
  ].join(' ');
  esbuild.buildSync({
    stdin: { contents, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'src', 'shared') },
    external: ['node:*'], logLevel: 'error',
  });
  return { buildDir, outfile };
}

// Normaliza una ruta para compararla entre SO: `\` → `/` y, en Windows, minúsculas.
function norm(path) {
  const slashed = String(path).replaceAll('\\', '/');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

function isUnsafeDir(dir) {
  const underTmp = resolve(dir).startsWith(resolve(tmpdir()));
  return !underTmp || dir === join(homedir(), '.claude') || dir === join(homedir(), '.codex');
}

function readClaudeServers(claudeDir) {
  const file = join(claudeDir, '.claude.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).mcpServers ?? {}) : {};
}

function diskAfterInstall(env) {
  const { engine, claudeDir, codexHome, name, serverPath } = env;
  if (engine === 'claude') {
    const raw = readFileSync(join(claudeDir, '.claude.json'), 'utf8');
    const entry = JSON.parse(raw).mcpServers?.[name];
    const args = (entry?.args ?? []).map(norm);
    const ok = entry !== undefined && entry.type === 'stdio' && norm(entry.command) === norm(process.execPath) &&
      JSON.stringify(args) === JSON.stringify([norm(serverPath), '--flag']);
    return ok ? null : raw;
  }
  const toml = readFileSync(join(codexHome, 'config.toml'), 'utf8');
  const ok = toml.includes(`[mcp_servers.${name}]`) && norm(toml).includes(norm(serverPath)) && toml.includes('--flag');
  return ok ? null : toml;
}

function diskAfterUninstall(env) {
  const { engine, claudeDir, codexHome, name } = env;
  if (engine === 'claude') return readClaudeServers(claudeDir)[name] === undefined ? null : 'sigue en mcpServers';
  const file = join(codexHome, 'config.toml');
  return !existsSync(file) || !readFileSync(file, 'utf8').includes(`[mcp_servers.${name}]`) ? null : 'sigue en config.toml';
}

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

async function runEngine(lib, env) {
  const { engine, pkg } = env;
  const binary = engine === 'claude' ? lib.resolveClaudeBinary() : lib.resolveCodexBinary();
  const configDir = engine === 'claude' ? env.claudeDir : env.codexHome;
  const ctx = { engine, binary, configDir, runner: lib.execFileRunner, baseEnv: process.env };
  const run = (command) => lib.runNativeCommand(ctx, command);

  await check(engine, 'version', async () => {
    const options = { env: lib.buildNativeEnv(engine, configDir, process.env), timeoutMs: lib.NATIVE_COMMAND_TIMEOUT_MS };
    const result = await lib.execFileRunner(binary, ['--version'], options);
    console.log(`INFO ${engine} version ${clip(result.stdout)}`);
  });
  await check(engine, 'guard-config-dir', async () => {
    const guarded = lib.runNativeCommand({ ...ctx, configDir: '' }, lib.nativeListCommand(engine, 'mcpStdio'));
    const message = await guarded.then(() => null, errText);
    return message !== null && message.includes('config dir') ? null : `no rechazó como se esperaba: ${message}`;
  });
  const installed = await check(engine, 'install', async () => {
    await lib.runNativeCommands(ctx, lib.nativeInstallCommands(engine, pkg.native));
  });
  if (installed) {
    await check(engine, 'disk-after-install', () => diskAfterInstall(env));
    await check(engine, 'list', async () => {
      const stdout = await run(lib.nativeListCommand(engine, 'mcpStdio'));
      const found = engine === 'claude' ? stdout.includes(env.name) : lib.parseCodexMcpList(stdout).some((e) => e.name === env.name);
      return found ? null : `no aparece ${env.name}: ${clip(stdout)}`;
    });
  }
  await check(engine, 'uninstall', async () => {
    await lib.runNativeCommands(ctx, lib.nativeUninstallCommands(engine, pkg.native));
  });
  await check(engine, 'disk-after-uninstall', () => diskAfterUninstall(env));
  await checkCliError(lib, ctx, pkg);
}

async function checkCliError(lib, ctx, pkg) {
  const { engine } = ctx;
  const outcome = await lib.runNativeCommands(ctx, lib.nativeUninstallCommands(engine, pkg.native)).then(
    () => ({ rejected: false, error: null }),
    (error) => ({ rejected: true, error }),
  );
  if (engine === 'codex') {
    // No medido: no se afirma, solo se informa.
    console.log(`INFO codex cli-error ${outcome.rejected ? `rechazó: ${clip(errText(outcome.error))}` : 'resolvió'}`);
    return pass('codex', 'cli-error-returned');
  }
  const { error } = outcome;
  const typed = error instanceof lib.NativeCommandError && error.result.exitCode !== 0;
  if (typed) console.log(`INFO claude cli-error ${clip(error.message)}`);
  return typed ? pass('claude', 'cli-error-returned') : fail('claude', 'cli-error-returned', `esperaba NativeCommandError con código != 0: ${outcome.rejected ? errText(error) : 'resolvió'}`);
}

// Solo lectura y nunca se imprime su contenido: comprueba que el spike no tocó la config real del usuario.
function checkRealConfigUntouched(name) {
  for (const file of [join(homedir(), '.claude.json'), join(homedir(), '.codex', 'config.toml')]) {
    if (!existsSync(file)) continue;
    const touched = readFileSync(file, 'utf8').includes(name);
    if (touched) fail('real', 'real-config-untouched', file);
    else pass('real', `real-config-untouched ${file}`);
  }
}

function checkBuildOnly(lib) {
  const missing = REQUIRED_EXPORTS.find((exportName) => typeof lib[exportName] !== 'function');
  if (missing !== undefined) {
    console.log(`FAIL build ${missing}`);
    return 1;
  }
  console.log('PASS build');
  return 0;
}

function prepareEnv(lib, engines) {
  const root = mkdtempSync(join(tmpdir(), 'mage-cap-spike-'));
  const claudeDir = join(root, 'claude');
  const codexHome = join(root, 'codex');
  mkdirSync(claudeDir);
  mkdirSync(codexHome);
  const serverPath = join(root, 'fake-mcp.mjs');
  writeFileSync(serverPath, 'process.exit(0);\n');
  const name = `mage-cap-spike-${randomUUID().slice(0, 8)}`;
  const pkg = lib.parseCapabilityPackage({
    id: 'cap-spike', version: '0.0.0', source: { url: 'https://example.invalid/cap-spike', sha256: '0'.repeat(64) },
    license: 'MIT', kind: 'mcp', engines: ['claude', 'codex'], files: [],
    native: { type: 'mcpStdio', name, command: process.execPath, args: [serverPath, '--flag'] },
  });
  return { root, claudeDir, codexHome, serverPath, name, pkg, engines };
}

async function main() {
  const argv = process.argv.slice(2);
  const { buildDir, outfile } = build();
  try {
    const lib = await import(pathToFileURL(outfile).href);
    if (argv.includes('--build-only')) return checkBuildOnly(lib);
    return await runAll(lib, argv.length > 0 ? argv : ['claude', 'codex']);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

async function runAll(lib, engines) {
  const unknown = engines.find((e) => e !== 'claude' && e !== 'codex');
  if (unknown !== undefined) throw new Error(`Motor desconocido: ${JSON.stringify(unknown)} (claude|codex)`);
  const env = prepareEnv(lib, engines);
  if (isUnsafeDir(env.claudeDir) || isUnsafeDir(env.codexHome)) {
    console.log('FAIL guarda');
    rmSync(env.root, { recursive: true, force: true });
    return 2;
  }
  try {
    for (const engine of engines) await runEngine(lib, { ...env, engine });
  } finally {
    checkRealConfigUntouched(env.name);
    rmSync(env.root, { recursive: true, force: true });
    if (!existsSync(env.root)) pass('spike', 'cleanup');
  }
  console.log(`RESUMEN ${passCount} PASS, ${failCount} FAIL`);
  return failCount > 0 ? 1 : 0;
}

process.exitCode = await main();
