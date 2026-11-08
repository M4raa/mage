import { useEffect } from 'react';
import type { MentionCandidate } from '@shared/mentions';
import { useT } from '../../i18n/uiLanguage';
import { formatSize } from '../conversationList';
import { chipDelivery, type MentionFailure } from '../mentionDraft';
import type { MentionPreviews } from '../useMentionPreviews';
import { Icon } from './Icon';
import { MENTION_KIND_ICON } from './MentionPopover';

// Fichas de los ficheros mencionados con `@` (Q06), en la fila de los adjuntos.

const THUMB_PX = 20;
const TOOLTIP_HEAD_MAX_LINES = 6;
const TOOLTIP_HEAD_MAX_CHARS = 400;

function baseName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

function headForTooltip(head: string): string {
  return head.split('\n').slice(0, TOOLTIP_HEAD_MAX_LINES).join('\n').slice(0, TOOLTIP_HEAD_MAX_CHARS);
}

interface MentionChipProps {
  readonly mention: MentionCandidate;
  readonly provider: string;
  readonly failure: MentionFailure | undefined;
  readonly previews: MentionPreviews;
  readonly onRemove: () => void;
}

function MentionChip({ mention, provider, failure, previews, onRemove }: MentionChipProps): React.JSX.Element {
  const t = useT();
  const name = baseName(mention.relPath);
  const preview = previews.get(mention.absPath);
  const pathOnly = chipDelivery(mention.kind, mention.bytes, provider) === 'pathOnly';
  // La miniatura de una imagen se pide al aparecer la ficha.
  useEffect(() => {
    if (mention.kind === 'image') previews.ensure(mention.absPath);
    // `previews` cambia de identidad en cada render: lo que cuenta es el fichero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mention.kind, mention.absPath]);
  const tooltip = preview?.kind === 'text' ? `${mention.relPath}\n${headForTooltip(preview.head)}` : mention.relPath;
  return (
    <div
      data-mention-chip={mention.relPath}
      data-mention-error={failure}
      title={tooltip}
      onMouseEnter={() => (mention.kind === 'text' ? previews.ensure(mention.absPath) : undefined)}
      className={`flex items-center gap-[5px] rounded-[6px] border bg-mg-panel px-[7px] py-[3px] text-[11px] text-mg-body2 ${failure === undefined ? 'border-mg-border-ctrl' : 'border-mg-danger'}`}
    >
      {preview?.kind === 'image' ? (
        <img src={preview.dataUrl} alt="" width={THUMB_PX} height={THUMB_PX} className="rounded-[3px] object-cover" style={{ width: THUMB_PX, height: THUMB_PX }} />
      ) : (
        <Icon name={MENTION_KIND_ICON[mention.kind]} size={12} className="text-mg-sec" />
      )}
      <span className="font-mono">{name}</span>
      {mention.kind === 'pdf' && <span className="text-mg-muted">{t('prompt.mentions.pdf', { size: formatSize(mention.bytes) })}</span>}
      {pathOnly && (
        <span data-mention-path-only="true" className="rounded-[4px] bg-mg-hover px-[4px] text-[9.5px] text-mg-sec">
          {t('prompt.mentions.pathOnly')}
        </span>
      )}
      <button onClick={onRemove} aria-label={t('prompt.mentions.remove', { name })} className="flex h-[14px] w-[14px] items-center justify-center rounded-full text-mg-sec hover:bg-mg-hover">
        <Icon name="close" size={10} />
      </button>
    </div>
  );
}

export interface MentionChipsProps {
  readonly mentions: readonly MentionCandidate[];
  readonly provider: string;
  readonly failures: ReadonlyMap<string, MentionFailure>;
  readonly previews: MentionPreviews;
  readonly onRemove: (mention: MentionCandidate) => void;
}

export function MentionChips({ mentions, provider, failures, previews, onRemove }: MentionChipsProps): React.JSX.Element {
  return (
    <>
      {mentions.map((mention) => (
        <MentionChip key={mention.absPath} mention={mention} provider={provider} failure={failures.get(mention.relPath)} previews={previews} onRemove={() => onRemove(mention)} />
      ))}
    </>
  );
}
