import { useEffect, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkbenchStore } from '../workbenchStore';
import { creatorTabOf } from '../adoptSession';
import { usePaneTabId } from '../paneContext';
import { CHIP_CLASS } from './GitChips';
import { PrBar } from './PrBar';
import { useT } from '../../i18n/uiLanguage';
import { TabSubline } from './TabSubline';

// Fila de informacion del chat, encima del input (peticion del usuario).
//
// La alternativa que se pidio primero era la "status line" del CLI, pero esa es una linea que el
// usuario CONFIGURA con un comando propio y que el CLI ejecuta: traerla aqui significaria lanzar
// procesos por cada refresco para pintar texto. El propio usuario ofrecio la salida — "o si es muy feo
// como queda, deberian salir etiquetas de informacion del chat" — y eso es esto: lo que de verdad hace
// falta ver de un vistazo, sin ejecutar nada.
//
// P-038 (rediseño del 10-11): la fila va DEBAJO de la caja del input y junta todo lo que antes estaba encima del
// input y en la sublínea de las pestañas. A la izquierda, la conversación (`TabSubline`: proveedor · cuenta, carpeta,
// rama, privacidad; la creadora y el PR); a la derecha, `children`: los selectores de modelo, esfuerzo y modo.
// Los refrescos de git y de PR siguen aqui: se lanzan con la pestaña.
export function ChatInfoBar({ children }: { readonly children?: ReactNode }): React.JSX.Element | null {
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
  return (
    <div data-chat-info-bar="true" className="mt-[6px] flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-[10.5px] text-mg-muted">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[6px] whitespace-nowrap">
        <TabSubline />
        <CreatorChip tabId={tabId} />
        <AwaitingCreatorChip tabId={tabId} />
        <PrBar tabId={tabId} />
      </div>
      <div data-prompt-controls="true" className="ml-auto flex flex-wrap items-center justify-end gap-[8px]">
        {children}
      </div>
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
    <button onClick={goToCreator} data-creator-chip data-tip={label} aria-label={label} className={`${CHIP_CLASS} transition-colors duration-90 ease-out hover:bg-mg-hover hover:text-mg-body`}>
      <span className="truncate">{label}</span>
    </button>
  );
}

// U26: la delegada preguntó a su creadora y espera. Solo informa: el usuario puede contestar aquí (mensaje normal).
function AwaitingCreatorChip({ tabId }: { readonly tabId: string }): React.JSX.Element | null {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const creator = useWorkbenchStore(useShallow((s) => (tab === undefined ? null : creatorTabOf(s, tab))));
  const t = useT();
  if (tab?.awaitingCreator !== true) return null;
  const label = creator === null ? t('chat.delegation.awaitingCreatorClosed') : t('chat.delegation.awaitingCreator', { title: creator.title });
  const tip = t('chat.delegation.awaitingCreatorTip');
  return (
    <span data-awaiting-creator-chip aria-label={label} data-tip={tip} className={`${CHIP_CLASS} cursor-help border-mg-border-subtle`}>
      <span className="truncate">{label}</span>
    </span>
  );
}
