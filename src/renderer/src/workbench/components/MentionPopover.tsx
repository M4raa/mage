import type { MentionKind } from '@shared/mentions';
import { useT } from '../../i18n/uiLanguage';
import type { MentionRow, MentionSection } from '../mentionDraft';
import type { MentionSuggestions } from '../useMentionSuggestions';
import { Icon, type IconName } from './Icon';

// Icono por clase de fichero (compartido con las fichas de la caja).
export const MENTION_KIND_ICON: Readonly<Record<MentionKind, IconName>> = {
  image: 'eye',
  pdf: 'note',
  text: 'file',
  binary: 'file',
};

const SECTION_LABEL_KEY = {
  conversation: 'prompt.mentions.sectionConversation',
  files: 'prompt.mentions.sectionFiles',
} as const satisfies Record<MentionSection, 'prompt.mentions.sectionConversation' | 'prompt.mentions.sectionFiles'>;

function splitRelPath(relPath: string): { readonly name: string; readonly dir: string } {
  const cut = relPath.lastIndexOf('/');
  return cut < 0 ? { name: relPath, dir: '' } : { name: relPath.slice(cut + 1), dir: relPath.slice(0, cut) };
}

function MentionOption({ row, selected, onPick, onHover }: { readonly row: MentionRow; readonly selected: boolean; readonly onPick: () => void; readonly onHover: () => void }): React.JSX.Element {
  const { name, dir } = splitRelPath(row.relPath);
  return (
    <button
      role="option"
      aria-selected={selected}
      data-mention-option={row.relPath}
      onClick={onPick}
      onMouseEnter={onHover}
      className={`flex w-full items-baseline gap-[8px] px-[11px] py-[6px] text-left ${selected ? 'bg-mg-hover' : ''}`}
    >
      <Icon name={row.candidate === null ? 'file' : MENTION_KIND_ICON[row.candidate.kind]} size={12} className="self-center text-mg-sec" />
      <span className="flex-none font-mono text-[11.5px] text-mg-body">{name}</span>
      <span className="truncate text-[10.5px] text-mg-muted">{dir}</span>
    </button>
  );
}

// Popover de menciones `@` (Q06). Mismo estilo y sitio que el de comandos `/`: encima de la caja.
export function MentionPopover({ suggestions }: { readonly suggestions: MentionSuggestions }): React.JSX.Element {
  const t = useT();
  const { rows, state, index } = suggestions;
  const untrusted = state.status === 'ready' && state.untrusted;
  return (
    <div
      role="listbox"
      data-mention-popover="true"
      aria-label={t('prompt.mentions.listLabel')}
      className="absolute bottom-full left-0 mb-[6px] w-[340px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-panel py-[4px] mg-shadow-pop"
    >
      {untrusted && <div className="px-[11px] py-[6px] text-[10.5px] text-mg-muted">{t('prompt.mentions.untrusted')}</div>}
      {state.status === 'error' && <div role="alert" className="px-[11px] py-[6px] text-[10.5px] text-mg-danger">{state.message}</div>}
      {rows.map((row, i) => (
        <div key={`${row.section}:${row.relPath}`}>
          {(i === 0 || rows[i - 1]?.section !== row.section) && (
            <div className="px-[11px] pb-[2px] pt-[4px] text-[9.5px] uppercase tracking-[0.04em] text-mg-ter">{t(SECTION_LABEL_KEY[row.section])}</div>
          )}
          <MentionOption row={row} selected={i === index} onPick={() => suggestions.pick(row)} onHover={() => suggestions.setIndex(i)} />
        </div>
      ))}
      {rows.length === 0 && !untrusted && state.status === 'ready' && <div className="px-[11px] py-[6px] text-[10.5px] text-mg-muted">{t('prompt.mentions.empty')}</div>}
      {rows.length === 0 && state.status === 'idle' && <div className="px-[11px] py-[6px] text-[10.5px] text-mg-muted">{t('prompt.mentions.searching')}</div>}
      {state.status === 'ready' && state.truncated && <div className="px-[11px] py-[4px] text-[10px] text-mg-ter">{t('prompt.mentions.truncated')}</div>}
    </div>
  );
}
