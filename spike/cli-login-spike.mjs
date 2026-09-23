// Mage - Spike del login por CLI (fase 9.0 de la auditoria: S1, S2 y S4).
//
// Por que existe: la Fase 9 quiere que el alta de cuenta la haga el CLI real y que Mage NUNCA vea el
// token. Antes de picar `cliLoginService.ts` hay que MEDIR tres cosas contra el binario real, no
// deducirlas (el `--help` de un CLI ya mintio por omision una vez, ver spike/agy-spike.mjs):
//
//   S1  El *code* entregado por stdin cierra el ciclo, el CLI escribe `.credentials.json` Y escribe
//       `oauthAccount` en `.claude.json` (de ahi saca AccountService el email y la org: si el CLI no
//       lo escribe, la ficha de cuenta se queda muda y 9.2 no puede borrar `mergeOauthAccount`).
//   S2  Callback por localhost o pegado manual. Si cierra solo, el alta es un indicador de progreso
//       y el usuario no pega nada.
//   S4  `BROWSER` apuntando a un ejecutable inexistente suprime la apertura del navegador. Medido en
//       Windows el 2026-09-11; faltan macOS y Linux. Este script lo mide en el SO donde se ejecute,
//       asi que en macOS/Linux basta con ejecutarlo alli.
//
// NO es codigo de produccion. Identificadores en ingles, comentarios en castellano.
//
// Uso:
//   node spike/cli-login-spike.mjs          # sondas GRATIS: no autentica, no toca ~/.claude
//   node spike/cli-login-spike.mjs --live   # ademas, un login REAL en un config dir temporal
//
// El modo --live abre una sesion OAuth mas de tu cuenta contra un CLAUDE_CONFIG_DIR temporal que se
// borra al final. No modifica ninguna cuenta existente.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const CONFIG = {
  claudeBin: resolveClaudeBinary(),
  urlTimeoutMs: 30_000,
  loginTimeoutMs: 300_000, // el humano tiene que autorizar en el navegador
  statusTimeoutMs: 20_000,
  browserArgvTimeoutMs: 15_000,
  pollMs: 300,
  // Ruta que no existe en ningun SO: es el no-op de BROWSER que mide S4.
  noopBrowser: process.platform === 'win32' ? 'C:\\mage-no-browser\\nope.exe' : '/nonexistent/mage-no-browser',
  browserNames: ['chrome', 'msedge', 'firefox', 'safari', 'brave', 'opera', 'vivaldi', 'chromium'],
};

function resolveClaudeBinary() {
  const override = process.env.MAGE_CLAUDE_BIN;
  if (override) return override;
  // Ubicacion del instalador nativo en Windows (los shims .cmd no arrancan con spawn directo).
  const winLocal = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (process.platform === 'win32' && fs.existsSync(winLocal)) return winLocal;
  return 'claude';
}

// --- Parseo de la URL de authorize ------------------------------------------------------------

// MEDIDO: el CLI envuelve la URL en un hyperlink OSC-8 (ESC ] 8 ; ; <url> BEL <texto> ESC ] 8 ; ; BEL),
// asi que la URL sale DOS VECES y pegada a bytes de escape. Un `indexOf('https://')` ingenuo se lleva
// las dos concatenadas y produce una URL invalida. Se limpian los escapes ANTES de buscar.
// Esta funcion es la que portara `cliLoginService.parseAuthorizeUrl` en 9.2.
export function parseAuthorizeUrl(output) {
  const plain = output
    .replace(/\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g, ' ') // hyperlinks OSC-8
    .replace(/\u001b\[[0-9;]*m/g, ''); // color SGR
  const match = plain.match(/https:\/\/\S*\/oauth\/authorize\?\S+/);
  if (match === null) return null;
  // `new URL` valida la frontera (estandar del repo): si el match arrastra basura, no hay URL.
  try {
    return new URL(match[0].trim());
  } catch {
    return null;
  }
}

function describeAuthorizeUrl(url) {
  const params = url.searchParams;
  const redirect = params.get('redirect_uri') ?? '(ausente)';
  return {
    redirect,
    isLocalCallback: redirect.startsWith('http://localhost:'),
    clientId: params.get('client_id') ?? '(ausente)',
    loginHint: params.get('login_hint'),
    hasPkce: params.get('code_challenge') !== null && params.get('code_challenge_method') === 'S256',
    scopes: (params.get('scope') ?? '').split(' ').filter((scope) => scope.length > 0),
  };
}

// --- Puertos a la escucha (oraculo de S2 sin gastar un login) ---------------------------------

// Devuelve Map<puerto, pid|null> de los sockets TCP en LISTEN sobre loopback. Cada SO tiene su
// herramienta; si no hay ninguna se devuelve null y el llamador lo DICE (nunca se silencia).
function listeningSockets() {
  const probes = process.platform === 'win32'
    ? [['netstat', ['-ano', '-p', 'TCP']]]
    : [['lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']], ['ss', ['-ltnp']]];
  for (const [command, args] of probes) {
    const run = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
    if (run.error || typeof run.stdout !== 'string' || run.stdout.length === 0) continue;
    return parseListening(run.stdout);
  }
  return null;
}

function parseListening(output) {
  const found = new Map();
  for (const line of output.split('\n')) {
    if (!/LISTEN/i.test(line)) continue;
    const local = line.match(/(?:127\.0\.0\.1|\[::1\]|localhost):(\d+)/);
    if (local === null) continue;
    const pid = line.match(/pid=(\d+)/) ?? line.match(/(\d+)\s*$/);
    found.set(Number(local[1]), pid === null ? null : Number(pid[1]));
  }
  return found;
}

// --- Procesos de navegador (oraculo de S4) ----------------------------------------------------

function countBrowserProcesses() {
  const run = process.platform === 'win32'
    ? spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
    : spawnSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8' });
  if (run.error || typeof run.stdout !== 'string') return null;
  const lower = run.stdout.toLowerCase();
  return CONFIG.browserNames.reduce((total, name) => total + occurrences(lower, name), 0);
}

function occurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

// --- Arranque del login -----------------------------------------------------------------------

function makeTempConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mage-login-spike-'));
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.log(`  (no se pudo borrar ${dir}: ${err.code ?? err.message} - borralo a mano)`);
  }
}

// Spawnea `claude auth login` con config dir aislado. Resuelve en cuanto imprime la URL.
// `suppressBrowser` fija BROWSER al no-op (S4); SIN el, el CLI abre el navegador con la URL
// AUTOMATICA (la del callback por localhost), que es justo lo que S2 quiere ver cerrarse solo.
function startLogin({ configDir, email, suppressBrowser, browser = null }) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  if (suppressBrowser) env.BROWSER = CONFIG.noopBrowser;
  else if (browser !== null) env.BROWSER = browser;
  const args = ['auth', 'login', '--claudeai'];
  if (email !== null) args.push('--email', email);

  const child = spawn(CONFIG.claudeBin, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  const pending = { onUrl: null, onExit: null };

  const absorb = (chunk) => {
    output += chunk;
    if (pending.onUrl === null) return;
    const url = parseAuthorizeUrl(output);
    if (url === null) return;
    const notify = pending.onUrl;
    pending.onUrl = null;
    notify(url);
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', absorb);
  child.stderr.on('data', absorb);
  child.on('exit', (code) => pending.onExit?.(code));

  return {
    child,
    get output() {
      return output;
    },
    waitForUrl(timeoutMs) {
      return new Promise((resolve, reject) => {
        const already = parseAuthorizeUrl(output);
        if (already !== null) {
          resolve(already);
          return;
        }
        const timer = setTimeout(() => reject(new Error(`Sin URL de authorize tras ${timeoutMs} ms`)), timeoutMs);
        pending.onUrl = (url) => {
          clearTimeout(timer);
          resolve(url);
        };
      });
    },
    waitForExit(timeoutMs) {
      return new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve(child.exitCode); // ya habia salido: el evento 'exit' no va a volver
          return;
        }
        const timer = setTimeout(() => resolve('timeout'), timeoutMs);
        pending.onExit = (code) => {
          clearTimeout(timer);
          resolve(code);
        };
      });
    },
  };
}

// --- S2: URL y callback por localhost (gratis) ------------------------------------------------

async function probeUrlAndListener() {
  console.log('\n=== S2 - URL de authorize y callback por localhost (gratis, no autentica) ===');
  const configDir = makeTempConfigDir();
  const before = listeningSockets();
  const session = startLogin({ configDir, email: 'spike@example.invalid', suppressBrowser: true });
  try {
    const url = await session.waitForUrl(CONFIG.urlTimeoutMs);
    const info = describeAuthorizeUrl(url);
    console.log(`  redirect_uri    ${info.redirect}`);
    console.log(`  callback local  ${info.isLocalCallback ? 'SI' : 'NO - la URL IMPRESA es la del pegado manual'}`);
    console.log(`  client_id       ${info.clientId}`);
    console.log(`  login_hint      ${info.loginHint ?? '(ausente)'}  (viene de --email)`);
    console.log(`  PKCE S256       ${info.hasPkce ? 'SI - el code_verifier vive en el CLI: Mage no podria canjear el code aunque quisiera' : 'NO'}`);
    console.log(`  scopes          ${info.scopes.length}: ${info.scopes.join(' ')}`);
    console.log(`  hyperlink OSC-8 ${session.output.includes('\u001b]8;;') ? 'SI (la URL sale DOS veces: hay que limpiarlo al parsear)' : 'no'}`);

    const after = listeningSockets();
    if (before === null || after === null) {
      console.log('  puertos: sin netstat/lsof/ss - NO MEDIDO en esta maquina');
      return;
    }
    const fresh = [...after.entries()].filter(([port]) => !before.has(port));
    const shown = fresh.map(([port, pid]) => `${port}${pid === null ? '' : ` (pid ${pid}${pid === session.child.pid ? ' = el propio CLI' : ''})`}`);
    console.log(`  puertos loopback nuevos mientras el login espera: ${fresh.length === 0 ? 'NINGUNO' : shown.join(', ')}`);
    console.log('    -> si hay puerto, el flujo AUTOMATICO esta vivo aunque la URL impresa sea la manual.');
  } finally {
    session.child.kill();
    removeDir(configDir);
  }
}

// --- S4: BROWSER no-op (gratis) ---------------------------------------------------------------

async function probeBrowserNoop() {
  console.log(`\n=== S4 - BROWSER no-op en ${process.platform} (gratis) ===`);
  const configDir = makeTempConfigDir();
  const before = countBrowserProcesses();
  const session = startLogin({ configDir, email: null, suppressBrowser: true });
  try {
    const url = await session.waitForUrl(CONFIG.urlTimeoutMs);
    const after = countBrowserProcesses();
    if (before === null || after === null) {
      console.log('  sin tasklist/ps - NO MEDIDO');
      return;
    }
    const delta = after - before;
    console.log(`  procesos de navegador antes=${before} despues=${after} delta=${delta}`);
    console.log(`  URL impresa pese al no-op: ${url === null ? 'NO' : 'SI'}`);
    console.log(`  BROWSER=${CONFIG.noopBrowser} -> ${delta <= 0 ? 'SUPRIME la apertura' : 'ABRIO navegador: re-mide el diseno de 9.2'}`);
  } finally {
    session.child.kill();
    removeDir(configDir);
  }
}

// --- S2b: que URL recibe BROWSER (gratis, pero abre una ventana en Windows) --------------------

// MEDIDO el 2026-09-14: el CLI imprime la URL MANUAL y le pasa a BROWSER la AUTOMATICA, la del
// callback por localhost. Es el dato del que depende que el alta de 9.2 sea de cero pegados: si Mage
// pone su propio ejecutable en BROWSER, recibe esa URL y puede abrirla en ventana privada.
//
// Como se mide sin compilar nada: hace falta un ejecutable que SOBREVIVA lo bastante para leerle la
// linea de comandos (Windows, via CIM) o que pueda escribirla en un fichero (POSIX, shebang).
// En Windows eso abre un Notepad que este spike cierra acto seguido; por eso va tras un flag.
async function probeBrowserArgv() {
  console.log('\n=== S2b - Que URL recibe BROWSER (abre y cierra un proceso auxiliar) ===');
  const configDir = makeTempConfigDir();
  const recorder = makeArgvRecorder();
  const session = startLogin({ configDir, email: null, suppressBrowser: false, browser: recorder.browserPath });
  try {
    await session.waitForUrl(CONFIG.urlTimeoutMs);
    const received = await recorder.read(CONFIG.browserArgvTimeoutMs);
    if (received === null) {
      console.log('  no se pudo capturar la linea de comandos del proceso auxiliar - NO MEDIDO');
      return;
    }
    console.log(`  argv recibido (crudo): ${received}`);
    const url = parseAuthorizeUrl(received) ?? safeUrl(received);
    if (url === null) {
      console.log('  el argumento no es una URL parseable: re-mide antes de disenar 9.2');
      return;
    }
    const info = describeAuthorizeUrl(url);
    console.log(`  redirect_uri    ${info.redirect}`);
    console.log(`  callback local  ${info.isLocalCallback ? 'SI -> Mage puede cerrar el ciclo SIN pegado manual' : 'NO'}`);
    console.log(`  comillas literales alrededor de la URL: ${received.includes('"http') ? 'SI (hay que quitarlas)' : 'no'}`);
  } finally {
    session.child.kill();
    recorder.cleanup();
    removeDir(configDir);
  }
}

function safeUrl(text) {
  const match = text.match(/https?:\/\/\S+/);
  if (match === null) return null;
  try {
    return new URL(match[0].replace(/^"|"$/g, ''));
  } catch {
    return null;
  }
}

// Devuelve un "navegador" falso que deja constancia de sus argumentos. Dos implementaciones porque el
// oraculo es distinto: en POSIX un script con shebang escribe argv a un fichero; en Windows no hay
// shebang, asi que se usa un ejecutable que sigue vivo (notepad) y se le lee la linea de comandos.
function makeArgvRecorder() {
  if (process.platform === 'win32') return makeWindowsArgvRecorder();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-browser-rec-'));
  const logFile = path.join(dir, 'argv.txt');
  const script = path.join(dir, 'fake-browser');
  fs.writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' "$@" > "${logFile}"\n`, { mode: 0o755 });
  return {
    browserPath: script,
    async read(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (fs.existsSync(logFile)) return fs.readFileSync(logFile, 'utf8').trim();
        await delay(CONFIG.pollMs);
      }
      return null;
    },
    cleanup() {
      removeDir(dir);
    },
  };
}

function makeWindowsArgvRecorder() {
  const helper = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe');
  return {
    browserPath: helper,
    async read(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const line = queryCommandLine('notepad.exe');
        if (line !== null) return line;
        await delay(CONFIG.pollMs);
      }
      return null;
    },
    cleanup() {
      spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force'], { windowsHide: true });
    },
  };
}

// Lee la linea de comandos de un proceso vivo por nombre. Solo Windows (CIM); devuelve la primera
// que contenga una URL, que es la del proceso que nos interesa.
function queryCommandLine(processName) {
  const run = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='${processName}'" | ForEach-Object { $_.CommandLine }`],
    { encoding: 'utf8', windowsHide: true },
  );
  if (run.error || typeof run.stdout !== 'string') return null;
  return run.stdout.split('\n').map((line) => line.trim()).find((line) => line.includes('http')) ?? null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- S1: login real de punta a punta ----------------------------------------------------------

// Consola del spike. UNA sola interfaz de readline para toda la ejecucion: abrir una segunda sobre el
// mismo stdin deja la primera pausada y la segunda resuelve en el acto con cadena vacia.
//
// `nextNonEmptyLine` existe porque la espera del *code* es una CARRERA contra el fin del proceso hijo:
// un Enter suelto (el que el usuario teclea porque "no pasa nada" mientras arranca el navegador) NO
// puede abortar un login en curso. Solo cuenta una linea con contenido.
function createConsole() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask(question) {
      return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
    },
    nextNonEmptyLine() {
      return new Promise((resolve) => {
        const onLine = (line) => {
          const value = line.trim();
          if (value.length === 0) return; // Enter suelto: se ignora a proposito
          rl.off('line', onLine);
          resolve(value);
        };
        rl.on('line', onLine);
      });
    },
    close() {
      rl.close();
    },
  };
}

// Lee SOLO las claves que le importan a AccountService. Nunca imprime el token: solo su presencia.
function inspectAccountFiles(configDir) {
  const credentials = readJson(path.join(configDir, '.credentials.json'));
  const block = credentials === null ? null : credentials.claudeAiOauth;
  const account = readJson(path.join(configDir, '.claude.json'))?.oauthAccount ?? null;
  return {
    credentialsExists: credentials !== null,
    credentialsHasToken: typeof block?.accessToken === 'string' && block.accessToken.length > 0,
    expiresAt: typeof block?.expiresAt === 'number' ? block.expiresAt : null,
    subscriptionType: typeof block?.subscriptionType === 'string' ? block.subscriptionType : null,
    oauthAccountKeys: account === null ? [] : Object.keys(account),
    hasEmail: typeof account?.emailAddress === 'string',
    hasOrg: typeof account?.organizationName === 'string',
  };
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.log(`  (${file} no es JSON valido: ${err.message})`);
    return null;
  }
}

function authStatus(configDir) {
  const run = spawnSync(CONFIG.claudeBin, ['auth', 'status', '--json'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    encoding: 'utf8',
    timeout: CONFIG.statusTimeoutMs,
    windowsHide: true,
  });
  const text = run.stdout ?? '';
  const start = text.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

async function liveLogin() {
  console.log('\n=== S1 - Login REAL por CLI en un config dir temporal ===');
  console.log('  No se toca ninguna cuenta existente: todo va a un CLAUDE_CONFIG_DIR temporal que se borra al final.');
  const term = createConsole();
  const email = await term.ask('  Email de la cuenta (Enter para omitir el login_hint): ');
  const configDir = makeTempConfigDir();
  // SIN suprimir BROWSER a proposito: asi se ve si el callback por localhost cierra el ciclo solo.
  const session = startLogin({ configDir, email: email.length > 0 ? email : null, suppressBrowser: false });
  try {
    const url = await session.waitForUrl(CONFIG.urlTimeoutMs);
    console.log('\n  El CLI deberia haber abierto el navegador con la URL AUTOMATICA (callback por localhost).');
    console.log('  Si no se abrio, pega esta otra (es la MANUAL, la del code a mano):\n');
    console.log(`  ${url.toString()}\n`);
    console.log('  Autoriza en el navegador y ESPERA: si el ciclo se cierra por localhost, esto termina solo.');
    console.log('  Solo si el CLI se queda parado, pega aqui el code y pulsa Enter (los Enter sueltos se ignoran).');
    console.log(`  Ctrl+C para abortar. Limite de espera: ${CONFIG.loginTimeoutMs / 1000} s.\n`);

    // Carrera: o el callback por localhost cierra solo (S2 = SI), o hace falta pegar el code (S2 = NO).
    const exited = session.waitForExit(CONFIG.loginTimeoutMs);
    const settled = await Promise.race([
      exited.then((code) => ({ how: 'auto', code })),
      term.nextNonEmptyLine().then((code) => ({ how: 'paste', code })),
    ]);

    if (settled.how === 'auto') {
      if (settled.code === 'timeout') {
        console.log('  El CLI sigue esperando y nadie ha pegado nada: login sin terminar.');
        return;
      }
      console.log(`  El CLI termino SOLO (exit=${settled.code}): el callback por localhost cerro el ciclo.`);
      console.log('  S2 = SI -> el alta es un indicador de progreso, el usuario no pega nada.');
    } else {
      session.child.stdin.write(`${settled.code}\n`);
      const code = await exited;
      console.log(`  code relayado por stdin -> el CLI salio con exit=${code}`);
      console.log('  S2 = NO por esta via: hizo falta el pegado manual.');
    }

    reportAccountFiles(configDir);
  } finally {
    term.close();
    if (session.child.exitCode === null) session.child.kill();
    removeDir(configDir);
  }
}

function reportAccountFiles(configDir) {
  console.log('\n  --- Lo que el CLI dejo escrito (S1) ---');
  const report = inspectAccountFiles(configDir);
  console.log(`  .credentials.json         ${report.credentialsExists ? 'SI' : 'NO'} (token presente: ${report.credentialsHasToken ? 'SI' : 'NO'}, expiresAt: ${report.expiresAt ?? 'ausente'}, subscriptionType: ${report.subscriptionType ?? 'ausente'})`);
  console.log(`  .claude.json oauthAccount ${report.oauthAccountKeys.length > 0 ? `SI -> claves: ${report.oauthAccountKeys.join(', ')}` : 'NO'}`);
  console.log(`  lo que lee AccountService: emailAddress ${report.hasEmail ? 'SI' : 'NO'} / organizationName ${report.hasOrg ? 'SI' : 'NO'}`);
  const status = authStatus(configDir);
  console.log(`  auth status --json:       ${status === null ? '(sin JSON)' : JSON.stringify(status)}`);
  if (!report.hasEmail) {
    console.log('  !! Sin emailAddress la ficha de cuenta se queda muda: 9.2 NO puede borrar mergeOauthAccount.');
  }
}

// --- Orquestacion -----------------------------------------------------------------------------

async function main() {
  const version = spawnSync(CONFIG.claudeBin, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (version.error) {
    console.error(`claude: NO ENCONTRADO (${CONFIG.claudeBin}). Fija MAGE_CLAUDE_BIN.`);
    process.exit(1);
  }
  console.log(`claude: ${version.stdout.trim()}  |  SO: ${process.platform}`);

  const wantsBrowserArgv = process.argv.includes('--browser-argv');
  const wantsLive = process.argv.includes('--live');

  await probeUrlAndListener();
  await probeBrowserNoop();
  if (wantsBrowserArgv) await probeBrowserArgv();
  if (wantsLive) await liveLogin();

  if (!wantsBrowserArgv) console.log('\n(pasa --browser-argv para medir que URL recibe BROWSER; en Windows abre y cierra un Notepad)');
  if (!wantsLive) console.log('(pasa --live para hacer ademas un login REAL en un config dir temporal: mide S1)');
}

void main();
