import { useEffect, useMemo, useState } from 'react';
import type { McpServerStatus } from '@shared/events';
import type { McpInventoryRow, McpScope } from '@shared/mcp';
import { useWorkbenchStore } from '../../workbenchStore';
import { useSharedConfigStore } from '../../sharedConfigStore';
import { useMcpStore } from '../../mcpStore';
import { buildServersTable, filterMcpTable, mcpAuthKey, mergeLiveStatuses, type McpBadge, type McpTableRow } from '../../mcpView';
import { Icon } from '../Icon';
import { McpServerDialog } from './McpServerDialog';
import { McpImportDialog } from './McpImportDialog';
import { McpAgySyncPanel } from './McpAgySync';
import { McpConnectorsTab } from './McpConnectorsTab';
import { McpExtensionsTab } from './McpExtensionsTab';
import { McpScopeDialog, OwnedByBadge, ProviderPills } from './McpScopeDialog';
import { MCP_BUTTON_CLASS as BUTTON_CLASS } from './mcpStyles';

// Seccion «MCP y conectores» (P-028 punto 5). Antes era «Config. compartida»: solo enseñaba y editaba
// mcp-common.json, mezclado con el editor de hooks (que ya vive en «Hooks y permisos»). Ahora es el
// inventario de TODO lo que carga una sesion —comunes de Mage, cuenta, proyecto, plugins, conectores de
// claude.ai— y de lo que hay en Claude Desktop, con el estado de cada uno.
//
// Mage solo escribe sus comunes. De lo demas ofrece «Copiar a comunes» y «Ver ubicación».
//
// 0.1.2 (grupo C): tres pestañas como Claude Desktop — Servidores (los MCP, con quien los carga),
// Conectores (lo de cada proveedor y cuenta) y Extensiones (.mcpb de Mage).

const ICON_BUTTON_CLASS = 'rounded-[5px] p-[3px] text-mg-muted hover:bg-mg-hover hover:text-mg-body disabled:opacity-40';

type DialogState =
  | { readonly kind: 'none' }
  | { readonly kind: 'edit'; readonly row: McpInventoryRow | null }
  | { readonly kind: 'import' }
  | { readonly kind: 'scope'; readonly row: McpInventoryRow };

const TABS = [
  { id: 'servers', label: 'Servidores' },
  { id: 'connectors', label: 'Conectores' },
  { id: 'extensions', label: 'Extensiones' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const EMPTY_SERVERS: readonly McpServerStatus[] = [];

export function McpSection(): React.JSX.Element {
  const activeCwd = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.cwd);
  const load = useMcpStore((s) => s.load);
  const loadCache = useMcpStore((s) => s.loadCache);
  const loadExtensions = useMcpStore((s) => s.loadExtensions);
  const loadShared = useSharedConfigStore((s) => s.load);
  const statuses = useLiveStatuses();
  const [tab, setTab] = useState<TabId>('servers');

  // Se relee al abrir: el usuario puede haber tocado cualquiera de los ficheros por fuera. La cache de
  // estado trae lo ultimo comprobado de cada cuenta, con su fecha, sin sondear.
  useEffect(() => {
    void load(activeCwd === undefined ? [] : [activeCwd]);
    void loadShared();
    void loadCache();
    void loadExtensions();
  }, [activeCwd, load, loadShared, loadCache, loadExtensions]);

  return (
    <div data-mcp-section="true" className="relative flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[14px_16px]">
      <div role="tablist" aria-label="MCP y conectores" onKeyDown={(e) => moveTab(e, tab, setTab)} className="flex gap-[4px] border-b border-mg-border-subtle">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            data-mcp-tab={item.id}
            onClick={() => setTab(item.id)}
            className={`-mb-px border-b-2 px-[10px] py-[5px] text-[11px] ${tab === item.id ? 'border-mg-focus font-semibold text-mg-body' : 'border-transparent text-mg-sec hover:text-mg-body'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find((item) => item.id === tab)?.label} className="flex flex-col gap-[12px]">
        {tab === 'servers' && <ServersTab statuses={statuses} />}
        {tab === 'connectors' && <McpConnectorsTab statuses={statuses} />}
        {tab === 'extensions' && <McpExtensionsTab />}
      </div>
    </div>
  );
}

// Flechas izquierda/derecha entre pestañas (patron de tablist con roving tabindex). Se para el evento:
// el tablist de Configuracion, que envuelve a este, tambien escucha flechas.
const ARROW_STEPS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1 };

function moveTab(e: React.KeyboardEvent<HTMLDivElement>, current: TabId, setTab: (id: TabId) => void): void {
  const step = ARROW_STEPS[e.key];
  if (step === undefined) return;
  e.preventDefault();
  e.stopPropagation();
  const index = (TABS.findIndex((item) => item.id === current) + step + TABS.length) % TABS.length;
  const next = TABS[index]!.id;
  setTab(next);
  e.currentTarget.querySelector<HTMLElement>(`[data-mcp-tab="${next}"]`)?.focus();
}

function ServersTab({ statuses }: { readonly statuses: ReturnType<typeof mergeLiveStatuses> }): React.JSX.Element {
  const inventory = useMcpStore((s) => s.inventory);
  const loadError = useMcpStore((s) => s.loadError);
  const mutate = useMcpStore((s) => s.mutate);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const rows = useMemo(() => filterMcpTable(buildServersTable(inventory, statuses), query), [inventory, statuses, query]);
  const close = (): void => setDialog({ kind: 'none' });
  const saveScope = async (row: McpInventoryRow, onlyIn: McpScope): Promise<void> => {
    const result = await mutate({ op: 'setOnlyIn', name: row.name, onlyIn });
    if (result.status === 'stale') throw new Error(result.message);
  };

  return (
    <>
      <p className="text-[11px] leading-[1.5] text-mg-sec">
        Todo lo que carga una conversación, venga de donde venga. Los <strong>comunes de Mage</strong> se suman a{' '}
        <strong>todos</strong> los proveedores y cuentas compatibles sin sustituir los suyos (o solo a los que elijas en
        «Solo en…»); lo propio de cada CLI se enseña donde está declarado y se puede copiar a comunes. Fuera de su
        carpeta, Mage solo escribe en agy cuando lo sincronizas.
      </p>
      <McpToolbar query={query} onQuery={setQuery} onAdd={() => setDialog({ kind: 'edit', row: null })} onImport={() => setDialog({ kind: 'import' })} />
      <McpNotices onImport={() => setDialog({ kind: 'import' })} />
      {loadError !== null && (
        <div role="alert" className="text-[11px] text-mg-danger">
          No se pudo leer el inventario: {loadError}
        </div>
      )}
      <McpTable rows={rows} onEdit={(row) => setDialog({ kind: 'edit', row })} onScope={(row) => setDialog({ kind: 'scope', row })} />
      <McpAgySyncPanel />
      {dialog.kind === 'edit' && <McpServerDialog row={dialog.row} onClose={close} />}
      {dialog.kind === 'import' && <McpImportDialog onClose={close} />}
      {dialog.kind === 'scope' && (
        <McpScopeDialog title={`Solo en… · ${dialog.row.name}`} scope={dialog.row.onlyIn} onSave={(scope) => saveScope(dialog.row, scope)} onClose={close} />
      )}
    </>
  );
}

// Estado por cuenta: lo sondeado y, si no, el `session_init` de las pestañas abiertas.
function useLiveStatuses(): ReturnType<typeof mergeLiveStatuses> {
  const probed = useMcpStore((s) => s.probed);
  const tabs = useWorkbenchStore((s) => s.tabs);
  const byChat = useWorkbenchStore((s) => s.mcpServersByChat);
  return useMemo(
    () => mergeLiveStatuses(probed, tabs.map((tab) => ({ accountId: tab.accountId, servers: byChat[tab.id] ?? EMPTY_SERVERS }))),
    [probed, tabs, byChat],
  );
}

function McpToolbar({
  query,
  onQuery,
  onAdd,
  onImport,
}: {
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly onAdd: () => void;
  readonly onImport: () => void;
}): React.JSX.Element {
  const probing = useMcpStore((s) => s.probing);
  const probeError = useMcpStore((s) => s.probeError);
  const probeStatus = useMcpStore((s) => s.probeStatus);
  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex items-center gap-[8px]">
        <label className="flex min-w-0 flex-1 items-center gap-[6px] rounded-[6px] border border-mg-border-subtle bg-mg-panel px-[8px] py-[3px]">
          <Icon name="search" className="text-mg-muted" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar servidores y conectores"
            aria-label="Buscar servidores MCP"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-mg-body outline-none"
          />
        </label>
        <button
          onClick={() => void probeStatus()}
          disabled={probing}
          className={BUTTON_CLASS}
          data-tip="Arranca el CLI de cada cuenta sin mandar ningún mensaje y le pregunta el estado de sus MCP"
        >
          <Icon name="refresh" />
          {probing ? 'Comprobando…' : 'Comprobar estado'}
        </button>
        <button onClick={onImport} className={BUTTON_CLASS}>
          <Icon name="import" />
          Importar…
        </button>
        <button onClick={onAdd} className={BUTTON_CLASS}>
          <Icon name="plus" />
          Añadir
        </button>
      </div>
      {probeError !== null && (
        <div role="alert" className="text-[10.5px] text-mg-danger">
          No se pudo comprobar el estado: {probeError}
        </div>
      )}
    </div>
  );
}

// Avisos: colisiones de la importacion del primer arranque, ficheros ilegibles, formas descartadas y MCP
// de una cuenta que no estan en los comunes (punto 34).
function McpNotices({ onImport }: { readonly onImport: () => void }): React.JSX.Element {
  const inventory = useMcpStore((s) => s.inventory);
  const snapshot = useSharedConfigStore((s) => s.snapshot);
  const aliasOf = useAliasOf();
  const importNotes = snapshot?.mcpCommonImportNotes ?? [];
  const warnings = [...(inventory?.warnings ?? []), ...(snapshot?.mcpCommonWarnings ?? []).map((w) => `mcp-common.json: ${w}`)];
  return (
    <>
      {(inventory?.unshared ?? []).map((account) => (
        <div key={account.accountDir} role="status" data-mcp-unshared="true" className="flex items-center gap-[8px] rounded-[7px] border border-mg-border-subtle bg-mg-code p-[7px_10px] text-[10.5px] text-mg-sec">
          <Icon name="info" className="text-mg-focus" />
          <span className="min-w-0 flex-1">
            La cuenta <strong>{aliasOf(account.accountDir)}</strong> tiene {account.names.length} MCP que no están en los comunes:{' '}
            {account.names.join(', ')}.
          </span>
          <button onClick={onImport} className={BUTTON_CLASS}>
            Importar…
          </button>
        </div>
      ))}
      <NoticeList title="Importados por primera vez, con avisos" items={importNotes} tone="info" dataAttr="data-mcp-import-notes" />
      <NoticeList title="Avisos" items={warnings} tone="warn" dataAttr="data-mcp-warnings" />
    </>
  );
}

function NoticeList({
  title,
  items,
  tone,
  dataAttr,
}: {
  readonly title: string;
  readonly items: readonly string[];
  readonly tone: 'info' | 'warn';
  readonly dataAttr: string;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  const skin = tone === 'warn' ? 'border-mg-warn-border bg-mg-warn-bg text-mg-warn-text' : 'border-mg-border-subtle bg-mg-code text-mg-sec';
  return (
    <div role="status" {...{ [dataAttr]: 'true' }} className={`flex flex-col gap-[3px] rounded-[7px] border p-[8px_10px] ${skin}`}>
      <span className="text-[10px] font-semibold">{title}</span>
      <ul className="flex flex-col gap-[2px]">
        {items.map((item) => (
          <li key={item} className="text-[10px]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useAliasOf(): (accountDir: string) => string {
  const accounts = useWorkbenchStore((s) => s.accounts);
  return (accountDir) => accounts.find((account) => account.id === accountDir)?.alias ?? accountDir;
}

interface RowHandlers {
  readonly onEdit: (row: McpInventoryRow) => void;
  readonly onScope: (row: McpInventoryRow) => void;
}

function McpTable({ rows, onEdit, onScope }: { readonly rows: readonly McpTableRow[] } & RowHandlers): React.JSX.Element {
  const inventory = useMcpStore((s) => s.inventory);
  if (inventory === null) return <p className="text-[11px] text-mg-muted">Cargando…</p>;
  if (rows.length === 0) return <p className="text-[11px] text-mg-muted">No hay ningún servidor MCP.</p>;
  return (
    <table className="w-full border-collapse text-left text-[11px]" aria-label="Servidores MCP y conectores">
      <thead>
        <tr className="border-b border-mg-border-subtle text-[9.5px] uppercase tracking-[.06em] text-mg-ter">
          <th className="py-[5px] pr-[8px] font-semibold">Nombre</th>
          <th className="py-[5px] pr-[8px] font-semibold">Tipo</th>
          <th className="py-[5px] pr-[8px] font-semibold">Proveedores</th>
          <th className="py-[5px] pr-[8px] font-semibold">Cuentas</th>
          <th className="py-[5px] pr-[8px] font-semibold">Estado</th>
          <th className="py-[5px] font-semibold">
            <span className="sr-only">Acciones</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <McpTableRowView key={row.key} row={row} onEdit={onEdit} onScope={onScope} />
        ))}
      </tbody>
    </table>
  );
}

function McpTableRowView({ row, onEdit, onScope }: { readonly row: McpTableRow } & RowHandlers): React.JSX.Element {
  const accountsLabel = useAccountsLabel(row.accounts);
  return (
    <tr data-mcp-row={row.name} className="border-b border-mg-border-subtle align-top">
      <td className="py-[6px] pr-[8px] font-medium text-mg-body">{row.name}</td>
      <td className="py-[6px] pr-[8px]">
        <div className="flex flex-wrap items-center gap-[4px]">
          <span className="text-mg-body2">{row.typeLabel}</span>
          {row.badges.map((badge) => (
            <OriginBadge key={`${badge.kind}:${badge.label}`} badge={badge} />
          ))}
          {row.ownedBy !== null && <OwnedByBadge family={row.ownedBy} />}
        </div>
      </td>
      <td className="py-[6px] pr-[8px]">
        <ProviderPills providers={row.providers} testId={row.name} />
        {row.inventory?.exportedToAgy === true && <span className="block text-[9.5px] text-mg-muted">agy: copia, puede estar desfasada</span>}
        {row.inventory?.onlyIn != null && <span className="block text-[9.5px] text-mg-muted">Solo en lo elegido</span>}
      </td>
      <td className="py-[6px] pr-[8px] text-mg-sec">{accountsLabel}</td>
      <td className="py-[6px] pr-[8px] text-mg-sec">
        <span data-mcp-status="true">{row.statusLabel}</span>
        <McpAuthActions serverName={row.cliName} accountDirs={row.needsAuth} />
      </td>
      <td className="py-[6px]">
        <RowActions row={row} onEdit={onEdit} onScope={onScope} />
      </td>
    </tr>
  );
}

function useAccountsLabel(accountDirs: readonly string[]): string {
  const accounts = useWorkbenchStore((s) => s.accounts);
  if (accountDirs.length === 0) return '—';
  if (accounts.length > 1 && accountDirs.length === accounts.length) return 'Todas';
  return accountDirs.map((dir) => accounts.find((account) => account.id === dir)?.alias ?? dir).join(', ');
}

// «Autenticar» (punto 18): OAuth del PROPIO servidor MCP (no el login de Claude) con el CLI de esa
// cuenta, que guarda el token en su config dir. Un boton por cuenta que lo pide: el token es por cuenta,
// asi que no hay una eleccion que adivinar. Uno a la vez: mientras uno espera al navegador, los demas
// se deshabilitan. Tambien lo usa el Inspector › MCP.
export function McpAuthActions({
  serverName,
  accountDirs,
  label = 'Autenticar',
}: {
  readonly serverName: string;
  readonly accountDirs: readonly string[];
  readonly label?: string;
}): React.JSX.Element | null {
  const authenticating = useMcpStore((s) => s.authenticating);
  const messages = useMcpStore((s) => s.authMessages);
  const authenticate = useMcpStore((s) => s.authenticate);
  const aliasOf = useAliasOf();
  const results = Object.entries(messages).filter(([key]) => key.endsWith(`
${serverName}`));
  if (accountDirs.length === 0 && results.length === 0) return null;
  return (
    <div className="mt-[4px] flex flex-col items-start gap-[3px]">
      {accountDirs.map((accountDir) => {
        const alias = aliasOf(accountDir);
        const running = authenticating === mcpAuthKey(accountDir, serverName);
        return (
          <button
            key={accountDir}
            onClick={() => void authenticate(accountDir, serverName)}
            disabled={authenticating !== null}
            aria-label={`Autenticar ${serverName} en ${alias}`}
            data-tip="Abre en el navegador la autorización del propio servidor MCP. Mage espera la vuelta hasta 5 minutos."
            className={BUTTON_CLASS}
          >
            <Icon name="external" />
            {running ? 'Autenticando…' : buttonText(label, alias, accountDirs.length)}
          </button>
        );
      })}
      {results.map(([key, message]) => (
        <span key={key} role={message.ok ? 'status' : 'alert'} data-mcp-auth-message="true" className={`max-w-[260px] text-[10px] ${message.ok ? 'text-mg-sec' : 'text-mg-danger'}`}>
          {message.text}
        </span>
      ))}
    </div>
  );
}

function buttonText(label: string, alias: string, accounts: number): string {
  return accounts > 1 ? `${label} en ${alias}` : label;
}

export function OriginBadge({ badge }: { readonly badge: McpBadge }): React.JSX.Element {
  const skin = badge.kind === 'common' ? 'bg-mg-sel text-mg-focus' : 'bg-mg-hover text-mg-body2';
  return <span className={`rounded-[4px] px-[5px] py-[1px] text-[9px] font-semibold ${skin}`}>{badge.label}</span>;
}

function RowActions({ row, onEdit, onScope }: { readonly row: McpTableRow } & RowHandlers): React.JSX.Element | null {
  const inventoryRow = row.inventory;
  if (inventoryRow === null) return null;
  if (inventoryRow.common !== null) return <CommonActions row={inventoryRow} onEdit={() => onEdit(inventoryRow)} onScope={() => onScope(inventoryRow)} />;
  return <ForeignActions row={inventoryRow} />;
}

function CommonActions({ row, onEdit, onScope }: { readonly row: McpInventoryRow; readonly onEdit: () => void; readonly onScope: () => void }): React.JSX.Element {
  const mutate = useMcpStore((s) => s.mutate);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (action: Parameters<typeof mutate>[0]): void => {
    setError(null);
    mutate(action)
      .then((result) => setError(result.status === 'stale' ? result.message : null))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div className="flex flex-col items-end gap-[3px]">
      <div className="flex items-center justify-end gap-[2px]">
        <button onClick={onEdit} aria-label={`Editar ${row.name}`} data-tip="Editar" className={ICON_BUTTON_CLASS}>
          <Icon name="pencil" />
        </button>
        <button onClick={onScope} aria-label={`Solo en… ${row.name}`} data-tip="Solo en…: elegir qué proveedores y cuentas lo cargan" className={ICON_BUTTON_CLASS}>
          <Icon name="user" />
        </button>
        <button
          onClick={() => run({ op: 'setDisabled', name: row.name, disabled: !row.disabled })}
          aria-label={row.disabled ? `Activar ${row.name}` : `Desactivar ${row.name}`}
          data-tip={row.disabled ? 'Activar: vuelve a cargarse en las sesiones nuevas' : 'Desactivar: deja de cargarse sin borrarlo'}
          className={ICON_BUTTON_CLASS}
        >
          <Icon name={row.disabled ? 'eyeOff' : 'eye'} />
        </button>
        {confirmRemove ? (
          <button onClick={() => run({ op: 'remove', name: row.name })} className={`${BUTTON_CLASS} text-mg-danger`}>
            ¿Quitar?
          </button>
        ) : (
          <button onClick={() => setConfirmRemove(true)} aria-label={`Quitar ${row.name}`} data-tip="Quitar de los comunes" className={ICON_BUTTON_CLASS}>
            <Icon name="trash" />
          </button>
        )}
      </div>
      {error !== null && (
        <span role="alert" className="max-w-[240px] text-right text-[10px] text-mg-danger">
          {error}
        </span>
      )}
    </div>
  );
}

function ForeignActions({ row }: { readonly row: McpInventoryRow }): React.JSX.Element {
  const applyImport = useMcpStore((s) => s.applyImport);
  const commonVersion = useMcpStore((s) => s.inventory?.commonVersion ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const origin = row.origins[0]!;
  const copy = (): void => {
    setMessage(null);
    applyImport([{ id: origin.importId, replace: false }], commonVersion)
      .then((result) => setMessage(result.status === 'stale' ? result.message : null))
      .catch((err: unknown) => setMessage(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div className="flex flex-col items-end gap-[3px]">
      <div className="flex items-center justify-end gap-[2px]">
        <button
          onClick={copy}
          aria-label={`Copiar ${row.name} a comunes`}
          data-tip="Copiar a comunes: lo verán todas las cuentas. El original no se toca."
          className={ICON_BUTTON_CLASS}
        >
          <Icon name="copy" />
        </button>
        <button onClick={() => void window.mage.revealFile(origin.path)} aria-label={`Ver ubicación de ${row.name}`} data-tip={origin.path} className={ICON_BUTTON_CLASS}>
          <Icon name="folderOpen" />
        </button>
      </div>
      {message !== null && (
        <span role="alert" className="max-w-[240px] text-right text-[10px] text-mg-danger">
          {message}
        </span>
      )}
    </div>
  );
}
