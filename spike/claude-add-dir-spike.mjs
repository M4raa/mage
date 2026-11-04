// Spike E2 (carril R, INFORME-046): ¿aíslan las carpetas extra en Claude? Mide si `--add-dir <dir>` y
// `--settings {"permissions":{"additionalDirectories":[<dir>]}}` (lo que usa `withTaskDirectories`) se comportan igual, y
// qué escrituras piden permiso en los modos `default` y `acceptEdits`.
//
// Contra: el `claude` REAL + `scripts/fake-anthropic-messages.mjs` (servidor Messages falso, sin cuota ni cuenta).
// Matriz: 2 modos x 3 mecanismos (ninguno, --add-dir, --settings) x 3 destinos (work, extra, fuera) = 18 casos, un proceso
// por caso. A cada `can_use_tool` el spike contesta DENEGAR y lo cuenta; «escrito» = el fichero existe al acabar.
//
// Uso:
//   node spike/claude-add-dir-spike.mjs [--out <fichero>]     (por defecto .verify-out/claude-add-dir-spike.json)
// Sale con 0 si todos los casos llegaron a `result` (sea cual sea lo medido) y con 1 si alguno no llegó.
//
// No toca la config de nadie: cada caso vive en `fs.mkdtempSync(os.tmpdir(), 'mage-r-e2-')` con su `CLAUDE_CONFIG_DIR`
// vacío, y se borra al terminar con reintentos (en Windows el hijo tarda en soltar los ficheros).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeAnthropic } from '../scripts/fake-anthropic-messages.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outFile = path.resolve(outIndex === -1 ? path.join(repo, '.verify-out', 'claude-add-dir-spike.json') : (args[outIndex + 1] ?? ''));
const isWindows = process.platform === 'win32';
const CLAUDE = isWindows ? 'claude.exe' : 'claude';
const CASE_TIMEOUT_MS = 60_000;
const FAKE_KEY = 'sk-ant-fake-r-e2';
const DENY_MESSAGE = 'spike: denegado';

const MODES = ['default', 'acceptEdits'];
const MECHANISMS = ['ninguno', '--add-dir', '--settings'];
const TARGETS = [
  { name: 'dentro', script: 'WRITE dentro.txt r', file: ['work', 'dentro.txt'] },
  { name: 'extra', script: 'WRITE ../extra/x.txt r', file: ['extra', 'x.txt'] },
  { name: 'fuera', script: 'WRITE ../fuera/y.txt r', file: ['fuera', 'y.txt'] },
];

function scrubbedEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[name];
  return { ...env, ...extra };
}

function mechanismArgs(mechanism, extra) {
  if (mechanism === '--add-dir') return ['--add-dir', extra];
  if (mechanism === '--settings') return ['--settings', JSON.stringify({ permissions: { additionalDirectories: [extra] } })];
  return [];
}

function claudeVersion() {
  const result = spawnSync(CLAUDE, ['--version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true, env: scrubbedEnv({}) });
  return `${result.stdout ?? ''}`.trim() || `desconocida (${result.error?.message ?? result.stderr})`;
}

// Un proceso de `claude`: devuelve { permisoPedido, resultado }. `resultado` es null si no llegó a `result`.
function runClaude({ cwd, env, cliArgs, script }) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, cliArgs, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const state = { permisoPedido: 0, resultado: null, finished: false };
    const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
    const finish = () => {
      if (state.finished) return;
      state.finished = true;
      clearTimeout(timer);
      child.kill();
      resolve(state);
    };
    const timer = setTimeout(finish, CASE_TIMEOUT_MS);
    const handle = (event) => {
      if (event.type === 'result') { state.resultado = event.subtype ?? 'sin-subtype'; finish(); return; }
      if (event.type !== 'control_request') return;
      if (event.request?.subtype === 'can_use_tool') {
        state.permisoPedido += 1;
        send({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response: { behavior: 'deny', message: DENY_MESSAGE } } });
      }
    };
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line.length > 0) handle(JSON.parse(line));
      }
    });
    child.stderr.resume();
    child.on('error', finish);
    child.on('exit', finish);
    send({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', hooks: {} } });
    send({ type: 'user', message: { role: 'user', content: script } });
  });
}

async function runCase(mode, mechanism, target) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-r-e2-'));
  const [work, extra, fuera, config] = ['work', 'extra', 'fuera', 'config'].map((name) => path.join(root, name));
  for (const dir of [work, extra, fuera, config]) fs.mkdirSync(dir);
  const fake = await startFakeAnthropic({ cwd: work });
  try {
    const env = scrubbedEnv({ CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: fake.url, ANTHROPIC_API_KEY: FAKE_KEY });
    const cliArgs = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio',
      '--model', 'haiku', '--permission-mode', mode, ...mechanismArgs(mechanism, extra)];
    const { permisoPedido, resultado } = await runClaude({ cwd: work, env, cliArgs, script: target.script });
    const written = fs.existsSync(path.join(root, ...target.file));
    return { modo: mode, mecanismo: mechanism, destino: target.name, permisoPedido, escrito: written, resultado };
  } finally {
    await fake.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

const version = claudeVersion();
console.log(`claude --version: ${version}`);
const cases = [];
for (const mode of MODES) {
  for (const mechanism of MECHANISMS) {
    for (const target of TARGETS) cases.push(await runCase(mode, mechanism, target));
  }
}
console.table(cases);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify({ claudeVersion: version, cases }, null, 2)}\n`);
console.log(`JSON: ${outFile}`);
const incomplete = cases.filter((c) => c.resultado === null);
if (incomplete.length > 0) console.error(`${incomplete.length} caso(s) sin result: ${incomplete.map((c) => `${c.modo}/${c.mecanismo}/${c.destino}`).join(', ')}`);
process.exitCode = incomplete.length === 0 ? 0 : 1;
