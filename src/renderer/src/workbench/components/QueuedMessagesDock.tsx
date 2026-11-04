import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import { queueEditAction, type QueuedMessage } from '../messageQueue';
import { Icon } from './Icon';
import { useT } from '../../i18n/uiLanguage';

// Lista «En cola» encima del input (0.1.1 R2, punto 30): lo que el usuario mando con un turno en marcha.
// NO son burbujas enviadas: salen al hilo de una en una cuando acaba cada turno. Por elemento, editar (en la
// propia fila: Enter guarda en su sitio, Escape cancela) y quitar.
const MAX_EDIT_ROWS = 4;
const NO_QUEUE: readonly QueuedMessage[] = [];

export function QueuedMessagesDock(): React.JSX.Element {
  const t = useT();
  const tabId = usePaneTabId();
  const queue = useWorkbenchStore((s) => s.queuedByChat[tabId] ?? NO_QUEUE);
  return (
    <AnimatePresence initial={false}>
      {queue.length > 0 && (
        <motion.div key="queue" variants={DISCLOSURE_VARIANTS} initial="initial" animate="animate" exit="exit" className="overflow-hidden px-[22px] pt-[8px]">
          <div data-queued-messages="true" className="overflow-hidden rounded-[10px] border border-mg-border bg-mg-panel">
            <div className="flex h-[24px] items-center gap-[6px] pl-[10px] text-[10.5px] font-semibold text-mg-sec">
              <Icon name="queue" size={10} />
              {t('prompt.queue.header', { count: queue.length })}
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
  const t = useT();
  const updateQueuedMessage = useWorkbenchStore((s) => s.updateQueuedMessage);
  const removeQueuedMessage = useWorkbenchStore((s) => s.removeQueuedMessage);
  // null = no se edita; si no, el texto en edición.
  const [draft, setDraft] = useState<string | null>(null);
  const images = message.attachments.length;
  const onEditKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const action = queueEditAction({ key: e.key, shiftKey: e.shiftKey, value: draft ?? '', original: message.text, images });
    if (action === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (action === 'keep') return;
    if (action === 'save') void updateQueuedMessage(tabId, message.id, draft ?? '');
    setDraft(null);
  };
  const rowLayout = draft === null ? 'h-[26px] items-center' : 'min-h-[26px] items-start py-[3px]';
  return (
    <div data-queued-message={message.id} className={`flex ${rowLayout} gap-[6px] border-t border-mg-border-subtle pl-[10px] pr-[6px] text-[11px]`}>
      {draft === null ? (
        <span className="min-w-0 flex-1 truncate text-mg-body2" title={message.text}>
          {message.text.length > 0 ? message.text : t('prompt.queue.imagesOnly')}
        </span>
      ) : (
        <textarea
          data-queued-edit-field="true"
          aria-label={t('prompt.queue.editField')}
          data-tip={t('prompt.queue.editField')}
          value={draft}
          autoFocus
          rows={Math.min(MAX_EDIT_ROWS, Math.max(1, draft.split('\n').length))}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onEditKey}
          className="min-w-0 flex-1 resize-none rounded-[4px] border border-mg-border-ctrl bg-mg-panel px-[4px] py-[1px] text-[11px] text-mg-body outline-none"
        />
      )}
      {images > 0 && <span className="flex-none text-[10px] text-mg-muted">{t('prompt.queue.imageCount', { count: images })}</span>}
      {draft === null && <QueueAction icon="pencil" label={t('prompt.queue.editInline')} attr="data-queued-edit" onClick={() => setDraft(message.text)} />}
      <QueueAction icon="close" label={t('prompt.queue.remove')} attr="data-queued-remove" onClick={() => removeQueuedMessage(tabId, message.id)} />
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
      className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[4px] text-mg-muted hover:bg-mg-sel hover:text-mg-sel-ink"
    >
      <Icon name={icon} size={10} />
    </button>
  );
}
