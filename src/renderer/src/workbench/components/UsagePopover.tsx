import type { UsageInfo } from '@shared/usage';
import { useWorkbenchStore } from '../workbenchStore';
import { formatResetAbsolute } from '../usageView';
import type { Account } from '../types';

// Popover «Uso general» con el uso de TODAS las cuentas. Se ancla SOLO desde el resumen de la status
// bar (hover/foco); el posicionamiento lo pone el contenedor. P-028, punto 22: por cuenta, las dos
// ventanas con su % y la HORA del reset (absoluta: el popover esta siempre montado y una cuenta atras
// se congelaba). Lee `usageByAccount`, no `account.usage`: el relleno de este ultimo pintaba 0 % en
// las cuentas que aun no se habian consultado. Sin dato -> «sin dato», nunca un 0 % falso.
export function UsagePopover(): React.JSX.Element {
  const accounts = useWorkbenchStore((s) => s.accounts);
  const usageByAccount = useWorkbenchStore((s) => s.usageByAccount);
  const now = Date.now();

  return (
    <div
      data-usage-popover="true"
      className="flex w-[260px] flex-col gap-2 rounded-[9px] border border-mg-border-pop bg-mg-popover p-[11px_12px] text-[10.5px] mg-shadow-pop"
    >
      <div className="text-[9.5px] font-bold tracking-[.08em] text-mg-ter">USO GENERAL</div>
      {accounts.map((a) => (
        <AccountUsageRow key={a.id} account={a} info={usageByAccount[a.id] ?? null} now={now} />
      ))}
    </div>
  );
}

function AccountUsageRow({
  account,
  info,
  now,
}: {
  readonly account: Account;
  readonly info: UsageInfo | null;
  readonly now: number;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[3px]" data-usage-account={account.alias}>
      <div className="flex items-center gap-[6px] text-mg-body2">
        <span className="h-[6px] w-[6px] rounded-[2px]" style={{ background: account.accent.base }} />
        {account.alias} · {account.provider}
        {info === null && <span className="ml-auto text-mg-muted">sin dato</span>}
      </div>
      {info !== null && (
        <>
          <WindowLine label="5 h" pct={info.fiveHour.utilization} reset={formatResetAbsolute(info.fiveHour.resetsAt, now, false)} accent={account.accent.base} />
          <WindowLine label="7 d" pct={info.sevenDay.utilization} reset={formatResetAbsolute(info.sevenDay.resetsAt, now, true)} accent={account.accent.base} />
        </>
      )}
    </div>
  );
}

function WindowLine({
  label,
  pct,
  reset,
  accent,
}: {
  readonly label: string;
  readonly pct: number;
  readonly reset: string;
  readonly accent: string;
}): React.JSX.Element {
  const shown = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 0;
  return (
    <div className="flex items-center gap-[6px]">
      <span className="w-[22px] text-mg-ter">{label}</span>
      <div className="h-[3px] flex-1 rounded-[2px] bg-mg-border-emph">
        <div className="h-full rounded-[2px]" style={{ width: `${shown}%`, background: accent }} />
      </div>
      <span className="text-mg-text" data-usage-window={label}>
        {shown} % · reset {reset}
      </span>
    </div>
  );
}
