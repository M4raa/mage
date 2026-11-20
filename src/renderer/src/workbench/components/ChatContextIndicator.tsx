import { useT } from '../../i18n/uiLanguage';
import { contextPctOf } from '../contextView';
import { usePaneTabId } from '../paneContext';
import { useWorkbenchStore } from '../workbenchStore';

// % de la ventana de contexto de la conversación de ESTE panel, a la derecha del modelo en la línea de debajo del input
// (antes en la barra de estado). Sin dato del CLI todavía, no se pinta.
export function ChatContextIndicator(): React.JSX.Element | null {
  const tabId = usePaneTabId();
  const pct = useWorkbenchStore((s) => contextPctOf(s.contextUsageByChat[tabId]));
  const t = useT();
  if (pct === null) return null;
  return (
    <span data-chat-context={pct} data-tip={t('tabs.subline.contextTip')} className="cursor-help tabular-nums text-mg-muted">
      {t('tabs.subline.context', { pct })}
    </span>
  );
}
