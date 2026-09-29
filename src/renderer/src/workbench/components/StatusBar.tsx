import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { selectAccount, useWorkbenchStore } from '../workbenchStore';
import { severityForPct, type UsageSeverity } from '../usageView';
import { UsagePopover } from './UsagePopover';
import { providerLabel } from '../accountView';
import type { Account } from '../types';
import type { StatusIndicator, StatusInfo } from '@shared/status';

// Presentacion de cada indicador de estado de Claude: color del punto + texto corto.
const STATUS_PRESENTATION: Record<StatusIndicator, { readonly color: string; readonly text: string }> = {
  none: { color: 'var(--color-mg-activity)', text: 'servicio operativo' },
  minor: { color: 'var(--mg-warn)', text: 'incidencia menor' },
  major: { color: 'var(--mg-major)', text: 'incidencia mayor' },
  critical: { color: 'var(--mg-crit)', text: 'caída del servicio' },
  maintenance: { color: 'var(--mg-info)', text: 'en mantenimiento' },
};

// Colores de severidad de uso (inline, transversales a la cuenta).
const SEVERITY_COLOR: Record<UsageSeverity, string> = {
  ok: 'var(--color-mg-idle)',
  warn: 'var(--mg-warn)',
  critical: 'var(--mg-crit)',
};

// Barra de estado inferior (26px): cuenta activa, modelo, resumen de uso (con popover) y estado del
// servicio de Claude (en vivo).
//
// Ronda 3, items 8+17: ya NO lleva los toggles "☰ chats"/"▤ panel". La visibilidad de `conversations`
// se disparaba desde TRES sitios (icono de la stripe, este toggle y el boton « de la cabecera de
// ChatSidebar) y la de `permissions` desde dos. El icono de la stripe/rail queda como UNICO control de
// visibilidad de cada panel — que ademas es el que dice DONDE esta el panel, cosa que un toggle suelto
// aqui abajo no podia hacer desde que los paneles se pueden mover de borde (F6).
export function StatusBar(): React.JSX.Element {
  const account = useWorkbenchStore((s) => selectAccount(s, s.activeAccountId));
  const status = useWorkbenchStore((s) => s.status);
  // P-028, 2: el proveedor es de la PESTAÑA enfocada (agy o el gateway corren bajo una cuenta de Claude).
  const focusedProvider = useWorkbenchStore((s) => providerLabel(s.tabs.find((t) => t.id === s.activeTabId)?.provider ?? 'claude'));

  return (
    <div className="flex h-[26px] items-center gap-[14px] border-t border-mg-border bg-mg-rail px-[12px] text-[10.5px] text-mg-ter">
      {account !== undefined && <AccountStatus account={account} provider={focusedProvider} />}
      <ServiceStatus status={status} />
      <AppVersion />
    </div>
  );
}

// Version de Mage, a la derecha del estado del servicio. Se resuelve UNA vez por proceso y se cachea
// en el modulo: es constante durante toda la vida de la app, asi que montar la barra otra vez no tiene
// por que volver a cruzar el IPC.
//
// Hasta que resuelve no pinta nada (no un hueco ni un "cargando"): son unos milisegundos, y un
// placeholder que aparece y desaparece en la barra de estado se ve como un parpadeo.
let appVersionPromise: Promise<string> | null = null;

function AppVersion(): React.JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    appVersionPromise ??= window.mage.getAppVersion();
    void appVersionPromise
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch((err: unknown) => {
        // Un fallo aqui no puede tumbar la barra: se traza y no se pinta version.
        appVersionPromise = null;
        console.warn('No se pudo leer la version de la app:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (version === null) return null;
  return (
    <span className="font-mono text-mg-muted" title={`Mage ${version}`}>
      v{version}
    </span>
  );
}

function AccountStatus({ account, provider }: { readonly account: Account; readonly provider: string }): React.JSX.Element {
  const { fiveHour, weekly } = account.usage;
  // Severidad global de la cuenta: la peor de sus ventanas (para el aviso ⚠/⛔ en la barra).
  const severity = worst(severityForPct(fiveHour.pct), severityForPct(weekly.pct));
  const refreshUsage = useWorkbenchStore((s) => s.refreshUsage);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const refreshAll = (): void => {
    for (const a of accounts) if (a.loginStatus === 'logged_in') void refreshUsage(a.id);
  };
  return (
    <>
      <span className="flex items-center gap-[6px]" style={{ color: account.accent.tint }}>
        <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: account.accent.base }} />
        {account.alias} · <span data-status-provider="true">{provider}</span> ▾
      </span>
      {/* Sin el modelo por defecto de la cuenta (P-026, D18): no era el del chat, su ▾ no abria nada y
          el modelo ya se ve —y se cambia— en el selector del input. */}

      {/* Feedback del usuario (2026-08-06): este indicador ya NO abre el panel "Uso" del dock (ese
          disparador se deja SOLO en el icono ◔ del rail izquierdo, para no tener dos sitios que hagan
          lo mismo) — en su lugar, en hover/foco muestra el mismo popover de resumen que antes vivia
          (duplicado) en el pie del sidebar. tabIndex hace el disparador enfocable para que el popover
          tambien se abra por teclado (mismo patron que ServiceStatus, mas abajo). */}
      {/* Al abrir el popover se consulta el uso de TODAS las cuentas con login (P-028, 22): solo se
          consultaba la activa y las demas enseñaban un 0 % que no era verdad. main cachea 180 s y
          tiene lockout, asi que pasar el raton varias veces no dispara peticiones de mas. */}
      <div className="group relative" onMouseEnter={refreshAll} onFocus={refreshAll}>
        <span
          tabIndex={0}
          className="cursor-default border-b border-dotted border-mg-idle"
          style={severity !== 'ok' ? { color: SEVERITY_COLOR[severity] } : undefined}
        >
          {severity !== 'ok' && <Icon name={severity === 'critical' ? 'error' : 'warning'} size={12} className="mr-[4px]" />}
          5h {fiveHour.pct}% · sem {weekly.pct}% · reset {fiveHour.label}
        </span>
        <div className="pointer-events-none absolute bottom-[calc(100%_+_8px)] left-0 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <UsagePopover />
        </div>
      </div>
    </>
  );
}

function ServiceStatus({ status }: { readonly status: StatusInfo | null }): React.JSX.Element {
  // Mientras no ha cargado, mantiene el aspecto operativo neutro (no alarma en falso).
  const presentation = STATUS_PRESENTATION[status?.indicator ?? 'none'];
  // Ronda 3, item 20: el badge era un <span> muerto. Ahora es un <button> que abre la pagina de estado
  // en el navegador (main valida que la URL sea https antes de pasarsela al SO). Un fallo al abrir se
  // avisa por consola, nunca se traga en silencio.
  const openStatusPage = (): void => {
    void window.mage
      .openExternal(CLAUDE_STATUS_PAGE_URL)
      .catch((err: unknown) => console.warn('No se pudo abrir la página de estado:', err));
  };
  return (
    <div className="group relative ml-auto">
      {/* role="status": anuncia el estado del servicio de Claude cuando cambia. Al ser un boton ya es
          enfocable, asi que el popover tambien se abre con teclado (focus-within) sin tabIndex. */}
      <button
        role="status"
        onClick={openStatusPage}
        data-tip="Abrir status.claude.com"
        aria-label={`Estado del servicio: ${presentation.text}. Abrir la página de estado`}
        className="flex cursor-pointer items-center gap-[6px] hover:text-mg-body"
      >
        <span className="h-[6px] w-[6px] rounded-full" style={{ background: presentation.color }} aria-hidden="true" />
        {presentation.text}
      </button>
      <div className="pointer-events-none absolute bottom-[calc(100%_+_8px)] right-0 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <StatusPopover status={status} />
      </div>
    </div>
  );
}

// Version para HUMANOS del endpoint que consulta statusService.ts (ese pide /api/v2/summary.json).
// Vive aqui, no en main: es un dato de presentacion, no del servicio.
const CLAUDE_STATUS_PAGE_URL = 'https://status.claude.com';

function StatusPopover({ status }: { readonly status: StatusInfo | null }): React.JSX.Element {
  const incidents = status?.incidents ?? [];
  return (
    <div className="flex w-[248px] flex-col gap-2 rounded-[9px] border border-mg-border-pop bg-mg-popover p-[11px_12px] text-[10.5px] mg-shadow-pop">
      <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">CLAUDE STATUS</div>
      <div className="text-mg-body2">{status?.description || 'Estado no disponible.'}</div>
      {incidents.length > 0 && (
        <div className="flex flex-col gap-[6px] border-t border-mg-border-subtle pt-[7px]">
          {incidents.map((incident, i) => (
            <div key={i} className="flex flex-col">
              <span className="text-mg-body">{incident.name}</span>
              <span className="text-mg-ter">
                {incident.status} · impacto {incident.impact}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Devuelve la severidad mas grave de dos (critical > warn > ok).
function worst(a: UsageSeverity, b: UsageSeverity): UsageSeverity {
  const rank: Record<UsageSeverity, number> = { ok: 0, warn: 1, critical: 2 };
  return rank[a] >= rank[b] ? a : b;
}
