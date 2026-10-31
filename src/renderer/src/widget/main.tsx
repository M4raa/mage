import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WidgetApp } from './WidgetApp';
import { initUiLanguage } from '../i18n/uiLanguage';
import { applyResolvedTheme, readStartupTheme } from '../workbench/theme';
import './widget.css';

// Entry de la ventana del WIDGET FLOTANTE (M3). Aplica el tema de arranque (hint de localStorage,
// compartido con la app principal) ANTES de montar React para evitar el parpadeo; luego cada snapshot
// trae el tema resuelto y lo re-aplica (ver WidgetApp). Fallback 'dark' (default de la app).
applyResolvedTheme(readStartupTheme() ?? 'dark');

const container = document.getElementById('widget-root');
if (!container) throw new Error('No se encontro el nodo #widget-root en widget.html');

// El idioma se resuelve ANTES de montar: sin esperar, quien tiene la interfaz en inglés vería un primer pintado en
// castellano. Si main no contesta, se monta igual en castellano y el error queda en la consola (no se traga).
await initUiLanguage(window.mage).catch((err: unknown) => console.error('[i18n] no se pudo leer el idioma de la interfaz', err));

createRoot(container).render(
  <StrictMode>
    <WidgetApp />
  </StrictMode>,
);
