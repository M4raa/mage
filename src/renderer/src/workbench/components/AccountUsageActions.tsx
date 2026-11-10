import { useState } from 'react';
import { formatMicroUsd, type UsageInfo } from '@shared/usage';
import { ACCOUNT_ALIAS_MAX } from '@shared/settings';
import { useWorkbenchStore } from '../workbenchStore';
import { useLocalPopover } from '../localPopovers';
import { formatResetAbsolute } from '../usageView';
import { formatPlanPriceUsd, parsePlanPriceUsd } from '../planPrice';
import { reportActionError } from '../notificationStore';
import type { Account } from '../types';
import { Icon } from './Icon';
import { ColorSwatches } from './TabContextMenu';
import { DeleteAccountDialog } from './AccountMenu';
import { CliLoginPanel, useCliLogin } from './CliLoginPanel';
import { loginLabel } from './accountBadge';
import { apiBilledLabel } from '../accountView';
import { useT } from '../../i18n/uiLanguage';
import { activeFormatLocale } from '../../i18n/format';

// Cabecera del detalle de una cuenta en «Cuentas y consumo» (P-039 F6): quién es, sus ventanas ahora, iniciar o
// refrescar la sesión, el precio de su plan y el menú ⋯ (renombrar, color, ocultar, eliminar). Renombrar y color abren
// un popover: antes se desplegaban dentro de la card y la agrandaban.

const BUTTON = 'rounded-[6px] border border-mg-border-ctrl px-[9px] py-[3px] text-[11px] text-mg-body2 hover:bg-mg-hover disabled:opacity-40';

export function AccountDetailHeader({ account }: { readonly account: Account }): React.JSX.Element {
  const t = useT();
  const info = useWorkbenchStore((s) => s.usageByAccount[account.id] ?? null);
  const hidden = useWorkbenchStore((s) => s.settings.hiddenAccounts.includes(account.id));
  return (
    <section data-account-card={account.id} className="flex flex-col gap-[10px] rounded-[10px] border border-mg-border-subtle p-[12px_14px]">
      <div className="flex items-center gap-[10px]">
        <span aria-hidden="true" className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[7px] text-[13px] font-bold text-mg-window" style={{ background: account.accent.base }}>{account.monogram}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-semibold text-mg-text">{account.provider} · {account.alias}</span>
          <span className="truncate text-[10.5px] text-mg-muted">{account.email ?? account.id}</span>
        </div>
        <SessionButtons account={account} />
        <AccountMenuButton account={account} hidden={hidden} />
      </div>
      <div className="flex flex-wrap items-center gap-[4px] text-[10px]">
        <Chip warn={account.apiBilled}>{account.apiBilled ? apiBilledLabel() : t('accountsUsage.subscription')}</Chip>
        {!account.apiBilled && <Chip warn={account.loginStatus !== 'logged_in'}>{loginLabel(account)}</Chip>}
        {hidden && <Chip>{t('accountsUsage.hiddenChip')}</Chip>}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-[16px]">
        <Windows account={account} info={info} />
        {!account.apiBilled && <PlanPriceField account={account} />}
      </div>
    </section>
  );
}

function Chip({ children, warn = false }: { readonly children: React.ReactNode; readonly warn?: boolean }): React.JSX.Element {
  return <span className={`rounded-[4px] border px-[5px] leading-[15px] ${warn ? 'border-mg-warn-border text-mg-warn-text' : 'border-mg-border-subtle text-mg-sec'}`}>{children}</span>;
}

// Ventanas de la suscripción (5 h / 7 d) con su reset, o el coste acumulado si factura la API.
function Windows({ account, info }: { readonly account: Account; readonly info: UsageInfo | null }): React.JSX.Element {
  const t = useT();
  const now = Date.now();
  if (account.apiBilled) {
    const cost = info?.apiUsage?.totals.costMicroUsd;
    return <p className="text-[10.5px] text-mg-sec">{cost === undefined ? t('accountsUsage.apiNoData') : t('accountsUsage.apiCost', { cost: formatMicroUsd(cost, activeFormatLocale()) })}</p>;
  }
  if (info === null) return <p className="text-[10.5px] text-mg-muted">{t('accountsUsage.windowsNoData')}</p>;
  return (
    <div className="flex max-w-[460px] flex-col gap-[5px]">
      <WindowBar label={t('accountsUsage.fiveHour')} pct={info.fiveHour.utilization} reset={formatResetAbsolute(info.fiveHour.resetsAt, now, false)} />
      <WindowBar label={t('accountsUsage.sevenDay')} pct={info.sevenDay.utilization} reset={formatResetAbsolute(info.sevenDay.resetsAt, now, true)} />
    </div>
  );
}

function WindowBar({ label, pct, reset }: { readonly label: string; readonly pct: number; readonly reset: string }): React.JSX.Element {
  const t = useT();
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div className="flex flex-col gap-[2px] text-[10.5px]">
      <div className="flex justify-between gap-[10px] text-mg-sec">
        <span>{label} · <span className="font-semibold tabular-nums text-mg-body">{clamped} %</span></span>
        <span>{t('accountsUsage.resets', { when: reset })}</span>
      </div>
      <div className="h-[4px] overflow-hidden rounded-[2px] bg-mg-hover">
        <div className="h-full rounded-[2px] bg-mg-fill" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

// Precio mensual del plan (P-039 D6): se guarda al salir del campo o con Enter; vacío lo quita.
function PlanPriceField({ account }: { readonly account: Account }): React.JSX.Element {
  const t = useT();
  const saved = useWorkbenchStore((s) => s.settings.planPriceMicroUsdByAccount[account.id]);
  const setPlanPrice = useWorkbenchStore((s) => s.setPlanPrice);
  const [text, setText] = useState(saved === undefined ? '' : formatPlanPriceUsd(saved));
  const [invalid, setInvalid] = useState(false);
  const save = (): void => {
    const parsed = parsePlanPriceUsd(text);
    setInvalid(parsed.kind === 'invalid');
    if (parsed.kind === 'invalid') return;
    setPlanPrice(account.id, parsed.kind === 'ok' ? parsed.microUsd : null);
  };
  return (
    <label className="flex flex-col gap-[3px] text-[10.5px] text-mg-sec">
      <span>{t('accountsUsage.planPrice')}</span>
      <input
        data-plan-price={account.id}
        value={text}
        inputMode="decimal"
        placeholder="20"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        aria-label={t('accountsUsage.planPriceAria', { alias: account.alias })}
        aria-invalid={invalid}
        className={`w-[110px] rounded-[6px] border bg-transparent px-[7px] py-[3px] text-[11.5px] tabular-nums text-mg-body ${invalid ? 'border-mg-danger-border' : 'border-mg-border-ctrl'}`}
      />
      {invalid && <span role="alert" className="max-w-[160px] text-mg-danger">{t('accountsUsage.planPriceInvalid')}</span>}
    </label>
  );
}

function SessionButtons({ account }: { readonly account: Account }): React.JSX.Element {
  const t = useT();
  const refreshAccounts = useWorkbenchStore((s) => s.refreshAccounts);
  const refreshLogin = useWorkbenchStore((s) => s.refreshLogin);
  const login = useCliLogin(() => {
    void refreshAccounts().catch((err: unknown) => reportActionError(t('sidebar.orphan.refreshFailed'), err, 'accounts'));
  });
  const [refreshing, setRefreshing] = useState(false);
  // «Iniciar sesión» solo sin sesión; con el token caducado basta con que su CLI lo renueve (P-038).
  const claudeSubscription = account.providerId === 'claude' && !account.apiBilled;
  const runRefresh = (): void => {
    setRefreshing(true);
    refreshLogin(account.id)
      .catch((err: unknown) => reportActionError(t('accountsUsage.refreshLoginFailed'), err, 'accounts'))
      .finally(() => setRefreshing(false));
  };
  return (
    <div className="flex flex-col items-end gap-[6px]">
      <div className="flex gap-[6px]">
        {claudeSubscription && account.loginStatus === 'logged_out' && <button className={BUTTON} onClick={() => login.begin(account.id, account.email)} disabled={login.phase === 'starting' || login.phase === 'submitting'}>{t('accountsUsage.login')}</button>}
        {claudeSubscription && account.loginStatus === 'expired' && <button className={BUTTON} onClick={runRefresh} disabled={refreshing} data-refresh-login={account.id} data-tip={t('accountsUsage.refreshLoginTip')}>{refreshing ? t('accountsUsage.refreshLoginBusy') : t('accountsUsage.refreshLogin')}</button>}
      </div>
      <CliLoginPanel login={login} />
    </div>
  );
}

type Popover = 'none' | 'menu' | 'rename' | 'color';

// Menú ⋯ de la cuenta. Renombrar y color abren su popover en el mismo sitio (no agrandan nada); ocultar es inmediato;
// eliminar abre la confirmación de siempre.
function AccountMenuButton({ account, hidden }: { readonly account: Account; readonly hidden: boolean }): React.JSX.Element {
  const t = useT();
  const setAccountHidden = useWorkbenchStore((s) => s.setAccountHidden);
  const isActive = useWorkbenchStore((s) => s.activeAccountId === account.id);
  const [open, setOpen] = useState<Popover>('none');
  const [deleting, setDeleting] = useState(false);
  useLocalPopover(open !== 'none');
  const item = 'flex w-full items-center gap-[8px] px-[11px] py-[6px] text-left text-[11.5px] text-mg-body2 hover:bg-mg-hover disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen('none')}>
      <button data-account-menu={account.id} aria-haspopup="menu" aria-expanded={open !== 'none'} aria-label={t('accountsUsage.menuAria', { alias: account.alias })} onClick={() => setOpen(open === 'none' ? 'menu' : 'none')} className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-mg-sec hover:bg-mg-hover hover:text-mg-body">
        <Icon name="ellipsis" size={14} />
      </button>
      {open !== 'none' && <div className="fixed inset-0 z-10" onClick={() => setOpen('none')} />}
      {open === 'menu' && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-[4px] w-[190px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] mg-shadow-pop">
          <button role="menuitem" className={item} onClick={() => setOpen('rename')}><Icon name="pencil" size={12} />{t('accountsUsage.rename')}</button>
          <button role="menuitem" className={item} onClick={() => setOpen('color')}><Icon name="palette" size={12} />{t('accountsUsage.color')}</button>
          <button role="menuitem" className={item} disabled={!hidden && isActive} data-tip={!hidden && isActive ? t('accountsUsage.hideActiveTip') : undefined} onClick={() => { setAccountHidden(account.id, !hidden); setOpen('none'); }}>
            <Icon name={hidden ? 'eye' : 'eyeOff'} size={12} />{hidden ? t('accountsUsage.show') : t('accountsUsage.hide')}
          </button>
          {!account.isMain && <button role="menuitem" className={`${item} text-mg-danger`} onClick={() => { setDeleting(true); setOpen('none'); }}><Icon name="trash" size={12} />{t('accountsUsage.delete')}</button>}
        </div>
      )}
      {open === 'rename' && <RenamePopover account={account} onDone={() => setOpen('none')} />}
      {open === 'color' && <ColorPopover account={account} />}
      {deleting && <DeleteAccountDialog account={account} onClose={() => setDeleting(false)} />}
    </div>
  );
}

const POPOVER = 'absolute right-0 top-full z-20 mt-[4px] rounded-[8px] border border-mg-border-pop bg-mg-popover p-[10px] mg-shadow-pop';

function RenamePopover({ account, onDone }: { readonly account: Account; readonly onDone: () => void }): React.JSX.Element {
  const t = useT();
  const renameAccount = useWorkbenchStore((s) => s.renameAccount);
  const [name, setName] = useState(account.alias);
  return (
    <form
      data-account-rename={account.id}
      className={`${POPOVER} flex w-[260px] flex-col gap-[8px]`}
      onSubmit={(e) => {
        e.preventDefault();
        renameAccount(account.id, name.trim() === (account.baseAlias ?? '') ? null : name);
        onDone();
      }}
    >
      <input value={name} maxLength={ACCOUNT_ALIAS_MAX} onChange={(e) => setName(e.target.value)} aria-label={t('accountsUsage.renameAria', { alias: account.alias })} className="rounded-[6px] border border-mg-border-ctrl bg-transparent px-[7px] py-[3px] text-[11.5px] text-mg-body" autoFocus />
      <div className="flex justify-end gap-[6px]">
        <button type="button" className={BUTTON} onClick={() => { renameAccount(account.id, null); onDone(); }}>{t('accountsUsage.resetName')}</button>
        <button type="submit" className={BUTTON}>{t('accountsUsage.save')}</button>
      </div>
    </form>
  );
}

function ColorPopover({ account }: { readonly account: Account }): React.JSX.Element {
  const t = useT();
  const setAccountAccent = useWorkbenchStore((s) => s.setAccountAccent);
  const accent = useWorkbenchStore((s) => s.settings.accentByAccount[account.id]);
  return (
    <div data-account-color={account.id} className={`${POPOVER} w-[230px]`}>
      <ColorSwatches selected={accent} onPick={(index) => setAccountAccent(account.id, index)} label={t('accounts.menu.colorLabel')} autoTip={t('accounts.menu.colorAuto')} />
    </div>
  );
}
