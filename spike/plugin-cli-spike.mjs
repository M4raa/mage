// Punto 42 de la 0.1.6: mide `claude plugin install|disable|enable|uninstall <p>@<m> --scope user` de punta a punta con el
// CODIGO DE PRODUCCION de Mage (pluginActionCommand, buildNativeEnv, execFileRunner y los lectores de overview/pluginFiles)
// contra el CLI real. Todo en un directorio DESECHABLE bajo os.tmpdir(): CLAUDE_CONFIG_DIR (`config`), HOME y USERPROFILE
// (`home`) y un marketplace LOCAL (`market`) creado aqui. Sin login, sin turnos y sin enlaces. Nunca imprime `.claude.json`
// ni `.credentials.json`: solo sus nombres en las listas de cambios.
// Uso: node spike/plugin-cli-spike.mjs <dir de evidencias (ruta absoluta)>
// Escrito contra Claude Code 2.1.319.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linguiCatalogPlugin } from '../scripts/lib/linguiEsbuildPlugin.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRepo = createRequire(join(repo, 'package.json'));
const esbuild = createRequire(requireFromRepo.resolve('vite/package.json'))('esbuild');
const MARKET = 'mage-spike';
const PLUGIN = 'hola';
const SELECTOR = `${PLUGIN}@${MARKET}`;
const REAL_PLUGIN_FILES = ['installed_plugins.json', 'known_marketplaces.json'];

async function build() {
  const buildDir = mkdtempSync(join(tmpdir(), 'mage-plugin-spike-build-'));
  const outfile = join(buildDir, 'lib.mjs');
  const contents = [
    "export * from './src/main/capabilities/commandRunner.ts';",
    "export * from './src/main/capabilities/nativeCommands.ts';",
    "export * from './src/main/capabilities/nativeRunner.ts';",
    "export * from './src/main/capabilities/overview/pluginFiles.ts';",
    "export { resolveClaudeBinary } from './src/main/os/claudeBinaryResolver.ts';",
  ].join(' ');
  await esbuild.build({
    stdin: { contents, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repo, 'src', 'shared') },
    external: ['node:*'], plugins: [linguiCatalogPlugin(repo)], logLevel: 'error',
  });
  return { buildDir, outfile };
}

const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const sha = (text) => createHash('sha256').update(text).digest('hex');
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Marketplace local: un plugin con un comando y nada que ejecutar al instalar.
function createMarket(dir) {
  writeJson(join(dir, '.claude-plugin', 'marketplace.json'), {
    name: MARKET, owner: { name: 'Mage spike' },
    plugins: [{ name: PLUGIN, source: `./plugins/${PLUGIN}`, description: 'Plugin de prueba del spike de Mage', version: '0.0.1' }],
  });
  const plugin = join(dir, 'plugins', PLUGIN);
  writeJson(join(plugin, '.claude-plugin', 'plugin.json'), { name: PLUGIN, version: '0.0.1', description: 'Plugin de prueba del spike de Mage' });
  mkdirSync(join(plugin, 'commands'), { recursive: true });
  writeFileSync(join(plugin, 'commands', 'hola.md'), '---\ndescription: Saluda\n---\nDi hola.\n');
}

// Ficheros (ruta relativa con `/` -> sha256) de un arbol.
function snapshot(root) {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(root, full).replaceAll('\\', '/')] = sha(readFileSync(full));
    }
  };
  if (existsSync(root)) walk(root);
  return files;
}

function diff(before, after) {
  return {
    created: Object.keys(after).filter((k) => !(k in before)),
    modified: Object.keys(after).filter((k) => k in before && before[k] !== after[k]),
    deleted: Object.keys(before).filter((k) => !(k in after)),
  };
}
const changed = (d) => [...d.created, ...d.modified, ...d.deleted];

// Lo que Mage lee de la cuenta: SOLO `enabledPlugins` de settings.json y los dos ficheros de `plugins/`.
function accountState(lib, config) {
  const settingsText = readText(join(config, 'settings.json'));
  const installedText = readText(join(config, 'plugins', 'installed_plugins.json'));
  const knownText = readText(join(config, 'plugins', 'known_marketplaces.json'));
  return {
    enabledPlugins: settingsText === null ? null : (JSON.parse(settingsText).enabledPlugins ?? null),
    installedPlugins: installedText === null ? null : JSON.parse(installedText),
    knownMarketplaces: knownText === null ? null : JSON.parse(knownText),
    mageInstalled: lib.parseInstalledPlugins(installedText, settingsText),
    mageMarketplaces: lib.parseKnownMarketplaces(knownText),
  };
}

async function step(ctx, name, args, config = ctx.config) {
  const env = ctx.lib.buildNativeEnv('claude', config, ctx.baseEnv);
  const before = { config: snapshot(config), home: snapshot(ctx.home) };
  const started = Date.now();
  const result = await ctx.lib.execFileRunner(ctx.binary, args, { env, timeoutMs: ctx.lib.NATIVE_COMMAND_TIMEOUT_MS });
  const record = {
    name, args, exitCode: result.exitCode, durationMs: Date.now() - started, stdout: result.stdout, stderr: result.stderr,
    config: diff(before.config, snapshot(config)), home: diff(before.home, snapshot(ctx.home)), state: accountState(ctx.lib, config),
  };
  ctx.n += 1;
  writeJson(join(ctx.out, `${String(ctx.n).padStart(2, '0')}-${name}.json`), record);
  console.log(`PASO ${name}: codigo ${result.exitCode}, ${record.durationMs} ms, cambia ${JSON.stringify(changed(record.config))}, home ${JSON.stringify(changed(record.home))}`);
  return record;
}

const act = (ctx, action) => step(ctx, action, ctx.lib.pluginActionCommand(action, SELECTOR).args);

// Si los argumentos de Mage fallan, se mide tambien sin `--scope` (enable/disable lo autodetectan).
async function actWithFallback(ctx, action) {
  const record = await act(ctx, action);
  if (record.exitCode === 0) return { record, fallback: null };
  return { record, fallback: await step(ctx, `${action}-sin-scope`, ['plugin', action, SELECTOR]) };
}

// La otra cuenta: una COPIA de `plugins/` (no un enlace) en un segundo config dir sin settings.json.
async function otherAccount(ctx) {
  const other = join(ctx.root, 'config-b');
  mkdirSync(other);
  cpSync(join(ctx.config, 'plugins'), join(other, 'plugins'), { recursive: true });
  return step(ctx, 'cuenta-b-list', ['plugin', 'list', '--json'], other);
}

// `enabled` del plugin en la lista JSON del CLI; 'sin medir' si la forma no es la esperada.
function listedEnabled(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    return 'sin medir';
  }
  const items = Array.isArray(parsed) ? parsed : (parsed?.plugins ?? []);
  const found = Array.isArray(items) ? items.find((p) => p?.id === SELECTOR || p?.name === SELECTOR) : undefined;
  return typeof found?.enabled === 'boolean' ? found.enabled : 'sin medir';
}

function realPlugins() {
  const dir = join(homedir(), '.claude', 'plugins');
  return Object.fromEntries(REAL_PLUGIN_FILES.map((name) => {
    const text = readText(join(dir, name));
    return [name, text === null ? null : { sha: sha(text), mentionsSpike: text.includes(MARKET) }];
  }));
}

const mine = (record) => record?.state.mageInstalled.plugins.find((p) => p.id === SELECTOR);
const yes = (ok) => (ok ? 'sí' : 'no');
const finalOf = (pair) => pair.fallback ?? pair.record;

function expectations(r, steps, realAfter) {
  const touched = changed(finalOf(r.disable).config);
  const b = listedEnabled(r.otherList.stdout);
  return {
    E1_acciones: yes([r.install, r.disable.record, r.enable.record, r.uninstall].every((x) => x.exitCode === 0)),
    E1_errores: yes(r.installMissing.exitCode !== 0 && r.uninstallMissing.exitCode !== 0),
    E2_instalar: yes(mine(r.install)?.enabled === true && mine(r.install)?.scopes.includes('user') === true),
    E3_desactivar: yes(mine(finalOf(r.disable))?.enabled === false),
    E4_activar: yes(mine(finalOf(r.enable))?.enabled === true),
    E5_desinstalar: yes(r.uninstall.exitCode === 0 && mine(r.uninstall) === undefined),
    E6_sinCuelgues: yes(steps.every((x) => x.exitCode !== null)),
    E7_homeIntacto: yes(steps.every((x) => changed(x.home).length === 0)),
    E8_activarSoloSettings: yes(touched.includes('settings.json') && !touched.some((p) => p.startsWith('plugins/'))),
    E9_cuentaB: b === 'sin medir' ? b : yes(b === false),
    E10_marketplace: yes(r.install.state.mageMarketplaces.some((m) => m.name === MARKET && m.installLocation !== null)),
    E11_realIntacto: yes(Object.values(realAfter).every((f) => f === null || !f.mentionsSpike)),
  };
}

async function runSteps(ctx) {
  const r = {};
  r.version = await step(ctx, 'version', ['--version']);
  r.marketAdd = await step(ctx, 'marketplace-add', ['plugin', 'marketplace', 'add', join(ctx.root, 'market')]);
  r.install = await act(ctx, 'install');
  r.otherList = await otherAccount(ctx);
  r.disable = await actWithFallback(ctx, 'disable');
  r.enable = await actWithFallback(ctx, 'enable');
  r.uninstall = await act(ctx, 'uninstall');
  r.installMissing = await step(ctx, 'install-inexistente', ctx.lib.pluginActionCommand('install', `nope@${MARKET}`).args);
  r.uninstallMissing = await step(ctx, 'uninstall-no-instalado', ctx.lib.pluginActionCommand('uninstall', SELECTOR).args);
  return r;
}

function assertDisposable(ctx) {
  const underTmp = resolve(ctx.root).startsWith(resolve(tmpdir()));
  if (!underTmp || resolve(ctx.config) === resolve(homedir(), '.claude')) throw new Error(`Directorio no desechable: ${ctx.root}`);
}

async function runAll(lib, out) {
  const root = mkdtempSync(join(tmpdir(), 'mage-plugin-spike-'));
  const ctx = { lib, out, root, n: 0, config: join(root, 'config'), home: join(root, 'home'), binary: lib.resolveClaudeBinary() };
  assertDisposable(ctx);
  mkdirSync(ctx.config);
  mkdirSync(ctx.home);
  ctx.baseEnv = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home };
  createMarket(join(root, 'market'));
  const realBefore = realPlugins();
  console.log(`INFO binario ${ctx.binary}; raiz ${root}`);
  try {
    const r = await runSteps(ctx);
    const steps = [r.version, r.marketAdd, r.install, r.otherList, r.disable.record, r.disable.fallback, r.enable.record,
      r.enable.fallback, r.uninstall, r.installMissing, r.uninstallMissing].filter((x) => x !== null);
    const realAfter = realPlugins();
    const result = { binary: ctx.binary, root, expectations: expectations(r, steps, realAfter), real: { before: realBefore, after: realAfter } };
    writeJson(join(out, 'resumen.json'), result);
    for (const [key, value] of Object.entries(result.expectations)) console.log(`ESPERADO ${key}: ${value}`);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

async function main() {
  const out = process.argv[2];
  if (out === undefined || !isAbsolute(out)) throw new Error(`Falta el dir de evidencias (ruta absoluta): ${JSON.stringify(out)}`);
  const { buildDir, outfile } = await build();
  try {
    await runAll(await import(pathToFileURL(outfile).href), out);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
