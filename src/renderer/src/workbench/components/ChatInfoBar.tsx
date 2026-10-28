import { useEffect, useMemo } from 'react';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { diffChip, folderChip, gitChip, privacyChip, type ChatChip } from '../chatInfoView';
import { canSwitchBranch } from '../canSwitchBranch';
import { Dropdown } from './Dropdown';
import { PrBar } from './PrBar';
import { worktreeOfCwd } from '@shared/worktree';
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
// La carpeta es la unica etiqueta ACCIONABLE, y es la que se pidio por su nombre: al pulsarla se abre,
// que es como se llega a los ficheros que va generando el agente y al scratchpad. Las demas informan.
export function ChatInfoBar(): React.JSX.Element | null {
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const scratchDir = useWorkbenchStore((s) => s.scratchDir);
  const scratchRoots = useWorkbenchStore((s) => s.scratchRoots);
  const ensureScratchDir = useWorkbenchStore((s) => s.ensureScratchDir);

  useEffect(() => {
    void ensureScratchDir();
  }, [ensureScratchDir]);

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

  const chips = useMemo((): readonly ChatChip[] => {
    if (tab === undefined) return [];
    const folder = folderChip(tab.cwd, scratchRoots.length > 0 ? scratchRoots : scratchDir);
    // Sin el chip del modelo (P-026, D18): salia aqui, en el selector del input y en la barra de estado.
    // Se queda solo en el selector, que es donde se puede cambiar.
    return [...(folder === null ? [] : [folder]), privacyChip(tab.privacy)];
  }, [tab, scratchDir, scratchRoots]);

  // Sin pestaña no hay nada que contar, y una fila vacia solo roba alto al hilo.
  if (tab === undefined || chips.length === 0) return null;
  const [folder, ...rest] = chips;

  return (
    <div className="flex flex-wrap items-center gap-[6px] px-[22px] pt-[8px] text-[10.5px] text-mg-muted">
      <button
        onClick={() => void window.mage.openPath(tab.cwd).catch(() => undefined)}
        data-tip={folder!.title}
        aria-label={folder!.title}
        className="inline-flex max-w-[280px] items-center gap-[5px] rounded-full border border-mg-border-ctrl px-[8px] py-[2px] transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body"
      >
        <Icon name={folder!.icon} size={12} />
        <span className="truncate">{folder!.label}</span>
      </button>
      <GitChips tabId={tabId} cwd={tab.cwd} />
      <PrBar tabId={tabId} />
      {rest.map((chip) => (
        // Las informativas NO son botones: nada ocurre al pulsarlas, y un boton que no hace nada es una
        // promesa rota. El dato largo va en el tooltip y en el nombre accesible.
        <span
          key={chip.label}
          data-tip={chip.title}
          aria-label={chip.title}
          className="inline-flex max-w-[280px] cursor-help items-center gap-[5px] rounded-full border border-mg-border-subtle px-[8px] py-[2px]"
        >
          <Icon name={chip.icon} size={12} />
          <span className="truncate">{chip.label}</span>
        </span>
      ))}
    </div>
  );
}

const CHIP_CLASS = 'inline-flex max-w-[280px] items-center gap-[5px] rounded-full border border-mg-border-ctrl px-[8px] py-[2px]';

// Rama, cambios y «Pedir commit al agente» (P-026 3.5, D25–D27; el nombre es el de DA-1). Sin repo, sin
// git o sin confianza, nada.
function GitChips({ tabId, cwd }: { readonly tabId: string; readonly cwd: string }): React.JSX.Element | null {
  const view = useWorkbenchStore((s) => s.gitByCwd[cwd]);
  const turnActive = useWorkbenchStore((s) => s.tabs.some((t) => t.cwd === cwd && isTurnLive(s.statusByChat[t.id])));
  const switchGitBranch = useWorkbenchStore((s) => s.switchGitBranch);
  const insertCommitPrompt = useWorkbenchStore((s) => s.insertCommitPrompt);
  const t = useT();
  const snapshot = view?.snapshot;
  const branch = gitChip(snapshot);
  if (view === undefined || branch === null || snapshot?.kind !== 'repo') return null;
  const diff = diffChip(snapshot);
  const worktree = worktreeOfCwd(cwd);
  const verdict = canSwitchBranch({ turnActive, dirty: snapshot.dirty, detached: snapshot.detached, worktree: worktree !== null });
  const onSwitch = (name: string): void => {
    if (name === snapshot.branch) return;
    void switchGitBranch(tabId, name).catch((err: unknown) => reportActionError(t('chat.git.switchBranchFailed'), err, 'git'));
  };
  return (
    <>
      {verdict.allowed ? (
        <Dropdown
          value={snapshot.branch ?? ''}
          options={view.branches.map((name) => ({ value: name, label: name }))}
          onChange={onSwitch}
          ariaLabel={t('chat.git.switchBranchAria')}
          tip={branch.title}
          leading={<Icon name="branch" size={12} />}
          triggerClassName="max-w-[280px] self-auto text-mg-muted"
        />
      ) : (
        <span data-tip={`${branch.title} · ${verdict.reason}`} aria-label={t('chat.git.switchBranchBlockedAria', { reason: verdict.reason })} aria-disabled="true" className={`${CHIP_CLASS} cursor-not-allowed`}>
          <Icon name="branch" size={12} />
          <span className="truncate">{branch.label}</span>
        </span>
      )}
      <WorktreeToggle tabId={tabId} isWorktree={worktree !== null} canBranch={snapshot.branch !== null} />
      {diff !== null && (
        <span data-git-diff data-tip={diff.title} aria-label={diff.title} className={`${CHIP_CLASS} cursor-help font-mono`}>
          <span className="text-mg-diff-add">{diff.added}</span>
          <span className="text-mg-diff-del">{diff.removed}</span>
        </span>
      )}
      {diff !== null && (
        <button
          onClick={() => insertCommitPrompt(tabId)}
          data-git-commit
          data-tip={t('chat.git.askCommitTip')}
          className={`${CHIP_CLASS} text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body`}
        >
          {t('chat.git.askCommit')}
        </button>
      )}
      {view.error !== null && (
        <span role="alert" className="max-w-[320px] truncate text-mg-danger" data-tip={view.error}>
          {view.error}
        </span>
      )}
    </>
  );
}

// Casilla «Worktree» (DN-6: marcada por defecto) mientras la conversacion no ha empezado; despues, si
// trabaja en uno, un chip que lo dice. Al archivar (cerrar la pestaña) el worktree se borra si esta limpio.
function WorktreeToggle({ tabId, isWorktree, canBranch }: { readonly tabId: string; readonly isWorktree: boolean; readonly canBranch: boolean }): React.JSX.Element | null {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const started = useWorkbenchStore((s) => s.sessionIdByChat[tabId] !== undefined || (s.blocksByChat[tabId]?.length ?? 0) > 0);
  const setWorktreeOff = useWorkbenchStore((s) => s.setWorktreeOff);
  const t = useT();
  if (tab === undefined) return null;
  if (isWorktree) {
    const tip = t('chat.worktree.chipTip');
    return (
      <span data-worktree-chip data-tip={tip} aria-label={tip} className={`${CHIP_CLASS} cursor-help`}>
        {t('chat.worktree.chip')}
      </span>
    );
  }
  if (started || tab.resumeSessionId !== undefined || !canBranch) return null;
  return (
    <label data-worktree-toggle data-tip={t('chat.worktree.toggleTip')} className={`${CHIP_CLASS} cursor-pointer`}>
      <input type="checkbox" checked={tab.worktreeOff !== true} onChange={(e) => setWorktreeOff(tabId, !e.target.checked)} />
      {t('chat.worktree.toggle')}
    </label>
  );
}

function isTurnLive(status: string | undefined): boolean {
  return status === 'streaming' || status === 'needs_permission';
}
