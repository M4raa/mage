import type { AccountInfo } from '@shared/accounts';
import { ACCOUNT_ACCENT_COUNT } from '@shared/settings';
import { CUSTOM_PROVIDER_ID_PREFIX } from '@shared/providers';
import type { Accent, Account, UsageWindow } from './types';

// Nº de acentos disponibles. Los VALORES viven en index.css como variables (--mg-accent-<i>-*), asi el
// acento conmuta con el tema (claro/oscuro) sin recolorear en JS. Por defecto va por posicion en el
// descubrimiento; desde PERS-3 el usuario puede fijar el de cada cuenta (`accentByAccount`).
const ACCENT_COUNT = ACCOUNT_ACCENT_COUNT;

// Uso en placeholder hasta M1.3 (UsageService + /api/oauth/usage). Mantiene la forma que consumen
// StatusBar/UsagePopover/UsagePanel sin datos reales todavia.
const PLACEHOLDER_WINDOW: UsageWindow = { pct: 0, label: '—' };
const USAGE_PLACEHOLDER = { fiveHour: PLACEHOLDER_WINDOW, weekly: PLACEHOLDER_WINDOW } as const;
// Modelo por defecto conceptual de la app cuando la cuenta no fija uno en su settings.json.
const DEFAULT_MODEL = 'sonnet';

// Nombre del CLI de cada cuenta (el rail y la cabecera del sidebar).
const ACCOUNT_PROVIDER_LABEL: Readonly<Record<string, string>> = { claude: 'Claude', codex: 'Codex', agy: 'agy' };

// Texto FIJO de la marca de las cuentas que facturan la API (texto, no solo color).
export const API_BILLED_LABEL = 'Factura API';

// Mapea una cuenta de dominio (AccountInfo, segura) a la cuenta de PRESENTACION que consume la UI.
export function toAccountView(info: AccountInfo, index: number, accentOverride?: number): Account {
  const alias = info.name.replace(/^\.+/, ''); // ".claude-p" -> "claude-p"
  return {
    id: info.configDir,
    monogram: deriveMonogram(info.email, alias),
    alias,
    provider: ACCOUNT_PROVIDER_LABEL[info.providerId] ?? info.providerId,
    providerId: info.providerId,
    apiBilled: info.authKind === 'api-key',
    defaultModel: info.defaultModel ?? DEFAULT_MODEL,
    accent: accentForIndex(accentOverride ?? index),
    activity: 'idle',
    usage: USAGE_PLACEHOLDER,
    email: info.email,
    loginStatus: info.loginStatus,
    isMain: info.isMain,
  };
}

// Reaplica los colores elegidos por el usuario (PERS-3) sobre cuentas ya construidas. `accounts` va en
// orden de descubrimiento, asi que la posicion es el indice del array (el color por defecto de siempre).
export function applyAccentOverrides(accounts: readonly Account[], overrides: Readonly<Record<string, number>>): Account[] {
  return accounts.map((account, index) => ({ ...account, accent: accentForIndex(overrides[account.id] ?? index) }));
}

// Marca corta del proveedor de una PESTAÑA (P-028, punto 2): null para Claude (lo normal, no se marca);
// si no, el id sin el prefijo de los proveedores del usuario («agy», «openai», «ollama»...), recortado
// para que quepa en la pestaña.
const PROVIDER_BADGE_MAX = 8;

export function providerBadge(providerId: string): string | null {
  if (providerId === 'claude' || providerId.length === 0) return null;
  const bare = providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX) ? providerId.slice(CUSTOM_PROVIDER_ID_PREFIX.length) : providerId;
  return bare.slice(0, PROVIDER_BADGE_MAX);
}

// Nombre del proveedor en la barra de estado: el de la pestaña enfocada, no el de la cuenta (una
// pestaña de agy o del gateway corre bajo una cuenta de Claude y decia «Claude»).
export function providerLabel(providerId: string): string {
  return providerBadge(providerId) ?? 'Claude';
}

// Devuelve el acento del indice como referencias a variables CSS (var(--mg-accent-<i>-*)); el tema
// activo (data-theme) decide el valor real. Se aplican inline en style -> var() funciona igual.
function accentForIndex(index: number): Accent {
  const i = ((index % ACCENT_COUNT) + ACCENT_COUNT) % ACCENT_COUNT; // tolera indices negativos
  return {
    base: `var(--mg-accent-${i}-base)`,
    tint: `var(--mg-accent-${i}-tint)`,
    bgActive: `var(--mg-accent-${i}-bg-active)`,
    borderInactive: `var(--mg-accent-${i}-border-inactive)`,
  };
}

// Monograma del avatar: primera letra/numero del email; si no hay, del alias; si no, "?".
function deriveMonogram(email: string | null, alias: string): string {
  const source = (email ?? alias).trim();
  const match = source.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : '?';
}
