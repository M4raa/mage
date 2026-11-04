import type { PrSnapshot } from '@shared/pr';
import { prStateBadge, type PrStateBadge } from '../../prPanelModel';
import { reportActionError } from '../../notificationStore';
import { t as translate, useT } from '../../../i18n/uiLanguage';
import { relativeTime } from '../../conversationList';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';

// Piezas pequeñas compartidas por el panel de PR y su detalle.

export const BUTTON = 'rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-[10.5px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body disabled:opacity-50';
export const SECTION_TITLE = 'px-[10px] pt-[8px] pb-[2px] text-[10px] font-bold tracking-[.06em] text-mg-ter';

// Guarda la CLAVE del estado: se traduce al pintar.
const STATE_LABELS = {
  draft: 'chat.pr.state.draft',
  open: 'chat.pr.state.open',
  merged: 'chat.pr.state.merged',
  closed: 'chat.pr.state.closed',
} as const satisfies Readonly<Record<PrStateBadge, MessageKey>>;

const STATE_TONES: Readonly<Record<PrStateBadge, string>> = {
  draft: 'text-mg-muted',
  open: 'text-mg-diff-add',
  merged: 'text-mg-body2',
  closed: 'text-mg-diff-del',
};

export function StateBadge({ pr }: { readonly pr: PrSnapshot }): React.JSX.Element {
  const t = useT();
  const badge = prStateBadge(pr);
  return (
    <span data-pr-state={badge} className={`shrink-0 rounded-full border border-mg-border-subtle px-[6px] text-[9.5px] ${STATE_TONES[badge]}`}>
      {t(STATE_LABELS[badge])}
    </span>
  );
}

// Los mismos glifos y colores que la barra compacta: ✓ pasan, ✗ fallan, ● en curso.
export function ChecksSummary({ pr }: { readonly pr: PrSnapshot }): React.JSX.Element | null {
  const { pass, fail, pending } = pr.summary;
  const counts = [
    { glyph: '✓', count: pass, tone: 'text-mg-diff-add' },
    { glyph: '✗', count: fail, tone: 'text-mg-diff-del' },
    { glyph: '●', count: pending, tone: 'text-mg-muted' },
  ].filter((entry) => entry.count > 0);
  if (counts.length === 0) return null;
  return (
    <span data-pr-checks className="inline-flex shrink-0 gap-[5px] font-mono text-[10px]">
      {counts.map((entry) => (
        <span key={entry.glyph} className={entry.tone}>{`${entry.glyph}${entry.count}`}</span>
      ))}
    </span>
  );
}

// «hace 3 h» de una fecha ISO; vacio si gh no mando una fecha valida.
export function sinceText(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : relativeTime(ms);
}

export function openExternal(url: string): void {
  void window.mage.openExternal(url).catch((err: unknown) => reportActionError(translate('app.prBar.openLinkFailed'), err, 'pr'));
}
