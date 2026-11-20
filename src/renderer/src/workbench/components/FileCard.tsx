import { Icon } from './Icon';
import { usePaneTabId } from '../paneContext';
import type { FileCardView } from '../fileCardView';
import { fileDocId } from '../planReferences';
import { useWorkbenchStore } from '../workbenchStore';
import { useT } from '../../i18n/uiLanguage';

// Ficha de un fichero creado o editado por el agente: «Creado «nombre»» o «Editado «nombre»», con la ruta al pasar el
// ratón, y «›», que lo abre en Ficheros.
export function FileCard({ card }: { readonly card: FileCardView }): React.JSX.Element {
  const t = useT();
  const tabId = usePaneTabId();
  const cwd = useWorkbenchStore((s) => s.tabs.find((tab) => tab.id === tabId)?.cwd ?? null);
  const openFileInPanel = useWorkbenchStore((s) => s.openFileInPanel);
  const label = t(card.action === 'created' ? 'chat.fileCard.created' : 'chat.fileCard.edited', { name: card.name });
  return (
    <div className="flex justify-start">
      <button
        type="button"
        data-file-card={card.path}
        title={card.path}
        disabled={cwd === null}
        onClick={() => cwd !== null && openFileInPanel(tabId, fileDocId(card.path, cwd))}
        className="flex max-w-[340px] min-w-0 items-center gap-[8px] rounded-[8px] border border-mg-border-subtle bg-mg-block px-[11px] py-[7px] text-left text-[12px] hover:bg-mg-hover disabled:opacity-60"
      >
        <Icon name="file" size={12} />
        <span className="min-w-0 flex-1 truncate text-mg-body">{label}</span>
        <Icon name="chevron" size={11} />
      </button>
    </div>
  );
}
