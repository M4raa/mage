import { Fragment, useEffect } from 'react';
import { Icon } from './Icon';
import { GitChips } from './GitChips';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { folderChip, privacyChip } from '../chatInfoView';
import { apiBilledLabel, providerLabel } from '../accountView';
import { useT } from '../../i18n/uiLanguage';

const SEPARATOR = ' · ';

// Información de la conversación (Q-U11): proveedor · cuenta · carpeta · rama · privacidad, sin modelo (D18). Desde el
// rediseño de P-038 vive a la izquierda de la fila bajo el input (`ChatInfoBar`), no bajo las pestañas. La carpeta
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
  // Suscribe la fila al idioma: las etiquetas de carpeta y privacidad salen de `chatInfoView`, que traduce al llamarse.
  useT();

  useEffect(() => {
    void ensureScratchDir();
  }, [ensureScratchDir]);

  if (tab === undefined) return null;
  const folder = folderChip(tab.cwd, scratchRoots.length > 0 ? scratchRoots : scratchDir);
  const privacy = privacyChip(tab.privacy);
  const parts: readonly React.ReactNode[] = [
    <span key="account" data-tab-subline-account className="inline-flex min-w-0 items-center gap-[6px]">
      <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: account?.accent.base ?? 'transparent' }} />
      <span className="truncate" title={tab.accountAlias}>{providerLabel(tab.provider)} {tab.accountAlias}</span>
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
            className="inline-flex min-w-0 max-w-[280px] items-center gap-[5px] rounded-[4px] px-[3px] transition-colors duration-90 ease-out hover:bg-mg-hover hover:text-mg-body"
          >
            <Icon name={folder.icon} size={12} />
            <span className="truncate">{folder.label}</span>
          </button>,
        ]),
    ...(inRepo ? [<GitChips key="git" tabId={tabId} cwd={tab.cwd} bare />] : []),
    // Informativa (no es un botón): el dato largo va en el tooltip y en el nombre accesible (P-038 V3).
    <span key="privacy" data-tab-subline-privacy={tab.privacy} data-tip={privacy.title} aria-label={privacy.title} className="inline-flex flex-none cursor-help items-center gap-[5px]">
      <Icon name={privacy.icon} size={12} />
      <span>{privacy.label}</span>
    </span>,
  ];

  return (
    <div data-tab-subline="true" className="flex flex-wrap items-center gap-[6px]">
      {parts.map((part, index) => (
        <Fragment key={(part as React.ReactElement).key}>
          {index > 0 && <span aria-hidden="true">{SEPARATOR}</span>}
          {part}
        </Fragment>
      ))}
    </div>
  );
}
