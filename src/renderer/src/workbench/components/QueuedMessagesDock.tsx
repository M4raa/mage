import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import type { QueuedMessage } from '../messageQueue';
import { Icon } from './Icon';

// Lista «En cola» encima del input (0.1.1 R2, punto 30): lo que el usuario mando con un turno en marcha.
// NO son burbujas enviadas: salen al hilo de una en una cuando acaba cada turno. Por elemento, editar (lo
// devuelve al input) y quitar.
const NO_QUEUE: readonly QueuedMessage[] = [];

export function QueuedMessagesDock(): React.JSX.Element {
  const tabId = usePaneTabId();
  const queue = useWorkbenchStore((s) => s.queuedByChat[tabId] ?? NO_QUEUE);
  return (
    <AnimatePresence initial={false}>
      {queue.length > 0 && (
        <motion.div key="queue" variants={DISCLOSURE_VARIANTS} initial="initial" animate="animate" exit="exit" className="overflow-hidden px-[22px] pt-[8px]">
          <div data-queued-messages="true" className="overflow-hidden rounded-[10px] border border-mg-border bg-mg-panel">
            <div className="flex h-[24px] items-center gap-[6px] pl-[10px] text-[10.5px] font-semibold text-mg-sec">
              <Icon name="queue" size={10} />
              En cola ({queue.length}) · se enviará al terminar el turno
            </div>
            {queue.map((message) => (
              <QueuedMessageRow key={message.id} tabId={tabId} message={message} />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function QueuedMessageRow({ tabId, message }: { readonly tabId: string; readonly message: QueuedMessage }): React.JSX.Element {
  const editQueuedMessage = useWorkbenchStore((s) => s.editQueuedMessage);
  const removeQueuedMessage = useWorkbenchStore((s) => s.removeQueuedMessage);
  const images = message.attachments.length;
  return (
    <div data-queued-message={message.id} className="flex h-[26px] items-center gap-[6px] border-t border-mg-border-subtle pl-[10px] pr-[6px] text-[11px]">
      <span className="min-w-0 flex-1 truncate text-mg-body2" title={message.text}>
        {message.text.length > 0 ? message.text : '(solo imágenes)'}
      </span>
      {images > 0 && <span className="flex-none text-[10px] text-mg-muted">{images === 1 ? '1 imagen' : `${images} imágenes`}</span>}
      <QueueAction icon="pencil" label="Editar: devolver al input" attr="data-queued-edit" onClick={() => editQueuedMessage(tabId, message.id)} />
      <QueueAction icon="close" label="Quitar de la cola" attr="data-queued-remove" onClick={() => removeQueuedMessage(tabId, message.id)} />
    </div>
  );
}

function QueueAction({ icon, label, attr, onClick }: { readonly icon: 'pencil' | 'close'; readonly label: string; readonly attr: string; readonly onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      {...{ [attr]: 'true' }}
      aria-label={label}
      data-tip={label}
      className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[4px] text-mg-muted hover:bg-mg-sel hover:text-mg-body"
    >
      <Icon name={icon} size={10} />
    </button>
  );
}
