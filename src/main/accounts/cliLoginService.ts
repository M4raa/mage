import type { EmbeddedLoginResult } from '@shared/accounts';

// Login de cuenta POR EL CLI (Fase 9.2). Mage spawnea `claude auth login`, le saca la URL de su
// stdout, la abre en ventana privada, relaya el *code* que pegue el usuario por stdin y verifica con
// `auth status --json`. **Mage nunca ve el token.**
//
// Y el *code* que relaya TAMPOCO es una credencial: el `code_verifier` del PKCE vive en el proceso del
// CLI (medido: la URL lleva `code_challenge_method=S256`), asi que Mage no podria canjearlo aunque
// quisiera. Es una propiedad de la arquitectura, no una declaracion de intenciones.
//
// Todo lo de aqui esta MEDIDO contra el CLI 2.1.270 el 2026-09-14 (`spike/cli-login-spike.mjs`):
//   - `auth login` sin TTY imprime la URL y espera el *code* en stdin; tras canjearlo, SALE (los
//     fallos los midio S2 de P-026: ver INVALID_CODE_PATTERN).
//   - La URL viaja envuelta en un hyperlink OSC-8, asi que aparece DOS VECES seguidas.
//   - `auth status --json` responde contra cualquier config dir, sin TTY, y trae email/orgName.

// El proceso del CLI reducido a lo que necesita el servicio -> testable sin streams ni FS.
export interface CliLoginProcess {
  onOutput(listener: (chunk: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  writeLine(text: string): void;
  kill(): void;
}

export interface CliLoginDeps {
  // Arranca el CLI con el config dir de la cuenta ya fijado en su entorno.
  readonly spawnLogin: (configDir: string, email: string | null) => CliLoginProcess;
  // Salida CRUDA de `auth status --json` para ese config dir. Nunca lanza: un fallo se ve como "no".
  readonly readAuthStatus: (configDir: string) => Promise<string>;
  // Abre la URL en ventana privada. Devuelve como se abrio para poder AVISAR en la UI si no fue
  // privada (una sesion ya iniciada en el navegador daria de alta la cuenta equivocada).
  readonly openPrivate: (url: string) => Promise<'private' | 'normal'>;
  // Frontera IPC: solo dirs de cuenta gestionados bajo HOME (mismo whitelisting que el borrado).
  readonly validateConfigDir: (configDir: string) => boolean;
  readonly log?: (level: 'warn', message: string) => void;
  // Tiempo maximo desde el spawn hasta que aparece la URL. Sin esto un CLI colgado deja el dialogo fijo.
  readonly urlTimeoutMs?: number;
  // Tiempo maximo desde que se escribe el *code* hasta que el CLI sale (o lo rechaza).
  readonly exchangeTimeoutMs?: number;
}

const DEFAULT_URL_TIMEOUT_MS = 30_000;
// Medido (S2 de P-026, CLI 2.1.283): un code que rechaza el servidor hace salir al CLI en ~0,3 s. El
// plazo cubre una red lenta sin dejar el dialogo colgado para siempre.
const DEFAULT_EXCHANGE_TIMEOUT_MS = 60_000;
// Cola de salida que se guarda tras el code: solo se busca en ella una frase conocida.
const MAX_TAIL_CHARS = 4_096;

// Frases del CLI que Mage reconoce tras el code (LISTA BLANCA, medida en S2 de P-026). La salida cruda
// no se loguea nunca: solo se traduce una de estas a un `reason` seguro.
//   - «Invalid code. Please make sure the full code was copied.»: validacion LOCAL de formato (el code
//     bueno es `<code>#<state>`). El CLI NO sale: vuelve a esperar otro code.
//   - «Login failed: Request failed with status code 400»: el servidor rechazo el canje; sale con 1.
const INVALID_CODE_PATTERN = /Invalid code/i;
const LOGIN_FAILED_PATTERN = /Login failed/i;

// Lo que se le devuelve al renderer al arrancar el login: la URL (por si hay que ensenarla) y como se
// abrio el navegador. `browser: 'normal'` es un AVISO, no un fallo: el login sigue siendo posible.
export interface CliLoginStart {
  readonly authorizeUrl: string;
  readonly browser: 'private' | 'normal';
}

interface Pending {
  readonly configDir: string;
  readonly process: CliLoginProcess;
  exited: boolean;
  exitCode: number | null;
  // Salida del CLI desde el ultimo code escrito (acotada a MAX_TAIL_CHARS).
  tail: string;
  // Despierta a quien espera el resultado del code; null si nadie espera.
  wake: (() => void) | null;
}

type ExchangeOutcome = 'exit' | 'invalid_code' | 'timeout';

export class CliLoginService {
  // Un login a la vez: un proceso, una ventana, un *code*. Dos a la vez confundirian al usuario sobre
  // en que cuenta esta pegando el codigo.
  private pending: Pending | null = null;

  constructor(private readonly deps: CliLoginDeps) {}

  // Arranca el login y resuelve cuando el CLI ha impreso su URL de authorize.
  async start(configDir: string, email: string | null): Promise<CliLoginStart> {
    if (configDir.trim().length === 0) throw new Error('Config dir vacio para el login');
    if (!this.deps.validateConfigDir(configDir)) throw new Error(`Cuenta no valida para login: ${configDir}`);
    if (this.pending !== null) throw new Error(`Ya hay un login en curso para ${this.pending.configDir}`);

    const child = this.deps.spawnLogin(configDir, email);
    const pending: Pending = { configDir, process: child, exited: false, exitCode: null, tail: '', wake: null };
    this.pending = pending;
    child.onOutput((chunk) => {
      pending.tail = (pending.tail + chunk).slice(-MAX_TAIL_CHARS);
      pending.wake?.();
    });
    child.onExit((code) => {
      pending.exited = true;
      pending.exitCode = code;
      pending.wake?.();
    });

    try {
      const authorizeUrl = await waitForAuthorizeUrl(child, this.deps.urlTimeoutMs ?? DEFAULT_URL_TIMEOUT_MS);
      const browser = await this.deps.openPrivate(authorizeUrl);
      if (browser === 'normal') {
        this.deps.log?.('warn', 'El login se abrio en una ventana normal: si el navegador ya tenia sesion, autorizara ESA cuenta');
      }
      return { authorizeUrl, browser };
    } catch (err) {
      this.cancel();
      throw err;
    }
  }

  // Relaya el *code* pegado por el usuario y espera a que el CLI termine el canje ANTES de verificar.
  // El fallo de la alpha (punto 1 de P-025): se verificaba en el acto y se mataba el CLI en mitad del
  // intercambio, con lo que `auth status` corria antes de que hubiera credenciales y el code, de un solo
  // uso, quedaba gastado. Nunca se mata el CLI antes de su `exit` salvo que venza el plazo.
  async submitCode(code: string): Promise<EmbeddedLoginResult> {
    const pending = this.pending;
    if (pending === null) return failure('no_login_in_progress');

    const clean = code.trim();
    // Un *code* con salto de linea partiria el relay en dos lineas y el CLI leeria basura como segunda
    // respuesta. Se rechaza en la frontera en vez de sanearlo a escondidas.
    if (clean.length === 0 || /\s/.test(clean)) return failure('bad_code_format');
    // El CLI ya murio mientras esperaba: escribir en su stdin cerrado no llegaria a nadie.
    if (pending.exited) return this.settleExit(pending);

    pending.tail = '';
    try {
      pending.process.writeLine(clean);
    } catch {
      this.cancel();
      return failure('cli_stdin_closed');
    }

    const outcome = await waitForExchange(pending, this.deps.exchangeTimeoutMs ?? DEFAULT_EXCHANGE_TIMEOUT_MS);
    // Code con formato invalido: el CLI sigue vivo esperando otro, asi que el login NO se cierra.
    if (outcome === 'invalid_code') return failure('cli_invalid_code');
    if (outcome === 'timeout') {
      this.cancel();
      return failure('cli_exchange_timeout');
    }
    return this.settleExit(pending);
  }

  // El CLI salio: se libera el login y, solo si salio bien, se le pregunta si la sesion vale.
  private async settleExit(pending: Pending): Promise<EmbeddedLoginResult> {
    if (this.pending === pending) this.pending = null;
    if (pending.exitCode !== 0) {
      return failure(LOGIN_FAILED_PATTERN.test(pending.tail) ? 'cli_login_rejected' : `cli_exit_${pending.exitCode}`);
    }
    return this.verify(pending.configDir);
  }

  // Aborta el login en curso (el usuario cerro el dialogo, o algo fallo). Idempotente.
  cancel(): void {
    const pending = this.pending;
    this.pending = null;
    if (pending === null || pending.exited) return;
    pending.process.kill();
  }

  // Verifica preguntandole al CLI, no mirando ficheros: es el unico que sabe si la sesion vale, y asi
  // Mage no tiene que interpretar el formato de `.credentials.json` para nada.
  private async verify(configDir: string): Promise<EmbeddedLoginResult> {
    const raw = await this.deps.readAuthStatus(configDir).catch(() => '');
    const status = parseAuthStatus(raw);
    if (status === null) return failure('auth_status_unreadable');
    if (!status.loggedIn) return failure('auth_status_not_logged_in');
    return { status: 'ok', email: status.email, org: status.org, reason: null };
  }
}

// --- Funciones puras (frontera: parsear lo que escupe el CLI) ----------------------------------

// URL de authorize dentro de la salida del CLI.
//
// MEDIDO: el CLI la envuelve en un hyperlink OSC-8 (`ESC ] 8 ; ; <url> BEL <texto> ESC ] 8 ; ; BEL`),
// asi que la URL sale DOS VECES seguidas. Un `indexOf('https://')` ingenuo se lleva las dos
// concatenadas y produce una URL invalida — por eso se limpian los escapes ANTES de buscar.
// Devuelve null (no lanza) si aun no ha salido: se llama en cada trozo de stdout.
export function parseAuthorizeUrl(output: string): string | null {
  const plain = output
    // eslint-disable-next-line no-control-regex -- son justo los bytes que hay que quitar
    .replace(/\]8;;[^]*(?:|\\)/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, '');
  const match = plain.match(/https:\/\/\S*\/oauth\/authorize\?\S+/);
  if (match === null) return null;
  try {
    // `new URL` valida la frontera: si el match arrastro basura, no hay URL que devolver.
    return new URL(match[0].trim()).toString();
  } catch {
    return null;
  }
}

// Estado de sesion segun el CLI. SEGURO: solo se sacan los campos que ya viajan en AccountInfo.
export interface AuthStatus {
  readonly loggedIn: boolean;
  readonly email: string | null;
  readonly org: string | null;
}

// Salida de `auth status --json`. MEDIDA el 2026-09-14 (CLI 2.1.270):
//   con sesion: {loggedIn:true, authMethod:"claude.ai", email, orgId, orgName, subscriptionType, ...}
//   sin sesion: {loggedIn:false, authMethod:"none", ...} — sin email ni orgName.
// Se busca el primer `{` porque el CLI puede escupir avisos antes del JSON. Devuelve null si no hay
// JSON utilizable: eso es "no se sabe", y el llamador lo trata como fallo explicito, nunca como "ok".
export function parseAuthStatus(raw: string): AuthStatus | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.loggedIn !== 'boolean') return null;
  return {
    loggedIn: record.loggedIn,
    email: typeof record.email === 'string' && record.email.length > 0 ? record.email : null,
    org: typeof record.orgName === 'string' && record.orgName.length > 0 ? record.orgName : null,
  };
}

// --- Interno ------------------------------------------------------------------------------------

// Espera al primero de: la salida del CLI, la frase de code invalido (el CLI sigue vivo) o el plazo.
// La salida gana si llegan a la vez: un CLI que ya salio no va a leer otro code.
function waitForExchange(pending: Pending, timeoutMs: number): Promise<ExchangeOutcome> {
  return new Promise((resolve) => {
    const finish = (outcome: ExchangeOutcome): void => {
      clearTimeout(timer);
      pending.wake = null;
      resolve(outcome);
    };
    const check = (): void => {
      if (pending.exited) finish('exit');
      else if (INVALID_CODE_PATTERN.test(pending.tail)) finish('invalid_code');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    pending.wake = check;
    check();
  });
}

// Espera a que la URL aparezca en la salida. Se acumula TODO lo que llega porque la URL puede venir
// partida entre dos trozos del stream.
function waitForAuthorizeUrl(child: CliLoginProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`El CLI no imprimio la URL de login en ${timeoutMs} ms`))),
      timeoutMs,
    );
    child.onOutput((chunk) => {
      output += chunk;
      const url = parseAuthorizeUrl(output);
      if (url !== null) finish(() => resolve(url));
    });
    // Si el proceso muere antes de imprimir la URL, no hay nada que esperar.
    child.onExit((code) => finish(() => reject(new Error(`El CLI de login termino (codigo ${code}) sin imprimir la URL`))));
  });
}

function failure(reason: string): EmbeddedLoginResult {
  return { status: 'error', email: null, org: null, reason };
}
