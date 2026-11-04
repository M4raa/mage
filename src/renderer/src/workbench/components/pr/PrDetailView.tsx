import { useEffect, useState } from 'react';
import type { GhRun } from '@shared/gh';
import { prKeyToString, type PrDetail, type PrKey, type RepoMergeOptions } from '@shared/pr';
import { useWorkbenchStore } from '../../workbenchStore';
import { Markdown } from '../Markdown';
import { Icon } from '../Icon';
import { reportActionError } from '../../notificationStore';
import { t as translate, useT } from '../../../i18n/uiLanguage';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';
import { ChecksSummary, openExternal, sinceText, StateBadge, BUTTON, SECTION_TITLE } from './PrPieces';
import { PrActionsBar } from './PrActionsBar';
import { PrDiff } from './PrDiff';

// Detalle de una PR (al elegir una fila): lo que GitHub dice de ella y, debajo, lo que se puede hacer.

const REVIEW_LABELS = {
  approved: 'chat.pr.review.approved',
  changes_requested: 'chat.pr.review.changesRequested',
  review_required: 'chat.pr.review.required',
} as const satisfies Readonly<Record<NonNullable<PrDetail['reviewDecision']>, MessageKey>>;

const CHECK_GLYPHS = { pass: '✓', fail: '✗', pending: '●', skip: '–', cancel: '–' } as const;
const CHECK_TONES = { pass: 'text-mg-diff-add', fail: 'text-mg-diff-del', pending: 'text-mg-muted', skip: 'text-mg-muted', cancel: 'text-mg-muted' } as const;

interface Props {
  readonly tabId: string;
  readonly prKey: PrKey;
  readonly detail: PrDetail;
  readonly options: RepoMergeOptions | undefined;
  readonly sameRepoAsTab: boolean;
  readonly linkState: 'none' | 'linked' | 'primary';
  readonly canLink: boolean;
}

export function PrDetailView({ tabId, prKey, detail, options, sameRepoAsTab, linkState, canLink }: Props): React.JSX.Element {
  const t = useT();
  const key = prKeyToString(prKey);
  const link = useWorkbenchStore((s) => s.linkPrToConversation);
  return (
    <section data-pr-detail={key} aria-label={t('pr.detailLabel', { key })} className="flex flex-col gap-[8px] border-b border-mg-border-subtle p-[10px] text-[11px] text-mg-body">
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="min-w-0 flex-1 text-[12px] font-semibold">{`#${detail.number} ${detail.title}`}</span>
        <StateBadge pr={detail} />
        <button aria-label={t('pr.openOnGithub')} data-tip={t('pr.openOnGithub')} onClick={() => openExternal(detail.url)} className="text-mg-muted hover:text-mg-body">
          <Icon name="external" size={11} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-[10px] text-mg-ter">
        <span className="font-mono">{t('pr.headToBase', { head: detail.headRefName, base: detail.baseRefName })}</span>
        <span>{t('pr.mergeStatus', { status: detail.mergeStateStatus })}</span>
        {detail.reviewDecision !== null && <span>{t(REVIEW_LABELS[detail.reviewDecision])}</span>}
        <ChecksSummary pr={detail} />
      </div>
      {detail.mergeable === 'conflicting' && detail.state === 'open' && <ConflictNotice tabId={tabId} prKey={prKey} />}
      <Checks tabId={tabId} detail={detail} withRerun={sameRepoAsTab} />
      {detail.body.trim().length === 0 ? <span className="text-mg-muted">{t('pr.noBody')}</span> : <Markdown text={detail.body} />}
      <Discussion detail={detail} />
      <Files detail={detail} />
      <PrDiff tabId={tabId} prKey={prKey} />
      <PrActionsBar tabId={tabId} prKey={prKey} detail={detail} options={options} />
      {canLink && linkState !== 'primary' && (
        <button data-pr-action={linkState === 'none' ? 'link' : 'primary'} onClick={() => void link(tabId, prKey, linkState === 'linked')} className={`${BUTTON} self-start`}>
          {linkState === 'none' ? t('pr.link') : t('pr.makePrimary')}
        </button>
      )}
    </section>
  );
}

// Sin boton de «resolver»: los conflictos los resuelve el agente, con un prompt que queda en la caja.
function ConflictNotice({ tabId, prKey }: { readonly tabId: string; readonly prKey: PrKey }): React.JSX.Element {
  const t = useT();
  const insert = useWorkbenchStore((s) => s.insertResolveConflictsPrompt);
  return (
    <div data-pr-conflicting className="flex flex-wrap items-center gap-[8px] text-mg-danger">
      <span>{t('pr.conflicting')}</span>
      <button data-pr-action="resolveConflicts" onClick={() => insert(tabId, prKey)} className={BUTTON}>
        {t('pr.resolveConflicts')}
      </button>
    </div>
  );
}

function Checks({ tabId, detail, withRerun }: { readonly tabId: string; readonly detail: PrDetail; readonly withRerun: boolean }): React.JSX.Element | null {
  const t = useT();
  if (detail.checks.length === 0) return null;
  return (
    <div className="flex flex-col gap-[2px]">
      <span className={SECTION_TITLE}>{t('pr.checks')}</span>
      <ul className="flex flex-col gap-[1px] px-[10px]">
        {detail.checks.map((check) => (
          <li key={`${check.workflow}/${check.name}`} className={`flex items-center gap-[6px] ${CHECK_TONES[check.state]}`}>
            <span className="font-mono">{CHECK_GLYPHS[check.state]}</span>
            <span className="text-mg-body2">{check.name}</span>
          </li>
        ))}
      </ul>
      {withRerun && detail.summary.fail > 0 && <FailedRuns tabId={tabId} branch={detail.headRefName} headSha={detail.headSha} />}
    </div>
  );
}

// Relanzar los runs fallidos de la rama de la PR: solo para el repo de la pestaña, con los mismos puentes que la
// barra compacta (`ghRuns`/`ghRunAction`).
function FailedRuns({ tabId, branch, headSha }: { readonly tabId: string; readonly branch: string; readonly headSha: string }): React.JSX.Element | null {
  const t = useT();
  const tab = useWorkbenchStore((s) => s.tabs.find((x) => x.id === tabId));
  const [runs, setRuns] = useState<readonly GhRun[]>([]);
  const [busy, setBusy] = useState(false);
  const folder = tab === undefined ? null : { cwd: tab.cwd, accountDir: tab.accountId };
  const load = async (): Promise<void> => {
    if (folder === null) return;
    const snapshot = await window.mage.ghRuns({ ...folder, branch });
    setRuns(snapshot.kind === 'runs' ? snapshot.runs.filter((run) => run.state === 'fail') : []);
  };
  useEffect(() => {
    void load().catch((err: unknown) => reportActionError(translate('pr.actionFailed'), err, 'pr'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` se rehace en cada render; solo importan la rama y el head
  }, [tabId, branch, headSha]);
  const rerun = async (run: GhRun): Promise<void> => {
    if (folder === null) return;
    setBusy(true);
    try {
      await window.mage.ghRunAction({ ...folder, runId: run.id, action: 'rerun' });
      await load();
    } catch (err) {
      reportActionError(translate('pr.actionFailed'), err, 'pr');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ul className="flex flex-col gap-[2px] px-[10px]">
      {runs.map((run) => (
        <li key={run.id} className="flex items-center gap-[8px]">
          <span className="text-mg-body2">{run.name}</span>
          <button disabled={busy} aria-label={t('pr.rerunLabel', { name: run.name })} onClick={() => void rerun(run)} className="hover:text-mg-body">
            {t('pr.rerun')}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Discussion({ detail }: { readonly detail: PrDetail }): React.JSX.Element | null {
  const t = useT();
  if (detail.reviews.length === 0 && detail.comments.length === 0) return null;
  return (
    <div className="flex flex-col gap-[4px]">
      {detail.reviews.length > 0 && <span className={SECTION_TITLE}>{t('pr.reviews')}</span>}
      {detail.reviews.map((review, index) => (
        <div key={`r${index}`} data-pr-review className="px-[10px] text-mg-body2">
          <span className="font-semibold">{review.author}</span> <span className="text-mg-ter">{review.state}</span>
          {review.body.length > 0 && <div className="whitespace-pre-wrap">{review.body}</div>}
        </div>
      ))}
      {detail.comments.length > 0 && <span className={SECTION_TITLE}>{t('pr.comments')}</span>}
      {detail.comments.map((comment, index) => (
        <div key={`c${index}`} data-pr-comment className="px-[10px] text-mg-body2">
          <span className="font-semibold">{comment.author}</span> <span className="text-mg-ter">{sinceText(comment.createdAt)}</span>
          <div className="whitespace-pre-wrap">{comment.body}</div>
        </div>
      ))}
    </div>
  );
}

function Files({ detail }: { readonly detail: PrDetail }): React.JSX.Element | null {
  const t = useT();
  if (detail.files.length === 0) return null;
  return (
    <div className="flex flex-col gap-[2px]">
      <span className={SECTION_TITLE}>{t('pr.files', { count: detail.files.length })}</span>
      <ul className="flex flex-col gap-[1px] px-[10px] font-mono text-[10.5px]">
        {detail.files.map((file) => (
          <li key={file.path} className="flex items-center gap-[8px]">
            <span className="min-w-0 flex-1 truncate text-mg-body2">{file.path}</span>
            <span className="text-mg-diff-add">{`+${file.additions}`}</span>
            <span className="text-mg-diff-del">{`−${file.deletions}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
