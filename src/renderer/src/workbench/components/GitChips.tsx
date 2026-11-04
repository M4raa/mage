import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { diffChip, gitChip } from '../chatInfoView';
import { canSwitchBranch } from '../canSwitchBranch';
import { Dropdown } from './Dropdown';
import { worktreeOfCwd } from '@shared/worktree';
import { reportActionError } from '../notificationStore';
import { useT } from '../../i18n/uiLanguage';

export const CHIP_CLASS = 'inline-flex max-w-[280px] items-center gap-[5px] rounded-full border border-mg-border-ctrl px-[8px] py-[2px]';
const BARE_CHIP_CLASS = 'inline-flex max-w-[280px] items-center gap-[5px] rounded-[4px] px-[3px]';

// Rama, cambios y «Pedir commit al agente» (P-026 3.5, D25–D27; el nombre es el de DA-1). Sin repo, sin
// git o sin confianza, nada.
// `bare` quita la píldora (borde y relleno de las etiquetas encima del input): en la sublínea de la pestaña van como texto.
export function GitChips({ tabId, cwd, bare = false }: { readonly tabId: string; readonly cwd: string; readonly bare?: boolean }): React.JSX.Element | null {
  const chipClass = bare ? BARE_CHIP_CLASS : CHIP_CLASS;
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
          bare={bare}
        />
      ) : (
        <span data-tip={`${branch.title} · ${verdict.reason}`} aria-label={t('chat.git.switchBranchBlockedAria', { reason: verdict.reason })} aria-disabled="true" className={`${chipClass} cursor-not-allowed`}>
          <Icon name="branch" size={12} />
          <span className="truncate">{branch.label}</span>
        </span>
      )}
      <WorktreeToggle tabId={tabId} isWorktree={worktree !== null} canBranch={snapshot.branch !== null} chipClass={chipClass} />
      {diff !== null && (
        <span data-git-diff data-tip={diff.title} aria-label={diff.title} className={`${chipClass} cursor-help font-mono`}>
          <span className="text-mg-diff-add">{diff.added}</span>
          <span className="text-mg-diff-del">{diff.removed}</span>
        </span>
      )}
      {diff !== null && (
        <button
          onClick={() => insertCommitPrompt(tabId)}
          data-git-commit
          data-tip={t('chat.git.askCommitTip')}
          className={`${chipClass} text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body`}
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
function WorktreeToggle({ tabId, isWorktree, canBranch, chipClass }: { readonly tabId: string; readonly isWorktree: boolean; readonly canBranch: boolean; readonly chipClass: string }): React.JSX.Element | null {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const started = useWorkbenchStore((s) => s.sessionIdByChat[tabId] !== undefined || (s.blocksByChat[tabId]?.length ?? 0) > 0);
  const setWorktreeOff = useWorkbenchStore((s) => s.setWorktreeOff);
  const t = useT();
  if (tab === undefined) return null;
  if (isWorktree) {
    const tip = t('chat.worktree.chipTip');
    return (
      <span data-worktree-chip data-tip={tip} aria-label={tip} className={`${chipClass} cursor-help`}>
        {t('chat.worktree.chip')}
      </span>
    );
  }
  if (started || tab.resumeSessionId !== undefined || !canBranch) return null;
  return (
    <label data-worktree-toggle data-tip={t('chat.worktree.toggleTip')} className={`${chipClass} cursor-pointer`}>
      <input type="checkbox" checked={tab.worktreeOff !== true} onChange={(e) => setWorktreeOff(tabId, !e.target.checked)} />
      {t('chat.worktree.toggle')}
    </label>
  );
}

function isTurnLive(status: string | undefined): boolean {
  return status === 'streaming' || status === 'needs_permission';
}
