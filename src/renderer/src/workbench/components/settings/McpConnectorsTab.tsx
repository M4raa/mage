import { useMemo } from 'react';
import { useCodexAppsStore } from '../../codexAppsStore';
import { useMcpStore } from '../../mcpStore';
import type { CodexAccountMetadata, McpStatusByAccount } from '@shared/mcp';
import { buildClaudeConnectorGroups, CLAUDE_AI_CONNECTORS_URL, describeCheckedAt, type McpConnectorGroup, type McpConnectorRow } from '../../mcpView';
import { useWorkbenchStore } from '../../workbenchStore';
import { Icon } from '../Icon';
import { McpAuthActions } from './McpSection';
import { MCP_BUTTON_CLASS as BUTTON_CLASS } from './mcpStyles';
import { useT } from '../../../i18n/uiLanguage';
import type { Translate } from '@shared/i18n/translator';

// Pestaña «Conectores» (C3-e…h, respuestas 22, 23 y 27): lo que puede usar cada proveedor y cuenta,
// venga de donde venga, como la pantalla de Claude Desktop. Agrupada por proveedor: los conectores de
// claude.ai son de la cuenta; las Apps de ChatGPT, de la cuenta de Codex; agy no expone ninguno.

export function McpConnectorsTab({ statuses }: { readonly statuses: McpStatusByAccount }): React.JSX.Element {
  const accounts = useWorkbenchStore((s) => s.accounts);
  const claudeAiOff = useWorkbenchStore((s) => s.settings.claudeAiConnectorsOff);
  const cache = useMcpStore((s) => s.cache);
  const extensions = useMcpStore((s) => s.extensions?.extensions);
  const groups = useMemo(
    () => buildClaudeConnectorGroups({ accountIds: accounts.map((a) => a.id), statuses, cache, extensions: extensions ?? [], claudeAiOff }),
    [accounts, statuses, cache, extensions, claudeAiOff],
  );
  const t = useT();
  return (
    <div className="flex flex-col gap-[14px]" data-mcp-connectors="true">
      <ProviderHeading title="Claude">
        <button onClick={() => void window.mage.openExternal(CLAUDE_AI_CONNECTORS_URL)} className={BUTTON_CLASS} data-tip={t('mcp.connectors.manageTip')}>
          <Icon name="external" />
          {t('mcp.connectors.manage')}
        </button>
        <ProbeButton />
      </ProviderHeading>
      {groups.length === 0 && <p className="text-[11px] text-mg-muted">{t('mcp.connectors.noClaudeAccounts')}</p>}
      {groups.map((group) => (
        <ClaudeAccountGroup key={group.accountId} group={group} />
      ))}
      <ProviderHeading title="Codex" />
      <CodexApps />
      <ProviderHeading title="agy" />
      <p className="text-[11px] text-mg-sec">{t('mcp.connectors.agyNone')}</p>
    </div>
  );
}

function CodexApps(): React.JSX.Element {
  const accounts = useWorkbenchStore((s) => s.accounts);
  const results = useCodexAppsStore((state) => state.results);
  const loading = useCodexAppsStore((state) => state.loading);
  const refresh = useCodexAppsStore((state) => state.refresh);
  const t = useT();
  const subscriptions = accounts.filter((account) => account.providerId === 'codex' && !account.apiBilled);
  return <section data-mcp-codex-apps="true" className="flex flex-col gap-[6px] text-[11px] text-mg-sec">
    <div className="flex items-center gap-[8px]">
      <span className="flex-1">{t('mcp.codexApps.title')}</span>
      <button className={BUTTON_CLASS} disabled={loading || subscriptions.length === 0} onClick={() => void refresh(subscriptions.map((account) => account.id))}>
        <Icon name="refresh" />{loading ? t('mcp.codexApps.loading') : t('mcp.codexApps.refresh')}
      </button>
    </div>
    {subscriptions.length === 0 && <p>{t('mcp.codexApps.noSubscription')}</p>}
    {subscriptions.map((account) => <div key={account.id} data-codex-app-account={account.id}>
      <strong>{account.alias}</strong>
      <CodexAppsResult result={results[account.id]} />
    </div>)}
  </section>;
}

function CodexAppsResult({ result }: { readonly result: CodexAccountMetadata | undefined }): React.JSX.Element {
  const t = useT();
  if (result === undefined) return <p>{t('mcp.codexApps.notChecked')}</p>;
  if (result.error !== null) return <p role="status">{t('mcp.codexApps.error', { error: result.error })}</p>;
  if (result.authenticated !== true) return <p>{t('mcp.codexApps.signIn')}</p>;
  if (result.apps?.length === 0) return <p>{t('mcp.codexApps.empty')}</p>;
  return <ul>{result.apps?.map((app) => <li key={app.id} className="py-[3px]">
    <span className="font-medium text-mg-body">{app.name}</span> · {codexAppStatus(app, t)}
  </li>)}</ul>;
}

function codexAppStatus(app: { readonly accessible: boolean; readonly enabled: boolean }, t: Translate): string {
  if (!app.accessible) return t('mcp.codexApps.status.noAccess');
  return app.enabled ? t('mcp.codexApps.status.available') : t('mcp.codexApps.status.disabled');
}

function ProviderHeading({ title, children }: { readonly title: string; readonly children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-[8px] border-b border-mg-border-subtle pb-[4px]">
      <span className="flex-1 text-[11px] font-bold text-mg-text">{title}</span>
      {children}
    </div>
  );
}

function ProbeButton(): React.JSX.Element {
  const probing = useMcpStore((s) => s.probing);
  const probeStatus = useMcpStore((s) => s.probeStatus);
  const t = useT();
  return (
    <button onClick={() => void probeStatus()} disabled={probing} className={BUTTON_CLASS} data-tip={t('mcp.connectors.probeTip')}>
      <Icon name="refresh" />
      {probing ? t('mcp.probe.running') : t('mcp.probe.button')}
    </button>
  );
}

function ClaudeAccountGroup({ group }: { readonly group: McpConnectorGroup }): React.JSX.Element {
  const alias = useWorkbenchStore((s) => s.accounts.find((a) => a.id === group.accountId)?.alias ?? group.accountId);
  const setEnabled = useWorkbenchStore((s) => s.setClaudeAiConnectorsEnabled);
  const t = useT();
  return (
    <section data-mcp-connector-group={group.accountId} className="flex flex-col gap-[6px]" aria-label={t('mcp.connectors.groupAria', { account: alias })}>
      <div className="flex items-center gap-[8px]">
        <span className="flex-1 text-[11px] font-semibold text-mg-body">{t('mcp.connectors.accountTitle', { account: alias })}</span>
        <label className="flex items-center gap-[5px] text-[10.5px] text-mg-body2" data-tip={t('mcp.connectors.claudeAiToggleTip')}>
          <input type="checkbox" checked={group.claudeAiEnabled} onChange={(e) => setEnabled(group.accountId, e.target.checked)} aria-label={t('mcp.connectors.claudeAiToggleAria', { account: alias })} />
          {t('mcp.connectors.claudeAiToggle')}
        </label>
      </div>
      <table className="w-full border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-b border-mg-border-subtle text-[9.5px] uppercase tracking-[.06em] text-mg-ter">
            <th className="py-[4px] pr-[8px] font-semibold">{t('mcp.connectors.column.connector')}</th>
            <th className="py-[4px] pr-[8px] font-semibold">{t('mcp.connectors.column.type')}</th>
            <th className="py-[4px] font-semibold">{t('mcp.connectors.column.status')}</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <ConnectorRowView key={row.key} row={row} accountId={group.accountId} />
          ))}
        </tbody>
      </table>
      <span className="text-[10px] text-mg-muted" data-mcp-checked-at="true">
        {describeCheckedAt(group.checkedAt, new Date())}
      </span>
    </section>
  );
}

function ConnectorRowView({ row, accountId }: { readonly row: McpConnectorRow; readonly accountId: string }): React.JSX.Element {
  const t = useT();
  return (
    <tr data-mcp-connector={row.name} data-mcp-connector-kind={row.kind} className="border-b border-mg-border-subtle align-top">
      <td className="py-[5px] pr-[8px] font-medium text-mg-body">{row.name}</td>
      <td className="py-[5px] pr-[8px] text-mg-body2">{row.typeLabel}</td>
      <td className="py-[5px] text-mg-sec">
        <span data-mcp-status="true">{row.statusLabel}</span>
        {row.cliName !== null && <McpAuthActions serverName={row.cliName} accountDirs={row.needsAuth ? [accountId] : []} label={t('mcp.connectors.connect')} />}
      </td>
    </tr>
  );
}
