import type { AccountInfo } from '@shared/accounts';
import { ACCOUNT_ACCENT_COUNT } from '@shared/settings';
import { CUSTOM_PROVIDER_ID_PREFIX } from '@shared/providers';
import type { Accent, Account, UsageWindow } from './types';
import { t } from '../i18n/uiLanguage';

// Nº de acentos disponibles. Los VALORES viven en index.css como variables (--mg-accent-<i>-*), asi el
// acento conmuta con el tema (claro/oscuro) sin recolorear en JS. Por defecto sale del identificador de la
// cuenta (#46: por posicion cambiaba al añadir otra); desde PERS-3 el usuario puede fijar el suyo (`accentByAccount`).
const ACCENT_COUNT = ACCOUNT_ACCENT_COUNT;

// Uso en placeholder hasta M1.3 (UsageService + /api/oauth/usage). Mantiene la forma que consumen
// StatusBar/UsagePopover/UsagePanel sin datos reales todavia.
const PLACEHOLDER_WINDOW: UsageWindow = { pct: 0, label: '—' };
const USAGE_PLACEHOLDER = { fiveHour: PLACEHOLDER_WINDOW, weekly: PLACEHOLDER_WINDOW } as const;
// Modelo por defecto conceptual de la app cuando la cuenta no fija uno en su settings.json.
const DEFAULT_MODEL = 'sonnet';

// Nombre del CLI de cada cuenta (el rail y la cabecera del sidebar).
const ACCOUNT_PROVIDER_LABEL: Readonly<Record<string, string>> = { claude: 'Claude', codex: 'Codex', agy: 'agy' };

// Texto FIJO de la marca de las cuentas que facturan la API (texto, no solo color). Función y no constante: se
// traduce al pintar, en el idioma activo.
export function apiBilledLabel(): string {
  return t('accounts.apiBilled.badge');
}

// Nombre de una cuenta que ya no está, sacado de su config dir: lo mismo que su alias cuando existía (el nombre de la
// carpeta sin los puntos del principio). Nunca la ruta entera, que lleva el usuario del equipo.
export function aliasFromConfigDir(configDir: string): string {
  const last = configDir.split(/[\\/]/).filter((part) => part.length > 0).at(-1) ?? '';
  return aliasFromName(last);
}

// Alias de una cuenta a partir del nombre de su carpeta (P-038): sin los puntos del principio y sin el prefijo del
// proveedor, que ya se ve al lado («.claude-p» → «p»). La principal no tiene más nombre que el prefijo y se queda así.
export function aliasFromName(name: string): string {
  const plain = name.replace(/^\.+/, '');
  const bare = plain.replace(PROVIDER_NAME_PREFIX, '').trim();
  return bare.length > 0 ? bare : plain;
}

// Mapea una cuenta de dominio (AccountInfo, segura) a la cuenta de PRESENTACION que consume la UI.
export function toAccountView(info: AccountInfo, accentOverride?: number, aliasOverride?: string): Account {
  const alias = aliasFromName(info.name);
  return {
    id: info.configDir,
    monogram: deriveMonogram(info.email, alias),
    alias: aliasOverride ?? alias,
    baseAlias: alias,
    provider: ACCOUNT_PROVIDER_LABEL[info.providerId] ?? info.providerId,
    providerId: info.providerId,
    apiBilled: info.authKind === 'api-key',
    defaultModel: info.defaultModel ?? DEFAULT_MODEL,
    accent: accentForIndex(accentOverride ?? stableAccent(info.configDir)),
    activity: 'idle',
    usage: USAGE_PLACEHOLDER,
    email: info.email,
    loginStatus: info.loginStatus,
    isMain: info.isMain,
  };
}

// Color y nombre elegidos a mano (PERS-3 y P-038 V16) sobre cuentas ya construidas; sin elección, los de siempre.
export function applyAccountOverrides(
  accounts: readonly Account[],
  overrides: { readonly accentByAccount: Readonly<Record<string, number>>; readonly aliasByAccount: Readonly<Record<string, string>> },
): Account[] {
  return applyAccentOverrides(accounts, overrides.accentByAccount).map((account) => ({ ...account, alias: overrides.aliasByAccount[account.id] ?? account.baseAlias ?? account.alias }));
}

// Las que se enseñan en la barra de cuentas, el selector y el popover de uso (P-038 V16): todas menos las ocultas, y la
// activa siempre (ocultarla dejaría la ventana sin cuenta a la vista).
export function visibleAccounts(accounts: readonly Account[], hidden: readonly string[], activeAccountId: string): readonly Account[] {
  if (hidden.length === 0) return accounts;
  const hiddenSet = new Set(hidden);
  return accounts.filter((account) => account.id === activeAccountId || !hiddenSet.has(account.id));
}

// Reaplica los colores elegidos por el usuario (PERS-3) sobre cuentas ya construidas; sin eleccion, el estable.
export function applyAccentOverrides(accounts: readonly Account[], overrides: Readonly<Record<string, number>>): Account[] {
  return accounts.map((account) => ({ ...account, accent: accentForIndex(overrides[account.id] ?? stableAccent(account.id)) }));
}

// Marca corta del proveedor de una PESTAÑA: el id sin el prefijo de los proveedores del usuario («claude»,
// «agy», «openai», «ollama»...), recortado para que quepa en la pestaña. Claude TAMBIÉN se marca (decisión del
// usuario, 2026-10-08): con tres proveedores de primera clase, marcar solo a los demás era una asimetría. Antes
// (P-028, punto 2) era null para Claude por ser «lo normal».
const PROVIDER_BADGE_MAX = 8;

export function providerBadge(providerId: string): string | null {
  if (providerId.length === 0) return null;
  const bare = providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX) ? providerId.slice(CUSTOM_PROVIDER_ID_PREFIX.length) : providerId;
  return bare.slice(0, PROVIDER_BADGE_MAX);
}

// Nombre del proveedor en la barra de estado: el de la pestaña enfocada, no el de la cuenta (una
// pestaña de agy o del gateway corre bajo una cuenta de Claude y decia «Claude»).
export function providerLabel(providerId: string): string {
  return providerId === 'claude' || providerId.length === 0 ? 'Claude' : (providerBadge(providerId) ?? 'Claude');
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

// Monograma del avatar (#46): primera letra/numero del nombre SIN el prefijo del proveedor («claude-work»
// -> «W»; antes todas las de Claude decian «C»). La cuenta principal no tiene mas nombre que el prefijo:
// entonces el email y, si no hay, el propio prefijo.
const PROVIDER_NAME_PREFIX = /^(?:claude|codex|agy)(?:[-_ .]+|$)/i;

function deriveMonogram(email: string | null, alias: string): string {
  const bare = alias.replace(PROVIDER_NAME_PREFIX, '').trim();
  const source = bare.length > 0 ? bare : (email ?? alias);
  const match = source.match(/[\p{L}\p{N}]/u);
  return match === null ? '?' : match[0].toUpperCase();
}

// Acento por defecto estable (#46): hash del identificador de la cuenta (su config dir), no su posicion.
const HASH_MULTIPLIER = 31;

function stableAccent(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, HASH_MULTIPLIER) + id.charCodeAt(i)) >>> 0;
  return hash % ACCENT_COUNT;
}

// #46/H3: acento de las cuentas que aún no tienen uno guardado: el MENOS usado entre los ya asignados
// (empates, el índice más bajo), en orden de descubrimiento. Las guardadas (elegidas a mano o asignadas
// antes) no se tocan, así que añadir una cuenta no cambia el color de las demás, y mientras haya colores
// libres no se repiten. Devuelve la MISMA referencia si no falta ninguna (no hay nada que persistir).
export function assignMissingAccents(accountIds: readonly string[], saved: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  const missing = accountIds.filter((id) => saved[id] === undefined);
  if (missing.length === 0) return saved;
  const uses = Array.from({ length: ACCENT_COUNT }, () => 0);
  for (const id of accountIds) {
    const accent = saved[id];
    if (accent !== undefined) uses[accent] = (uses[accent] ?? 0) + 1;
  }
  const next: Record<string, number> = { ...saved };
  for (const id of missing) {
    const least = uses.indexOf(Math.min(...uses));
    next[id] = least;
    uses[least] = (uses[least] ?? 0) + 1;
  }
  return next;
}
