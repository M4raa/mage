import { DELEGATION_DEPTH_MAX, DELEGATION_DEPTH_MIN } from '@shared/settings';
import { useT } from '../../../i18n/uiLanguage';
import { useWorkbenchStore } from '../../workbenchStore';
import { useMcpRegistration } from './useMcpRegistration';

const BUTTON_CLASS =
  'rounded-[7px] border border-mg-border-emph px-[12px] py-[6px] text-[11.5px] text-mg-body transition-colors duration-90 ease-out hover:bg-mg-hover disabled:opacity-50';
const PROVIDER_LABEL = { claude: 'Claude', codex: 'Codex' } as const;
const DEPTH_OPTIONS = Array.from({ length: DELEGATION_DEPTH_MAX - DELEGATION_DEPTH_MIN + 1 }, (_, index) => DELEGATION_DEPTH_MIN + index);

function DepthSelector(): React.JSX.Element {
  const t = useT();
  const depth = useWorkbenchStore((s) => s.settings.delegation.maxDepth);
  const setDelegationDepth = useWorkbenchStore((s) => s.setDelegationDepth);
  return (
    <label className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
      <select
        className="w-[60px] rounded-[4px] border border-mg-border bg-transparent px-[6px] py-[2px] text-[11.5px] text-mg-body"
        value={depth}
        onChange={(e) => setDelegationDepth(Number(e.target.value))}
      >
        {DEPTH_OPTIONS.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <span>
        <span className="font-semibold">{t('settings.mcpServer.depthLabel')}</span>
        <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{t('settings.mcpServer.depthHelp')}</span>
      </span>
    </label>
  );
}

// P-038 V7: el interruptor que de verdad decide si las conversaciones de Mage tienen el MCP de Mage. Encendido,
// cada conversación de Claude o Codex que se lance o se reabra lo recibe (privadas incluidas); las ya abiertas no.
function MageMcpToggle(): React.JSX.Element {
  const t = useT();
  const enabled = useWorkbenchStore((s) => s.settings.mageMcpEnabled);
  const setMageMcpEnabled = useWorkbenchStore((s) => s.setMageMcpEnabled);
  return (
    <label data-setting="mage-mcp-enabled" className="flex items-start gap-[8px] text-[11.5px] text-mg-body">
      <input type="checkbox" className="mt-[2px]" checked={enabled} onChange={(e) => setMageMcpEnabled(e.target.checked)} />
      <span>
        <span className="font-semibold">{t('settings.mcpServer.enabledLabel')}</span>
        <span className="block text-[10.5px] leading-[1.45] text-mg-ter">{t('settings.mcpServer.enabledHelp')}</span>
      </span>
    </label>
  );
}

// H4 y U10: registrar el servidor MCP de Mage en las cuentas de Claude y Codex, y la profundidad de delegación.
export function McpServerSection(): React.JSX.Element {
  const t = useT();
  const { result, busy, unavailable, register, unregister } = useMcpRegistration();
  const accountNames = new Map((result?.entries ?? []).map((entry) => [entry.accountId, entry.accountName]));
  return (
    <div data-setting="mcp-server" className="mt-[8px] flex flex-col gap-[8px] border-t border-mg-border pt-[12px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('settings.sections.mcpServer.title')}</span>
      <MageMcpToggle />
      <span className="text-[10.5px] leading-[1.45] text-mg-ter">{t('settings.mcpServer.intro')}</span>
      <span className="text-[10.5px] leading-[1.45] text-mg-ter">{t('settings.mcpServer.onlyFromMage')}</span>
      <ul role="status" className="flex flex-col gap-[3px] text-[11.5px] text-mg-body">
        {unavailable && <li className="text-mg-ter">{t('settings.mcpServer.statusUnavailable')}</li>}
        {result?.entries.map((entry) => (
          <li key={entry.accountId}>
            {entry.accountName} ({PROVIDER_LABEL[entry.provider]}): {t(entry.registered ? 'settings.mcpServer.registered' : 'settings.mcpServer.notRegistered')}
          </li>
        ))}
        {result?.failures.map((failure) => (
          <li key={failure.accountId} className="text-mg-ter">
            {t('settings.mcpServer.failed', { account: accountNames.get(failure.accountId) ?? failure.accountId, detail: failure.message })}
          </li>
        ))}
      </ul>
      <div className="flex gap-[8px]">
        <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={register}>{t('settings.mcpServer.registerAll')}</button>
        <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={unregister}>{t('settings.mcpServer.unregisterAll')}</button>
      </div>
      <DepthSelector />
    </div>
  );
}
