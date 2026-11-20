import { useState } from 'react';
import { Dropdown } from './Dropdown';
import { providerLabel } from '../accountView';
import { useWorkbenchStore } from '../workbenchStore';
import { DEFAULT_CHOICE, effortAfterModelChange, effortOptionsOf, modelOptionsOf } from '../launchCards';
import type { LaunchCardState } from '../launchCards';
import { useT } from '../../i18n/uiLanguage';

const CARD = 'flex max-w-[380px] min-w-0 flex-col gap-[8px] rounded-[8px] border border-mg-border-subtle bg-mg-block px-[11px] py-[9px] text-[12px]';
const BUTTON = 'rounded-[6px] border border-mg-border-emph px-[11px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover disabled:opacity-50';
const PRIMARY = 'rounded-[6px] bg-mg-primary px-[12px] py-[4px] text-[11px] font-semibold text-mg-primary-ink disabled:opacity-50';

// Tarjeta «Lanzar» en la conversación que pidió la sesión: lo heredado ya puesto, y «Lanzar» o «Cancelar». Contestada,
// queda en una línea.
export function LaunchCard({ card }: { readonly card: LaunchCardState }): React.JSX.Element {
  const t = useT();
  if (card.outcome !== null) return <LaunchCardLine card={card} />;
  return <LaunchCardForm card={card} defaultLabel={t('chat.launchCard.default')} />;
}

function LaunchCardForm({ card, defaultLabel }: { readonly card: LaunchCardState; readonly defaultLabel: string }): React.JSX.Element {
  const t = useT();
  const launch = useWorkbenchStore((s) => s.launchDelegated);
  const cancel = useWorkbenchStore((s) => s.cancelDelegatedLaunch);
  const account = useWorkbenchStore((s) => s.accounts.find((candidate) => candidate.id === card.accountId)?.alias ?? card.accountId);
  const [model, setModel] = useState(card.model ?? DEFAULT_CHOICE);
  const [effort, setEffort] = useState(card.effort ?? DEFAULT_CHOICE);
  const changeModel = (next: string): void => {
    setModel(next);
    setEffort(effortAfterModelChange(card, next, effort));
  };
  return (
    <div className="flex justify-start">
      <div data-launch-card={card.childId} className={CARD}>
        <div className="min-w-0">
          <div className="truncate font-semibold text-mg-body" title={card.title}>{card.title}</div>
          <div className="truncate text-[11px] text-mg-muted">{providerLabel(card.provider)} · {account}</div>
          <div className="text-[11px] text-mg-muted">{t('chat.launchCard.heading')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <Dropdown value={model} options={modelOptionsOf(card, defaultLabel)} onChange={changeModel} ariaLabel={t('chat.launchCard.model')} triggerData={{ 'data-launch-model': model }} />
          <Dropdown value={effort} options={effortOptionsOf(card, model, defaultLabel)} onChange={setEffort} ariaLabel={t('chat.launchCard.effort')} triggerData={{ 'data-launch-effort': effort }} />
        </div>
        {card.error !== null && <div role="alert" className="text-[11px] text-mg-danger">{card.error}</div>}
        <div className="flex justify-end gap-[6px]">
          <button type="button" data-launch-cancel disabled={card.busy} onClick={() => void cancel(card.childId)} className={BUTTON}>{t('chat.launchCard.cancel')}</button>
          <button type="button" data-launch-go disabled={card.busy} onClick={() => void launch(card.childId, { model, effort })} className={PRIMARY}>{t('chat.launchCard.launch')}</button>
        </div>
      </div>
    </div>
  );
}

function LaunchCardLine({ card }: { readonly card: LaunchCardState }): React.JSX.Element {
  const t = useT();
  const outcome = card.outcome;
  const launched = outcome !== null && outcome.launched;
  const text = launched
    ? t('chat.launchCard.launched', { model: outcome.model ?? t('chat.launchCard.default'), effort: outcome.effort ?? t('chat.launchCard.default') })
    : t('chat.launchCard.notLaunched');
  return (
    <div className="flex justify-start">
      <div data-launch-card={card.childId} data-launch-outcome={launched ? 'launched' : 'cancelled'} className="truncate text-[11.5px] text-mg-muted" title={card.title}>
        {card.title} · {text}
      </div>
    </div>
  );
}
