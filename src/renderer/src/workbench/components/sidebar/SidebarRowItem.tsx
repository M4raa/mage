import { useLocalPopover } from '../../localPopovers';
import { memo, useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { selectIsActiveTab, useConversation } from '../../conversationSelectors';
import { useWorkbenchStore } from '../../workbenchStore';
import type { Account, ChatStatus } from '../../types';
import { relativeTime, rowRecency } from '../../conversationList';
import { backgroundLabel, backgroundMoveBlockedReason, type BackgroundSession } from '../../backgroundWork';
import { providerMonogram, providerOfRow, type RowIndicator, type SidebarRow } from '../../sidebarModel';
import { apiBilledLabel } from '../../accountView';
import { displayTitle } from '../../conversationTitle';
import { useT } from '../../../i18n/uiLanguage';

// La fila de la conversación a la que llevó el clic en una notificación (P-028 40): se trae a la vista y
// se resalta un momento. No se reabre: cortaría la sesión viva en segundo plano.
const HIGHLIGHT_MS = 4000;

function useHighlight(sessionId: string | undefined): { readonly on: boolean; readonly ref: React.RefObject<HTMLButtonElement | null> } {
  const on = useWorkbenchStore((s) => sessionId !== undefined && s.highlightedSessionId === sessionId);
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!on) return;
    ref.current?.scrollIntoView({ block: 'nearest' });
    const id = setTimeout(() => useWorkbenchStore.setState({ highlightedSessionId: null }), HIGHLIGHT_MS);
    return () => clearTimeout(id);
  }, [on]);
  return { on, ref };
}

type StatusLabelKey = 'sidebar.tab.status.streaming' | 'sidebar.tab.status.needsPermission' | 'sidebar.tab.status.error' | 'sidebar.tab.status.idle';

// Estado de la conversación en palabras (nombre accesible de la fila). Devuelve la clave: se traduce al pintar.
function statusLabel(status: ChatStatus | undefined): StatusLabelKey {
  if (status === 'streaming') return 'sidebar.tab.status.streaming';
  if (status === 'needs_permission') return 'sidebar.tab.status.needsPermission';
  if (status === 'error') return 'sidebar.tab.status.error';
  return 'sidebar.tab.status.idle';
}

export interface SidebarRowItemProps {
  readonly row: SidebarRow;
  readonly account: Account | undefined;
  readonly status: ChatStatus | undefined;
  readonly indicator: RowIndicator | null;
  // Presente = la conversación se cerró con trabajo en vuelo y su CLI sigue vivo (solo filas de historial).
  readonly background: BackgroundSession | undefined;
  readonly onSelectTab: (tabId: string) => void;
  readonly onOpenHistory: (row: SidebarRow) => void;
  readonly onRename: (tabId: string, title: string) => void;
  readonly onDragOutside: (row: SidebarRow) => void;
  readonly onMenu: (row: SidebarRow, x: number, y: number) => void;
}

// Una fila del lateral (pestaña abierta o conversación del historial): título arriba; abajo, monograma del
// proveedor, punto y alias de la cuenta y tiempo. A la derecha UN indicador y, al pasar el ratón, «⋯».
export const SidebarRowItem = memo(function SidebarRowItem(props: SidebarRowItemProps): React.JSX.Element {
  const { row } = props;
  return row.kind === 'tab' ? <TabRow {...props} row={row} /> : <HistoryRow {...props} row={row} />;
});

const ROW_CLASS = 'group relative flex items-center rounded-[6px] transition-colors duration-90 ease-out';

function TabRow(props: SidebarRowItemProps & { readonly row: Extract<SidebarRow, { kind: 'tab' }> }): React.JSX.Element {
  const { row, account, status, indicator, onSelectTab, onRename, onMenu } = props;
  const t = useT();
  const { tab } = row;
  const selected = useConversation(tab.id, selectIsActiveTab);
  const [editing, setEditing] = useState(false);
  useLocalPopover(editing); // renombrar en linea: su Escape cancela la edicion, no interrumpe el turno
  const title = displayTitle(tab.title, t);
  const commit = (value: string): void => {
    setEditing(false);
    onRename(tab.id, value);
  };
  if (editing) {
    return (
      <div data-sidebar-row="true" className={`${ROW_CLASS} bg-mg-sel text-mg-sel-ink before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark p-[5px_8px]`}>
        <input
          autoFocus
          defaultValue={title}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            else if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={(e) => commit(e.target.value)}
          aria-label={t('sidebar.tab.renameAria')}
          className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-mg-text outline-none"
        />
      </div>
    );
  }
  return (
    <div data-sidebar-row="true" className={`${ROW_CLASS} ${selected ? 'bg-mg-sel text-mg-sel-ink before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark' : 'hover:bg-mg-hover'}`}>
      <button
        onClick={() => onSelectTab(tab.id)}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(row, e.clientX, e.clientY);
        }}
        aria-current={selected}
        aria-label={`${title}, ${tab.provider} ${tab.model}, ${t(statusLabel(status))}`}
        data-tip={t('sidebar.tab.tip', { provider: tab.provider, model: tab.model })}
        className="flex min-w-0 flex-1 flex-col gap-[2px] p-[5px_8px] text-left"
      >
        <span className={`block truncate ${selected ? 'font-semibold text-mg-sel-ink' : 'text-mg-body2'}`}>{title}</span>
        <RowMeta row={row} account={account} timeText={relativeTime(rowRecency(row) === 0 ? Date.now() : rowRecency(row))} />
      </button>
      <RowTail row={row} indicator={indicator} background={undefined} account={account} onMenu={onMenu} />
    </div>
  );
}

function HistoryRow(props: SidebarRowItemProps & { readonly row: Extract<SidebarRow, { kind: 'history' }> }): React.JSX.Element {
  const { row, account, indicator, background, onOpenHistory, onDragOutside, onMenu } = props;
  const t = useT();
  const { item } = row;
  const highlighted = useHighlight(item.sessionId);
  // Arrastrarla fuera de Mage la abre en otra ventana (P-028, 36); trabajando en segundo plano, no.
  const draggableOut = backgroundMoveBlockedReason(background) === null;
  const title = displayTitle(item.title, t);
  const timeText = background === undefined ? relativeTime(item.updatedAtMs) : backgroundLabel(background.state);
  return (
    <div data-sidebar-row="true" className={`${ROW_CLASS} hover:bg-mg-hover ${highlighted.on ? 'bg-mg-sel text-mg-sel-ink before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark ring-1 ring-mg-border-emph' : ''}`}>
      <button
        ref={highlighted.ref}
        onClick={() => onOpenHistory(row)}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(row, e.clientX, e.clientY);
        }}
        draggable={draggableOut}
        data-history-session={item.sessionId}
        onDragStart={(e) => {
          // Tipo propio: que ningún campo de texto (el prompt) acepte la fila como texto soltado.
          e.dataTransfer.setData('application/x-mage-conversation', item.sessionId);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={(e) => {
          if (e.dataTransfer.dropEffect === 'none') onDragOutside(row);
        }}
        data-history-highlighted={highlighted.on ? 'true' : undefined}
        data-tip={background === undefined ? title : t('sidebar.history.backgroundTip', { title, state: backgroundLabel(background.state) })}
        aria-label={background === undefined ? title : `${title}, ${backgroundLabel(background.state)}`}
        className="flex min-w-0 flex-1 flex-col gap-[2px] p-[5px_8px] text-left"
      >
        <span className="flex min-w-0 items-center gap-[5px]">
          <span className="truncate text-mg-sec">{title}</span>
          {/* La empezó una tarea programada, no el usuario (P-026, D20). */}
          {item.isScheduled && (
            <span data-scheduled-badge="true" className="flex-none rounded-full border border-mg-border-subtle px-[5px] text-[9px] text-mg-muted">
              {t('sidebar.history.scheduled')}
            </span>
          )}
        </span>
        <RowMeta row={row} account={account} timeText={timeText} />
      </button>
      <RowTail row={row} indicator={indicator} background={background} account={account} onMenu={onMenu} />
    </div>
  );
}

// Segunda línea: monograma del proveedor, punto con el acento de la cuenta, su alias («Factura API» detrás si
// factura la API) y el tiempo. Sin peso en disco: va a la barra de estado.
function RowMeta({ row, account, timeText }: { readonly row: SidebarRow; readonly account: Account | undefined; readonly timeText: string }): React.JSX.Element {
  const providerId = providerOfRow(row);
  return (
    <span data-row-meta="true" className="flex min-w-0 items-center gap-[5px] text-[10.5px] text-mg-muted">
      <span
        data-provider-monogram={providerId}
        aria-hidden="true"
        className="inline-grid h-[14px] w-[14px] flex-none place-items-center rounded-[4px] border border-mg-border-ctrl font-mono text-[9px] font-semibold leading-none text-mg-sec"
      >
        {providerMonogram(providerId)}
      </span>
      {account !== undefined && (
        <>
          <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: account.accent.base }} />
          <span className="truncate">{account.apiBilled ? `${account.alias} · ${apiBilledLabel()}` : account.alias}</span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span className="flex-none">{timeText}</span>
    </span>
  );
}

function RowTail({ row, indicator, background, account, onMenu }: {
  readonly row: SidebarRow;
  readonly indicator: RowIndicator | null;
  readonly background: BackgroundSession | undefined;
  readonly account: Account | undefined;
  readonly onMenu: (row: SidebarRow, x: number, y: number) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <span className="flex flex-none items-center gap-[4px] pr-[6px]">
      <RowIndicatorView row={row} indicator={indicator} background={background} account={account} />
      <button
        aria-label={t('sidebar.row.moreActions')}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onMenu(row, rect.left, rect.bottom);
        }}
        className="grid h-[18px] w-[18px] flex-none place-items-center rounded-[4px] text-mg-icon opacity-0 transition-opacity duration-100 ease-out hover:bg-mg-hover focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
      >
        <Icon name="ellipsis" size={14} />
      </button>
    </span>
  );
}

// El ÚNICO indicador de la fila. Si no hay ninguno pero la conversación terminó en segundo plano, queda
// pendiente de revisar: ese es el único caso en que se pinta una pastilla neutra.
function RowIndicatorView({ row, indicator, background, account }: {
  readonly row: SidebarRow;
  readonly indicator: RowIndicator | null;
  readonly background: BackgroundSession | undefined;
  readonly account: Account | undefined;
}): React.JSX.Element | null {
  const t = useT();
  if (indicator === 'attention') {
    const text = row.kind === 'tab' ? t('sidebar.tab.permissionBadge') : t('sidebar.history.badgeAction');
    return (
      <span
        data-row-indicator="attention"
        {...(background === undefined ? {} : { 'data-background-badge': background.state })}
        className="rounded-full border border-mg-warn-border bg-mg-warn-bg px-[7px] py-px text-[10px] font-bold text-mg-warn-text"
      >
        {text}
      </span>
    );
  }
  if (indicator === 'error') return <span data-row-indicator="error" aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-mg-danger" />;
  if (indicator === 'working') {
    return <span data-row-indicator="working" aria-hidden="true" className="mg-pulse h-[7px] w-[7px] rounded-full" style={{ background: account?.accent.base ?? 'var(--color-mg-activity)' }} />;
  }
  if (indicator === 'readOnly') {
    return <span data-row-indicator="readOnly" title={t('sidebar.row.readOnly')} className="text-mg-sec"><Icon name="lock" size={12} /></span>;
  }
  if (background?.state === 'done') {
    return (
      <span data-background-badge="done" className="rounded-full border border-mg-focus px-[6px] py-px text-[9.5px] font-bold text-mg-text">
        {t('sidebar.history.badgeReview')}
      </span>
    );
  }
  return null;
}
