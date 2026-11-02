import { t } from '../i18n/uiLanguage';

// La matriz de «Añadir cuenta» (grupo E, respuestas 3, 6 y 10): FABRICANTE × FORMA DE PAGO, con un
// adaptador por CLI. Datos PUROS: el dialogo los pinta y decide el formulario por `flow`.
//   - cli-oauth: login de Claude Code por su CLI (el de siempre).
//   - codex-login: login de ChatGPT por `codex app-server` (sin verificar).
//   - api-key: nombre + clave; la clave sube una vez y se cifra en main.
//   - agy-login: login de la suscripcion de agy en un perfil propio (URL de Google + codigo que da su web).
//   - endpoint: un servidor local o compatible con OpenAI (IP:puerto), que va por el runtime propio de Mage.

export type AccountVendor = 'anthropic' | 'openai' | 'google' | 'local';
export type AccountKindFlow = 'cli-oauth' | 'codex-login' | 'api-key' | 'agy-login' | 'endpoint';

export type AccountKindLabelKey =
  | 'accounts.kind.subscription'
  | 'accounts.kind.subscriptionChatGpt'
  | 'accounts.kind.apiKey'
  | 'accounts.kind.apiKeyGemini'
  | 'accounts.kind.localServer';

export interface AccountKindOption {
  readonly vendor: AccountVendor;
  readonly payment: 'subscription' | 'api-key' | 'endpoint';
  readonly providerId: 'claude' | 'codex' | 'agy' | null;
  readonly flow: AccountKindFlow;
  // Clave del catálogo: se traduce al pintar (la tabla se evalúa al importar, antes de saber el idioma).
  readonly labelKey: AccountKindLabelKey;
  readonly unverified: boolean;
}

export const ACCOUNT_VENDORS: readonly { readonly id: AccountVendor }[] = [{ id: 'anthropic' }, { id: 'openai' }, { id: 'google' }, { id: 'local' }];

// Las tres primeras son nombres de producto (no se traducen); la de servidor local sí.
const VENDOR_PRODUCT_LABEL: Readonly<Record<Exclude<AccountVendor, 'local'>, string>> = {
  anthropic: 'Anthropic · Claude',
  openai: 'OpenAI · Codex',
  google: 'Google · agy',
};

export function accountVendorLabel(vendor: AccountVendor): string {
  return vendor === 'local' ? t('accounts.vendor.local') : VENDOR_PRODUCT_LABEL[vendor];
}

export const ACCOUNT_KINDS: readonly AccountKindOption[] = [
  { vendor: 'anthropic', payment: 'subscription', providerId: 'claude', flow: 'cli-oauth', labelKey: 'accounts.kind.subscription', unverified: false },
  { vendor: 'anthropic', payment: 'api-key', providerId: 'claude', flow: 'api-key', labelKey: 'accounts.kind.apiKey', unverified: false },
  { vendor: 'openai', payment: 'subscription', providerId: 'codex', flow: 'codex-login', labelKey: 'accounts.kind.subscriptionChatGpt', unverified: false },
  { vendor: 'openai', payment: 'api-key', providerId: 'codex', flow: 'api-key', labelKey: 'accounts.kind.apiKey', unverified: false },
  { vendor: 'google', payment: 'subscription', providerId: 'agy', flow: 'agy-login', labelKey: 'accounts.kind.subscription', unverified: false },
  { vendor: 'google', payment: 'api-key', providerId: 'agy', flow: 'api-key', labelKey: 'accounts.kind.apiKeyGemini', unverified: false },
  { vendor: 'local', payment: 'endpoint', providerId: null, flow: 'endpoint', labelKey: 'accounts.kind.localServer', unverified: false },
];

export function accountKindsFor(vendor: AccountVendor): readonly AccountKindOption[] {
  return ACCOUNT_KINDS.filter((kind) => kind.vendor === vendor);
}

// Carpeta que se creara, para enseñarla antes de crear nada.
export function accountHomeHint(kind: AccountKindOption, name: string): string {
  const shown = name.trim().length > 0 ? name.trim() : t('accounts.homeHint.namePlaceholder');
  if (kind.providerId === 'claude') return `~/.claude-${shown}`;
  if (kind.providerId === 'codex') return `~/.codex-${shown}`;
  return t('accounts.homeHint.agyProfile', { name: shown });
}
