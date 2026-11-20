import { Icon, type IconName } from './Icon';
import { MENTION_KIND_ICON } from './MentionPopover';
import { usePaneTabId } from '../paneContext';
import { formatSize } from '../conversationList';
import { fileDocId } from '../planReferences';
import type { SentAttachment } from '../sentAttachments';
import { useWorkbenchStore } from '../workbenchStore';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;
const PDF_EXT_RE = /\.pdf$/i;

// Icono por extensión: la misma clase de glifo que las fichas del prompt.
function iconFor(name: string): IconName {
  if (IMAGE_EXT_RE.test(name)) return MENTION_KIND_ICON.image;
  return PDF_EXT_RE.test(name) ? MENTION_KIND_ICON.pdf : MENTION_KIND_ICON.text;
}

// Los ficheros que el usuario adjuntó al mensaje enviado, como fichas (icono, nombre, tamaño y ruta al pasar el ratón).
// Pulsar una la abre en Ficheros.
export function SentAttachmentCards({ files }: { readonly files: readonly SentAttachment[] }): React.JSX.Element {
  const tabId = usePaneTabId();
  const cwd = useWorkbenchStore((s) => s.tabs.find((tab) => tab.id === tabId)?.cwd ?? null);
  const openFileInPanel = useWorkbenchStore((s) => s.openFileInPanel);
  return (
    <div className="flex flex-wrap gap-[6px] pt-[2px]">
      {files.map((file, index) => (
        <button
          key={`${file.path}:${index}`}
          type="button"
          data-sent-attachment={file.path}
          title={file.path}
          disabled={cwd === null}
          onClick={() => cwd !== null && openFileInPanel(tabId, fileDocId(file.path, cwd))}
          className="inline-flex items-center gap-[6px] rounded-[8px] border border-mg-border-subtle px-[8px] py-[4px] text-[12px] hover:bg-mg-hover disabled:opacity-60"
        >
          <Icon name={iconFor(file.name)} size={14} />
          <span className="font-mono">{file.name}</span>
          {file.bytes !== null && <span className="text-mg-muted">{formatSize(file.bytes)}</span>}
        </button>
      ))}
    </div>
  );
}
