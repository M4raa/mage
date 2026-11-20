import { useMemo } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { useT } from '../../i18n/uiLanguage';
import { usePaneTabId } from '../paneContext';
import { artifactCardsOf } from '../artifactView';
import { ArtifactCard } from './ArtifactCard';
import { Hint } from './TranscriptHint';
import type { Block } from '../types';

// Panel "Artifacts": todo lo que esta conversacion ha publicado, sin tener que buscarlo scrolleando el
// hilo (peticion del usuario).
//
// La fuente son los BLOQUES del chat y no un registro aparte. Es a proposito: los bloques se hidratan
// desde la transcripcion al reabrir una conversacion, asi que la lista sale igual de completa en una
// conversacion viva que en una de hace un mes, y no hay nada nuevo que persistir ni que se pueda
// desincronizar del hilo.
//
// Se reutiliza la MISMA tarjeta del chat, no una version reducida: lo que hace util a un artifact es
// poder abrirlo con la cuenta que lo publico, y esa logica no se duplica.
//
// «Todos los artifacts» abre la pantalla con los de todas las cuentas (creados y compartidos), tambien sin
// conversacion: por eso el boton va en la cabecera, que se pinta siempre.
const EMPTY_BLOCKS: readonly Block[] = [];

export function ArtifactsPanel(): React.JSX.Element {
  const t = useT();
  const tabId = usePaneTabId();
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? EMPTY_BLOCKS);
  const openLibrary = useWorkbenchStore((s) => s.openArtifactsLibrary);
  const cards = useMemo(() => artifactCardsOf(blocks), [blocks]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-[8px] border-b border-mg-border-subtle px-[10px] py-[6px] text-[10px] text-mg-ter">
        <span className="font-bold tracking-[.06em]">{t('chat.artifacts.title', { count: cards.length })}</span>
        <button data-artifacts-open-library onClick={openLibrary} className="rounded-[6px] border border-mg-border-ctrl px-[8px] py-[2px] text-[10.5px] text-mg-body2 hover:bg-mg-hover">
          {t('chat.artifacts.openLibrary')}
        </button>
      </div>
      {cards.length === 0 ? (
        <Hint text={t('chat.artifacts.empty')} />
      ) : (
        <div className="flex min-h-0 flex-col gap-[8px] overflow-y-auto p-[10px]">
          {cards.map((card) => (
            <ArtifactCard key={card.url} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
