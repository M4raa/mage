// Tipo de dominio de una cuenta de Claude Code descubierta en disco (un CLAUDE_CONFIG_DIR).
// Es SEGURO por diseno: NUNCA incluye el token, el `oauthAccount` completo, `userID` ni `machineID`
// (invariante de seguridad). Es lo unico que cruza el IPC main->renderer sobre cuentas.

// Estado de login de una cuenta: sin credenciales, con credenciales expiradas, o con login valido.
export type LoginStatus = 'logged_in' | 'expired' | 'logged_out';

// Forma de pago de una cuenta (grupo E): la suscripcion del fabricante (login de su CLI) o una clave de
// API, que Mage guarda cifrada en su boveda y solo pone en el hijo de ESA cuenta.
export type AccountAuthKind = 'subscription' | 'api-key';

// Proveedores con cuentas propias (cada uno con su CLI). El de Claude es el de siempre.
export type AccountProviderId = 'claude' | 'codex' | 'agy';

export interface AccountInfo {
  // Donde vive el estado de la cuenta: CLAUDE_CONFIG_DIR (claude), CODEX_HOME (codex) o el perfil
  // (USERPROFILE) de una cuenta de agy por clave. Es tambien su id: el de la pestaña (`accountId`).
  readonly configDir: string;
  readonly name: string; // basename del dir (p.ej. ".claude-p")
  readonly isMain: boolean; // true si es ~/.claude (cuenta principal)
  readonly providerId: AccountProviderId;
  readonly authKind: AccountAuthKind;
  readonly email: string | null; // oauthAccount.emailAddress (o null)
  readonly org: string | null; // oauthAccount.organizationName (o null)
  readonly loginStatus: LoginStatus;
  readonly expiresAt: number | null; // epoch ms de caducidad del token; null si no hay login
  readonly defaultModel: string | null; // settings.json -> model (o null)
}

// Alta de una cuenta que no es la suscripcion de Claude (grupo E, «Añadir cuenta» para la matriz). La
// clave (solo en las de API) sube UNA vez, en este mensaje, y nunca vuelve al renderer.
export interface AccountCreateParams {
  readonly providerId: AccountProviderId;
  readonly authKind: AccountAuthKind;
  readonly name: string;
  readonly apiKey?: string;
}

// Login de una cuenta de agy por suscripcion (dos pasos, medido en agy 1.3.1): 1) Mage lanza agy en el perfil de la
// cuenta, que imprime una URL de Google; 2) el usuario la abre, inicia sesion y pega aqui el codigo que le da la web.
// agy espera 60 s en total por el codigo (fijo, `--print-timeout` no lo cambia).
export type AgyLoginStart =
  | { readonly status: 'url'; readonly url: string; readonly timeoutMs: number }
  | { readonly status: 'error'; readonly reason: string };

// Resultado del login de ChatGPT de una cuenta de Codex (sin verificar). `reason` con forma
// `<fase>_<detalle>`, nunca con tokens.
export type CodexLoginOutcome =
  | { readonly status: 'ok' }
  | { readonly status: 'cancelled' | 'timeout' | 'error'; readonly reason: string };

// Resultado del login. El nombre conserva el "Embedded" del login OAuth propio de M3 (ventana propia
// + servidor local de callback), que ya NO existe: hoy lo produce `cliLoginService`, spawneando el CLI
// del proveedor. Es un discriminado y SEGURO por diseno: NUNCA lleva tokens (solo email/org de la
// cuenta autenticada, que ya viajan en AccountInfo). Cada estado no-ok puede traer un `reason` de
// diagnostico con el formato `<fase>_<detalle>` (p.ej. "auth_status_not_logged_in"): describe la fase
// que fallo sin filtrar credenciales.
export type EmbeddedLoginStatus = 'ok' | 'cancelled' | 'timeout' | 'error';

// Arranque del login por CLI (Fase 9.2). `browser: 'normal'` NO es un fallo: significa que no habia
// ningun navegador con bandera de ventana privada y se abrio el por defecto. Importa porque en un
// navegador con sesion ya iniciada, autorizar da de alta la cuenta EQUIVOCADA sin avisar.
export interface CliLoginStart {
  readonly authorizeUrl: string;
  readonly browser: 'private' | 'normal';
}

export interface EmbeddedLoginResult {
  readonly status: EmbeddedLoginStatus;
  readonly email: string | null; // solo en 'ok'; null en el resto
  readonly org: string | null; // solo en 'ok'; null en el resto
  readonly reason: string | null; // diagnostico `<fase>_<detalle>` en no-ok; null en 'ok'
}
