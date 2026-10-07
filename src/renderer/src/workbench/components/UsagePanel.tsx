import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { selectAccount, useWorkbenchStore } from '../workbenchStore';
import {
  FIVE_HOUR_WINDOW_MS,
  SEVEN_DAY_WINDOW_MS,
  formatApiCredits,
  formatProjection,
  formatResetAbsolute,
  perModelBars,
  projectWindowExhaustion,
  severityForPct,
  toUsageWindows,
  type UsageProjection,
  type UsageSeverity,
} from '../usageView';
import { formatMicroUsd, type AgyUsageSnapshot, type ApiUsageAmounts, type ApiUsageSnapshot, type UsageInfo } from '@shared/usage';
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

      {account.apiBilled && <Hint text="Esta cuenta factura la API con su clave: no tiene ventanas de suscripción." />}
      {!account.apiBilled && account.loginStatus !== 'logged_in' && <Hint text="La cuenta no tiene login válido: no hay datos de uso." />}
      {error !== null && account.loginStatus === 'logged_in' && (
        <div className="rounded-[7px] border border-mg-danger-border bg-mg-danger-bg p-[8px_10px] text-[10.5px] text-mg-danger">
          No se pudo obtener el uso: {error}
        </div>
      )}
      {usage === null && error === null && account.loginStatus === 'logged_in' && account.providerId !== 'agy' && (
        <Hint text={account.providerId === 'codex' ? 'Aún sin datos de uso: llegan con la primera conversación.' : 'Cargando uso…'} />
      )}

      {account.apiBilled && account.providerId === 'claude' && <ApiUsageSection snapshot={usage?.apiUsage ?? null} />}
      {usage !== null && !account.apiBilled && <UsageBody account={account} usage={usage} />}
      {account.providerId === 'agy' && <AgyUsageSection okColor={account.accent.base} />}
    </div>
  );
}

function ApiUsageSection({ snapshot }: { readonly snapshot: ApiUsageSnapshot | null }): React.JSX.Element {
  if (snapshot === null) return <Hint text="Todavía no hay turnos de API medidos por Mage en esta cuenta." />;
  return (
    <section data-api-usage="true" aria-label="Uso de API de Claude" className="flex flex-col gap-[12px] border-t border-mg-border-subtle pt-[10px]">
      <ApiAmounts title="Último turno" amounts={snapshot.lastTurn} />
      <ApiAmounts title={`Total en Mage · ${snapshot.turns} turnos`} amounts={snapshot.totals} />
    </section>
  );
}

function ApiAmounts({ title, amounts }: { readonly title: string; readonly amounts: ApiUsageAmounts }): React.JSX.Element {
  const count = (value: number): string => value.toLocaleString('es-ES');
  return (
    <div className="flex flex-col gap-[5px] text-mg-body">
      <div className="font-semibold text-mg-text">{title}</div>
      <div>Tokens: {count(amounts.totalTokens)} · entrada {count(amounts.inputTokens)} · salida {count(amounts.outputTokens)}</div>
      {(amounts.cacheReadTokens > 0 || amounts.cacheCreationTokens > 0) &&
        <div>Caché: lectura {count(amounts.cacheReadTokens)} · creación {count(amounts.cacheCreationTokens)}</div>}
      <div>Coste: {formatMicroUsd(amounts.costMicroUsd)}</div>
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

// Suscripcion de agy (M9): su `/usage` es gratis (medido en 1.2.14). Solo se pinta si agy contesta;
// sin agy instalado, nada. Se pide al abrir el panel y con su propio boton (main cachea 180 s).
function AgyUsageSection({ okColor }: { readonly okColor: string }): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<AgyUsageSnapshot | null>(null);
  const load = (): void => {
    window.mage
      .readAgyUsage()
      .then(setSnapshot)
      .catch((err: unknown) => setSnapshot({ status: 'unavailable', reason: err instanceof Error ? err.message : String(err), fetchedAt: Date.now() }));
  };
  useEffect(load, []);
  if (snapshot === null || snapshot.status !== 'ok' || snapshot.groups.length === 0) return null;
  const now = Date.now();
  return (
    <section aria-label="Uso de agy" data-agy-usage="true" className="flex flex-col gap-[8px] border-t border-mg-border-subtle pt-[10px]">
      <div className="flex items-center justify-between">
        <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">ANTIGRAVITY (AGY) · SUSCRIPCIÓN</div>
        <button onClick={load} data-tip="Refrescar uso de agy" aria-label="Refrescar uso de agy" className="flex h-5 w-5 items-center justify-center rounded-[5px] text-mg-muted hover:bg-mg-hover hover:text-mg-body">
          ⟳
        </button>
      </div>
      {snapshot.groups.flatMap((group) =>
        group.buckets.map((bucket) => (
          <WindowRow
            key={bucket.id}
            title={`${group.name} · ${AGY_WINDOW_LABEL[bucket.window] ?? bucket.window}`}
            pct={bucket.usedPercent}
            label={formatResetAbsolute(bucket.resetsAt, now, bucket.window !== '5h')}
            severity={severityForPct(bucket.usedPercent)}
            okColor={okColor}
          />
        )),
      )}
    </section>
  );
}

const AGY_WINDOW_LABEL: Readonly<Record<string, string>> = { '5h': 'ventana de 5 h', weekly: 'semanal' };

function Hint({ text }: { readonly text: string }): React.JSX.Element {
  return <div className="text-[11px] text-mg-muted">{text}</div>;
}
