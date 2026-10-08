// La matriz de «Añadir cuenta» (grupo E, respuestas 3, 6 y 10): FABRICANTE × FORMA DE PAGO, con un
// adaptador por CLI. Datos PUROS: el dialogo los pinta y decide el formulario por `flow`.
//   - cli-oauth: login de Claude Code por su CLI (el de siempre).
//   - codex-login: login de ChatGPT por `codex app-server` (sin verificar).
//   - api-key: nombre + clave; la clave sube una vez y se cifra en main.
//   - agy-login: login de la suscripcion de agy en un perfil propio (URL de Google + codigo que da su web).
//   - endpoint: un servidor local o compatible con OpenAI (IP:puerto), que va por el runtime propio de Mage.

export type AccountVendor = 'anthropic' | 'openai' | 'google' | 'local';
export type AccountKindFlow = 'cli-oauth' | 'codex-login' | 'api-key' | 'agy-login' | 'endpoint';

export interface AccountKindOption {
  readonly vendor: AccountVendor;
  readonly payment: 'subscription' | 'api-key' | 'endpoint';
  readonly providerId: 'claude' | 'codex' | 'agy' | null;
  readonly flow: AccountKindFlow;
  readonly label: string;
  readonly unverified: boolean;
}

export const ACCOUNT_VENDORS: readonly { readonly id: AccountVendor; readonly label: string }[] = [
  { id: 'anthropic', label: 'Anthropic · Claude' },
  { id: 'openai', label: 'OpenAI · Codex' },
  { id: 'google', label: 'Google · agy' },
  { id: 'local', label: 'Local · IP:puerto' },
];

export const ACCOUNT_KINDS: readonly AccountKindOption[] = [
  { vendor: 'anthropic', payment: 'subscription', providerId: 'claude', flow: 'cli-oauth', label: 'Suscripción', unverified: false },
  { vendor: 'anthropic', payment: 'api-key', providerId: 'claude', flow: 'api-key', label: 'Clave de API', unverified: false },
  { vendor: 'openai', payment: 'subscription', providerId: 'codex', flow: 'codex-login', label: 'Suscripción (ChatGPT)', unverified: false },
  { vendor: 'openai', payment: 'api-key', providerId: 'codex', flow: 'api-key', label: 'Clave de API', unverified: false },
  { vendor: 'google', payment: 'subscription', providerId: 'agy', flow: 'agy-login', label: 'Suscripción', unverified: false },
  { vendor: 'google', payment: 'api-key', providerId: 'agy', flow: 'api-key', label: 'Clave de API (Gemini)', unverified: false },
  { vendor: 'local', payment: 'endpoint', providerId: null, flow: 'endpoint', label: 'Servidor local', unverified: false },
];

export function accountKindsFor(vendor: AccountVendor): readonly AccountKindOption[] {
  return ACCOUNT_KINDS.filter((kind) => kind.vendor === vendor);
}

// Carpeta que se creara, para enseñarla antes de crear nada.
export function accountHomeHint(kind: AccountKindOption, name: string): string {
  const shown = name.trim().length > 0 ? name.trim() : '<nombre>';
  if (kind.providerId === 'claude') return `~/.claude-${shown}`;
  if (kind.providerId === 'codex') return `~/.codex-${shown}`;
  return `perfil de Mage «agy-${shown}»`;
}
