// Punto de control (b), C2 (carril P): ¿dónde lee Codex 0.164.0 las skills SUELTAS? Pone una skill de sonda en cada sitio candidato
// (CODEX_HOME/skills, ~/.agents/skills, ~/.codex/skills, <repo>/.agents/skills y <repo>/.codex/skills) y pregunta a `codex app-server`
// con `skills/list` cuáles ve y con qué `scope`. Es una MEDICIÓN, no una afirmación: ninguna sonda visible no es un fallo.
// Sin turnos de modelo y sin cuenta (`skills/list` no habla con ningún modelo; si exigiera sesión, lo dice y para). Todo vive bajo
// `os.tmpdir()`: CODEX_HOME, HOME y USERPROFILE del hijo son carpetas del montaje, nunca las reales.
// Uso:  node spike/codex-skills-spike.mjs
// Escrito contra Codex 0.164.0. Líneas: RESULT <sonda> <visible|ausente> scope=<scope|-> path=<ruta relativa al montaje|->,
// RESULT disable-by-config <enabled=false visible|sin efecto>, INFO (errors, system-skills, git ausente, …) y FAIL.
// Salida: 0 si `skills/list` respondió, 1 si falló, 2 si la guarda de carpetas rechaza el montaje.
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linguiCatalogPlugin } from '../scripts/lib/linguiEsbuildPlugin.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRepo = createRequire(join(repoRoot, 'package.json'));
const esbuild = createRequire(requireFromRepo.resolve('vite/package.json'))('esbuild');

const PREVIEW_CHARS = 300;
const RPC_TIMEOUT_MS = 60_000;
const PROBE_DISABLED = 'mage-probe-codex-home';
// Nombre de la sonda y carpeta (relativa al montaje) donde va su `<nombre>/SKILL.md`.
const PROBES = [
  ['mage-probe-codex-home', ['codex-home', 'skills']],
  ['mage-probe-agents-home', ['home', '.agents', 'skills']],
  ['mage-probe-codex-userdir', ['home', '.codex', 'skills']],
  ['mage-probe-repo-agents', ['repo', '.agents', 'skills']],
  ['mage-probe-repo-codex', ['repo', '.codex', 'skills']],
];

const clip = (text) => String(text).trim().slice(0, PREVIEW_CHARS);
const errText = (err) => (err instanceof Error ? err.message : String(err));
const slashed = (path) => path.replaceAll('\\', '/');

function isUnsafeDir(dir) {
  const underTmp = resolve(dir).startsWith(resolve(tmpdir()));
  return !underTmp || dir === join(homedir(), '.claude') || dir === join(homedir(), '.codex');
}

// `scrubAgentEnv` de producción, compilado como en library-spike.mjs.
async function loadScrubAgentEnv() {
  const buildDir = mkdtempSync(join(tmpdir(), 'mage-codex-skills-build-'));
  const outfile = join(buildDir, 'agent-env.mjs');
  try {
    await esbuild.build({
      stdin: { contents: "export { scrubAgentEnv } from './src/main/os/agentEnv.ts'; export { findCodexBinary } from './src/main/os/codexBinaryResolver.ts';", resolveDir: repoRoot, loader: 'ts' },
      bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@shared': join(repoRoot, 'src', 'shared') },
      external: ['node:*'], plugins: [linguiCatalogPlugin(repoRoot)], logLevel: 'error',
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

function writeProbes(root) {
  for (const [name, parts] of PROBES) {
    const dir = join(root, ...parts, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Mage probe ${name}.\n---\n\nSonda de medición de Mage.\n`);
  }
}

function initRepo(repoDir) {
  try {
    execFileSync('git', ['init', '-q'], { cwd: repoDir, stdio: 'ignore' });
  } catch (err) {
    console.log(`INFO git ausente ${clip(errText(err))}`);
  }
}

// ---------------------------------------------------------------- Cliente mínimo de `codex app-server`

class AppServer {
  constructor(binary, env, cwd) {
    this.child = spawn(binary, ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.pid = this.child.pid;
    this.waiting = new Map();
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
    }
  }

  write(message) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  async request(method, params) {
    this.seq += 1;
    const id = this.seq;
    const reply = await new Promise((resolveRpc, rejectRpc) => {
      const timer = setTimeout(() => rejectRpc(new Error(`sin respuesta a ${method} en ${RPC_TIMEOUT_MS} ms`)), RPC_TIMEOUT_MS);
      this.waiting.set(id, (message) => { clearTimeout(timer); resolveRpc(message); });
      this.write({ id, method, params });
    });
    if (reply.error !== undefined) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  }

  async init() {
    await this.request('initialize', { clientInfo: { name: 'mage-spike', title: 'Mage spike', version: '0.1.4' }, capabilities: { experimentalApi: true } });
    this.write({ method: 'initialized' });
  }

  // Se para por su PID (el proceso es el nuestro) y se espera a que muera: en Windows su carpeta sigue bloqueada mientras vive.
  close() {
    return new Promise((resolveClose) => {
      if (this.child.exitCode !== null) return resolveClose();
      this.child.once('exit', () => resolveClose());
      process.kill(this.pid);
    });
  }
}

// ---------------------------------------------------------------- Lectura de `skills/list`

function allObjects(node, out = []) {
  if (Array.isArray(node)) node.forEach((item) => allObjects(item, out));
  else if (node !== null && typeof node === 'object') {
    out.push(node);
    Object.values(node).forEach((value) => allObjects(value, out));
  }
  return out;
}

const skillsOf = (result) => allObjects(result).filter((o) => typeof o.name === 'string' && typeof o.path === 'string');
const errorsOf = (result) => allObjects(result).flatMap((o) => (Array.isArray(o.errors) ? o.errors : []));

function reportProbes(result, root) {
  const skills = skillsOf(result);
  for (const [name] of PROBES) {
    const found = skills.find((s) => s.name === name);
    if (found === undefined) console.log(`RESULT ${name} ausente scope=- path=-`);
    else console.log(`RESULT ${name} visible scope=${found.scope ?? '-'} path=${slashed(relative(root, found.path))}`);
  }
  console.log(`INFO errors ${clip(JSON.stringify(errorsOf(result)))}`);
  console.log(`INFO system-skills ${skills.filter((s) => s.scope === 'system').length}`);
}

async function measureDisable(server, repoDir) {
  const listParams = { cwds: [repoDir], forceReload: true };
  try {
    await server.request('skills/config/write', { name: PROBE_DISABLED, enabled: false });
  } catch (err) {
    console.log(`INFO disable-by-config ${clip(errText(err))}`);
  }
  const after = skillsOf(await server.request('skills/list', listParams)).find((s) => s.name === PROBE_DISABLED);
  console.log(`RESULT disable-by-config ${after !== undefined && after.enabled === false ? 'enabled=false visible' : 'sin efecto'}`);
}

async function measure(server, mount) {
  await server.init();
  const listParams = { cwds: [mount.repoDir], forceReload: true };
  reportProbes(await server.request('skills/list', listParams), mount.root);
  await measureDisable(server, mount.repoDir);
}

// ---------------------------------------------------------------- Principal

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'mage-codex-skills-'));
  const mount = { root, repoDir: join(root, 'repo'), codexHome: join(root, 'codex-home'), home: join(root, 'home') };
  if ([root, mount.repoDir, mount.codexHome, mount.home].some(isUnsafeDir)) {
    console.log('FAIL guarda: alguna carpeta no cuelga de os.tmpdir()');
    rmSync(root, { recursive: true, force: true });
    return 2;
  }
  for (const dir of [mount.repoDir, mount.codexHome, mount.home]) mkdirSync(dir, { recursive: true });
  let server = null;
  try {
    const { scrubAgentEnv, findCodexBinary } = await loadScrubAgentEnv();
    const binary = findCodexBinary();
    if (binary === null) throw new Error('No se encontró el binario de codex');
    initRepo(mount.repoDir);
    writeProbes(root);
    const env = { ...scrubAgentEnv(process.env), CODEX_HOME: mount.codexHome, HOME: mount.home, USERPROFILE: mount.home };
    server = new AppServer(binary, env, mount.repoDir);
    await measure(server, mount);
    return 0;
  } catch (err) {
    console.log(`FAIL skills/list: ${clip(errText(err))}`);
    return 1;
  } finally {
    if (server !== null) await server.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

process.exitCode = await main();
