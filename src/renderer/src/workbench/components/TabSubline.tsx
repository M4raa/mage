import { Fragment, useEffect } from 'react';
import { Icon } from './Icon';
import { GitChips } from './GitChips';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { folderChip } from '../chatInfoView';
import { apiBilledLabel } from '../accountView';
import { useT } from '../../i18n/uiLanguage';

const SEPARATOR = ' · ';

// Sublínea bajo la barra de pestañas de un panel (Q-U11): cuenta · carpeta · rama, sin modelo (D18). La carpeta
// es la única parte accionable (se abre, que es como se llega a lo que genera el agente y al scratchpad); la rama
// y los cambios salen de `GitChips` en su variante sin píldora. Sin pestaña, no pinta nada.
export function TabSubline(): React.JSX.Element | null {
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((candidate) => candidate.id === tabId));
  const account = useWorkbenchStore((s) => s.accounts.find((candidate) => candidate.id === tab?.accountId));
  // `GitChips` no pinta nada fuera de un repo: sin esto quedaría un « · » colgando al final.
  const inRepo = useWorkbenchStore((s) => tab !== undefined && s.gitByCwd[tab.cwd]?.snapshot?.kind === 'repo');
  const scratchDir = useWorkbenchStore((s) => s.scratchDir);
  const scratchRoots = useWorkbenchStore((s) => s.scratchRoots);
  const ensureScratchDir = useWorkbenchStore((s) => s.ensureScratchDir);
  // Suscribe la fila al idioma: la etiqueta de la carpeta sale de `chatInfoView`, que traduce al llamarse.
  useT();

  useEffect(() => {
    void ensureScratchDir();
  }, [ensureScratchDir]);

  if (tab === undefined) return null;
  const folder = folderChip(tab.cwd, scratchRoots.length > 0 ? scratchRoots : scratchDir);
  const parts: readonly React.ReactNode[] = [
    <span key="account" data-tab-subline-account className="inline-flex items-center gap-[6px]">
      <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: account?.accent.base ?? 'transparent' }} />
      <span className="truncate">{tab.accountAlias}</span>
      {account?.apiBilled === true && <span data-subline-api-billed="true" className="flex-none text-mg-warn">{apiBilledLabel()}</span>}
    </span>,
    ...(folder === null
      ? []
      : [
          <button
            key="folder"
            onClick={() => void window.mage.openPath(tab.cwd).catch(() => undefined)}
            data-tip={folder.title}
            aria-label={folder.title}
            className="inline-flex max-w-[280px] items-center gap-[5px] rounded-[4px] px-[3px] transition-colors duration-90 ease-out hover:bg-mg-hover hover:text-mg-body"
          >
            <Icon name={folder.icon} size={12} />
            <span className="truncate">{folder.label}</span>
          </button>,
        ]),
    ...(inRepo ? [<GitChips key="git" tabId={tabId} cwd={tab.cwd} bare />] : []),
  ];

  return (
    <div data-tab-subline="true" className="flex items-center gap-[6px] border-b border-mg-border-subtle px-[14px] py-[4px] text-[10.5px] text-mg-muted">
      {parts.map((part, index) => (
        <Fragment key={(part as React.ReactElement).key}>
          {index > 0 && <span aria-hidden="true">{SEPARATOR}</span>}
          {part}
        </Fragment>
      ))}
    </div>
  );
}
