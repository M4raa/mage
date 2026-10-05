import { useMemo, useState } from 'react';
import { useMcpStore } from '../../mcpStore';
import type { CodexAccountMetadata, McpStatusByAccount } from '@shared/mcp';
import { buildClaudeConnectorGroups, CLAUDE_AI_CONNECTORS_URL, describeCheckedAt, type McpConnectorGroup, type McpConnectorRow } from '../../mcpView';
import { useWorkbenchStore } from '../../workbenchStore';
import { Icon } from '../Icon';
import { McpAuthActions } from './McpSection';
import { MCP_BUTTON_CLASS as BUTTON_CLASS } from './mcpStyles';

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
  return (
    <div className="flex flex-col gap-[14px]" data-mcp-connectors="true">
      <ProviderHeading title="Claude">
        <button onClick={() => void window.mage.openExternal(CLAUDE_AI_CONNECTORS_URL)} className={BUTTON_CLASS} data-tip="Añadir y descubrir conectores se hace en tu cuenta de claude.ai">
          <Icon name="external" />
          Gestionar en claude.ai
        </button>
        <ProbeButton />
      </ProviderHeading>
      {groups.length === 0 && <p className="text-[11px] text-mg-muted">No hay cuentas de Claude.</p>}
      {groups.map((group) => (
        <ClaudeAccountGroup key={group.accountId} group={group} />
      ))}
      <ProviderHeading title="Codex" />
      <CodexApps />
      <ProviderHeading title="agy" />
      <p className="text-[11px] text-mg-sec">agy no expone conectores: sus integraciones de Google no se pueden gestionar desde su CLI.</p>
    </div>
  );
}

function CodexApps(): React.JSX.Element {
  const accounts = useWorkbenchStore((s) => s.accounts);
  const [results, setResults] = useState<Readonly<Record<string, CodexAccountMetadata>>>({});
  const [loading, setLoading] = useState(false);
  const subscriptions = accounts.filter((account) => account.providerId === 'codex' && !account.apiBilled);
  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      for (const account of subscriptions) {
        const value = await window.mage.readCodexApps(account.id).catch((): CodexAccountMetadata => ({
          authenticated: null, apps: null, error: 'No se pudieron consultar las Apps de esta cuenta.',
        }));
        setResults((previous) => ({ ...previous, [account.id]: value }));
      }
    } finally { setLoading(false); }
  };
  return <section data-mcp-codex-apps="true" className="flex flex-col gap-[6px] text-[11px] text-mg-sec">
    <div className="flex items-center gap-[8px]">
      <span className="flex-1">Apps de ChatGPT</span>
      <button className={BUTTON_CLASS} disabled={loading || subscriptions.length === 0} onClick={() => void refresh()}>
        <Icon name="refresh" />{loading ? 'Consultando…' : 'Consultar Apps'}
      </button>
    </div>
    {subscriptions.length === 0 && <p>Añade una cuenta de suscripción de Codex para consultar sus Apps de ChatGPT.</p>}
    {subscriptions.map((account) => <div key={account.id} data-codex-app-account={account.id}>
      <strong>{account.alias}</strong>
      <CodexAppsResult result={results[account.id]} />
    </div>)}
  </section>;
}

function CodexAppsResult({ result }: { readonly result: CodexAccountMetadata | undefined }): React.JSX.Element {
  if (result === undefined) return <p>Sin consultar.</p>;
  if (result.error !== null) return <p role="status">{result.error} Puedes volver a intentarlo.</p>;
  if (result.authenticated !== true) return <p>Inicia sesión en esta cuenta de Codex para consultar sus Apps.</p>;
  if (result.apps?.length === 0) return <p>Codex no ha devuelto ninguna App.</p>;
  return <ul>{result.apps?.map((app) => <li key={app.id} className="py-[3px]">
    <span className="font-medium text-mg-body">{app.name}</span> · {codexAppStatus(app)}
  </li>)}</ul>;
}

function codexAppStatus(app: { readonly accessible: boolean; readonly enabled: boolean }): string {
  if (!app.accessible) return 'Sin acceso';
  return app.enabled ? 'Disponible' : 'Desactivada';
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
  return (
    <button onClick={() => void probeStatus()} disabled={probing} className={BUTTON_CLASS} data-tip="Arranca el CLI de cada cuenta sin mandar ningún mensaje y le pregunta el estado">
      <Icon name="refresh" />
      {probing ? 'Comprobando…' : 'Comprobar estado'}
    </button>
  );
}

function ClaudeAccountGroup({ group }: { readonly group: McpConnectorGroup }): React.JSX.Element {
  const alias = useWorkbenchStore((s) => s.accounts.find((a) => a.id === group.accountId)?.alias ?? group.accountId);
  const setEnabled = useWorkbenchStore((s) => s.setClaudeAiConnectorsEnabled);
  return (
    <section data-mcp-connector-group={group.accountId} className="flex flex-col gap-[6px]" aria-label={`Conectores de ${alias}`}>
      <div className="flex items-center gap-[8px]">
        <span className="flex-1 text-[11px] font-semibold text-mg-body">Cuenta {alias}</span>
        <label className="flex items-center gap-[5px] text-[10.5px] text-mg-body2" data-tip="Se aplica a las conversaciones que se abran después. No cambia nada en tu cuenta de claude.ai.">
          <input type="checkbox" checked={group.claudeAiEnabled} onChange={(e) => setEnabled(group.accountId, e.target.checked)} aria-label={`Usar los conectores de claude.ai en ${alias}`} />
          Usar los conectores de claude.ai
        </label>
      </div>
      <table className="w-full border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-b border-mg-border-subtle text-[9.5px] uppercase tracking-[.06em] text-mg-ter">
            <th className="py-[4px] pr-[8px] font-semibold">Conector</th>
            <th className="py-[4px] pr-[8px] font-semibold">Tipo</th>
            <th className="py-[4px] font-semibold">Estado</th>
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
  return (
    <tr data-mcp-connector={row.name} data-mcp-connector-kind={row.kind} className="border-b border-mg-border-subtle align-top">
      <td className="py-[5px] pr-[8px] font-medium text-mg-body">{row.name}</td>
      <td className="py-[5px] pr-[8px] text-mg-body2">{row.typeLabel}</td>
      <td className="py-[5px] text-mg-sec">
        <span data-mcp-status="true">{row.statusLabel}</span>
        {row.cliName !== null && <McpAuthActions serverName={row.cliName} accountDirs={row.needsAuth ? [accountId] : []} label="Conectar" />}
      </td>
    </tr>
  );
}
