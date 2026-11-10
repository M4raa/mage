import { useEffect, useState } from 'react';
import { useT } from '../../i18n/uiLanguage';
import { Icon } from './Icon';
import { selectAccount, useWorkbenchStore } from '../workbenchStore';
import { severityForPct, shortCountdown, type UsageSeverity } from '../usageView';
import { UsagePopover } from './UsagePopover';
import { reportActionError } from '../notificationStore';
import { providerLabel } from '../accountView';
import { conversationIdOfTab } from '../conversationId';
import { conversationSizeById } from '../sidebarModel';
import { formatSize } from '../conversationList';
import { contextPctOf } from '../contextView';
import type { Account } from '../types';
import type { StatusIndicator, StatusInfo } from '@shared/status';
import { formatMicroUsd } from '@shared/usage';
import { activeFormatLocale, formatInteger } from '../../i18n/format';

type StatusTextKey = 'app.statusBar.statusOperational' | 'app.statusBar.statusMinor' | 'app.statusBar.statusMajor' | 'app.statusBar.statusCritical' | 'app.statusBar.statusMaintenance';

// Presentacion de cada indicador de estado de Claude: color del punto + texto corto.
const STATUS_PRESENTATION: Record<StatusIndicator, { readonly color: string; readonly text: StatusTextKey }> = {
  none: { color: 'var(--color-mg-activity)', text: 'app.statusBar.statusOperational' },
  minor: { color: 'var(--mg-warn)', text: 'app.statusBar.statusMinor' },
  major: { color: 'var(--mg-major)', text: 'app.statusBar.statusMajor' },
  critical: { color: 'var(--mg-crit)', text: 'app.statusBar.statusCritical' },
  maintenance: { color: 'var(--mg-info)', text: 'app.statusBar.statusMaintenance' },
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
    <div data-status-bar="true" className="flex h-[26px] items-center gap-[14px] border-t border-mg-border bg-mg-rail px-[12px] text-[10.5px] text-mg-ter">
      {account !== undefined && <AccountStatus account={account} provider={focusedProvider} />}
      <ServiceStatus status={status} />
      <AppVersion />
      <UpdateIndicator />
    </div>
  );
}

// Actualizacion descargada (grupo B): se queda aqui mientras no se instale, para que «Más tarde» no la
// haga desaparecer. Pulsarla reabre su dialogo (con las notas), no reinicia a ciegas. A la derecha de la
// version: entre el estado del servicio y la version no se mete nada.
function UpdateIndicator(): React.JSX.Element | null {
  const t = useT();
  const state = useWorkbenchStore((s) => s.updateState);
  const openUpdatePrompt = useWorkbenchStore((s) => s.openUpdatePrompt);
  if (state.kind !== 'ready') return null;
  return (
    <button
      data-update-indicator="true"
      onClick={openUpdatePrompt}
      aria-label={t('app.statusBar.updateReadyLabel', { version: state.version })}
      className="flex cursor-pointer items-center gap-[5px] rounded-[5px] px-[6px] py-[1px] text-mg-body hover:bg-mg-hover"
    >
      <span className="h-[6px] w-[6px] rounded-full bg-mg-activity" aria-hidden="true" />
      {t('app.statusBar.updateReady', { version: state.version })}
    </button>
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
  const t = useT();
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
    <span className="font-mono text-mg-muted" title={t('app.statusBar.versionTitle', { version })}>
      {t('app.statusBar.versionShort', { version })}
    </span>
  );
}

function AccountStatus({ account, provider }: { readonly account: Account; readonly provider: string }): React.JSX.Element {
  const openAccountsUsage = useWorkbenchStore((s) => s.openAccountsUsage);
  const t = useT();
  const { fiveHour, weekly } = account.usage;
  // Peso de la conversación de la pestaña activa (sale de la fila del lateral): primitivo, así que solo repinta si cambia.
  const sizeBytes = useWorkbenchStore((s) => {
    const tab = s.tabs.find((candidate) => candidate.id === s.activeTabId);
    const id = tab === undefined ? undefined : conversationIdOfTab(tab, s.sessionIdByChat[tab.id]);
    return id === undefined ? 0 : (conversationSizeById(s.allConversationHistory).get(id) ?? 0);
  });
  const apiUsage = useWorkbenchStore((s) => s.usageByAccount[account.id]?.apiUsage);
  // Ocupación de la ventana de contexto de la pestaña activa que reporta el CLI; sin dato todavía, no se pinta.
  const contextPct = useWorkbenchStore((s) => contextPctOf(s.contextUsageByChat[s.activeTabId]));
  const refreshUsage = useWorkbenchStore((s) => s.refreshUsage);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const refreshAll = (): void => {
    for (const a of accounts) if (a.loginStatus === 'logged_in') void refreshUsage(a.id);
  };
  return (
    <>
      <span className="flex items-center gap-[6px]" style={{ color: account.accent.tint }}>
        <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: account.accent.base }} />
        <span data-status-provider="true">{provider}</span> · {account.alias} ▾
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
      <div className="group relative flex items-center" onMouseEnter={refreshAll} onFocus={refreshAll}>
        {/* data-volatile-text: uso y estado del servicio REALES de la cuenta; verify:gui --dump-dom-text no los vuelca */}
        {/* P-038 V11: pulsarlo abre «Cuentas y consumo» (el hover sigue con el popover rápido). */}
        <span
          data-volatile-text="true"
          data-usage-summary="true"
          tabIndex={0}
          role="button"
          data-tip={t('accountsUsage.openAria')}
          onClick={openAccountsUsage}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccountsUsage(); } }}
          aria-label={account.apiBilled ? undefined : t('app.statusBar.windows', { fiveHour: fiveHour.pct, weekly: weekly.pct, reset: fiveHour.label })}
          className="inline-flex cursor-pointer items-center gap-[10px] hover:text-mg-body"
        >
          {account.apiBilled ? (apiUsage === undefined ? t('app.statusBar.apiNoTurns')
            : t('app.statusBar.apiUsage', { tokens: formatInteger(apiUsage.totals.totalTokens), cost: formatMicroUsd(apiUsage.totals.costMicroUsd, activeFormatLocale()) }))
            : (
              <>
                <UsageMeter name="5h" window={fiveHour} />
                <UsageMeter name="7d" window={weekly} />
              </>
            )}
        </span>
        {/* `pb-[8px]` y no un `bottom` desplazado: el hueco entre el resumen y el popover es parte de la zona de hover, y
            el ratón puede entrar a desplazar la lista (P-038: con muchas cuentas se cortaba y no se llegaba a ella). */}
        <div className="pointer-events-none absolute bottom-full left-0 pb-[8px] opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <UsagePopover />
        </div>
      </div>
      {sizeBytes > 0 && (
        <span data-status-size="true" data-volatile-text="true" title={t('sidebar.history.sizeOnDisk', { bytes: formatInteger(sizeBytes) })} className="-ml-[8px]">
          <span aria-hidden="true">· </span>{formatSize(sizeBytes)}
        </span>
      )}
      {contextPct !== null && (
        <span data-status-context={contextPct} data-tip={t('tabs.subline.contextTip')} className="-ml-[8px] cursor-help tabular-nums">
          <span aria-hidden="true">· </span>{t('tabs.subline.context', { pct: contextPct })}
        </span>
      )}
    </>
  );
}

// Una ventana de uso en pequeño (P-038): nombre, barra, % y lo que falta para el reset. La barra toma el color de su
// severidad; el texto completo va en el nombre accesible del resumen.
function UsageMeter({ name, window }: { readonly name: string; readonly window: { readonly pct: number; readonly label: string } }): React.JSX.Element {
  const severity = severityForPct(window.pct);
  const color = severity === 'ok' ? undefined : SEVERITY_COLOR[severity];
  return (
    <span data-usage-meter={name} data-usage-severity={severity} aria-hidden="true" className="inline-flex items-center gap-[5px] tabular-nums" style={color === undefined ? undefined : { color }}>
      {severity !== 'ok' && <Icon name={severity === 'critical' ? 'error' : 'warning'} size={12} />}
      <span className={color === undefined ? 'text-mg-muted' : ''}>{name}</span>
      <span className="relative h-[4px] w-[36px] overflow-hidden rounded-full bg-mg-track">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${window.pct}%`, background: color ?? 'var(--color-mg-sec)' }} />
      </span>
      <span>{window.pct}%</span>
      <span className="text-mg-muted">{shortCountdown(window.label)}</span>
    </span>
  );
}

function ServiceStatus({ status }: { readonly status: StatusInfo | null }): React.JSX.Element {
  const t = useT();
  // Mientras no ha cargado, mantiene el aspecto operativo neutro (no alarma en falso).
  const presentation = STATUS_PRESENTATION[status?.indicator ?? 'none'];
  // Ronda 3, item 20: el badge era un <span> muerto. Ahora es un <button> que abre la pagina de estado
  // en el navegador (main valida que la URL sea https antes de pasarsela al SO). Un fallo al abrir se
  // avisa con un error visible (y en el log), nunca se traga en silencio.
  const openStatusPage = (): void => {
    void window.mage
      .openExternal(CLAUDE_STATUS_PAGE_URL)
      .catch((err: unknown) => reportActionError(t('app.statusBar.openStatusError'), err, 'status'));
  };
  return (
    <div className="group relative ml-auto" data-volatile-text="true">
      {/* role="status": anuncia el estado del servicio de Claude cuando cambia. Al ser un boton ya es
          enfocable, asi que el popover tambien se abre con teclado (focus-within) sin tabIndex. */}
      <button
        role="status"
        onClick={openStatusPage}
        data-tip={t('app.statusBar.openStatusTip')}
        aria-label={t('app.statusBar.serviceLabel', { status: t(presentation.text) })}
        className="flex cursor-pointer items-center gap-[6px] hover:text-mg-body"
      >
        <span className="h-[6px] w-[6px] rounded-full" style={{ background: presentation.color }} aria-hidden="true" />
        {t(presentation.text)}
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
  const t = useT();
  const incidents = status?.incidents ?? [];
  return (
    <div className="flex w-[248px] flex-col gap-2 rounded-[9px] border border-mg-border-pop bg-mg-popover p-[11px_12px] text-[10.5px] mg-shadow-pop">
      <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">{t('app.statusBar.popoverTitle')}</div>
      <div className="text-mg-body2">{status?.description || t('app.statusBar.statusUnavailable')}</div>
      {incidents.length > 0 && (
        <div className="flex flex-col gap-[6px] border-t border-mg-border-subtle pt-[7px]">
          {incidents.map((incident, i) => (
            <div key={i} className="flex flex-col">
              <span className="text-mg-body">{incident.name}</span>
              <span className="text-mg-ter">
                {t('app.statusBar.incidentImpact', { status: incident.status, impact: incident.impact })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

