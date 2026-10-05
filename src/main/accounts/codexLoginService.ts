import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { CodexLoginOutcome } from '@shared/accounts';

// Inicio de sesion de una cuenta de Codex (suscripcion de ChatGPT) por su propio CLI: Mage lanza
// `codex app-server` con el CODEX_HOME de la cuenta, pide `account/login/start {type:"chatgpt"}`, abre
// la `authUrl` en el navegador y espera `account/login/completed`. El token lo escribe codex en su
// `auth.json`; Mage nunca lo ve.
//
// Login oficial completado con codex-cli 0.160.0 en CODEX_HOME temporal: authUrl de auth.openai.com,
// account/login/completed success=true y account/read tipo chatgpt. Mage no lee auth.json.

export interface CodexLoginDeps {
  readonly spawnAppServer: (codexHome: string) => ChildProcessWithoutNullStreams;
  readonly openUrl: (url: string) => Promise<void>;
  readonly killTree: (child: ChildProcessWithoutNullStreams) => void;
  readonly timeoutMs: number;
}

export type CodexLoginResult = CodexLoginOutcome;

const INITIALIZE_ID = 1;
const LOGIN_ID = 2;

export class CodexLoginService {
  private current: { readonly child: ChildProcessWithoutNullStreams; readonly finish: (result: CodexLoginResult) => void } | null = null;

  constructor(private readonly deps: CodexLoginDeps) {}

  // Un login a la vez: empezar otro cancela el anterior (su CLI se quedaria esperando el navegador).
  login(codexHome: string): Promise<CodexLoginResult> {
    this.cancel();
    const child = this.deps.spawnAppServer(codexHome);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish({ status: 'timeout', reason: 'login_timeout' }), this.deps.timeoutMs);
      let done = false;
      const finish = (result: CodexLoginResult): void => {
        if (done) return; // matar el proceso dispara su `exit`: solo cuenta el primer final
        done = true;
        clearTimeout(timer);
        if (this.current?.child === child) this.current = null;
        this.deps.killTree(child);
        resolve(result);
      };
      this.current = { child, finish };
      this.wire(child, finish);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: INITIALIZE_ID, method: 'initialize', params: { clientInfo: { name: 'mage', version: '0.1.2' } } })}\n`);
    });
  }

  cancel(): void {
    this.current?.finish({ status: 'cancelled', reason: 'login_cancelled' });
  }

  private wire(child: ChildProcessWithoutNullStreams, finish: (result: CodexLoginResult) => void): void {
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) this.onLine(child, line, finish);
      }
    });
    child.on('error', () => finish({ status: 'error', reason: 'spawn_failed' }));
    child.on('exit', (code) => finish({ status: 'error', reason: `app_server_exit_${String(code)}` }));
  }

  private onLine(child: ChildProcessWithoutNullStreams, line: string, finish: (result: CodexLoginResult) => void): void {
    let message: { id?: unknown; method?: unknown; result?: unknown; error?: { code?: unknown }; params?: { success?: unknown; error?: unknown } };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return; // una linea que no es JSON (aviso del CLI) no es una respuesta: se sigue esperando
    }
    if (message.error !== undefined) {
      const code = typeof message.error.code === 'number' ? String(message.error.code) : 'unknown';
      finish({ status: 'error', reason: `rpc_${code}` });
      return;
    }
    if (message.id === INITIALIZE_ID) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: LOGIN_ID, method: 'account/login/start', params: { type: 'chatgpt' } })}\n`);
      return;
    }
    if (message.id === LOGIN_ID) {
      const url = (message.result as { authUrl?: unknown } | undefined)?.authUrl;
      if (typeof url !== 'string') finish({ status: 'error', reason: 'login_without_auth_url' });
      else if (!isOfficialLoginUrl(url)) finish({ status: 'error', reason: 'login_invalid_auth_url' });
      else void this.deps.openUrl(url).catch(() => finish({ status: 'error', reason: 'open_url_failed' }));
      return;
    }
    if (message.method === 'account/login/completed') {
      const ok = message.params?.success === true;
      finish(ok ? { status: 'ok' } : { status: 'error', reason: 'login_failed' });
    }
  }
}

function isOfficialLoginUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && url.hostname === 'auth.openai.com' && url.username === '' && url.password === '';
}
