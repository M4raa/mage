import type { AccountInfo } from '@shared/accounts';
import type { Accent, Account, UsageWindow } from './types';

// Nº de acentos disponibles. Los VALORES viven en index.css como variables (--mg-accent-<i>-*), asi el
// acento conmuta con el tema (claro/oscuro) sin recolorear en JS. La asignacion por indice es estable:
// una cuenta mantiene su acento mientras no cambie su posicion en el descubrimiento.
const ACCENT_COUNT = 6;

// Uso en placeholder hasta M1.3 (UsageService + /api/oauth/usage). Mantiene la forma que consumen
// StatusBar/UsagePopover/UsagePanel sin datos reales todavia.
const PLACEHOLDER_WINDOW: UsageWindow = { pct: 0, label: '—' };
const USAGE_PLACEHOLDER = { fiveHour: PLACEHOLDER_WINDOW, weekly: PLACEHOLDER_WINDOW } as const;
// Modelo por defecto conceptual de la app cuando la cuenta no fija uno en su settings.json.
const DEFAULT_MODEL = 'sonnet';

// Mapea una cuenta de dominio (AccountInfo, segura) a la cuenta de PRESENTACION que consume la UI.
export function toAccountView(info: AccountInfo, index: number): Account {
  const alias = info.name.replace(/^\.+/, ''); // ".claude-p" -> "claude-p"
  return {
    id: info.configDir,
    monogram: deriveMonogram(info.email, alias),
    alias,
    provider: 'Claude',
    defaultModel: info.defaultModel ?? DEFAULT_MODEL,
    accent: accentForIndex(index),
    activity: 'idle',
    usage: USAGE_PLACEHOLDER,
    email: info.email,
    loginStatus: info.loginStatus,
    isMain: info.isMain,
  };
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
