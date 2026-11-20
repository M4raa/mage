import { useEffect, useRef, useState } from 'react';
import type { BrowserBounds, BrowserEntryState } from '@shared/browser';
import { useT } from '../../i18n/uiLanguage';
import { usePaneTabId } from '../paneContext';
import { describeError } from '../describeError';
import { useWorkbenchStore } from '../workbenchStore';
import { Hint } from '../components/TranscriptHint';
import { BrowserControlBar } from './BrowserControlBar';
import { BrowserToolbar } from './BrowserToolbar';
import { browserPanelViewOf, sameBounds, toWindowBounds } from './browserPanelModel';
import { ensureBrowserStateSync, useBrowserStore } from './browserStore';
import { PenOverlay } from './PenOverlay';

// Panel «Navegador» (D-S7): la barra de direcciones y el hueco donde main coloca la WebContentsView de la sesión.
// El contenido de la página es una vista nativa, no DOM: aquí solo se mide el hueco y se le dice a main dónde está.
ensureBrowserStateSync();

// Cada cuántos ms se vuelve a medir el hueco por si el panel se mueve sin cambiar de tamaño.
const BOUNDS_POLL_MS = 250;

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

function BrowserPanelBody({ sessionId, state }: { readonly sessionId: string; readonly state: BrowserEntryState | null }): React.JSX.Element {
  const tabId = usePaneTabId();
  const [penOpen, setPenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const penActive = penOpen && state !== null;
  return (
    // `h-full` y no solo `flex-1`: el contenedor de los paneles del dock no es flex, y con `flex-1` el panel medía lo que la
    // barra de direcciones (39 px) y la vista nativa quedaba en un hueco de 0 px de alto (P-038: «google.com no pinta nada»).
    <div data-browser-panel className="flex h-full min-h-0 flex-1 flex-col">
      <BrowserToolbar sessionId={sessionId} state={state} onError={setError} onPen={() => setPenOpen(true)} />
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
