import { useState } from 'react';
import type { MergeStrategy, PrDetail, PrKey, PrWriteAction, RepoMergeOptions } from '@shared/pr';
import { useWorkbenchStore } from '../../workbenchStore';
import { allowedStrategies, canWrite } from '../../prPanelModel';
import { useT } from '../../../i18n/uiLanguage';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';
import { BUTTON } from './PrPieces';

// Acciones de escritura de una PR. Cada una manda el head del detalle cargado (lo hace la store) y se
// deshabilita mientras hay una en vuelo. Fusionar pide confirmacion en linea y solo ofrece las estrategias
// que el repositorio permite.

const STRATEGY_LABELS = {
  squash: 'pr.strategy.squash',
  merge: 'pr.strategy.merge',
  rebase: 'pr.strategy.rebase',
} as const satisfies Readonly<Record<MergeStrategy, MessageKey>>;

const DEFAULT_STRATEGY: MergeStrategy = 'squash';

interface Props {
  readonly tabId: string;
  readonly prKey: PrKey;
  readonly detail: PrDetail;
  readonly options: RepoMergeOptions | undefined;
}

export function PrActionsBar({ tabId, prKey, detail, options }: Props): React.JSX.Element {
  const t = useT();
  const runPrAction = useWorkbenchStore((s) => s.runPrAction);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<MergeStrategy | null>(null);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const strategies = options === undefined ? [] : allowedStrategies(options);

  const run = async (action: PrWriteAction, clearText = false): Promise<void> => {
    setBusy(true);
    try {
      const done = await runPrAction(tabId, prKey, action);
      if (done && clearText) setText('');
    } finally {
      setBusy(false);
      setPending(null);
      setPicking(false);
    }
  };
  const body = text.trim();
  const button = (action: string, label: string, onClick: () => void, disabled = false, tip?: string): React.JSX.Element => (
    <button data-pr-action={action} aria-label={label} title={tip} disabled={busy || disabled} onClick={onClick} className={BUTTON}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-[6px]">
      {canWrite(detail, 'comment') && (
        <textarea
          data-pr-comment-box
          aria-label={t('pr.commentPlaceholder')}
          placeholder={t('pr.commentPlaceholder')}
          value={text}
          rows={2}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          className="w-full resize-y rounded-[6px] border border-mg-border-ctrl bg-transparent p-[6px] text-[11px] text-mg-body"
        />
      )}
      <div className="flex flex-wrap items-center gap-[6px]">
        {canWrite(detail, 'comment') && button('comment', t('pr.comment'), () => void run({ kind: 'comment', body }, true), body.length === 0)}
        {canWrite(detail, 'review') && button('approve', t('pr.approve'), () => void run({ kind: 'review', event: 'approve', body }, true))}
        {canWrite(detail, 'review') &&
          button('requestChanges', t('pr.requestChanges'), () => void run({ kind: 'review', event: 'request_changes', body }, true), body.length === 0, body.length === 0 ? t('pr.requestChangesNeedsText') : undefined)}
        {canWrite(detail, 'close') && button('close', t('pr.close'), () => void run({ kind: 'close' }))}
        {canWrite(detail, 'reopen') && button('reopen', t('pr.reopen'), () => void run({ kind: 'reopen' }))}
        {canWrite(detail, 'merge') && button('merge', `${t('pr.merge')} ▾`, () => setPicking(!picking), options === undefined)}
        {canWrite(detail, 'autoMerge') &&
          button('autoMerge', detail.autoMerge ? t('pr.autoMergeOff') : t('pr.autoMergeOn'), () => void run({ kind: 'autoMerge', enabled: !detail.autoMerge, strategy: strategies[0] ?? DEFAULT_STRATEGY }), options === undefined)}
      </div>
      {picking && (
        <div data-pr-strategies role="menu" className="flex flex-wrap items-center gap-[6px]">
          {strategies.length === 0 && <span className="text-[10.5px] text-mg-muted">{t('pr.noStrategies')}</span>}
          {strategies.map((strategy) => (
            <button key={strategy} role="menuitem" data-pr-strategy={strategy} disabled={busy} onClick={() => setPending(strategy)} className={BUTTON}>
              {t(STRATEGY_LABELS[strategy])}
            </button>
          ))}
        </div>
      )}
      {pending !== null && (
        <div data-pr-confirm role="alertdialog" aria-label={t('pr.confirmMerge', { number: detail.number, strategy: t(STRATEGY_LABELS[pending]) })} className="flex flex-wrap items-center gap-[8px] rounded-[6px] bg-mg-hover p-[6px_8px] text-[11px] text-mg-body">
          <span>{t('pr.confirmMerge', { number: detail.number, strategy: t(STRATEGY_LABELS[pending]) })}</span>
          <label className="inline-flex items-center gap-[5px] text-mg-body2">
            <input type="checkbox" checked={deleteBranch} disabled={busy} onChange={(e) => setDeleteBranch(e.target.checked)} />
            {t('pr.deleteBranch')}
          </label>
          <button data-pr-confirm-yes disabled={busy} onClick={() => void run({ kind: 'merge', strategy: pending, deleteBranch })} className="font-semibold hover:underline">
            {t('pr.confirm')}
          </button>
          <button disabled={busy} onClick={() => setPending(null)} className="hover:underline">
            {t('pr.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
