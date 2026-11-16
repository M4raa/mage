import { Icon } from './Icon';
import type { DelegationCardView } from '../delegationView';
import { useOpenSubsession } from '../useOpenSubsession';
import { useT } from '../../i18n/uiLanguage';

// Tarjeta de una subsesión creada con `mage_create_session`: su nombre y «›», que la abre (su pestaña, o desde el
// historial si ya no está abierta).
export function DelegationCard({ card }: { readonly card: DelegationCardView }): React.JSX.Element {
  const open = useOpenSubsession();
  const t = useT();
  const title = card.title.length > 0 ? card.title : t('chat.sessionResult.unnamed');
  return (
    <div className="flex justify-start">
      <button
        type="button"
        data-delegation-card={card.conversationId}
        onClick={() => open(card.conversationId)}
        className="flex max-w-[340px] min-w-0 items-center gap-[8px] rounded-[8px] border border-mg-border-subtle bg-mg-block px-[11px] py-[7px] text-left text-[12px] hover:bg-mg-hover"
      >
        <span className="min-w-0 flex-1 truncate text-mg-body" title={title}>{title}</span>
        <Icon name="chevron" size={11} />
      </button>
    </div>
  );
}
