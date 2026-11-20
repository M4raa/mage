import { useEffect, useRef, useState } from 'react';
import type { BrowserBounds, BrowserEntryState } from '@shared/browser';
import { useT } from '../../i18n/uiLanguage';
import { usePaneTabId } from '../paneContext';
import { describeError } from '../describeError';
import { useWorkbenchStore } from '../workbenchStore';
import { Hint } from '../components/TranscriptHint';
import { BrowserControlBar } from './BrowserControlBar';
import { BrowserToolbar } from './BrowserToolbar';
import { displayTitle } from '../conversationTitle';
import { browserPanelViewOf, placesView, sameBounds, toWindowBounds, type BrowserPlace } from './browserPanelModel';
import { ensureBrowserStateSync, useBrowserStore } from './browserStore';
import { PenOverlay } from './PenOverlay';

// Panel «Navegador» (D-S7): la barra de direcciones y el hueco donde main coloca la WebContentsView de la sesión.
// El contenido de la página es una vista nativa, no DOM: aquí solo se mide el hueco y se le dice a main dónde está.
ensureBrowserStateSync();

// Cada cuántos ms se vuelve a medir el hueco por si el panel se mueve sin cambiar de tamaño.
const BOUNDS_POLL_MS = 250;
const NOTICE_ACTION = 'rounded-[6px] border border-mg-border-ctrl px-[10px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover hover:text-mg-body';

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
    // ponytail: sondeo barato (un getBoundingClientRect y `sameBounds`) para los movimientos sin cambio de tamaño; un observador del layout del dock lo haría sin sondear.
    const timer = window.setInterval(push, BOUNDS_POLL_MS);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      window.removeEventListener('resize', push);
      window.mage.browserSetBounds({ sessionId, bounds: null }).catch(warnBounds);
    };
  }, [sessionId, enabled, hostRef]);
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

// El navegador está en su ventana propia: el panel lo dice y deja traerlo de vuelta.
function PoppedOutNotice({ sessionId }: { readonly sessionId: string }): React.JSX.Element {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const bringBack = (): void => {
    setError(null);
    window.mage.browserPopIn(sessionId).catch((err: unknown) => setError(describeError(err)));
  };
  return (
    <div data-browser-panel data-browser-popped-out className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-[10px] p-[14px] text-center text-[11px] text-mg-muted">
      <span>{t('chat.browser.poppedOut')}</span>
      <button data-browser-pop-in onClick={bringBack} className={NOTICE_ACTION}>
        {t('chat.browser.popIn')}
      </button>
      {error !== null && <div role="alert" className="text-[10.5px] text-mg-danger">{error}</div>}
    </div>
  );
}

interface BodyProps {
  readonly sessionId: string;
  readonly state: BrowserEntryState | null;
  readonly place: BrowserPlace;
}

// El navegador entero (barra, control y hueco de la vista). El mismo en el panel y en su ventana propia; la pluma y
// «Sacar a una ventana propia» solo en el panel (la pluma adjunta al borrador del chat, que vive en esta ventana).
export function BrowserPanelBody({ sessionId, state, place }: BodyProps): React.JSX.Element {
  const tabId = usePaneTabId();
  const [penOpen, setPenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inPanel = place === 'panel';
  const penActive = penOpen && state !== null;
  const popOut = (): void => {
    setError(null);
    window.mage.browserPopOut({ sessionId, title: conversationTitleOf(tabId) }).catch((err: unknown) => setError(describeError(err)));
  };
  return (
    // `h-full` y no solo `flex-1`: el contenedor de los paneles del dock no es flex, y con `flex-1` el panel medía lo que la
    // barra de direcciones (39 px) y la vista nativa quedaba en un hueco de 0 px de alto («google.com no pinta nada»).
    <div data-browser-panel={place} className="flex h-full min-h-0 flex-1 flex-col">
      <BrowserToolbar sessionId={sessionId} state={state} onError={setError} onPen={inPanel ? () => setPenOpen(true) : undefined} onPopOut={inPanel ? popOut : undefined} />
      {error !== null && (
        <div role="alert" className="px-[10px] py-[4px] text-[10.5px] text-mg-danger">
          {error}
        </div>
      )}
      {state !== null && <BrowserControlBar state={state} />}
      {penActive ? <PenOverlay sessionId={sessionId} tabId={tabId} onDone={() => setPenOpen(false)} /> : <BrowserHost sessionId={sessionId} state={state} enabled={placesView(state, place)} />}
    </div>
  );
}

function conversationTitleOf(tabId: string): string {
  const tab = useWorkbenchStore.getState().tabs.find((candidate) => candidate.id === tabId);
  return displayTitle(tab?.title ?? '');
}

export function BrowserPanel(): React.JSX.Element {
  const t = useT();
  const tabId = usePaneTabId();
  const sessionId = useWorkbenchStore((s) => s.sessionIdByChat[tabId]);
  const view = browserPanelViewOf(sessionId, useBrowserStore((s) => s.states));
  if (view.kind === 'noSession') return <Hint text={t('chat.browser.noSession')} />;
  if (view.kind === 'closed') return <BrowserPanelBody key={view.sessionId} sessionId={view.sessionId} state={null} place="panel" />;
  if (view.state.poppedOut) return <PoppedOutNotice key={view.state.sessionId} sessionId={view.state.sessionId} />;
  return <BrowserPanelBody key={view.state.sessionId} sessionId={view.state.sessionId} state={view.state} place="panel" />;
}
