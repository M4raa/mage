import { useEffect, useState } from 'react';
import type { GhPullRequest, GhRun } from '@shared/gh';
import { Icon } from './Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { ghNoticeView, prBarView } from '../chatInfoView';
import { worktreeOfCwd } from '@shared/worktree';

// Barra de PR/CI de la sesion (grupo D, como Claude Desktop): el PR vinculado con sus checks, y al
// desplegarla los que fallan, los runs (relanzar/cancelar), el auto-merge y el auto-fix. Sin PR en la
// rama, «Crear PR». Sin gh o sin sesion, un aviso descartable para siempre (DA-3).
//
// Va en la fila de informacion del chat; el detalle se abre debajo, a lo ancho de la fila.

const CHIP = 'inline-flex max-w-[280px] items-center gap-[5px] rounded-full border border-mg-border-ctrl px-[8px] py-[2px]';
const BUTTON = `${CHIP} text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body`;
const TONES = { add: 'text-mg-diff-add', del: 'text-mg-diff-del', muted: 'text-mg-muted' } as const;

function openExternal(url: string): void {
  void window.mage.openExternal(url).catch((err: unknown) => console.warn('No se pudo abrir el enlace:', err));
}

export function PrBar({ tabId }: { readonly tabId: string }): React.JSX.Element | null {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const snapshot = useWorkbenchStore((s) => s.prByTab[tabId]);
  const noticeDismissed = useWorkbenchStore((s) => s.settings.ghNoticeDismissed);
  const setGhNoticeDismissed = useWorkbenchStore((s) => s.setGhNoticeDismissed);
  const insertCreatePrPrompt = useWorkbenchStore((s) => s.insertCreatePrPrompt);
  const unbindPr = useWorkbenchStore((s) => s.unbindPr);
  const [open, setOpen] = useState(false);
  if (tab === undefined || snapshot === undefined) return null;

  const notice = ghNoticeView(snapshot, noticeDismissed);
  if (notice !== null) {
    return (
      <span data-gh-notice className={`${CHIP} border-mg-border-subtle text-mg-muted`}>
        <button data-tip={notice.title} aria-label={notice.title} onClick={() => notice.url !== null && openExternal(notice.url)} className={notice.url === null ? 'cursor-help' : 'hover:text-mg-body'}>
          {notice.label}
        </button>
        <button aria-label="No volver a avisar de gh" data-tip="No volver a avisar (se recupera en Configuración › General)" onClick={() => setGhNoticeDismissed(true)} className="hover:text-mg-body">
          <Icon name="close" size={10} />
        </button>
      </span>
    );
  }
  if (snapshot.kind === 'no-pr' && tab.prNumber === undefined) {
    return (
      <button data-pr-create onClick={() => insertCreatePrPrompt(tabId)} data-tip="Deja en el input un prompt para que el agente suba la rama y abra el PR con gh; lo envías tú" className={BUTTON}>
        Crear PR
      </button>
    );
  }
  if (snapshot.kind !== 'pr' || tab.prNumber !== snapshot.pr.number) return null;

  const view = prBarView(snapshot.pr);
  return (
    <>
      <button data-pr-chip aria-expanded={open} aria-label={view.title} data-tip={view.title} onClick={() => setOpen((v) => !v)} className={BUTTON}>
        <Icon name="branch" size={12} />
        <span className="truncate">{view.label}</span>
        {view.counts.map((c) => (
          <span key={c.glyph} className={`font-mono ${TONES[c.tone]}`}>{`${c.glyph}${c.count}`}</span>
        ))}
      </button>
      <button aria-label={`Dejar de seguir el PR #${snapshot.pr.number}`} data-tip="Dejar de seguir este PR (el PR no se toca)" onClick={() => unbindPr(tabId)} className="text-mg-muted hover:text-mg-body">
        <Icon name="close" size={10} />
      </button>
      {open && <PrDetails tabId={tabId} pr={snapshot.pr} autoFix={tab.prAutoFix === true} details={view.details} inWorktree={worktreeOfCwd(tab.cwd) !== null} />}
    </>
  );
}

interface DetailsProps {
  readonly tabId: string;
  readonly pr: GhPullRequest;
  readonly autoFix: boolean;
  readonly details: readonly string[];
  readonly inWorktree: boolean;
}

// Confirmacion en dos pasos dentro del propio panel: lo que escribe en GitHub nunca sale de un clic.
type Pending = { readonly kind: 'run'; readonly run: GhRun; readonly action: 'rerun' | 'cancel' } | { readonly kind: 'merge'; readonly enabled: boolean };

function PrDetails({ tabId, pr, autoFix, details, inWorktree }: DetailsProps): React.JSX.Element {
  const runs = useWorkbenchStore((s) => s.ghRunsByTab[tabId]);
  const loadGhRuns = useWorkbenchStore((s) => s.loadGhRuns);
  const setPrAutoFix = useWorkbenchStore((s) => s.setPrAutoFix);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadGhRuns(tabId).catch((err: unknown) => setError(String(err)));
  }, [tabId, pr.headSha, loadGhRuns]);

  const finish = (err: string | null): void => {
    setPending(null);
    setError(err);
  };
  const failing = pr.checks.filter((check) => check.state === 'fail');
  return (
    <div data-pr-details role="region" aria-label={`PR #${pr.number}`} className="flex basis-full flex-col gap-[6px] rounded-[8px] border border-mg-border-subtle p-[8px_10px] text-[10.5px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="font-semibold text-mg-body">{pr.title}</span>
        {details.map((detail) => (
          <span key={detail} className="text-mg-ter">{detail}</span>
        ))}
        <button onClick={() => openExternal(pr.url)} className="ml-auto inline-flex items-center gap-[4px] hover:text-mg-body">
          Abrir en GitHub <Icon name="external" size={10} />
        </button>
      </div>
      {failing.length > 0 && (
        <ul data-pr-failing aria-label="Checks que fallan" className="flex flex-col gap-[2px] text-mg-danger">
          {failing.map((check) => (
            <li key={check.name}>✗ {check.name}</li>
          ))}
        </ul>
      )}
      {runs?.kind === 'runs' && <RunList runs={runs.runs} onAsk={(run, action) => setPending({ kind: 'run', run, action })} />}
      <AutoToggles pr={pr} autoFix={autoFix} onAutoFix={(on) => setPrAutoFix(tabId, on)} onAutoMerge={(enabled) => setPending({ kind: 'merge', enabled })} />
      {inWorktree && pr.state === 'open' && <MergeBaseButton tabId={tabId} base={pr.baseRefName} onError={setError} />}
      {pending !== null && <Confirm tabId={tabId} pending={pending} onDone={(err) => finish(err)} />}
      {error !== null && (
        <span role="alert" className="text-mg-danger">
          {error}
        </span>
      )}
    </div>
  );
}

// «Traer la base» (como Desktop): fetch de la rama base y merge en la del worktree, nunca rebase. Con
// cambios sin confirmar main se niega; los conflictos se quedan para el agente.
function MergeBaseButton({ tabId, base, onError }: { readonly tabId: string; readonly base: string; readonly onError: (error: string | null) => void }): React.JSX.Element {
  const mergeBaseIntoWorktree = useWorkbenchStore((s) => s.mergeBaseIntoWorktree);
  const [result, setResult] = useState<string | null>(null);
  const run = (): void => {
    onError(null);
    void mergeBaseIntoWorktree(tabId, base)
      .then((outcome) => setResult(outcome === 'merged' ? `${base} fusionada en la rama` : `Conflictos con ${base}: pídele al agente que los resuelva`))
      .catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div className="flex items-center gap-[8px]">
      <button onClick={run} data-tip={`Trae ${base} a esta rama (fetch y merge, nunca rebase)`} className="hover:text-mg-body">
        Traer {base}
      </button>
      {result !== null && <span className="text-mg-ter">{result}</span>}
    </div>
  );
}

const RUN_LABELS = { pending: 'en marcha', pass: 'pasa', fail: 'falla', skip: 'omitido', cancel: 'cancelado' } as const;

function RunList({ runs, onAsk }: { readonly runs: readonly GhRun[]; readonly onAsk: (run: GhRun, action: 'rerun' | 'cancel') => void }): React.JSX.Element {
  if (runs.length === 0) return <span className="text-mg-ter">Sin runs en esta rama</span>;
  return (
    <ul data-pr-runs aria-label="Runs de la rama" className="flex flex-col gap-[2px]">
      {runs.map((run) => (
        <li key={run.id} className="flex items-center gap-[8px]">
          <span className="text-mg-body2">{run.name}</span>
          <span className="text-mg-ter">{RUN_LABELS[run.state]}</span>
          {(run.state === 'fail' || run.state === 'cancel') && (
            <button onClick={() => onAsk(run, 'rerun')} className="hover:text-mg-body">
              Relanzar
            </button>
          )}
          {run.state === 'pending' && (
            <button onClick={() => onAsk(run, 'cancel')} className="hover:text-mg-body">
              Cancelar run
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

interface TogglesProps {
  readonly pr: GhPullRequest;
  readonly autoFix: boolean;
  readonly onAutoFix: (enabled: boolean) => void;
  readonly onAutoMerge: (enabled: boolean) => void;
}

function AutoToggles({ pr, autoFix, onAutoFix, onAutoMerge }: TogglesProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-[14px] text-mg-body2">
      <label className="inline-flex items-center gap-[5px]" data-tip="Con el CI roto o un conflicto, Mage abre un turno para que el agente lo arregle y haga push sin preguntar">
        <input type="checkbox" checked={autoFix} onChange={(e) => onAutoFix(e.target.checked)} />
        Auto-fix
      </label>
      <label className="inline-flex items-center gap-[5px]" data-tip="Auto-merge nativo de GitHub (squash): fusiona solo cuando pasen los checks obligatorios">
        <input type="checkbox" checked={pr.autoMerge} disabled={pr.state !== 'open'} onChange={(e) => onAutoMerge(e.target.checked)} />
        Auto-merge
      </label>
    </div>
  );
}

function confirmText(pending: Pending): string {
  if (pending.kind === 'run') return pending.action === 'rerun' ? `¿Relanzar los jobs que fallaron de «${pending.run.name}»?` : `¿Cancelar el run «${pending.run.name}»?`;
  if (pending.enabled) return 'Activar el auto-merge: GitHub fusionará el PR (squash) en cuanto pasen los checks, sin otra mirada.';
  return '¿Desactivar el auto-merge de este PR?';
}

function Confirm({ tabId, pending, onDone }: { readonly tabId: string; readonly pending: Pending; readonly onDone: (error: string | null) => void }): React.JSX.Element {
  const ghRunAction = useWorkbenchStore((s) => s.ghRunAction);
  const setPrAutoMerge = useWorkbenchStore((s) => s.setPrAutoMerge);
  const [busy, setBusy] = useState(false);
  const text = confirmText(pending);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      if (pending.kind === 'run') await ghRunAction(tabId, pending.run.id, pending.action);
      else await setPrAutoMerge(tabId, pending.enabled);
      onDone(null);
    } catch (err) {
      onDone(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div data-pr-confirm role="alertdialog" aria-label={text} className="flex flex-wrap items-center gap-[8px] rounded-[6px] bg-mg-hover p-[6px_8px] text-mg-body">
      <span>{text}</span>
      <button disabled={busy} onClick={() => void run()} className="font-semibold hover:underline">
        Confirmar
      </button>
      <button disabled={busy} onClick={() => onDone(null)} className="hover:underline">
        No
      </button>
    </div>
  );
}
