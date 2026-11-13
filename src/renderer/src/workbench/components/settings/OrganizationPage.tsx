import { useEffect, useMemo, useState } from 'react';
import type { CapabilitiesOverview, ManagedSettingsView, PolicyEntryView } from '@shared/capabilities';
import type { Translate } from '@shared/i18n/translator';
import { useT } from '../../../i18n/uiLanguage';
import { describeError } from '../../describeError';
import { useWorkbenchStore } from '../../workbenchStore';
import { Icon } from '../Icon';
import { allowedKey, entryValueKey, policyLabelKey } from './capabilitiesModel';
import { CAPABILITY_PAGE_CLASS, CapabilityHeader, NOOP } from './CapabilityPage';
import { MCP_BUTTON_CLASS } from './mcpStyles';

// Página Organización de Capacidades (DEVOLUCION-093, U-4): SOLO LECTURA de las políticas de cada cuenta de Claude y de
// los ajustes gestionados del equipo. Editar no se hace en Mage: el enlace abre la consola de administración (D-6).

export const ADMIN_CONSOLE_URL = 'https://claude.ai/admin-settings';
const SECTION_CLASS = 'flex flex-col gap-[6px] rounded-[9px] border border-mg-border-subtle p-[10px_12px]';
const ID_SEPARATOR = '\n';

type OverviewState = { readonly kind: 'ready'; readonly overview: CapabilitiesOverview } | { readonly kind: 'error'; readonly message: string };
interface PolicyRowData { readonly name: string; readonly value: string; readonly attr: string }

function useOverviews(accountIds: readonly string[]): Readonly<Record<string, OverviewState>> {
  const [states, setStates] = useState<Readonly<Record<string, OverviewState>>>({});
  const key = accountIds.join(ID_SEPARATOR);
  useEffect(() => {
    let cancelled = false;
    for (const id of key.split(ID_SEPARATOR).filter((part) => part !== '')) {
      window.mage
        .capabilitiesOverview(id)
        .then((overview) => ({ kind: 'ready', overview }) as const)
        .catch((err: unknown) => ({ kind: 'error', message: describeError(err) }) as const)
        .then((state) => {
          if (!cancelled) setStates((prev) => ({ ...prev, [id]: state }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return states;
}

function entryRows(t: Translate, entries: readonly PolicyEntryView[], attr: string): readonly PolicyRowData[] {
  return entries.map(({ name, value }) => {
    const valueKey = entryValueKey(value);
    return { name, value: valueKey === null ? value : t(valueKey), attr };
  });
}

function AdminLink(): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-col items-end gap-[2px]">
      <button data-org-admin-link="true" onClick={() => void window.mage.openExternal(ADMIN_CONSOLE_URL)} className={MCP_BUTTON_CLASS}>
        <Icon name="external" />
        {t('capabilities.org.adminLink')}
      </button>
      <span className="text-[10px] text-mg-ter">{t('capabilities.org.adminOnly')}</span>
    </div>
  );
}

function PolicyRow({ row }: { readonly row: PolicyRowData }): React.JSX.Element {
  const t = useT();
  const labelKey = policyLabelKey(row.name);
  return (
    <div role="listitem" {...{ [row.attr]: row.name }} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-[10px] border-b border-mg-border-subtle py-[5px] text-[11px]">
      {labelKey === null ? <code className="font-mono text-[10.5px]">{row.name}</code> : <span>{t(labelKey)}</span>}
      <span className="text-mg-sec">{row.value}</span>
    </div>
  );
}

function PolicyGroup({ title, rows }: { readonly title: string; readonly rows: readonly PolicyRowData[] }): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-mg-ter">{title}</span>
      <div role="list">
        {rows.map((row) => (
          <PolicyRow key={`${row.attr}:${row.name}`} row={row} />
        ))}
      </div>
    </div>
  );
}

function PolicyFileNote({ state }: { readonly state: 'absent' | 'ok' | 'unreadable' }): React.JSX.Element | null {
  const t = useT();
  if (state === 'absent') return <p className="text-[11px] text-mg-sec">{t('capabilities.org.fileAbsent')}</p>;
  if (state === 'unreadable') return <p role="status" className="text-[11px] text-mg-warn-text">{t('capabilities.org.fileUnreadable')}</p>;
  return null;
}

function PoliciesDetail({ overview }: { readonly overview: CapabilitiesOverview }): React.JSX.Element {
  const t = useT();
  const { policies } = overview;
  const broken = policies.state === 'unreadable' || policies.remoteState === 'unreadable';
  const restrictions = policies.restrictions.map(({ name, allowed }) => ({ name, value: t(allowedKey(allowed)), attr: 'data-org-restriction' }));
  const taints = policies.complianceTaints.map((taint, i) => ({ name: `#${i + 1}`, value: taint, attr: 'data-org-taint' }));
  return (
    <>
      <PolicyFileNote state={broken ? 'unreadable' : policies.state} />
      <PolicyGroup title={t('capabilities.org.restrictions')} rows={restrictions} />
      <PolicyGroup title={t('capabilities.org.defaults')} rows={entryRows(t, policies.defaults, 'data-org-default')} />
      <PolicyGroup title={t('capabilities.org.remote')} rows={entryRows(t, policies.remote, 'data-org-remote')} />
      <PolicyGroup title={t('capabilities.org.monitoring')} rows={entryRows(t, policies.monitoringNotice ?? [], 'data-org-monitoring')} />
      <PolicyGroup title={t('capabilities.org.taints')} rows={taints} />
      <PolicyGroup title={t('capabilities.org.extra')} rows={entryRows(t, policies.extra, 'data-org-extra')} />
    </>
  );
}

function PoliciesBody({ state }: { readonly state: OverviewState | undefined }): React.JSX.Element {
  const t = useT();
  if (state === undefined) return <p className="text-[11px] text-mg-muted">{t('mcp.common.loading')}</p>;
  if (state.kind === 'error') return <div role="alert" className="text-[11px] text-mg-danger">{t('capabilities.loadError', { error: state.message })}</div>;
  return <PoliciesDetail overview={state.overview} />;
}

function AccountPolicies({ accountId, alias, state }: { readonly accountId: string; readonly alias: string; readonly state: OverviewState | undefined }): React.JSX.Element {
  return (
    <section data-org-account={accountId} aria-label={alias} className={SECTION_CLASS}>
      <h3 className="text-[11.5px] font-semibold text-mg-text">{alias}</h3>
      <PoliciesBody state={state} />
    </section>
  );
}

function ManagedBlock({ view }: { readonly view: ManagedSettingsView }): React.JSX.Element {
  const t = useT();
  return (
    <section data-org-managed="true" className={SECTION_CLASS}>
      <h3 className="text-[11.5px] font-semibold text-mg-text">{t('capabilities.org.managed.title')}</h3>
      {view.files.length === 0 && <p className="text-[11px] text-mg-sec">{t('capabilities.org.managed.none', { dir: view.dir })}</p>}
      {view.files.map((file) =>
        file.state === 'ok' ? (
          <PolicyGroup key={file.file} title={file.file} rows={entryRows(t, file.entries, 'data-org-managed-entry')} />
        ) : (
          <p key={file.file} className="text-[11px] text-mg-warn-text">
            {file.file}: {t('capabilities.org.fileUnreadable')}
          </p>
        ),
      )}
      <p className="text-[10px] text-mg-ter">{t('capabilities.org.managed.mdmNote')}</p>
    </section>
  );
}

export function OrganizationPage(): React.JSX.Element {
  const t = useT();
  const allAccounts = useWorkbenchStore((s) => s.accounts);
  const accounts = useMemo(() => allAccounts.filter((account) => account.providerId === 'claude'), [allAccounts]);
  const overviews = useOverviews(useMemo(() => accounts.map((account) => account.id), [accounts]));
  const first = accounts[0] === undefined ? undefined : overviews[accounts[0].id];
  return (
    <div data-capabilities-page="organization" className={CAPABILITY_PAGE_CLASS}>
      <CapabilityHeader tab={null} onTab={NOOP} query={null} onQuery={NOOP} placeholder="" choices={[]} add={[]} actions={<AdminLink />} />
      <p className="text-[11px] leading-[1.5] text-mg-sec">{t('capabilities.org.intro')}</p>
      {accounts.length === 0 && <p className="text-[11px] text-mg-muted">{t('capabilities.noClaudeAccounts')}</p>}
      {first?.kind === 'ready' && <ManagedBlock view={first.overview.managed} />}
      {accounts.map((account) => (
        <AccountPolicies key={account.id} accountId={account.id} alias={account.alias} state={overviews[account.id]} />
      ))}
    </div>
  );
}
