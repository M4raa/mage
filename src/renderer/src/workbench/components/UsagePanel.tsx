import { useEffect } from 'react';
import { Icon } from './Icon';
import { selectAccount, useWorkbenchStore } from '../workbenchStore';
import {
  FIVE_HOUR_WINDOW_MS,
  SEVEN_DAY_WINDOW_MS,
  formatApiCredits,
  formatProjection,
  perModelBars,
  projectWindowExhaustion,
  severityForPct,
  toUsageWindows,
  type UsageProjection,
  type UsageSeverity,
} from '../usageView';
import type { UsageInfo } from '@shared/usage';
import type { Account } from '../types';

// Colores de severidad (inline: el sistema de diseno mantiene lo cromatico fuera del CSS). El estado
// "ok" usa el acento de la cuenta; aviso ambar y critico rojo son transversales a la cuenta.
const WARN_COLOR = 'var(--mg-warn)';
const CRIT_COLOR = 'var(--mg-crit)';

// Panel "Uso" del dock izquierdo (F6): dashboard de consumo de la cuenta activa (5h/semanal/por-modelo,
// creditos de API y cuenta atras). Datos reales via UsageService (cacheados en main >=180 s).
export function UsagePanel(): React.JSX.Element {
  const account = useWorkbenchStore((s) => selectAccount(s, s.activeAccountId));
  const usage = useWorkbenchStore((s) => (account ? (s.usageByAccount[account.id] ?? null) : null));
  const error = useWorkbenchStore((s) => (account ? (s.usageErrorByAccount[account.id] ?? null) : null));
  const refreshUsage = useWorkbenchStore((s) => s.refreshUsage);
  const accountId = account?.id;

  // Al ABRIR el panel (montaje: la zona estaba cerrada o mostraba otro panel), refresca de una vez —
  // igual que hacia antes el ◔ del rail al abrir el popover flotante. El polling global (App.tsx) ya
  // cubre el resto (>=180 s); esto solo evita una lectura obviamente caducada justo al entrar aqui.
  useEffect(() => {
    if (accountId !== undefined) void refreshUsage(accountId);
    // Solo al montar/cambiar de cuenta — refreshUsage es estable (accion de Zustand).
  }, [accountId]);

  if (account === undefined) return <Hint text="Sin cuenta activa." />;

  return (
    // h-full (F6: ahora es un panel acoplable mas, no contenido de un popover con su propio tamaño
    // fijo) — sin el, el fondo del panel no llega al suelo de su zona, mismo bug que ya se corrigio en
    // ChatSidebar.tsx.
    <div className="flex h-full flex-col gap-[14px] p-[14px] text-[11px]">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-bold text-mg-text">{account.alias}</div>
          <div className="truncate text-[10px] text-mg-ter">{account.email ?? 'sin email'}</div>
        </div>
        <button
          onClick={() => void refreshUsage(account.id)}
          data-tip="Refrescar uso"
          className="flex h-6 w-6 items-center justify-center rounded-[6px] text-mg-muted hover:bg-mg-hover hover:text-mg-body"
        >
          ⟳
        </button>
      </div>

      {account.loginStatus !== 'logged_in' && <Hint text="La cuenta no tiene login válido: no hay datos de uso." />}
      {error !== null && account.loginStatus === 'logged_in' && (
        <div className="rounded-[7px] border border-mg-danger-border bg-mg-danger-bg p-[8px_10px] text-[10.5px] text-mg-danger">
          No se pudo obtener el uso: {error}
        </div>
      )}
      {usage === null && error === null && account.loginStatus === 'logged_in' && (
        <Hint text="Cargando uso…" />
      )}

      {usage !== null && <UsageBody account={account} usage={usage} />}
    </div>
  );
}

function UsageBody({ account, usage }: { readonly account: Account; readonly usage: UsageInfo }): React.JSX.Element {
  // now del render: la cuenta atras es aproximada (el timer/refrescos la mantienen al dia).
  const now = Date.now();
  const windows = toUsageWindows(usage, now);
  const models = perModelBars(usage);
  const okColor = account.accent.base;

  return (
    <>
      <WindowRow
        title="Ventana de 5 h"
        pct={windows.fiveHour.pct}
        label={windows.fiveHour.label}
        severity={severityForPct(usage.fiveHour.utilization)}
        okColor={okColor}
        projection={projectWindowExhaustion(usage.fiveHour.utilization, usage.fiveHour.resetsAt, FIVE_HOUR_WINDOW_MS, now)}
      />
      <WindowRow
        title="Ventana semanal"
        pct={windows.weekly.pct}
        label={windows.weekly.label}
        severity={severityForPct(usage.sevenDay.utilization)}
        okColor={okColor}
        projection={projectWindowExhaustion(usage.sevenDay.utilization, usage.sevenDay.resetsAt, SEVEN_DAY_WINDOW_MS, now)}
      />

      {models.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">POR MODELO</div>
          {models.map((bar) => (
            <WindowRow key={bar.label} title={bar.label} pct={bar.pct} label={`${bar.pct}%`} severity={bar.severity} okColor={okColor} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-mg-border-subtle pt-[10px] text-[10.5px] text-mg-ter">
        <span>Créditos API</span>
        <span className="text-mg-body">{formatApiCredits(usage.apiCreditsMinor)}</span>
      </div>
    </>
  );
}

function WindowRow({
  title,
  pct,
  label,
  severity,
  okColor,
  projection,
}: {
  readonly title: string;
  readonly pct: number;
  readonly label: string;
  readonly severity: UsageSeverity;
  readonly okColor: string;
  // Solo las ventanas del plan la traen: las barras por-modelo no tienen fecha de reset que proyectar.
  readonly projection?: UsageProjection;
}): React.JSX.Element {
  const color = severityColor(severity, okColor);
  // El porcentaje dice cuanto llevas; esto dice si te da. Se calla cuando no hay nada fiable que decir.
  const projectionText = projection === undefined ? null : formatProjection(projection);
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-center justify-between text-[10.5px] text-mg-ter">
        <span className="flex items-center gap-[6px] truncate">
          {severity !== 'ok' && <Icon name={severity === 'critical' ? 'error' : 'warning'} size={12} />}
          {title}
        </span>
        <span style={{ color }}>
          {pct}% · {label}
        </span>
      </div>
      <div className="h-[4px] rounded-[2px] bg-mg-track">
        <div className="h-full rounded-[2px]" style={{ width: `${pct}%`, background: color }} />
      </div>
      {projectionText !== null && (
        <div className="text-[9.5px] text-mg-muted" style={projection?.kind === 'depleting' ? { color } : undefined}>
          {projectionText}
        </div>
      )}
    </div>
  );
}

function severityColor(severity: UsageSeverity, okColor: string): string {
  if (severity === 'critical') return CRIT_COLOR;
  if (severity === 'warn') return WARN_COLOR;
  return okColor;
}

function Hint({ text }: { readonly text: string }): React.JSX.Element {
  return <div className="text-[11px] text-mg-muted">{text}</div>;
}
