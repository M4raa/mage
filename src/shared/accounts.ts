// Tipo de dominio de una cuenta de Claude Code descubierta en disco (un CLAUDE_CONFIG_DIR).
// Es SEGURO por diseno: NUNCA incluye el token, el `oauthAccount` completo, `userID` ni `machineID`
// (invariante de seguridad). Es lo unico que cruza el IPC main->renderer sobre cuentas.

// Estado de login de una cuenta: sin credenciales, con credenciales expiradas, o con login valido.
export type LoginStatus = 'logged_in' | 'expired' | 'logged_out';

export interface AccountInfo {
  readonly configDir: string; // CLAUDE_CONFIG_DIR absoluto
  readonly name: string; // basename del dir (p.ej. ".claude-p")
  readonly isMain: boolean; // true si es ~/.claude (cuenta principal)
  readonly email: string | null; // oauthAccount.emailAddress (o null)
  readonly org: string | null; // oauthAccount.organizationName (o null)
  readonly loginStatus: LoginStatus;
  readonly expiresAt: number | null; // epoch ms de caducidad del token; null si no hay login
  readonly defaultModel: string | null; // settings.json -> model (o null)
}

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
