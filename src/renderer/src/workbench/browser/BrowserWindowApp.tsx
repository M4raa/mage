import { useEffect } from 'react';
import { useT } from '../../i18n/uiLanguage';
import { BrowserPanelBody } from './BrowserPanel';
import { useBrowserStore } from './browserStore';

// Ventana propia del navegador de una sesión (`?browserWindow=<sessionId>&title=<conversación>`): solo el navegador,
// con las mismas barras que el panel. La vista nativa la coloca main en el hueco que esta ventana informa.
export function BrowserWindowApp({ sessionId, title }: { readonly sessionId: string; readonly title: string }): React.JSX.Element {
  const t = useT();
  const state = useBrowserStore((s) => s.states[sessionId] ?? null);
  useEffect(() => {
    document.title = t('chat.browser.windowTitle', { title });
  }, [t, title]);
  return (
    <div data-browser-window={sessionId} className="flex h-screen w-screen flex-col bg-mg-window text-mg-body">
      <BrowserPanelBody sessionId={sessionId} state={state} place="window" />
    </div>
  );
}
