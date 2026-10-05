// Mage — Spike del CLI de Antigravity (`agy`) como posible motor nativo.
// Objetivo: medir si `agy` expone un protocolo de salida estructurada utilizable por AgentSession, y
// si permite delegar los permisos en Mage (decision nº 2 del proyecto). Ejecutado el 2026-08-09
// contra `agy` 1.1.2; conclusiones anotadas en el informe del spike.
//
// Re-medido el 2026-08-11 contra `agy` 1.1.11 antes de escribir el adapter (E3). Dos hallazgos que
// cambian lo que decia §5.5 y que este script comprueba:
//  1. `--conversation <id-arbitrario>` NO vale: responde `warning: conversation "…" not found` y
//     arranca una conversacion nueva. Hay que capturar el `conversation_id` que emite `agy` en su
//     `init` (viaja tambien en la raiz de cada step_update y del result) y devolverselo. Lo comprueba
//     `probeArbitraryConversation`, que es GRATIS (el prompt vacio corta antes de gastar peticion).
//  2. En 1.1.11 el modo por defecto (`request-review`) YA NO deja la tool en `state: ERROR`: con
//     `--add-dir` la escritura se aplica sin preguntar y sin emitir nada que Mage pueda contestar.
//     Sigue sin haber puente de permisos, pero el sintoma es otro. Se ve con `--live`.
//
// Por que existe este script: la nota del ROADMAP del 2026-07-15 dio `agy` por descartado leyendo su
// `--help`, y `--help` MIENTE POR OMISION (`--output-format` no aparece pero existe). Esto vuelve a
// medirlo de verdad, para poder repetirlo en cada actualizacion del CLI en vez de fiarse de una nota.
//
// NO es codigo de produccion. Identificadores en ingles, comentarios en castellano.
//
// Uso:
//   node spike/agy-spike.mjs          # solo sondas GRATIS (no gasta ni una peticion)
//   node spike/agy-spike.mjs --live   # ademas, 2 turnos reales (consume suscripcion, poco)
//   node spike/agy-spike.mjs --persistent   # sesion persistente --input-format stream-json (~12
//                                            # turnos cortos: escrituras por modo, interrupcion,
//                                            # mensaje en curso, /usage, clave de Gemini). Medido
//                                            # el 2026-09-30 contra agy 1.2.14.
//   node spike/agy-spike.mjs --permissions  # reglas allow/deny en un USERPROFILE aislado (~14 turnos)
//   node spike/agy-spike.mjs --images       # imagenes en sesion persistente (M13, 2026-10-01): que
//                                            # bloques admite `content` (gratis) y ~3 turnos cortos
//   node spike/agy-spike.mjs --profile      # perfil propio para la suscripcion, MCP por junction de
//                                            # .gemini/config y relectura de settings (~3 turnos)
//   node spike/agy-spike.mjs --mcp-rules    # reglas mcp(<srv>/<tool>): denegada, comodin y deny (~3 turnos)
//   node spike/agy-spike.mjs --instructions # que fichero de instrucciones lee y desde donde (3 turnos)

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const CONFIG = {
  binary: process.platform === 'win32' ? 'agy.exe' : 'agy',
  probeTimeoutMs: 20_000,
  liveTimeoutMs: 150_000,
  printTimeout: '90s',
};

// Flags a sondear. El oraculo: un flag INEXISTENTE responde "flags provided but not defined";
// uno EXISTENTE pero sin valor responde "flag needs an argument". Ninguno de los dos gasta peticiones.
const FLAGS_TO_PROBE = [
  'output-format',
  'effort',
  'input-format',
  'permission-prompt-tool',
  'session-id',
  'include-partial-messages',
  'mcp-config',
  'settings',
  'allowed-tools',
  'verbose',
  // Añadidos el 2026-09-30 (agy 1.2.14): existen y no salian en la lista.
  'mode',
  'sandbox',
  'conversation',
  'print-timeout',
  'dangerously-skip-permissions',
];

function run(args, { timeoutMs, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(CONFIG.binary, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: String(err), code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

// Clasifica la respuesta del binario a un flag suelto.
function classifyFlagProbe(output) {
  if (output.includes('not defined')) return 'no existe';
  if (output.includes('needs an argument')) return 'EXISTE (oculto si no sale en --help)';
  return 'indeterminado';
}

async function probeFlags() {
  console.log('\n=== Sondeo de flags (gratis, sin peticiones) ===');
  const help = await run(['--help'], { timeoutMs: CONFIG.probeTimeoutMs });
  const helpText = `${help.stdout}${help.stderr}`;
  for (const flag of FLAGS_TO_PROBE) {
    const probe = await run([`--${flag}`], { timeoutMs: CONFIG.probeTimeoutMs });
    const verdict = classifyFlagProbe(`${probe.stdout}${probe.stderr}`);
    const inHelp = helpText.includes(`--${flag}`) ? 'sí' : 'NO';
    console.log(`  --${flag.padEnd(26)} en --help: ${inHelp.padEnd(3)} -> ${verdict}`);
  }
}

// Borra el workspace temporal. En Windows `agy` puede dejar un handle abierto un instante y el rm
// falla con EPERM: es un directorio de /tmp, asi que se AVISA (nunca se traga) y se sigue.
function removeWorkspace(workspace) {
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch (err) {
    console.log(`  (no se pudo borrar ${workspace}: ${err.code ?? err.message} — borralo a mano)`);
  }
}

function parseNdjson(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { event: 'NO_PARSEABLE', raw: line.slice(0, 120) };
      }
    });
}

// Turno real con stream-json. `conversationId` continua una conversacion existente. Devuelve los
// eventos NDJSON parseados.
async function liveStreamTurn(workspace, prompt, conversationId = null) {
  const args = [
    '--output-format',
    'stream-json',
    '--add-dir',
    workspace, // SIN esto, agy escribe en su propio scratch e ignora el cwd
    '--print-timeout',
    CONFIG.printTimeout,
  ];
  if (conversationId !== null) args.push('--conversation', conversationId);
  args.push('--print', prompt);
  const result = await run(args, { timeoutMs: CONFIG.liveTimeoutMs, cwd: workspace });
  return parseNdjson(result.stdout);
}

// ¿Acepta `--conversation` un id que elija Mage? GRATIS: el prompt vacio aborta antes de gastar
// peticion, y el aviso de "not found" ya sale. La respuesta manda en el diseno del adapter: si el id
// no se puede imponer, hay que capturar el que genera el CLI y reusarlo turno a turno.
async function probeArbitraryConversation() {
  console.log('\n=== ¿Se puede imponer un id en --conversation? (gratis) ===');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-agy-conv-'));
  try {
    const invented = '11111111-1111-1111-1111-111111111111';
    const result = await run(
      ['--output-format', 'stream-json', '--add-dir', workspace, '--conversation', invented, '--print', ''],
      { timeoutMs: CONFIG.probeTimeoutMs, cwd: workspace },
    );
    const notFound = `${result.stdout}${result.stderr}`.includes('not found');
    console.log(`  id inventado -> ${notFound ? 'RECHAZADO ("conversation not found")' : 'aceptado (¡re-mide el diseno!)'}`);
    for (const event of parseNdjson(result.stdout)) {
      if (event.event === 'result') console.log(`  result status=${event.result?.status} error=${JSON.stringify(event.result?.error)}`);
    }
  } finally {
    removeWorkspace(workspace);
  }
}

function printEvents(events) {
  for (const event of events) {
    const update = event.step_update;
    if (event.event === 'init') {
      console.log(
        `  init         conversation=${event.conversation_id} tools=${event.init?.tools?.length ?? 0} permission_mode=${event.init?.permission_mode}`,
      );
    } else if (event.event === 'step_update') {
      const detail = update?.tool_name ? ` tool=${update.tool_name}` : '';
      const delta = update?.text_delta ? ` delta=${JSON.stringify(update.text_delta.slice(0, 40))}` : '';
      console.log(`  step_update  [${update?.step_index}] ${update?.state} ${update?.step_type}${detail}${delta}`);
    } else if (event.event === 'result') {
      const usage = event.result?.usage ?? {};
      console.log(`  result       status=${event.result?.status} turns=${event.result?.num_turns}`);
      console.log(`               usage in=${usage.input_tokens} out=${usage.output_tokens} thinking=${usage.thinking_tokens} cache_read=${usage.cache_read_tokens}`);
    } else {
      console.log(`  ${event.event}`);
    }
  }
}

async function probeLive() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-agy-spike-'));
  try {
    console.log('\n=== Turno 1: prompt trivial con --output-format stream-json ===');
    const first = await liveStreamTurn(workspace, 'reply with exactly: OK');
    if (first.length === 0) {
      console.log('  (sin salida: ¿sesión sin login? ejecuta `agy` una vez y autentícate)');
      return;
    }
    printEvents(first);

    // El id que hay que reusar sale del propio CLI (uno inventado no vale, ver probeArbitraryConversation).
    const conversationId = first.find((event) => event.event === 'init')?.conversation_id ?? null;
    if (conversationId === null) {
      console.log('\n  (sin conversation_id en el init: el multi-turno de un proceso por turno NO es posible)');
      return;
    }

    console.log(`\n=== Turno 2: --conversation ${conversationId} (¿recuerda? ¿cachea? ¿escribe donde toca?) ===`);
    const second = await liveStreamTurn(
      workspace,
      'Write the word you just replied into a file named memo.txt in the workspace.',
      conversationId,
    );
    printEvents(second);
    const memo = path.join(workspace, 'memo.txt');
    console.log(`  memo.txt en el workspace: ${fs.existsSync(memo) ? JSON.stringify(fs.readFileSync(memo, 'utf8')) : 'NO EXISTE'}`);

    console.log('\n  Conclusiones (ver el informe de E3):');
    console.log('   - Hay stream estructurado: init + step_update (con text_delta y tool calls) + result.');
    console.log('   - El usage es REAL, por paso y total, con thinking y cache_read.');
    console.log('   - Multi-turno entre PROCESOS distintos con el conversation_id que el CLI genera.');
    console.log('   - NO hay puente de permisos: la escritura se aplica sin preguntar y sin avisar.');
  } finally {
    removeWorkspace(workspace);
  }
}

// ================================================================================================
// Modo --persistent (2026-09-30, agy 1.2.14): sesion PERSISTENTE con `--input-format stream-json`.
// Un proceso, una linea NDJSON por mensaje: {"event":"user","message":{"content":"<texto>"}}.
// Mide lo que decide el adapter persistente: escrituras por modo, comandos, interrupcion, mensaje
// con otro en curso, /usage y /quota, y la clave de Gemini. CONSUME SUSCRIPCION (unos 10 turnos
// cortos). Todo en directorios temporales que se borran. Solo las sondas marcadas "gratis" no gastan.
// ================================================================================================

const PERSISTENT = {
  model: 'gemini-3.8-flash-low', // el mas barato que lista `agy models`
  turnTimeoutMs: 180_000,
  // Tiempo entre el primer delta y el corte en la sonda de interrupcion: lo justo para estar A MITAD.
  interruptAfterMs: 1_500,
};

// Sesion persistente viva. `events` acumula todo lo parseado, con el instante de llegada.
function startPersistent(workspace, extraArgs = [], env = process.env) {
  const args = [
    '--output-format', 'stream-json', '--input-format', 'stream-json',
    '--add-dir', workspace, '--model', PERSISTENT.model, ...extraArgs,
  ];
  const child = spawn(CONFIG.binary, args, { cwd: workspace, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const session = { child, events: [], stderr: '', exitCode: undefined, t0: Date.now() };
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length > 0) session.events.push({ atMs: Date.now() - session.t0, ...parseNdjson(line)[0] });
    }
  });
  child.stderr.on('data', (chunk) => (session.stderr += chunk));
  session.exited = new Promise((resolve) => child.on('close', (code) => resolve((session.exitCode = code))));
  session.send = (text) => child.stdin.write(`${JSON.stringify({ event: 'user', message: { content: text } })}\n`);
  return session;
}

// Espera a que se cumpla `predicate` sobre los eventos (o a que el proceso muera, o al timeout).
async function waitFor(session, predicate, timeoutMs = PERSISTENT.turnTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(session.events)) return true;
    if (session.exitCode !== undefined) return predicate(session.events);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

const countResults = (events) => events.filter((event) => event.event === 'result').length;

// Mata el ARBOL del proceso, como hace Mage (`killProcessTree`): `agy` puede tener hijos.
function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

// Resumen legible de una sesion: init, pasos con herramienta y resultados (el usage se imprime tal
// cual llega, que es ACUMULADO por sesion: el turno N trae la suma de 1..N).
function summarize(session) {
  for (const event of session.events) {
    const at = `${String(event.atMs).padStart(6)}ms`;
    if (event.event === 'init') console.log(`  ${at} init permission_mode=${event.init?.permission_mode} conv=${event.conversation_id}`);
    const update = event.step_update;
    if (event.event === 'step_update' && (update?.tool_name || update?.step_type !== 'agent_response')) {
      const extra = update?.tool_name ? ` tool=${update.tool_name}` : '';
      const error = update?.error ? ` error=${JSON.stringify(String(update.error).slice(0, 120))}` : '';
      console.log(`  ${at} step [${update?.step_index}] ${update?.state} ${update?.step_type}${extra}${error}`);
    }
    if (event.event === 'result') {
      const { status, num_turns: turns, error, usage = {}, response = '' } = event.result ?? {};
      console.log(`  ${at} result status=${status} turns=${turns} error=${JSON.stringify(error ?? null)}`);
      console.log(`           usage in=${usage.input_tokens} out=${usage.output_tokens} cache=${usage.cache_read_tokens} response=${JSON.stringify(response.slice(0, 80))}`);
    }
  }
  if (session.stderr.trim().length > 0) console.log(`  stderr: ${session.stderr.trim().slice(0, 300)}`);
}

async function withWorkspace(prefix, body) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await body(workspace);
  } finally {
    removeWorkspace(workspace);
  }
}

// Una sesion con un solo mensaje, cerrando stdin al acabar el turno. Devuelve la sesion ya muerta.
async function singleTurn(workspace, text, extraArgs = []) {
  const session = startPersistent(workspace, extraArgs);
  session.send(text);
  await waitFor(session, (events) => countResults(events) >= 1);
  session.child.stdin.end();
  await session.exited;
  return session;
}

// (0) GRATIS: que eventos de entrada reconoce. Solo `user` es valido; `control_request` y
// `control_response` estan RESERVADOS ("not supported yet", abortan la sesion); el resto se ignora.
async function probeInputEvents() {
  console.log('\n=== [persistent 0] Eventos de entrada reconocidos (gratis) ===');
  await withWorkspace('mage-agy-events-', async (workspace) => {
    for (const name of ['interrupt', 'cancel', 'control_request', 'control_response']) {
      const session = startPersistent(workspace);
      session.child.stdin.end(`${JSON.stringify({ event: name })}\n`);
      await session.exited;
      console.log(`  ${name.padEnd(18)} exit=${session.exitCode} ${session.stderr.trim().split('\n')[0] ?? ''}`);
    }
    const empty = startPersistent(workspace);
    empty.child.stdin.end(`${JSON.stringify({ event: 'user', message: {} })}\n`);
    await empty.exited;
    console.log(`  user sin content    exit=${empty.exitCode} ${empty.stderr.trim()}`);
  });
}

// (1) y (4): escritura de fichero y comando de shell en cada modo. ¿Se aplica? ¿Pide permiso?
async function probeWritesByMode() {
  const modes = [['accept-edits', ['--mode', 'accept-edits']], ['default', []], ['plan', ['--mode', 'plan']]];
  for (const [label, args] of modes) {
    await withWorkspace('mage-agy-write-', async (workspace) => {
      console.log(`\n=== [persistent 1/4] modo ${label}: write_to_file + run_command ===`);
      const session = startPersistent(workspace, args);
      session.send(`Create a file named probe.txt in ${workspace} containing exactly: mage. Do nothing else.`);
      await waitFor(session, (events) => countResults(events) >= 1);
      session.send(`Run this exact shell command in ${workspace}: echo mage > cmd.txt . Do nothing else.`);
      await waitFor(session, (events) => countResults(events) >= 2);
      session.child.stdin.end();
      await session.exited;
      summarize(session);
      for (const name of ['probe.txt', 'cmd.txt']) {
        const file = path.join(workspace, name);
        console.log(`  ${name} en el workspace: ${fs.existsSync(file) ? JSON.stringify(fs.readFileSync(file, 'utf8').trim()) : 'NO EXISTE'}`);
      }
    });
  }
}

// (2) Interrumpir A MITAD de turno. No hay evento de entrada para ello (ver 0): se mata el arbol y se
// reanuda con `--conversation <id>` en un proceso nuevo para ver si la conversacion sigue viva.
async function probeInterrupt() {
  console.log('\n=== [persistent 2] Interrupcion a mitad de turno ===');
  await withWorkspace('mage-agy-int-', async (workspace) => {
    const session = startPersistent(workspace);
    session.send('Count from 1 to 400, one number per line, no other text.');
    await waitFor(session, (events) => events.some((event) => event.step_update?.text_delta));
    await new Promise((resolve) => setTimeout(resolve, PERSISTENT.interruptAfterMs));
    const conversationId = session.events.find((event) => event.event === 'init')?.conversation_id;
    killTree(session.child);
    await session.exited;
    console.log(`  cortado: exit=${session.exitCode} results=${countResults(session.events)} eventos=${session.events.length} conv=${conversationId}`);
    const resumed = await singleTurn(workspace, 'In one short line: what did I ask you in my previous message?', ['--conversation', conversationId]);
    console.log('  reanudada con --conversation:');
    summarize(resumed);
  });
}

// (3) Segundo mensaje con el primero en curso: ¿se encola, interrumpe o se rechaza?
async function probeConcurrentMessage() {
  console.log('\n=== [persistent 3] Mensaje con otro turno en curso ===');
  await withWorkspace('mage-agy-conc-', async (workspace) => {
    const session = startPersistent(workspace);
    session.send('Count from 1 to 150, one number per line, no other text.');
    await waitFor(session, (events) => events.some((event) => event.step_update?.text_delta));
    session.send('Reply with exactly: SEGUNDO');
    await waitFor(session, (events) => countResults(events) >= 2);
    session.child.stdin.end();
    await session.exited;
    summarize(session);
  });
}

// (5) Comandos de solo lectura en print mode. El changelog (1.1.11) dice que no abren turno ni gastan
// cuota: se comprueba por num_turns/usage del result y comparando /quota antes y despues.
// OJO: desde Git Bash, `agy --print /usage` a mano necesita MSYS_NO_PATHCONV=1 o MSYS lo convierte en
// una ruta y se lanza un TURNO REAL (volvio a pasar el 2026-09-30). Aqui no aplica: spawn no pasa por MSYS.
async function probeReadOnlyCommands() {
  console.log('\n=== [persistent 5] /usage, /quota, /credits (deberian ser gratis) ===');
  for (const command of ['/quota', '/usage', '/credits', '/quota']) {
    const result = await run(['--output-format', 'json', '--print', command], { timeoutMs: CONFIG.probeTimeoutMs });
    console.log(`  ${command} exit=${result.code}\n${result.stdout.trim().slice(0, 1200)}`);
    if (result.stderr.trim()) console.log(`  stderr: ${result.stderr.trim().slice(0, 200)}`);
  }
}

// (6) GRATIS: clave de Gemini con una clave FALSA (nunca una real en un spike). `/usage` dice que
// credencial usa la sesion sin abrir turno. Tres casos: clave en el entorno con el login normal;
// HOME aislado sin nada; HOME aislado con `modelProvider: "gemini"` en su settings.json.
async function probeGeminiKey() {
  console.log('\n=== [persistent 6] GEMINI_API_KEY (clave falsa, gratis) ===');
  const fakeKey = 'mage-spike-fake-key';
  const cases = [
    ['clave en env, HOME real', { GEMINI_API_KEY: fakeKey }, null],
    ['HOME aislado, sin clave', {}, {}],
    ['HOME aislado + modelProvider gemini + clave', { GEMINI_API_KEY: fakeKey }, { modelProvider: 'gemini' }],
  ];
  for (const [label, extraEnv, settings] of cases) {
    await withWorkspace('mage-agy-key-', async (home) => {
      const env = { ...process.env, ...extraEnv };
      if (settings !== null) {
        env.HOME = home;
        env.USERPROFILE = home;
        const dir = path.join(home, '.gemini', 'antigravity-cli');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
      }
      const result = await runWithEnv(['--output-format', 'json', '--print', '/usage'], env);
      console.log(`  ${label}: exit=${result.code} ${`${result.stdout}${result.stderr}`.trim().slice(0, 400)}`);
      // Con la clave FALSA, un turno en modo clave falla en la API de Google (400 API_KEY_INVALID) sin
      // coste: es la prueba de que NO cae a la suscripcion. Solo en el caso aislado con modelProvider.
      if (settings?.modelProvider === 'gemini') {
        const turn = runWithEnv(['--output-format', 'json', '--add-dir', home, '--print', 'hi'], env);
        console.log(`    turno con clave falsa: exit=${turn.code} ${turn.stdout.trim().slice(0, 200)}`);
      }
    });
  }
}

function runWithEnv(args, env, timeoutMs = CONFIG.probeTimeoutMs) {
  const result = spawnSync(CONFIG.binary, args, { env, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, input: '' });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? String(result.error ?? '') };
}

// ================================================================================================
// Modo --permissions (2026-09-30, agy 1.2.14): reglas de permisos de comandos ESCRITAS EN DISCO antes
// de lanzar, que es como Mage las concederia (no hay flag de sesion: el oraculo rechaza --allow,
// --deny, --permissions, --settings, --config). Las reglas van en el settings.json del CLI dentro de
// un USERPROFILE AISLADO: `agy` resuelve su HOME por USERPROFILE (no por HOME, medido) y su login NO
// vive ahi, asi que sigue autenticado sin tocar la config real del usuario. Se comprueba con hash.
// CONSUME SUSCRIPCION: ~12 turnos cortos.
// ================================================================================================

// Reglas y casos elegidos para distinguir la SINTAXIS medida el 2026-09-30 (agy 1.2.14):
//   - `command(<linea>)` casa la linea de comando EXACTA, redireccion incluida; NO es un prefijo
//     (`command(git)` no casa `git --version`, `command(echo mage)` no casa `echo mage > f`);
//   - `command(regex:<re>)` casa por expresion regular;
//   - `deny` gana a `allow` sobre el mismo comando.
const PERMISSION_RULES = {
  allow: ['command(echo mage > allowed.txt)', 'command(regex:^echo regex .*)', 'command(git)', 'command(hostname > denied.txt)'],
  deny: ['command(regex:^hostname.*)'],
};

// Un comando por mensaje, con el fichero que deberia crear si se ejecuta y lo que se espera.
const PERMISSION_CASES = [
  { label: 'exacto permitido', command: 'echo mage > allowed.txt', file: 'allowed.txt', expected: 'EJECUTADO' },
  { label: 'regex permitido', command: 'echo regex > regex.txt', file: 'regex.txt', expected: 'EJECUTADO' },
  { label: 'prefijo (command(git))', command: 'git --version > prefix.txt', file: 'prefix.txt', expected: 'no ejecutado' },
  { label: 'deny gana a allow', command: 'hostname > denied.txt', file: 'denied.txt', expected: 'no ejecutado' },
  { label: 'no listado', command: 'whoami > unlisted.txt', file: 'unlisted.txt', expected: 'no ejecutado' },
];

// Huella de la config REAL de agy del usuario (settings del CLI y ~/.gemini/config), para demostrar que
// el spike no la toca. Solo ficheros de config: los logs y la cache cambian solos.
function realConfigFingerprint() {
  const roots = [path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json'), path.join(os.homedir(), '.gemini', 'config')];
  const hashes = [];
  const walk = (target) => {
    if (!fs.existsSync(target)) return;
    if (fs.statSync(target).isDirectory()) {
      for (const entry of fs.readdirSync(target)) walk(path.join(target, entry));
      return;
    }
    hashes.push(`${target}:${createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`);
  };
  roots.forEach(walk);
  return createHash('sha256').update(hashes.sort().join('\n')).digest('hex');
}

// USERPROFILE aislado con las reglas en su settings.json. HOME se deja en el real a proposito: git lo
// usa (medido: git resuelve ~/.gitconfig por HOME/HOMEDRIVE+HOMEPATH, no por USERPROFILE).
function isolatedProfileEnv(profile, rules) {
  const dir = path.join(profile, '.gemini', 'antigravity-cli');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ permissions: rules }, null, 2));
  return { ...process.env, USERPROFILE: profile, HOME: process.env.HOME ?? os.homedir() };
}

// Veredicto por caso con las tres senales medidas: el fichero en disco (la verdad), el mensaje de
// error del paso (`tool_info.error.message`, trae el comando EXACTO) y `result.denied_actions`, que
// solo lista las denegaciones por "no hay a quien preguntar" (un deny explicito NO aparece ahi). El
// `state` del paso NO sirve: una denegacion sale a veces como DONE.
function reportCases(workspace, session, cases = PERMISSION_CASES) {
  for (const testCase of cases) {
    const ran = fs.existsSync(path.join(workspace, testCase.file)) ? 'EJECUTADO' : 'no ejecutado';
    const ok = ran === testCase.expected ? 'ok' : 'INESPERADO';
    console.log(`  ${testCase.label.padEnd(24)} -> ${ran.padEnd(12)} (${ok})`);
  }
  for (const event of session.events ?? []) {
    const message = event.step_update?.tool_info?.error?.message;
    if (message) console.log(`    error del paso: ${message.split('\n')[0].slice(0, 200)}`);
    if (event.event === 'result' && event.result?.denied_actions) {
      console.log(`    denied_actions: ${JSON.stringify(event.result.denied_actions)}`);
    }
  }
  const notices = session.stderr.split('\n').filter((line) => line.includes('auto-denied'));
  if (notices.length > 0) console.log(`    stderr (${notices.length}x): ${notices[0].trim().slice(0, 160)}`);
}

// En un USERPROFILE aislado, escribir DENTRO del workspace (--add-dir) tambien se deniega salvo regla
// `write_file(<dir>)` (medido: ni `trustedWorkspaces` ni `allowNonWorkspaceAccess` lo desbloquean). Y
// los comandos que lance el agente heredan ese USERPROFILE (os.homedir() del hijo = perfil aislado).
async function probeIsolatedProfileWrites() {
  for (const withRule of [false, true]) {
    await withWorkspace('mage-agy-iso-', async (workspace) => {
      await withWorkspace('mage-agy-profile-', async (profile) => {
        const rules = withRule ? { allow: [`write_file(${workspace})`] } : {};
        console.log(`\n=== [permissions] perfil aislado, write_to_file en el workspace, reglas ${JSON.stringify(rules)} ===`);
        const session = startPersistent(workspace, [], isolatedProfileEnv(profile, rules));
        session.send(`Use the write_to_file tool to create a file named w.txt in ${workspace} containing exactly: mage. Nothing else.`);
        await waitFor(session, (events) => countResults(events) >= 1);
        session.child.stdin.end();
        await session.exited;
        const denied = session.events.find((event) => event.event === 'result')?.result?.denied_actions ?? null;
        console.log(`  w.txt: ${fs.existsSync(path.join(workspace, 'w.txt')) ? 'EJECUTADO' : 'no ejecutado'} denied_actions=${JSON.stringify(denied)}`);
      });
    });
  }
}

async function probePermissionRules() {
  const before = realConfigFingerprint();
  await probeIsolatedProfileWrites();
  const modes = [['default', []], ['accept-edits', ['--mode', 'accept-edits']], ['plan', ['--mode', 'plan']]];
  for (const [label, args] of modes) {
    await withWorkspace('mage-agy-perm-', async (workspace) => {
      await withWorkspace('mage-agy-profile-', async (profile) => {
        console.log(`\n=== [permissions] sesion persistente, modo ${label}, reglas ${JSON.stringify(PERMISSION_RULES)} ===`);
        const session = startPersistent(workspace, args, isolatedProfileEnv(profile, PERMISSION_RULES));
        const cases = label === 'default' ? PERMISSION_CASES : [PERMISSION_CASES[0], PERMISSION_CASES[3]];
        for (const [index, testCase] of cases.entries()) {
          session.send(`Use the run_command tool to run exactly this command in ${workspace} and nothing else: ${testCase.command}`);
          await waitFor(session, (events) => countResults(events) >= index + 1);
        }
        session.child.stdin.end();
        await session.exited;
        summarize(session);
        reportCases(workspace, session, cases);
      });
    });
  }
  await withWorkspace('mage-agy-perm-p-', async (workspace) => {
    await withWorkspace('mage-agy-profile-', async (profile) => {
      console.log('\n=== [permissions] print mode (-p), modo default: permitido y denegado en un turno ===');
      const prompt = `Use the run_command tool twice, in ${workspace}: first exactly "echo mage > allowed.txt", then exactly "hostname > denied.txt". Nothing else.`;
      const printCases = [PERMISSION_CASES[0], PERMISSION_CASES[3]];
      const result = runWithEnv(['--output-format', 'json', '--add-dir', workspace, '--model', PERSISTENT.model, '--print', prompt], isolatedProfileEnv(profile, PERMISSION_RULES), PERSISTENT.turnTimeoutMs);
      console.log(`  exit=${result.code} ${result.stdout.trim().slice(0, 200)}`);
      reportCases(workspace, { stderr: result.stderr }, printCases);
    });
  });
  const after = realConfigFingerprint();
  console.log(`\n  config real de agy intacta: ${before === after ? 'SI' : 'NO — revisa'} (sha256 ${after.slice(0, 12)}…)`);
}

async function probePersistent() {
  await probeInputEvents();
  await probeReadOnlyCommands();
  await probeGeminiKey();
  await probeWritesByMode();
  await probeInterrupt();
  await probeConcurrentMessage();
}

// ================================================================================================
// Modo --images (2026-10-01, agy 1.2.14, M13). Lo medido:
//   - GRATIS: `content` solo admite bloques `text`. Un bloque `image` (con o sin `source` base64) da
//     «stream input content block type "image" is not supported (only "text")», result ERROR, 0 turnos.
//   - 1 turno: una imagen por RUTA en el texto la abre el agente con `view_file` y contesta bien ("Red"),
//     tambien fuera del workspace con el perfil real.
//   - Perfil aislado (USERPROFILE propio, como una cuenta por clave): leer fuera del workspace se DENIEGA
//     (`denied_actions: read_file/ViewFile`) salvo `read_file(<dir>)`, que actua como prefijo; y la regla
//     tiene que llevar la ruta LARGA: con la forma 8.3 de Windows (DMARAT~1) no casa.
// Es lo que hace `agyAdapter` (imagen a disco + ruta) y `agyProfile` (regla con `realpathSync.native`).
// ================================================================================================

// PNG de 64x64 de un solo color, sin dependencias.
function solidPng(file, [r, g, b]) {
  const width = 64;
  const height = 64;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set([r, g, b], y * (width * 3 + 1) + 1 + x * 3);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(typed));
    return Buffer.concat([length, typed, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

async function probeImages() {
  console.log('\n=== [images] bloques admitidos en content (gratis) ===');
  await withWorkspace('mage-agy-img-free-', async (workspace) => {
    for (const content of [[{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }], [{ type: 'bogus' }]]) {
      const session = startPersistent(workspace);
      session.child.stdin.end(`${JSON.stringify({ event: 'user', message: { content } })}\n`);
      await session.exited;
      console.log(`  ${content[0].type.padEnd(6)} exit=${session.exitCode} ${session.stderr.trim().split('\n')[0] ?? ''}`);
    }
  });
  const before = realConfigFingerprint();
  await withWorkspace('mage-agy-img-dir-', async (imagesDir) => {
    const image = path.join(fs.realpathSync.native(imagesDir), 'probe.png');
    solidPng(image, [255, 0, 0]);
    const ask = `Look at the image file ${image} with view_file. Reply with ONLY the name of its dominant color, one word.`;
    await withWorkspace('mage-agy-img-ws-', async (workspace) => {
      console.log('\n=== [images] imagen por ruta, perfil real (1 turno) ===');
      reportImageTurn(await singleTurn(workspace, ask));
      for (const rule of [null, `read_file(${path.dirname(image)})`]) {
        await withWorkspace('mage-agy-profile-', async (profile) => {
          console.log(`\n=== [images] perfil aislado, regla ${rule ?? '(ninguna)'} (1 turno) ===`);
          const session = startPersistent(workspace, [], isolatedProfileEnv(profile, rule === null ? {} : { allow: [rule] }));
          session.send(ask);
          await waitFor(session, (events) => countResults(events) >= 1);
          session.child.stdin.end();
          await session.exited;
          reportImageTurn(session);
        });
      }
    });
  });
  console.log(`\n  config real de agy intacta: ${before === realConfigFingerprint() ? 'SI' : 'NO — revisa'}`);
}

function reportImageTurn(session) {
  const result = session.events.find((event) => event.event === 'result')?.result;
  console.log(`  respuesta=${JSON.stringify((result?.response ?? '').trim())} denied_actions=${JSON.stringify(result?.denied_actions ?? null)}`);
}

// ================================================================================================
// Modo --profile (2026-10-01, agy 1.2.14): el perfil propio de Mage para la SUSCRIPCION (sin
// `modelProvider`) y lo que se enlaza en el. Mide:
//   (a) GRATIS: `/usage` en un USERPROFILE aislado sin `modelProvider`: si trae las cuotas, el login de
//       suscripcion sigue valiendo ahi.
//   (b) un MCP de `~/.gemini/config` visto desde el perfil por un JUNCTION. Nunca se toca la config real:
//       el junction apunta a una copia falsa en el temporal con un servidor MCP minimo (stdio, node).
//   (c) ¿relee agy su settings.json a mitad de sesion? Se cambia la regla allow entre dos turnos.
// Resultado (2026-10-01, agy 1.2.14): (a) SI, el login vale; (b) `agy mcp list` lo lista y la tool se llama,
// pero solo con `read_file(<perfil>/.gemini/antigravity-cli/mcp)` (agy lee alli el esquema) y `mcp(<srv>/<tool>)`;
// (c) NO relee: las reglas valen solo al lanzar. Ademas: agy crea `.gemini/config` como carpeta real al
// arrancar en un perfil nuevo, y con `.gemini/config` colgado no arranca.
// CONSUME SUSCRIPCION: ~3 turnos cortos.
// ================================================================================================

// Servidor MCP minimo por stdio (JSON-RPC por lineas): una tool `echo` que devuelve un texto fijo.
const MCP_SERVER_SOURCE = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\\n');
rl.on('line', (line) => {
  const req = JSON.parse(line);
  if (req.id === undefined) return;
  if (req.method === 'initialize') send({ id: req.id, result: { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'magespike', version: '1.0.0' } } });
  else if (req.method === 'tools/list') send({ id: req.id, result: { tools: [{ name: 'mage_echo', description: 'Returns a fixed secret word', inputSchema: { type: 'object', properties: {} } }] } });
  else if (req.method === 'tools/call') send({ id: req.id, result: { content: [{ type: 'text', text: 'TANGERINE' }] } });
  else send({ id: req.id, result: {} });
});`;

// OJO (medido): el `/usage` de (a) ya CREA `.gemini/config` en el perfil como carpeta real (`.migrated`,
// `mcp_config.json` vacio, `projects/default-cli-project.json`). Un junction se tiene que crear antes de
// que agy arranque, o quitar de en medio la que dejo. Aqui es un temporal del spike: se borra.
function linkDir(target, link) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  if (fs.existsSync(link)) {
    console.log(`  agy ya creo ${path.basename(link)} como carpeta real: ${JSON.stringify(fs.readdirSync(link))} (se quita)`);
    fs.rmSync(link, { recursive: true, force: true });
  }
  fs.symlinkSync(target, link, 'junction'); // en POSIX el tipo se ignora: symlink de directorio
}

async function probeProfile() {
  const before = realConfigFingerprint();
  await withWorkspace('mage-agy-prof-', async (workspace) => {
    await withWorkspace('mage-agy-profile-', async (profile) => {
      // Medido: para llamar a una tool MCP agy lee antes su esquema con view_file en
      // `<perfil>/.gemini/antigravity-cli/mcp/<servidor>/<tool>.json`; en un perfil aislado eso se deniega
      // salvo `read_file(<esa carpeta>)` (ruta LARGA, como la de las imagenes).
      const mcpDir = path.join(fs.realpathSync.native(profile), '.gemini', 'antigravity-cli', 'mcp');
      const baseAllow = [`write_file(${workspace})`, `read_file(${mcpDir})`];
      const env = isolatedProfileEnv(profile, { allow: [...baseAllow, 'command(echo one > one.txt)'] });
      console.log('\n=== [profile a] /usage en perfil aislado SIN modelProvider (gratis) ===');
      const usage = runWithEnv(['--output-format', 'json', '--print', '/usage'], env);
      const groups = /"groups"\s*:\s*\[\s*\{/.test(usage.stdout) || /Limit Remaining/.test(usage.stdout);
      console.log(`  exit=${usage.code} cuotas de suscripcion: ${groups ? 'SI' : 'NO'}`);

      console.log('\n=== [profile c] ¿relee settings.json a mitad de sesion? (2 turnos) ===');
      const session = startPersistent(workspace, ['--mode', 'accept-edits'], env);
      session.send('Use the run_command tool to run exactly this command and nothing else: echo one > one.txt');
      await waitFor(session, (events) => countResults(events) >= 1);
      isolatedProfileEnv(profile, { allow: [...baseAllow, 'command(echo two > two.txt)'] });
      session.send('Use the run_command tool to run exactly this command and nothing else: echo two > two.txt');
      await waitFor(session, (events) => countResults(events) >= 2);
      session.child.stdin.end();
      await session.exited;
      console.log(`  one.txt (regla al lanzar): ${fs.existsSync(path.join(workspace, 'one.txt')) ? 'EJECUTADO' : 'no ejecutado'}`);
      console.log(`  two.txt (regla cambiada a mitad): ${fs.existsSync(path.join(workspace, 'two.txt')) ? 'EJECUTADO -> relee' : 'no ejecutado -> solo lee al lanzar'}`);
      summarize(session);
      reportCases(workspace, session, []);

      await withWorkspace('mage-agy-fakecfg-', async (fakeConfig) => {
        const server = path.join(fakeConfig, 'server.cjs');
        fs.writeFileSync(server, MCP_SERVER_SOURCE);
        fs.writeFileSync(path.join(fakeConfig, 'mcp_config.json'), JSON.stringify({ mcpServers: { magespike: { command: process.execPath, args: [server] } } }));
        linkDir(fakeConfig, path.join(profile, '.gemini', 'config'));
        console.log('\n=== [profile b] MCP de .gemini/config por junction: `agy mcp list` (gratis) y una llamada (1 turno) ===');
        console.log(`  ${runWithEnv(['mcp', 'list'], env).stdout.trim().replace(/\n/g, '\n  ')}`);
        // Con la tool permitida por su regla `mcp(<servidor>/<tool>)` (sin ella: denied_actions mcp/CallMcpTool).
        isolatedProfileEnv(profile, { allow: [...baseAllow, 'mcp(magespike/mage_echo)'] });
        const call = await singleTurnWithEnv(workspace, 'Call the mage_echo tool of the magespike MCP server and reply with ONLY the word it returns.', env);
        const response = call.events.find((event) => event.event === 'result')?.result?.response ?? '';
        console.log(`  respuesta: ${JSON.stringify(response.trim().slice(0, 120))} -> tool MCP ejecutada: ${/TANGERINE/i.test(response) ? 'SI' : 'NO'}`);
        reportCases(workspace, { events: call.events, stderr: call.stderr }, []);
      });
    });
  });
  console.log(`\n  config real de agy intacta: ${before === realConfigFingerprint() ? 'SI' : 'NO — revisa'}`);
}

// ================================================================================================
// Modo --mcp-rules (grupo E, fase 3; 2026-10-01, agy 1.2.14): reglas `mcp(<servidor>/<tool>)` en el perfil
// de Mage. Mismo servidor MCP falso que --profile, por junction de `.gemini/config` a un temporal (la
// config real no se toca: se compara su huella antes y despues). Mide, un turno por caso (las reglas se
// leen al lanzar):
//   (1) sin regla mcp: que error trae el paso y que `denied_actions` (para el aviso de Mage);
//   (2) `mcp(<srv>/*)`: ¿vale el comodin de servidor?;
//   (3) `deny mcp(<srv>/<tool>)` frente a `allow mcp(<srv>/*)`: mensaje de un deny explicito.
// CONSUME SUSCRIPCION: 3 turnos cortos.
// ================================================================================================
const MCP_RULE_CASES = [
  { label: 'sin regla mcp', allow: [], deny: [] },
  { label: 'allow mcp(magespike/*)', allow: ['mcp(magespike/*)'], deny: [] },
  { label: 'deny exacta + allow *', allow: ['mcp(magespike/*)'], deny: ['mcp(magespike/mage_echo)'] },
];

async function probeMcpRules() {
  const before = realConfigFingerprint();
  await withWorkspace('mage-agy-mcpr-', async (workspace) => {
    await withWorkspace('mage-agy-mcpr-profile-', async (profile) => {
      await withWorkspace('mage-agy-mcpr-cfg-', async (fakeConfig) => {
        const server = path.join(fakeConfig, 'server.cjs');
        fs.writeFileSync(server, MCP_SERVER_SOURCE);
        fs.writeFileSync(path.join(fakeConfig, 'mcp_config.json'), JSON.stringify({ mcpServers: { magespike: { command: process.execPath, args: [server] } } }));
        linkDir(fakeConfig, path.join(profile, '.gemini', 'config'));
        const mcpDir = path.join(fs.realpathSync.native(profile), '.gemini', 'antigravity-cli', 'mcp');
        const baseAllow = [`write_file(${workspace})`, `read_file(${mcpDir})`];
        for (const testCase of MCP_RULE_CASES) {
          const env = isolatedProfileEnv(profile, { allow: [...baseAllow, ...testCase.allow], deny: testCase.deny });
          console.log(`
=== [mcp-rules] ${testCase.label} ===`);
          const loaded = runWithEnv(['--output-format', 'json', '--print', '/permissions'], env);
          console.log(`  /permissions (gratis): ${loaded.stdout.replace(/\s+/g, ' ').trim().slice(0, 400)}`);
          const call = await singleTurnWithEnv(workspace, 'Call the mage_echo tool of the magespike MCP server and reply with ONLY the word it returns.', env);
          const response = call.events.find((event) => event.event === 'result')?.result?.response ?? '';
          console.log(`  respuesta: ${JSON.stringify(response.trim().slice(0, 120))} -> tool MCP ejecutada: ${/TANGERINE/i.test(response) ? 'SI' : 'NO'}`);
          for (const event of call.events) {
            const update = event.step_update;
            if (update?.tool_name) console.log(`    paso tool=${update.tool_name} state=${update.state} tool_info=${JSON.stringify(update.tool_info ?? null).slice(0, 400)}`);
          }
          reportCases(workspace, { events: call.events, stderr: call.stderr }, []);
        }
      });
    });
  });
  console.log(`
  config real de agy intacta: ${before === realConfigFingerprint() ? 'SI' : 'NO — revisa'}`);
}

async function singleTurnWithEnv(workspace, text, env) {
  const session = startPersistent(workspace, ['--mode', 'accept-edits'], env);
  session.send(text);
  await waitFor(session, (events) => countResults(events) >= 1);
  session.child.stdin.end();
  await session.exited;
  return session;
}

// ================================================================================================
// Modo --instructions (grupo H; 2026-10-05, agy 1.2.16): que fichero de instrucciones lee agy y desde
// donde, para darle el CLAUDE.md de un proyecto SIN escribir en el repo. Lo que dice el binario (sus
// docs embebidas y su changelog de la 1.2.16, gratis): reglas `GEMINI.md`/`AGENTS.md` en cada carpeta
// del cwd a la raiz del repo, y globales en `~/.gemini/{GEMINI,AGENTS}.md` y `~/.gemini/config/…`. No
// hay flag ni ajuste para otro nombre (`contextFileName` es de los manifiestos de plugin). Mide con
// turnos (gemini-3.8-flash-low), en un USERPROFILE aislado:
//   (a) CLAUDE.md en el proyecto y GEMINI.md en `<perfil>/.gemini/`: ¿cual llega? (1 turno);
//   (b) se reescribe el GEMINI.md del perfil con la sesion viva: ¿lo relee por turno o solo al lanzar? (1);
//   (c) AGENTS.md y GEMINI.md en el proyecto: ¿lee los dos? (1 turno).
// Las instrucciones las cuenta el modelo (se le piden las palabras clave que llevan, sin herramientas);
// el resumen de pasos dice si abrio algun fichero, que invalidaria el caso. CONSUME SUSCRIPCION: 3 turnos.
// ================================================================================================
const INSTRUCTIONS_QUESTION =
  'Without using any tool and without reading any file, list every CODEWORD that appears in your rules, ' +
  'user rules or system instructions. Reply with ONLY the codewords separated by commas, or NONE.';

function realRulesFingerprint() {
  const files = ['GEMINI.md', 'AGENTS.md'].map((name) => path.join(os.homedir(), '.gemini', name));
  return files.map((file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : '-')).join(',');
}

async function askCodewords(session, expectedResults) {
  session.send(INSTRUCTIONS_QUESTION);
  await waitFor(session, (events) => countResults(events) >= expectedResults);
  const results = session.events.filter((event) => event.event === 'result');
  const tools = session.events.filter((event) => event.step_update?.tool_name).map((event) => event.step_update.tool_name);
  return `${JSON.stringify((results.at(-1)?.result?.response ?? '').trim().slice(0, 120))} herramientas=${JSON.stringify([...new Set(tools)])}`;
}

async function probeInstructions() {
  const before = `${realConfigFingerprint()}|${realRulesFingerprint()}`;
  await withWorkspace('mage-agy-ins-', async (workspace) => {
    await withWorkspace('mage-agy-ins-profile-', async (profile) => {
      const env = isolatedProfileEnv(profile, { allow: [] });
      const globalRules = path.join(profile, '.gemini', 'GEMINI.md');
      fs.writeFileSync(path.join(workspace, 'CLAUDE.md'), 'CODEWORD: PLUM\n');
      fs.writeFileSync(globalRules, 'CODEWORD: KIWI\n');
      console.log('\n=== [instructions a] CLAUDE.md (PLUM) en el proyecto, GEMINI.md (KIWI) en el perfil ===');
      const session = startPersistent(workspace, ['--mode', 'accept-edits'], env);
      console.log(`  respuesta: ${await askCodewords(session, 1)}`);
      fs.writeFileSync(globalRules, 'CODEWORD: MANGO\n');
      console.log('\n=== [instructions b] GEMINI.md del perfil reescrito (MANGO) con la sesion viva ===');
      console.log(`  respuesta: ${await askCodewords(session, 2)}  (KIWI = solo al lanzar; MANGO = relee)`);
      session.child.stdin.end();
      await session.exited;
    });
  });
  await withWorkspace('mage-agy-ins2-', async (workspace) => {
    await withWorkspace('mage-agy-ins2-profile-', async (profile) => {
      const env = isolatedProfileEnv(profile, { allow: [] });
      fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'CODEWORD: FIG\n');
      fs.writeFileSync(path.join(workspace, 'GEMINI.md'), 'CODEWORD: LIME\n');
      console.log('\n=== [instructions c] AGENTS.md (FIG) y GEMINI.md (LIME) en el proyecto ===');
      const session = startPersistent(workspace, ['--mode', 'accept-edits'], env);
      console.log(`  respuesta: ${await askCodewords(session, 1)}`);
      session.child.stdin.end();
      await session.exited;
    });
  });
  await withWorkspace('mage-agy-ins3-', async (workspace) => {
    await withWorkspace('mage-agy-ins3-bridge-', async (bridge) => {
      await withWorkspace('mage-agy-ins3-profile-', async (profile) => {
        const env = isolatedProfileEnv(profile, { allow: [] });
        fs.writeFileSync(path.join(bridge, 'GEMINI.md'), 'CODEWORD: PEAR\n');
        console.log('\n=== [instructions d] GEMINI.md (PEAR) en una carpeta FUERA del proyecto pasada con un segundo --add-dir ===');
        const session = startPersistent(workspace, ['--mode', 'accept-edits', '--add-dir', bridge], env);
        console.log(`  respuesta: ${await askCodewords(session, 1)}`);
        session.child.stdin.end();
        await session.exited;
      });
    });
  });
  const after = `${realConfigFingerprint()}|${realRulesFingerprint()}`;
  console.log(`\n  config y reglas reales de agy intactas: ${before === after ? 'SI' : 'NO — revisa'}`);
}

async function main() {
  const version = await run(['--version'], { timeoutMs: CONFIG.probeTimeoutMs });
  const found = version.code === 0;
  console.log(`agy: ${found ? `v${version.stdout.trim()}` : 'NO ENCONTRADO en el PATH'}`);
  if (!found) process.exit(1);

  await probeFlags();
  // `--print ''` corta antes de gastar en las versiones medidas; con otra version, compruebalo antes.
  await probeArbitraryConversation();
  if (process.argv.includes('--live')) await probeLive();
  if (process.argv.includes('--persistent')) await probePersistent();
  if (process.argv.includes('--permissions')) await probePermissionRules();
  if (process.argv.includes('--images')) await probeImages();
  if (process.argv.includes('--profile')) await probeProfile();
  if (process.argv.includes('--mcp-rules')) await probeMcpRules();
  if (process.argv.includes('--instructions')) await probeInstructions();
  if (!['--live', '--persistent', '--permissions', '--images', '--profile', '--mcp-rules', '--instructions'].some((flag) => process.argv.includes(flag))) {
    console.log('\n(--live: 2 turnos reales por proceso; --persistent: sesion persistente, ~12 turnos; --permissions: reglas de comandos, ~14 turnos; --images: imagenes, ~3 turnos. Consumen suscripción)');
  }
}

void main();
