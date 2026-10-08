import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgyLoginStart, CodexLoginOutcome } from '@shared/accounts';

// Inicio de sesion de una cuenta de agy por suscripcion, por su propio CLI (medido en agy 1.3.1,
// `spike/agy-login-spike.mjs`): `agy --print /usage` en el perfil de la cuenta, con `SSH_CONNECTION` (agy guarda
// el token en un fichero del perfil), imprime «Authentication required … <URL>» y «Or, paste the authorization code
// here and press Enter:». Mage abre la URL en el navegador, el usuario pega aqui el codigo y Mage lo escribe en la
// entrada estandar del CLI. agy solo espera 60 s por el codigo. El token lo escribe agy en el perfil; Mage no lo lee.

export interface AgyLoginDeps {
  readonly spawnLogin: (profileDir: string) => ChildProcessWithoutNullStreams;
  readonly openUrl: (url: string) => Promise<void>;
  readonly killTree: (child: ChildProcessWithoutNullStreams) => void;
  // ¿Existe ya el fichero de token de ese perfil? Es la prueba de que el login terminó bien.
  readonly tokenExists: (profileDir: string) => boolean;
  readonly urlTimeoutMs: number;
  readonly authTimeoutMs: number; // lo que agy espera por el codigo (60 s)
  readonly pollMs: number;
  // Cuanto se espera a que agy termine solo tras aparecer el token, antes de cortarlo.
  readonly settleMs: number;
}

export type AgyLoginResult = CodexLoginOutcome;

const URL_PATTERN = /https:\/\/accounts\.google\.com\/\S+/;
// Un codigo de autorizacion de Google: una sola linea, sin espacios, de longitud razonable.
const CODE_PATTERN = /^[A-Za-z0-9._~\-/+=]{8,2048}$/;

interface Current {
  readonly child: ChildProcessWithoutNullStreams;
  readonly profileDir: string;
  readonly finish: (result: AgyLoginResult) => void;
  readonly result: Promise<AgyLoginResult>;
}

export class AgyLoginService {
  private current: Current | null = null;

  constructor(private readonly deps: AgyLoginDeps) {}

  // Paso 1: lanza el CLI y devuelve la URL (que tambien abre en el navegador). Un login a la vez.
  start(profileDir: string): Promise<AgyLoginStart> {
    this.cancel();
    const child = this.deps.spawnLogin(profileDir);
    let resolveUrl: (start: AgyLoginStart) => void = () => undefined;
    const urlPromise = new Promise<AgyLoginStart>((resolve) => { resolveUrl = resolve; });
    let finish: (result: AgyLoginResult) => void = () => undefined;
    const result = new Promise<AgyLoginResult>((resolve) => {
      let done = false;
      const authTimer: { handle: ReturnType<typeof setTimeout> | null } = { handle: null };
      finish = (outcome) => {
        if (done) return;
        done = true;
        if (authTimer.handle !== null) clearTimeout(authTimer.handle);
        if (this.current?.child === child) this.current = null;
        this.deps.killTree(child);
        resolve(outcome);
        resolveUrl({ status: 'error', reason: outcome.status === 'ok' ? 'login_finished_early' : outcome.reason });
      };
      const urlTimer = setTimeout(() => finish({ status: 'timeout', reason: 'url_timeout' }), this.deps.urlTimeoutMs);
      let buffer = '';
      const onData = (chunk: Buffer | string): void => {
        buffer += chunk.toString();
        const url = URL_PATTERN.exec(buffer)?.[0];
        if (url === undefined || done) return;
        buffer = '';
        clearTimeout(urlTimer);
        authTimer.handle = setTimeout(() => finish({ status: 'timeout', reason: 'code_timeout' }), this.deps.authTimeoutMs);
        void this.deps.openUrl(url).catch(() => undefined); // si no abre, la URL va tambien en la respuesta
        resolveUrl({ status: 'url', url, timeoutMs: this.deps.authTimeoutMs });
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', () => finish({ status: 'error', reason: 'spawn_failed' }));
      child.on('exit', () => finish(this.deps.tokenExists(profileDir) ? { status: 'ok' } : { status: 'error', reason: 'agy_exit' }));
    });
    this.current = { child, profileDir, finish, result };
    return urlPromise;
  }

  // Paso 2: el codigo que dio la web de Google. Devuelve cuando el token aparece en el perfil, o el motivo del fallo.
  async submitCode(code: string): Promise<AgyLoginResult> {
    const current = this.current;
    if (current === null) return { status: 'error', reason: 'no_login_in_progress' };
    const trimmed = code.trim();
    if (!CODE_PATTERN.test(trimmed)) return { status: 'error', reason: 'invalid_code_format' };
    current.child.stdin.write(`${trimmed}\n`);
    const appeared = await this.waitForToken(current);
    if (appeared) {
      // agy sigue unos instantes (pide su /usage): se le deja terminar antes de cortarlo, para no truncar el token.
      await Promise.race([current.result, new Promise((resolve) => setTimeout(resolve, this.deps.settleMs))]);
      current.finish({ status: 'ok' });
      return { status: 'ok' };
    }
    return current.result;
  }

  cancel(): void {
    this.current?.finish({ status: 'cancelled', reason: 'login_cancelled' });
  }

  // Sondea el fichero de token hasta que aparece o el login termina por su cuenta.
  private async waitForToken(current: Current): Promise<boolean> {
    let ended = false;
    void current.result.then(() => { ended = true; });
    const deadline = Date.now() + this.deps.authTimeoutMs;
    while (!ended && Date.now() < deadline) {
      if (this.deps.tokenExists(current.profileDir)) return true;
      await new Promise((resolve) => setTimeout(resolve, this.deps.pollMs));
    }
    return this.deps.tokenExists(current.profileDir);
  }
}
