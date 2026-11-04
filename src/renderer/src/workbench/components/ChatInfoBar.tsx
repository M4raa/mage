import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { creatorTabOf } from '../adoptSession';
import { usePaneTabId } from '../paneContext';
import { privacyChip } from '../chatInfoView';
import { CHIP_CLASS } from './GitChips';
import { PrBar } from './PrBar';
import { reportActionError } from '../notificationStore';
import { useT } from '../../i18n/uiLanguage';

// Fila de informacion del chat, encima del input (peticion del usuario).
//
// La alternativa que se pidio primero era la "status line" del CLI, pero esa es una linea que el
// usuario CONFIGURA con un comando propio y que el CLI ejecuta: traerla aqui significaria lanzar
// procesos por cada refresco para pintar texto. El propio usuario ofrecio la salida — "o si es muy feo
// como queda, deberian salir etiquetas de informacion del chat" — y eso es esto: lo que de verdad hace
// falta ver de un vistazo, sin ejecutar nada.
//
// La carpeta y la rama (Q-U11) viven ahora en la sublinea bajo las pestañas (`TabSubline`); aqui quedan la
// privacidad, «Encargada por…» y el PR. Los refrescos de git y de PR siguen aqui: se lanzan con la pestaña.
export function ChatInfoBar(): React.JSX.Element | null {
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  // Suscribe la fila al idioma: las etiquetas salen de `chatInfoView`, que traduce al llamarse.
  useT();

  // Git se refresca por eventos (P-026 3.5), sin watchers ni timers: al activar la pestaña o cambiar su
  // carpeta, y al volver el foco a la ventana. El fin de turno y el cambio de rama los lanza el store.
  const refreshGit = useWorkbenchStore((s) => s.refreshGit);
  const refreshPr = useWorkbenchStore((s) => s.refreshPr);
  const cwd = tab?.cwd;
  useEffect(() => {
    if (cwd === undefined) return;
    // El PR va detras de git (grupo D): `gh` solo corre si git ya puede (repo, confianza).
    const refresh = (): void => {
      void refreshGit(tabId).then(() => refreshPr(tabId)).catch((err: unknown) => console.warn('No se pudo leer el PR:', err));
    };
    refresh();
    const onFocus = refresh;
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [tabId, cwd, refreshGit, refreshPr]);

  // Sin pestaña no hay nada que contar, y una fila vacia solo roba alto al hilo.
  if (tab === undefined) return null;
  const privacy = privacyChip(tab.privacy);

  return (
    <div className="mb-[6px] flex flex-wrap items-center gap-[6px] text-[10.5px] text-mg-muted">
      <CreatorChip tabId={tabId} />
      <PrBar tabId={tabId} />
      {/* Informativa: NO es un boton (nada ocurre al pulsarla, y un boton que no hace nada es una promesa
          rota). El dato largo va en el tooltip y en el nombre accesible. */}
      <span
        data-tip={privacy.title}
        aria-label={privacy.title}
        className="inline-flex max-w-[280px] cursor-help items-center gap-[5px] rounded-full border border-mg-border-subtle px-[8px] py-[2px]"
      >
        <Icon name={privacy.icon} size={12} />
        <span className="truncate">{privacy.label}</span>
      </span>
    </div>
  );
}

// #29: «Encargada por …» en la pestaña de una sesión delegada por el MCP. Con la creadora abierta lleva a su
// pestaña (activa su cuenta primero, como `onWidgetFocusTab`); sin ella, solo informa.
function CreatorChip({ tabId }: { readonly tabId: string }): React.JSX.Element | null {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const creator = useWorkbenchStore(useShallow((s) => (tab === undefined ? null : creatorTabOf(s, tab))));
  const t = useT();
  if (tab?.createdBy === undefined) return null;
  if (creator === null) {
    const closed = t('chat.delegation.creatorClosed');
    return <span data-creator-chip aria-label={closed} data-tip={closed} className={`${CHIP_CLASS} cursor-help border-mg-border-subtle`}>{closed}</span>;
  }
  const label = t('chat.delegation.createdBy', { title: creator.title });
  const goToCreator = (): void => {
    const state = useWorkbenchStore.getState();
    const target = state.tabs.find((candidate) => candidate.id === creator.tabId);
    if (target === undefined) return;
    state.setActiveAccount(target.accountId);
    state.setActiveTab(creator.tabId);
  };
  return (
    <button onClick={goToCreator} data-creator-chip data-tip={label} aria-label={label} className={`${CHIP_CLASS} transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body`}>
      <span className="truncate">{label}</span>
    </button>
  );
}
