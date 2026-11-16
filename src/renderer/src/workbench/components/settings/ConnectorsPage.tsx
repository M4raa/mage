import { useState } from 'react';
import type { LibraryKind } from '@shared/ipc';
import { useT } from '../../../i18n/uiLanguage';
import { CLAUDE_AI_CONNECTORS_URL } from '../../mcpView';
import { Icon } from '../Icon';
import {
  accountChoice,
  CAPABILITY_PAGE_CLASS,
  CapabilityHeader,
  NOOP,
  useClaudeAccountChoice,
  type CapabilityTab,
} from './CapabilityPage';
import { LibrarySection } from './LibrarySection';
import { McpSection } from './McpSection';
import { MCP_BUTTON_CLASS } from './mcpStyles';

// «MCP y conectores»: la cabecera común va FUERA de `[data-mcp-section]` porque «P-038 V12» mide que
// el primer tablist de la sección viene después de la tarjeta del MCP de Mage y diez comprobaciones usan `[data-mcp-tab]`
// y los botones de su barra; por eso «Añadir ▾» no se duplica aquí. «Tuyos» es `McpSection` tal cual.
const CONNECTOR_LIBRARY_KINDS: readonly LibraryKind[] = ['mcp'];

function DiscoverConnectors({ accountDir }: { readonly accountDir: string | null }): React.JSX.Element {
  const t = useT();
  return (
    <div className={CAPABILITY_PAGE_CLASS}>
      <section data-connectors-directory="true" className="flex items-center gap-[10px] rounded-[9px] border border-mg-border-subtle p-[10px_12px]">
        <Icon name="globe" className="text-mg-focus" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[12px] font-semibold text-mg-text">{t('capabilities.connectors.directoryTitle')}</span>
          <span className="text-[10.5px] leading-[1.45] text-mg-sec">{t('capabilities.connectors.directoryHint')}</span>
        </div>
        <button onClick={() => void window.mage.openExternal(CLAUDE_AI_CONNECTORS_URL)} className={MCP_BUTTON_CLASS}>
          <Icon name="external" />
          {t('capabilities.connectors.directoryOpen')}
        </button>
      </section>
      {accountDir === null ? t('capabilities.noClaudeAccounts') : <LibrarySection kinds={CONNECTOR_LIBRARY_KINDS} accountDir={accountDir} />}
    </div>
  );
}

export function ConnectorsPage(): React.JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<CapabilityTab>('mine');
  const { accounts, accountDir, setAccountDir } = useClaudeAccountChoice();
  const choices = tab === 'discover' && accountDir !== null ? [accountChoice(t, accounts, accountDir, setAccountDir)] : [];
  return (
    <div data-capabilities-page="connectors" className="flex min-h-0 flex-1 flex-col">
      <div className="p-[14px_16px_0]">
        <CapabilityHeader tab={tab} onTab={setTab} query={null} onQuery={NOOP} placeholder="" choices={choices} add={[]} />
      </div>
      {tab === 'mine' ? <McpSection /> : <DiscoverConnectors accountDir={accountDir} />}
    </div>
  );
}
