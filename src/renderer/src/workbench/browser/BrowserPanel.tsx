import { useEffect, useRef, useState } from 'react';
import type { BrowserBounds, BrowserEntryState } from '@shared/browser';
import { useT } from '../../i18n/uiLanguage';
import { usePaneTabId } from '../paneContext';
import { describeError } from '../describeError';
import { useWorkbenchStore } from '../workbenchStore';
import { Icon, type IconName } from '../components/Icon';
import { Hint } from '../components/TranscriptHint';
import { BrowserControlBar } from './BrowserControlBar';
import { browserPanelViewOf, sameBounds, toWindowBounds } from './browserPanelModel';
import { ensureBrowserStateSync, useBrowserStore } from './browserStore';
import { PenOverlay } from './PenOverlay';

// Panel «Navegador» (D-S7): la barra de direcciones y el hueco donde main coloca la WebContentsView de la sesión.
// El contenido de la página es una vista nativa, no DOM: aquí solo se mide el hueco y se le dice a main dónde está.
ensureBrowserStateSync();

const ICON_BUTTON = 'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-mg-muted hover:bg-mg-hover hover:text-mg-body disabled:opacity-40';

function warnBounds(err: unknown): void {
  console.warn('No se pudo colocar el navegador', describeError(err));
}

// Manda el hueco medido a main solo cuando cambia; al irse (desmontar, otra sesión, pluma abierta) oculta la vista.
function useBrowserBounds(sessionId: string, enabled: boolean, hostRef: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!enabled || host === null) return;
    let last: BrowserBounds | null = null;
    const push = (): void => {
      const bounds = toWindowBounds(host.getBoundingClientRect(), window.mage.getUiZoomFactor());
      if (sameBounds(last, bounds)) return;
      last = bounds;
      window.mage.browserSetBounds({ sessionId, bounds }).catch(warnBounds);
    };
    push();
    const observer = new ResizeObserver(push);
    observer.observe(host);
    window.addEventListener('resize', push);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', push);
      window.mage.browserSetBounds({ sessionId, bounds: null }).catch(warnBounds);
    };
  }, [sessionId, enabled, hostRef]);
}

interface ToolButtonProps {
  readonly icon: IconName;
  readonly label: string;
  readonly disabled?: boolean;
  readonly flip?: boolean;
  readonly dataAttr?: Readonly<Record<string, string>>;
  readonly onClick: () => void;
}

function ToolButton({ icon, label, disabled, flip, dataAttr, onClick }: ToolButtonProps): React.JSX.Element {
  return (
    <button title={label} aria-label={label} disabled={disabled} onClick={onClick} className={ICON_BUTTON} {...dataAttr}>
      <Icon name={icon} size={13} className={flip === true ? 'rotate-180' : ''} />
    </button>
  );
}

interface ToolbarProps {
  readonly sessionId: string;
  readonly state: BrowserEntryState | null;
  readonly onPen: () => void;
  readonly onError: (message: string | null) => void;
}

function onEnter(e: React.KeyboardEvent, typed: string | null, submit: (url: string) => void): void {
  if (e.key !== 'Enter' || typed === null || typed.trim() === '') return;
  submit(typed.trim());
}

function BrowserToolbar({ sessionId, state, onPen, onError }: ToolbarProps): React.JSX.Element {
  const t = useT();
  const [typed, setTyped] = useState<string | null>(null);
  const run = (action: Promise<unknown>): void => {
    onError(null);
    action.catch((err: unknown) => onError(describeError(err)));
  };
  const submit = (url: string): void => {
    setTyped(null);
    run(window.mage.browserNavigate({ sessionId, url }));
  };
  return (
    <div className="flex shrink-0 items-center gap-[4px] border-b border-mg-border-subtle px-[8px] py-[5px]">
      <ToolButton icon="chevron" flip label={t('chat.browser.back')} disabled={state?.canGoBack !== true} onClick={() => run(window.mage.browserBack(sessionId))} />
      <ToolButton icon="refresh" label={t('chat.browser.reload')} disabled={state === null} onClick={() => run(window.mage.browserReload(sessionId))} />
      <input
        data-browser-address
        aria-label={t('chat.browser.address')}
        value={typed ?? state?.url ?? ''}
        onFocus={() => setTyped(state?.url ?? '')}
        onBlur={() => setTyped(null)}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => onEnter(e, typed, submit)}
        spellCheck={false}
        className="min-w-0 flex-1 rounded-[6px] border border-mg-border-ctrl bg-transparent px-[8px] py-[3px] font-mono text-[10.5px] text-mg-body"
      />
      {state !== null && <ToolButton icon="pencil" label={t('chat.browser.pen')} dataAttr={{ 'data-browser-pen-button': '' }} onClick={onPen} />}
      {state !== null && <ToolButton icon="close" label={t('chat.browser.close')} dataAttr={{ 'data-browser-close': '' }} onClick={() => run(window.mage.browserClose(sessionId))} />}
    </div>
  );
}

function BrowserHost({ sessionId, state, enabled }: { readonly sessionId: string; readonly state: BrowserEntryState | null; readonly enabled: boolean }): React.JSX.Element {
  const t = useT();
  const hostRef = useRef<HTMLDivElement | null>(null);
  useBrowserBounds(sessionId, enabled, hostRef);
  if (state === null) {
    return <div className="flex min-h-0 flex-1 items-center justify-center p-[14px] text-center text-[11px] text-mg-muted">{t('chat.browser.closedHint')}</div>;
  }
  const border = state.control === 'agent' ? 'border-mg-warn-text' : 'border-transparent';
  return (
    <div className={`min-h-0 flex-1 border-2 ${border}`}>
      <div ref={hostRef} data-browser-host className="h-full w-full" />
    </div>
  );
}

function BrowserPanelBody({ sessionId, state }: { readonly sessionId: string; readonly state: BrowserEntryState | null }): React.JSX.Element {
  const tabId = usePaneTabId();
  const [penOpen, setPenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const penActive = penOpen && state !== null;
  return (
    <div data-browser-panel className="flex min-h-0 flex-1 flex-col">
      <BrowserToolbar sessionId={sessionId} state={state} onPen={() => setPenOpen(true)} onError={setError} />
      {error !== null && (
        <div role="alert" className="px-[10px] py-[4px] text-[10.5px] text-mg-danger">
          {error}
        </div>
      )}
      {state !== null && <BrowserControlBar state={state} />}
      {penActive ? <PenOverlay sessionId={sessionId} tabId={tabId} onDone={() => setPenOpen(false)} /> : <BrowserHost sessionId={sessionId} state={state} enabled={state !== null} />}
    </div>
  );
}

export function BrowserPanel(): React.JSX.Element {
  const t = useT();
  const tabId = usePaneTabId();
  const sessionId = useWorkbenchStore((s) => s.sessionIdByChat[tabId]);
  const view = browserPanelViewOf(sessionId, useBrowserStore((s) => s.states));
  if (view.kind === 'noSession') return <Hint text={t('chat.browser.noSession')} />;
  if (view.kind === 'open') return <BrowserPanelBody key={view.state.sessionId} sessionId={view.state.sessionId} state={view.state} />;
  return <BrowserPanelBody key={view.sessionId} sessionId={view.sessionId} state={null} />;
}
