import { useEffect, useMemo, useState } from 'react';
import { parsePrKey, prKeyToString, type PrDetail, type PrKey, type PrListState, type PrSnapshot } from '@shared/pr';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { useT } from '../../i18n/uiLanguage';
import { conversationIdOfTab } from '../conversationId';
import { ghNoticeView } from '../chatInfoView';
import { EMPTY_PR_PANEL } from '../prPanelActions';
import { conversationPrKeys, PR_LIST_STATES, PR_MAX_LIMIT, repoKeyOf, type ConversationPr } from '../prPanelModel';
import { Hint } from './TranscriptHint';
import { Icon } from './Icon';
import { PrDetailView } from './pr/PrDetailView';
import { BUTTON, ChecksSummary, SECTION_TITLE, sinceText, StateBadge } from './pr/PrPieces';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';

// Panel «Pull requests» (F5.5, Q08): las PR del repo de la pestaña (con filtro y paginacion), las vinculadas a
// la conversacion —de cualquier repo, por eso dos #7 de repos distintos conviven— y el detalle de la elegida con
// sus acciones. Sigue a la pestaña del panel, como el resto de paneles del dock. La barra compacta del chat
// (`PrBar`) sigue siendo el resumen y abre este panel.

const FILTER_LABELS = {
  open: 'pr.filter.open',
  draft: 'pr.filter.draft',
  closed: 'pr.filter.closed',
  merged: 'pr.filter.merged',
  all: 'pr.filter.all',
} as const satisfies Readonly<Record<PrListState, MessageKey>>;

export function PullRequestsPanel(): React.JSX.Element {
  const t = useT();
  const tabId = usePaneTabId();
  const cwd = useWorkbenchStore((s) => s.tabs.find((tab) => tab.id === tabId)?.cwd ?? '');
  const conversationId = useWorkbenchStore((s) => {
    const tab = s.tabs.find((candidate) => candidate.id === tabId);
    return tab === undefined ? undefined : conversationIdOfTab(tab, s.sessionIdByChat[tabId]);
  });
  const panel = useWorkbenchStore((s) => s.prPanelByTab[tabId] ?? EMPTY_PR_PANEL);
  const loadPrPanel = useWorkbenchStore((s) => s.loadPrPanel);
  const migratePrOnce = useWorkbenchStore((s) => s.migratePrOnce);
  const [ready, setReady] = useState(false);

  // Al montar y al cambiar de pestaña o de conversacion: migrar el numero guardado (una vez) y cargar.
  useEffect(() => {
    setReady(false);
    if (cwd.length === 0) return;
    void migratePrOnce(tabId)
      .then(() => loadPrPanel(tabId))
      .then(() => setReady(true));
  }, [tabId, cwd, conversationId, migratePrOnce, loadPrPanel]);

  if (cwd.length === 0) return <Hint text={t('pr.noRepo')} />;
  if (!ready) return <Hint text={t('pr.loading')} />;
  if (panel.repo === null) return <Hint text={t('pr.noRepo')} />;
  if (panel.list?.kind === 'off') return <Hint text={offText(panel.list.reason, t('pr.unavailable'))} />;
  return <PanelBody tabId={tabId} conversationId={conversationId} />;
}

function linkStateOf(link: ConversationPr | undefined): 'none' | 'linked' | 'primary' {
  if (link === undefined) return 'none';
  return link.primary ? 'primary' : 'linked';
}

function offText(reason: 'no-gh' | 'no-auth' | 'no-repo' | 'not-github' | 'error', fallback: string): string {
  return ghNoticeView({ kind: 'off', reason }, false)?.title ?? fallback;
}

function PanelBody({ tabId, conversationId }: { readonly tabId: string; readonly conversationId: string | undefined }): React.JSX.Element {
  const t = useT();
  const panel = useWorkbenchStore((s) => s.prPanelByTab[tabId] ?? EMPTY_PR_PANEL);
  const catalog = useWorkbenchStore((s) => s.prCatalog);
  const details = useWorkbenchStore((s) => s.prDetailByKey);
  const optionsByRepo = useWorkbenchStore((s) => s.prMergeOptionsByRepo);
  const loadPrPanel = useWorkbenchStore((s) => s.loadPrPanel);
  const selectPr = useWorkbenchStore((s) => s.selectPr);
  const linked = useMemo(() => (conversationId === undefined ? [] : conversationPrKeys(catalog, conversationId)), [catalog, conversationId]);
  const selected = panel.selectedKey === null ? null : parsePrKey(panel.selectedKey);
  const detail = selected === null ? undefined : details[prKeyToString(selected)];
  const repo = panel.repo;
  const link = linked.find((pr) => selected !== null && prKeyToString(pr.key) === prKeyToString(selected));
  return (
    <div data-pr-panel="true" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-[8px] border-b border-mg-border-subtle px-[10px] py-[6px] text-[10.5px] text-mg-body2">
        <span className="min-w-0 flex-1 truncate font-mono">{repo === null ? '' : `${repo.owner}/${repo.repo}`}</span>
        <button aria-label={t('pr.reload')} data-tip={t('pr.reload')} disabled={panel.loading} onClick={() => void loadPrPanel(tabId)} className="text-mg-muted hover:text-mg-body">
          <Icon name="refresh" size={12} />
        </button>
      </div>
      <Filters tabId={tabId} active={panel.state} />
      {panel.error !== null && (
        <div data-pr-error role="alert" className="px-[10px] py-[6px] text-[10.5px] text-mg-danger">
          {panel.error}
        </div>
      )}
      {selected !== null && detail !== undefined && (
        <PrDetailView
          tabId={tabId}
          prKey={selected}
          detail={detail}
          options={optionsByRepo[repoKeyOf(selected)]}
          sameRepoAsTab={repo !== null && repoKeyOf(repo) === repoKeyOf(selected)}
          linkState={linkStateOf(link)}
          canLink={conversationId !== undefined}
        />
      )}
      <ConversationSection tabId={tabId} linked={linked} selectedKey={panel.selectedKey} />
      <PrList tabId={tabId} onSelect={(key) => void selectPr(tabId, key)} />
    </div>
  );
}

function Filters({ tabId, active }: { readonly tabId: string; readonly active: PrListState }): React.JSX.Element {
  const t = useT();
  const setPrListState = useWorkbenchStore((s) => s.setPrListState);
  return (
    <div role="group" aria-label={t('pr.filtersLabel')} className="flex shrink-0 flex-wrap gap-[4px] px-[10px] py-[6px]">
      {PR_LIST_STATES.map((state) => (
        <button
          key={state}
          data-pr-filter={state}
          aria-pressed={state === active}
          onClick={() => void setPrListState(tabId, state)}
          className={`rounded-full border px-[8px] py-[1px] text-[10.5px] ${state === active ? 'border-mg-border-emph bg-mg-sel text-mg-sel-ink' : 'border-mg-border-ctrl text-mg-body2 hover:bg-mg-hover'}`}
        >
          {t(FILTER_LABELS[state])}
        </button>
      ))}
    </div>
  );
}

interface ConversationProps {
  readonly tabId: string;
  readonly linked: readonly ConversationPr[];
  readonly selectedKey: string | null;
}

function ConversationSection({ tabId, linked, selectedKey }: ConversationProps): React.JSX.Element | null {
  const t = useT();
  const details = useWorkbenchStore((s) => s.prDetailByKey);
  const selectPr = useWorkbenchStore((s) => s.selectPr);
  const link = useWorkbenchStore((s) => s.linkPrToConversation);
  const unlink = useWorkbenchStore((s) => s.unlinkPrFromConversation);
  if (linked.length === 0) return null;
  return (
    <div data-pr-section="conversation" className="flex flex-col">
      <span className={SECTION_TITLE}>{t('pr.section.conversation')}</span>
      <ul className="flex flex-col p-[4px_6px]">
        {linked.map((pr) => {
          const key = prKeyToString(pr.key);
          const detail: PrDetail | undefined = details[key];
          return (
            <li key={key} data-pr-conv-row={key} className="flex flex-wrap items-center gap-[6px] rounded-[6px] px-[6px] py-[4px]">
              <button aria-pressed={key === selectedKey} onClick={() => void selectPr(tabId, pr.key)} className="flex min-w-0 flex-1 items-center gap-[6px] text-left hover:text-mg-body">
                <span className="shrink-0 font-mono text-mg-ter">{`${pr.key.owner}/${pr.key.repo}#${pr.key.number}`}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-mg-body">{detail?.title ?? ''}</span>
                {detail !== undefined && <StateBadge pr={detail} />}
              </button>
              {pr.primary && <span data-pr-primary className="text-[9.5px] text-mg-ter">{t('pr.primary')}</span>}
              {!pr.primary && (
                <button data-pr-action="primary" onClick={() => void link(tabId, pr.key, true)} className={BUTTON}>
                  {t('pr.makePrimary')}
                </button>
              )}
              <button data-pr-action="unlink" aria-label={t('pr.unlinkLabel', { key })} onClick={() => void unlink(tabId, pr.key)} className={BUTTON}>
                {t('pr.unlink')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PrList({ tabId, onSelect }: { readonly tabId: string; readonly onSelect: (key: PrKey) => void }): React.JSX.Element {
  const t = useT();
  const panel = useWorkbenchStore((s) => s.prPanelByTab[tabId] ?? EMPTY_PR_PANEL);
  const loadMorePrs = useWorkbenchStore((s) => s.loadMorePrs);
  const prs = panel.list?.kind === 'list' ? panel.list.prs : [];
  if (panel.list === null) return <Hint text={t('pr.loading')} />;
  if (prs.length === 0) return <Hint text={t('pr.empty')} />;
  const mayHaveMore = prs.length >= panel.limit && panel.limit < PR_MAX_LIMIT;
  return (
    <ul className="flex flex-col p-[4px_6px]">
      {prs.map((pr) => (
        <PrRow key={prKeyToString(pr.key)} pr={pr} selected={prKeyToString(pr.key) === panel.selectedKey} onSelect={onSelect} />
      ))}
      {mayHaveMore && (
        <li className="p-[6px]">
          <button data-pr-more disabled={panel.loading} onClick={() => void loadMorePrs(tabId)} className={BUTTON}>
            {t('pr.loadMore')}
          </button>
        </li>
      )}
    </ul>
  );
}

function PrRow({ pr, selected, onSelect }: { readonly pr: PrSnapshot; readonly selected: boolean; readonly onSelect: (key: PrKey) => void }): React.JSX.Element {
  const t = useT();
  return (
    <li>
      <button
        data-pr-row={prKeyToString(pr.key)}
        aria-pressed={selected}
        aria-label={t('pr.rowLabel', { number: pr.number, title: pr.title })}
        onClick={() => onSelect(pr.key)}
        className={`flex w-full flex-col items-start gap-[2px] rounded-[6px] px-[8px] py-[5px] text-left ${selected ? 'bg-mg-sel text-mg-sel-ink' : 'hover:bg-mg-hover'}`}
      >
        <span className="flex w-full items-center gap-[6px]">
          <span className="shrink-0 font-mono text-mg-ter">{`#${pr.number}`}</span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-mg-body">{pr.title}</span>
          <StateBadge pr={pr} />
        </span>
        <span className="flex w-full items-center gap-[8px] text-[10px] text-mg-ter">
          <span className="truncate">{t('pr.by', { author: pr.author })}</span>
          <ChecksSummary pr={pr} />
          <span className="ml-auto shrink-0">{sinceText(pr.updatedAt)}</span>
        </span>
      </button>
    </li>
  );
}
