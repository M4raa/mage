// Spike del punto de control cp/M-04 (carril M): el REGISTRO del servidor MCP de Mage en los CLI de verdad.
// Con el código REAL de `src/main/mcpServer/registration.ts` (empaquetado aquí con esbuild) construye los argumentos de
// `claude mcp add` y `codex mcp add` y los ejecuta contra un CLAUDE_CONFIG_DIR y un CODEX_HOME temporales y VACÍOS, con un
// Mage construido (`out/main/index.js`) sin ventanas como destino del servidor. Turnos REALES: 0 (no se envía ningún prompt; sin
// credenciales del usuario: el entorno de los CLI se sanea, sin ANTHROPIC_*, OPENAI_* ni CODEX_API_KEY).
//   node spike/mcp-registration.mjs --build-only                 empaqueta el módulo de registro y sale con 0 (sin CLI ni Mage)
//   node spike/mcp-registration.mjs --out <fichero.json>         requiere `pnpm build` antes (si falta out/main/index.js, sale con 1)
// Mide: g1 `.claude.json` con `mcpServers.mage` (command, args y env exactos; el nombre NO se cuela en env), g2 `claude mcp list`
// lo da por conectado, g3 `config.toml` de Codex con `[mcp_servers.mage]` (command, args y env), g4 `codex mcp list` lo muestra,
// g5 los dos `mcp remove` lo quitan, más las versiones de `claude` y `codex`. Sale con 0 si todo da lo esperado y con 1 si no.
// Medido contra: ver `versiones` en la salida (el hallazgo sin versión no es reproducible). Opcionales: --claude <ruta> --codex <ruta>.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRepo = createRequire(join(repo, 'package.json'));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const MAIN_ENTRY = join(repo, 'out', 'main', 'index.js');
const HOST_WAIT_MS = 30_000;
const POLL_MS = 250;
const CLI_TIMEOUT_MS = 60_000;
const OUTPUT_EXCERPT = 600;
const PROFILE_PREFIX = 'mage-m-reg-';
const CREDENTIAL_ENV = /^(ANTHROPIC_|OPENAI_|CODEX_API_KEY$|GEMINI_|GOOGLE_API_KEY$)/;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);

async function bundleRegistration(outDir) {
  const esbuild = requireFromRepo(join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
  const outfile = join(outDir, 'registration-bundle.mjs');
  await esbuild.build({
    stdin: {
      contents: "export * from './src/main/mcpServer/registration.ts'; export * from './src/main/mcpServer/registrationStatus.ts';",
      resolveDir: repo, sourcefile: 'mcp-registration-entry.ts', loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error',
  });
  return import(pathToFileURL(outfile).href);
}

// Entorno de los CLI: el del usuario SIN ninguna credencial (la misma idea que `scrubAgentEnv`).
function sanitizedEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!CREDENTIAL_ENV.test(key) && value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

function runCli(binary, cliArgs, env) {
  const run = spawnSync(binary, cliArgs, { env, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, windowsHide: true });
  return {
    code: run.status, error: run.error?.message ?? null,
    stdout: (run.stdout ?? '').trim(), stderr: (run.stderr ?? '').trim(),
  };
}

const excerpt = (run) => ({ code: run.code, error: run.error, stdout: run.stdout.slice(0, OUTPUT_EXCERPT), stderr: run.stderr.slice(0, OUTPUT_EXCERPT) });

function killTree(pid) {
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-pid, 'SIGKILL');
}

async function waitForHostFiles(runDir) {
  const start = nowMs();
  while (nowMs() - start < HOST_WAIT_MS) {
    if (existsSync(runDir) && ['host-endpoint', 'host-token'].every((name) => readdirSync(runDir).includes(name))) return;
    await sleep(POLL_MS);
  }
  throw new Error(`El host no escribió sus ficheros en ${runDir} en ${HOST_WAIT_MS} ms`);
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((item, index) => item === b[index]);

// g1: lo que dejó `claude mcp add` en `.claude.json` frente a lo planeado por `mageMcpLaunch`.
function measureClaudeConfig(claudeDir, launch, name) {
  const file = join(claudeDir, '.claude.json');
  if (!existsSync(file)) return { ok: false, motivo: 'no existe .claude.json' };
  const server = JSON.parse(readFileSync(file, 'utf8')).mcpServers?.[name];
  if (server === undefined) return { ok: false, motivo: `mcpServers.${name} ausente` };
  const envKeys = Object.keys(server.env ?? {}).sort();
  const expectedKeys = Object.keys(launch.env).sort();
  const checks = {
    command: server.command === launch.command,
    args: sameList(server.args, launch.args),
    envClaves: sameList(envKeys, expectedKeys),
    envValores: expectedKeys.every((key) => server.env?.[key] === launch.env[key]),
    elNombreNoEstaEnEnv: !envKeys.includes(name),
  };
  return { ok: Object.values(checks).every(Boolean), ...checks, type: server.type ?? null, envClaves_: envKeys };
}

// Quita comillas y barras: el TOML escapa las rutas de Windows (`\\`) y eso no importa para comparar el contenido.
const flat = (text) => text.replaceAll('\\', '').replaceAll('"', '').replaceAll("'", '');

// g3: la tabla `[mcp_servers.mage]` de `config.toml` y su sub-tabla de entorno.
function measureCodexConfig(codexHome, launch, name, status) {
  const file = join(codexHome, 'config.toml');
  if (!existsSync(file)) return { ok: false, motivo: 'no existe config.toml' };
  const text = readFileSync(file, 'utf8');
  const hasTable = status.codexConfigHasMageServer(text);
  const section = flat(text.split(/\r?\n/).filter((line) => !line.startsWith('#')).join('\n'));
  const checks = {
    tabla: hasTable,
    command: section.includes(flat(launch.command)),
    args: launch.args.every((arg) => section.includes(flat(arg))),
    env: Object.entries(launch.env).every(([key, value]) => section.includes(`${key} = ${value}`) || section.includes(`${key}=${value}`)),
    tablaEnv: text.includes(`mcp_servers.${name}.env`),
  };
  return { ok: Object.values(checks).every(Boolean), ...checks };
}

async function measure(registration, profile, dirs, binaries) {
  const name = registration.MAGE_MCP_SERVER_NAME;
  const launch = registration.mageMcpLaunch({
    isPackaged: false, execPath: requireFromRepo('electron'), resourcesPath: '', appPath: repo, appImage: undefined, userDataDir: profile,
  });
  const claudeEnv = sanitizedEnv({ CLAUDE_CONFIG_DIR: dirs.claude });
  const codexEnv = sanitizedEnv({ CODEX_HOME: dirs.codex });
  const report = { versiones: {
    claude: runCli(binaries.claude, ['--version'], claudeEnv).stdout, codex: runCli(binaries.codex, ['--version'], codexEnv).stdout,
  } };
  const claudeAdd = runCli(binaries.claude, registration.claudeAddArgs(launch), claudeEnv);
  const codexAdd = runCli(binaries.codex, registration.codexAddArgs(launch), codexEnv);
  report.add = { claude: excerpt(claudeAdd), codex: excerpt(codexAdd) };
  report.g1 = measureClaudeConfig(dirs.claude, launch, name);
  const claudeList = runCli(binaries.claude, ['mcp', 'list'], claudeEnv);
  const line = claudeList.stdout.split(/\r?\n/).find((row) => row.startsWith(`${name}:`)) ?? null;
  report.g2 = { ok: line !== null && /connected/i.test(line) && !/failed/i.test(line), linea: line, list: excerpt(claudeList) };
  report.g3 = measureCodexConfig(dirs.codex, launch, name, registration);
  const codexList = runCli(binaries.codex, ['mcp', 'list'], codexEnv);
  report.g4 = { ok: codexList.code === 0 && new RegExp(`(^|\\s)${name}(\\s|$)`, 'm').test(codexList.stdout), list: excerpt(codexList) };
  const claudeRemove = runCli(binaries.claude, [...registration.CLAUDE_REMOVE_ARGS], claudeEnv);
  const codexRemove = runCli(binaries.codex, [...registration.CODEX_REMOVE_ARGS], codexEnv);
  const claudeGone = !registration.claudeConfigHasMageServer(readFileSync(join(dirs.claude, '.claude.json'), 'utf8'));
  const codexFile = join(dirs.codex, 'config.toml');
  const codexGone = !existsSync(codexFile) || !registration.codexConfigHasMageServer(readFileSync(codexFile, 'utf8'));
  report.g5 = { ok: claudeGone && codexGone && claudeRemove.code === 0 && codexRemove.code === 0, claudeGone, codexGone, claude: excerpt(claudeRemove), codex: excerpt(codexRemove) };
  report.launchPlaneado = { command: launch.command, args: launch.args, envClaves: Object.keys(launch.env) };
  return report;
}

async function main() {
  const bundleDir = mkdtempSync(join(tmpdir(), `${PROFILE_PREFIX}bundle-`));
  const temps = [bundleDir];
  let mage;
  try {
    const registration = await bundleRegistration(bundleDir);
    if (args.includes('--build-only')) {
      console.log('bundle ok');
      return;
    }
    if (!existsSync(MAIN_ENTRY)) {
      console.error(`No existe ${MAIN_ENTRY}: ejecuta «pnpm build» antes.`);
      process.exitCode = 1;
      return;
    }
    const profile = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
    const claudeDir = mkdtempSync(join(tmpdir(), `${PROFILE_PREFIX}claude-`));
    const codexHome = mkdtempSync(join(tmpdir(), `${PROFILE_PREFIX}codex-`));
    temps.push(profile, claudeDir, codexHome);
    mage = spawn(requireFromRepo('electron'), [MAIN_ENTRY, '--headless', `--user-data-dir=${profile}`], {
      stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true,
    });
    await waitForHostFiles(join(profile, 'run'));
    const binaries = { claude: option('claude') ?? 'claude', codex: option('codex') ?? 'codex' };
    const report = { spike: 'mcp-registration', checkpoint: 'cp/M-04', realTurns: 0, at: new Date().toISOString(),
      ...(await measure(registration, profile, { claude: claudeDir, codex: codexHome }, binaries)) };
    report.ok = ['g1', 'g2', 'g3', 'g4', 'g5'].every((key) => report[key]?.ok === true);
    const target = resolve(option('out') ?? join(tmpdir(), 'mage-m-mcp-registration.json'));
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    console.log(`salida: ${target}`);
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    // Para SU Mage por PID con su árbol y borra lo temporal.
    if (mage?.pid !== undefined) {
      try { killTree(mage.pid); } catch { /* ya parado */ }
    }
    await sleep(POLL_MS * 4);
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
