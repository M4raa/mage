// Spike: QUE OFRECE de verdad el CLI `codex` de OpenAI.
//
// POR QUE EXISTE: la skill `protocolo-cli` del repo lo exige antes de escribir un adapter, y con
// motivo — el proyecto ya se equivoco dos veces: una creyendose documentacion de segunda mano del CLI
// (era de otra version) y otra descartando `agy` porque su `--help` no mencionaba `--output-format`,
// que si existia. Un hallazgo sin spike reproducible no vale.
//
// Uso: node spike/codex-spike.mjs
//      node spike/codex-spike.mjs "C:/ruta/a/codex.exe"   (si no esta en el PATH)
//      node spike/codex-spike.mjs --app-server [--key]   (protocolo JSON-RPC sin cuenta; ver abajo)
//      node spike/codex-spike.mjs --instructions         (instrucciones sin tocar el repo; ver abajo)
//      node spike/codex-spike.mjs --verify [--contract] [--offline] [--mcp]
//      node spike/codex-spike.mjs --verify --login --keep-home
//      node spike/codex-spike.mjs --verify --real --keep-home
//      node spike/codex-spike.mjs --verify --real --resume-real --scenario=approvals --keep-home
//      node spike/codex-spike.mjs --verify --real --resume-real --scenario=resume --keep-home
//      node spike/codex-spike.mjs --verify --real --metadata --keep-home (0 turnos)
// --verify (0.160.0): solo temporales, sin consultar ~/.codex. --offline usa Responses LOCAL (0
// turnos reales); --mcp llama directamente al servidor de prueba (0 turnos). --login abre el navegador
// oficial. MAGE_CODEX_VERIFY_HOME permite continuar exclusivamente con un temporal creado por el spike.
import { spawnSync } from 'node:child_process';

// La verificacion nueva nunca consulta el login ni los ficheros del CODEX_HOME del usuario.
if (process.argv.includes('--verify')) {
  const { verifyCodex } = await import('./codex-verification.mjs');
  await verifyCodex();
} else {

const explicitBin = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const bin = explicitBin ?? (process.platform === 'win32' ? 'codex.exe' : 'codex');

const run = (args, entrada) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', input: entrada, timeout: 30_000, windowsHide: true });
  if (r.error !== undefined && r.error !== null) return `NO SE PUDO EJECUTAR: ${r.error.message}`;
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
};

const primeraLinea = (texto) => texto.split('\n')[0]?.trim() ?? '';

console.log('# Spike de codex — ' + bin);
console.log('\n## 1. Version (un hallazgo sin version no es reproducible)');
console.log(primeraLinea(run(['--version'])));

console.log('\n## 2. Salida estructurada');
const execHelp = run(['exec', '--help']);
for (const flag of ['--json', '--output-last-message', '--output-schema']) {
  console.log(`  ${flag.padEnd(24)} ${execHelp.includes(flag) ? 'SI' : 'no'}`);
}

console.log('\n## 3. Entrada, cwd y multi-turno');
for (const flag of ['--cd', '--add-dir', '--model', '--sandbox', '--ephemeral', '--skip-git-repo-check']) {
  console.log(`  ${flag.padEnd(24)} ${execHelp.includes(flag) ? 'SI' : 'no'}`);
}
console.log(`  exec resume              ${execHelp.includes('resume') ? 'SI' : 'no'}`);
console.log('  (el PROMPT se puede pasar por stdin: "If not provided as an argument ... read from stdin")');

console.log('\n## 4. PERMISOS — el punto que decide si cumple la decision nº 2 de Mage');
// El oraculo de flags: un flag que NO existe se rechaza con "unexpected argument"; uno que existe da
// otro error (o un aviso). Es gratis y no gasta ninguna peticion al modelo.
for (const flag of ['--permission-prompt-tool', '--approval-mode', '--ask-for-approval', '--full-auto']) {
  const salida = primeraLinea(run(['exec', flag]));
  const existe = !salida.includes('unexpected argument');
  console.log(`  ${flag.padEnd(28)} ${existe ? 'EXISTE' : 'no existe'}  — ${salida.slice(0, 90)}`);
}
console.log('  Politicas de --sandbox: read-only | workspace-write | danger-full-access (ESTATICAS,');
console.log('  no es un puente de permisos: Mage no puede contestar a nada).');

console.log('\n## 5. Catalogo de modelos');
const rootHelp = run(['--help']);
console.log(`  ¿hay un comando que liste modelos?  ${/\bmodels\b/.test(rootHelp) ? 'SI' : 'NO'}`);
console.log('  (`features list` es de feature flags, no de modelos. Mismo caso que Claude Code.)');

console.log('\n## 6. Sesion');
console.log(primeraLinea(run(['login', 'status'])));
console.log('  Sin cuenta NO se puede medir el stream de eventos de un turno real, que es lo unico que');
console.log('  falta para escribir el adapter. Con cuenta: `codex exec --json "di hola"` y anotar aqui');
console.log('  los tipos de evento, si traen `usage`, y donde acaba un fichero escrito (agy reportaba');
console.log('  bien el cwd y escribia en otro sitio: comprobar SIEMPRE el disco, no el evento).');

// ================================================================================================
// Modo --app-server (2026-10-01, codex-cli 0.144.4): el protocolo sobre el que esta escrito
// `src/main/engine/codexAdapter.ts`. GRATIS y SIN CUENTA: `CODEX_HOME` temporal y sin las claves del
// entorno (`OPENAI_API_KEY`/`CODEX_API_KEY` se borran), asi que un `turn/start` falla con 401 antes de
// llegar a ningun modelo. Mide:
//   - el handshake (`initialize` -> `initialized`), `account/read`, `model/list` (responde SIN cuenta),
//     `permissionProfile/list` (los modos de permiso que ofrece el CLI) y `collaborationMode/list`
//     (pide la capacidad `experimentalApi`);
//   - `thread/start` -> `thread/started`, un `turn/start` sin credencial (errores con `willRetry`) y
//     `turn/interrupt` -> `turn/completed` con `status: interrupted`;
//   - con `--key`: que el app-server NO lee `CODEX_API_KEY`/`OPENAI_API_KEY` del entorno ("Missing
//     bearer") y que un proveedor propio con `env_key` SI manda la clave ("Incorrect API key provided"):
//     es como Mage pasa la clave de una cuenta de API sin escribirla en el `auth.json` de codex.
// `MAGE_CODEX_FIXTURES=<dir>` guarda las respuestas (rutas e ids de instalacion anonimizados) como
// fixtures de los tests del adapter. Al final compara el hash de `~/.codex/config.toml` y `auth.json`
// antes y despues: el spike nunca toca la configuracion real.
// ================================================================================================

if (process.argv.includes('--app-server')) await probeAppServer();

async function probeAppServer() {
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = await import('node:fs');
  const { tmpdir, homedir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { spawn } = await import('node:child_process');
  const realFiles = [join(homedir(), '.codex', 'config.toml'), join(homedir(), '.codex', 'auth.json')];
  const hashOf = (file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null);
  const before = realFiles.map(hashOf);
  const home = mkdtempSync(join(tmpdir(), 'mage-codex-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'mage-codex-ws-'));
  const fixtures = process.env.MAGE_CODEX_FIXTURES;
  // Las rutas del temporal salen en varias formas (JSON escapa la barra invertida; Windows a veces la
  // acorta a 8.3): se cambian todas por una fija para que el fixture no dependa de la maquina.
  const escaped = (path) => JSON.stringify(path).slice(1, -1);
  const anonymize = (value) =>
    JSON.parse(
      JSON.stringify(value)
        .split(escaped(home)).join('C:\\\\codex-home')
        .split(escaped(workspace)).join('C:\\\\proyecto')
        .replace(/"codexHome":"[^"]*"/g, '"codexHome":"C:\\\\codex-home"')
        .replace(/"installationId":"[^"]*"/g, '"installationId":"00000000-0000-0000-0000-000000000000"')
        .replace(/"serverName":"[^"]*"/g, '"serverName":"PC"')
        .replace(/"userAgent":"[^"]*"/g, '"userAgent":"mage-spike/0.144.4"')
        .replace(/cf-ray: [a-z0-9-]+/g, 'cf-ray: x')
        .replace(/request id: req_[a-z0-9]+/g, 'request id: req_x'),
    );
  const save = (name, value) => {
    if (fixtures === undefined) return;
    mkdirSync(fixtures, { recursive: true });
    writeFileSync(join(fixtures, `${name}.json`), `${JSON.stringify(anonymize(value), null, 2)}\n`);
  };

  const session = (extraArgs = [], extraEnv = {}) => {
    const env = { ...process.env, CODEX_HOME: home, ...extraEnv };
    if (!('CODEX_API_KEY' in extraEnv)) delete env.CODEX_API_KEY;
    if (!('OPENAI_API_KEY' in extraEnv)) delete env.OPENAI_API_KEY;
    const child = spawn(bin, ['app-server', ...extraArgs], { env, cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const pending = new Map();
    const notifications = [];
    let buffer = '';
    let nextId = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length === 0) continue;
        const message = JSON.parse(line);
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        } else notifications.push(message);
      }
    });
    const request = (method, params) =>
      new Promise((resolve) => {
        nextId += 1;
        pending.set(nextId, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: nextId, method, params })}\n`);
      });
    const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    const close = () =>
      new Promise((resolve) => {
        child.on('close', resolve);
        child.kill();
      });
    return { request, notify, notifications, close };
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  console.log('\n## 7. app-server (sin cuenta, CODEX_HOME temporal)');
  const s = session();
  const init = await s.request('initialize', { clientInfo: { name: 'mage-spike', title: 'Mage', version: '0' }, capabilities: { experimentalApi: true } });
  s.notify('initialized');
  save('initialize', init);
  console.log(`  initialize: ${JSON.stringify(Object.keys(init.result ?? {}))}`);
  const probes = [
    ['account-read', 'account/read', {}],
    ['model-list', 'model/list', {}],
    ['permission-profile-list', 'permissionProfile/list', {}],
    ['collaboration-mode-list', 'collaborationMode/list', {}],
    ['rate-limits-read', 'account/rateLimits/read', undefined],
  ];
  for (const [name, method, params] of probes) {
    const response = await s.request(method, params);
    save(name, response);
    console.log(`  ${method}: ${JSON.stringify(response.result ?? response.error).slice(0, 160)}`);
  }
  const thread = await s.request('thread/start', { cwd: workspace, approvalPolicy: 'on-request', ephemeral: true });
  save('thread-start', thread);
  const threadId = thread.result.thread.id;
  console.log(`  thread/start: thread=${threadId} model=${thread.result.model} sandbox=${JSON.stringify(thread.result.sandbox)}`);
  const turn = await s.request('turn/start', { threadId, input: [{ type: 'text', text: 'hi', text_elements: [] }] });
  save('turn-start', turn);
  await wait(2_500);
  const interrupt = await s.request('turn/interrupt', { threadId, turnId: turn.result.turn.id });
  await wait(1_500);
  save('turn-interrupt', interrupt);
  save('turn-notifications', s.notifications);
  console.log(`  turno: ${s.notifications.map((n) => n.method).join(' ')}`);
  await s.close();

  if (process.argv.includes('--key')) {
    console.log('\n## 8. Clave de API (FALSA): ¿la manda el app-server?');
    const providerArgs = [
      '-c',
      'model_providers.mage-openai={name="OpenAI",base_url="https://api.openai.com/v1",env_key="MAGE_CODEX_API_KEY",wire_api="responses"}',
      '-c',
      'model_provider="mage-openai"',
    ];
    const cases = [
      ['CODEX_API_KEY en el entorno', [], { CODEX_API_KEY: 'sk-mage-spike-falsa' }],
      ['OPENAI_API_KEY en el entorno', [], { OPENAI_API_KEY: 'sk-mage-spike-falsa' }],
      ['proveedor propio con env_key', providerArgs, { MAGE_CODEX_API_KEY: 'sk-mage-spike-falsa' }],
    ];
    for (const [label, args, env] of cases) {
      const k = session(args, env);
      await k.request('initialize', { clientInfo: { name: 'mage-spike', version: '0' } });
      k.notify('initialized');
      const t = await k.request('thread/start', { cwd: workspace, ephemeral: true });
      const tu = await k.request('turn/start', { threadId: t.result.thread.id, input: [{ type: 'text', text: 'hi' }] });
      await wait(2_500);
      await k.request('turn/interrupt', { threadId: t.result.thread.id, turnId: tu.result.turn.id });
      const detail = k.notifications.find((n) => n.method === 'error')?.params?.error?.additionalDetails ?? '';
      const verdict = /Incorrect API key/.test(detail) ? 'MANDA la clave' : /Missing bearer/.test(detail) ? 'no la manda (Missing bearer)' : detail.slice(0, 80);
      console.log(`  ${label.padEnd(32)} -> ${verdict}`);
      await k.close();
    }
  }

  await wait(1_000);
  for (const dir of [home, workspace]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (err) {
      console.log(`  (no se pudo borrar ${dir}: ${err.code ?? err.message})`);
    }
  }
  const after = realFiles.map(hashOf);
  console.log(`\n  configuracion real de codex intacta: ${JSON.stringify(before) === JSON.stringify(after) ? 'SI' : 'NO — revisa'}`);
}

// ================================================================================================
// Modo --instructions (2026-10-05, codex-cli 0.144.4, grupo H): ¿como se le dan instrucciones a codex
// SIN escribir en el repo ni en la config real? GRATIS y SIN CUENTA: codex habla con un servidor
// Responses FALSO local (proveedor propio por `-c`, clave falsa por `env_key`) que guarda el cuerpo de
// cada peticion y contesta 400; asi se ve EXACTAMENTE que instrucciones manda codex al modelo. Mide:
//   (1) un CLAUDE.md solo en el proyecto: ¿lo lee codex por si mismo?;
//   (2) `-c project_doc_fallback_filenames=["CLAUDE.md"]`: ¿lo lee como si fuera su AGENTS.md?;
//   (3) `developerInstructions` en `thread/start`: ¿donde y como llega?;
//   (4) `CODEX_HOME/AGENTS.md` (un CODEX_HOME temporal): su global;
//   (5) AGENTS.md y CLAUDE.md a la vez con el fallback: ¿solo el suyo?;
//   (6) `thread/resume` con `developerInstructions`: ¿se suman o se sustituyen las del hilo?
// Compara el hash de `~/.codex/config.toml` y `auth.json` antes y despues.
// ================================================================================================

if (process.argv.includes('--instructions')) await probeInstructions();

async function probeInstructions() {
  const fs = await import('node:fs');
  const { tmpdir, homedir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { spawn } = await import('node:child_process');
  const http = await import('node:http');
  const realFiles = [join(homedir(), '.codex', 'config.toml'), join(homedir(), '.codex', 'auth.json')];
  const hashOf = (file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null);
  const before = realFiles.map(hashOf);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Servidor Responses falso: guarda cada cuerpo y contesta 400.
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      bodies.push(raw);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'mage spike: peticion capturada', type: 'invalid_request_error' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const providerArgs = [
    '-c', `model_providers.mage-fake={name="Fake",base_url="http://127.0.0.1:${port}/v1",env_key="MAGE_CODEX_API_KEY",wire_api="responses"}`,
    '-c', 'model_provider="mage-fake"',
  ];

  // Un hilo y un turno; devuelve el cuerpo de la PRIMERA peticion que codex mando al modelo.
  const turn = async ({ home, workspace, extraArgs = [], thread = {}, resumeId = null }) => {
    const env = { ...process.env, CODEX_HOME: home, MAGE_CODEX_API_KEY: 'sk-mage-spike-falsa' };
    delete env.CODEX_API_KEY;
    delete env.OPENAI_API_KEY;
    const child = spawn(bin, ['app-server', ...providerArgs, ...extraArgs], { env, cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const pending = new Map();
    let buffer = '';
    let nextId = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length === 0) continue;
        const message = JSON.parse(line);
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        }
      }
    });
    const request = (method, params) =>
      new Promise((resolve) => {
        nextId += 1;
        pending.set(nextId, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: nextId, method, params })}\n`);
      });
    await request('initialize', { clientInfo: { name: 'mage-spike', version: '0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
    const opened = resumeId === null
      ? await request('thread/start', { cwd: workspace, ...thread })
      : await request('thread/resume', { threadId: resumeId, cwd: workspace, ...thread });
    const threadId = opened.result?.thread?.id;
    const already = bodies.length;
    if (threadId !== undefined) {
      await request('turn/start', { threadId, input: [{ type: 'text', text: 'hi', text_elements: [] }] });
      const deadline = Date.now() + 15_000;
      while (bodies.length === already && Date.now() < deadline) await wait(100);
      await wait(1_500);
    } else console.log(`  el hilo no abrio: ${JSON.stringify(opened.error ?? opened.result).slice(0, 200)}`);
    await new Promise((resolve) => {
      child.on('close', resolve);
      child.kill();
    });
    return { threadId: threadId ?? null, text: bodies[already] ?? '{}' };
  };

  // Donde aparece cada marca en la peticion: en `instructions` (base) o como mensaje de un rol.
  const where = (body, mark) => {
    if (!body.includes(mark)) return 'NO llega';
    const parsed = JSON.parse(body);
    if (typeof parsed.instructions === 'string' && parsed.instructions.includes(mark)) return 'en `instructions` (base)';
    const hits = (parsed.input ?? []).filter((item) => JSON.stringify(item).includes(mark));
    const roles = hits.map((item) => item.role ?? item.type).join(',');
    const count = body.split(mark).length - 1;
    const head = hits.map((item) => JSON.stringify(item.content ?? '').slice(0, 110)).join(' | ');
    return `llega ${count}x como [${roles}]: ${head}`;
  };

  const dirs = [];
  const fresh = (files = {}) => {
    const home = fs.mkdtempSync(join(tmpdir(), 'mage-codex-ih-'));
    const workspace = fs.mkdtempSync(join(tmpdir(), 'mage-codex-iw-'));
    dirs.push(home, workspace);
    for (const [name, text] of Object.entries(files)) {
      const [root, rel] = name.split(':');
      fs.writeFileSync(join(root === 'home' ? home : workspace, rel), text);
    }
    return { home, workspace };
  };
  const FALLBACK = ['-c', 'project_doc_fallback_filenames=["CLAUDE.md"]'];

  console.log('\n## 9. Instrucciones sin tocar el repo (servidor Responses falso, sin cuenta)');
  const c1 = await turn(fresh({ 'ws:CLAUDE.md': 'MARK-CLAUDE-PROJ' }));
  console.log(`  (1) solo CLAUDE.md en el proyecto          -> ${where(c1.text, 'MARK-CLAUDE-PROJ')}`);
  const c2 = await turn({ ...fresh({ 'ws:CLAUDE.md': 'MARK-CLAUDE-PROJ' }), extraArgs: FALLBACK });
  console.log(`  (2) con project_doc_fallback_filenames      -> ${where(c2.text, 'MARK-CLAUDE-PROJ')}`);
  const c3 = await turn({ ...fresh(), thread: { developerInstructions: 'MARK-DEV-START' } });
  console.log(`  (3) developerInstructions en thread/start   -> ${where(c3.text, 'MARK-DEV-START')}`);
  const c4 = await turn(fresh({ 'home:AGENTS.md': 'MARK-CODEX-HOME' }));
  console.log(`  (4) CODEX_HOME/AGENTS.md                    -> ${where(c4.text, 'MARK-CODEX-HOME')}`);
  const c5 = await turn({ ...fresh({ 'ws:AGENTS.md': 'MARK-AGENTS-PROJ', 'ws:CLAUDE.md': 'MARK-CLAUDE-PROJ' }), extraArgs: FALLBACK });
  console.log(`  (5) AGENTS.md + CLAUDE.md con fallback: AGENTS -> ${where(c5.text, 'MARK-AGENTS-PROJ')}`);
  console.log(`                                          CLAUDE -> ${where(c5.text, 'MARK-CLAUDE-PROJ')}`);
  const both = fresh();
  const first = await turn({ ...both, thread: { developerInstructions: 'MARK-DEV-FIRST' } });
  if (first.threadId !== null) {
    const resumed = await turn({ ...both, thread: { developerInstructions: 'MARK-DEV-RESUME' }, resumeId: first.threadId });
    console.log(`  (6) thread/resume: las del inicio          -> ${where(resumed.text, 'MARK-DEV-FIRST')}`);
    console.log(`                     las del resume          -> ${where(resumed.text, 'MARK-DEV-RESUME')}`);
  }
  console.log(`  peticiones capturadas: ${bodies.length}`);

  server.close();
  await wait(1_000);
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (err) {
      console.log(`  (no se pudo borrar ${dir}: ${err.code ?? err.message})`);
    }
  }
  const after = realFiles.map(hashOf);
  console.log(`\n  configuracion real de codex intacta: ${JSON.stringify(before) === JSON.stringify(after) ? 'SI' : 'NO — revisa'}`);
}
}
