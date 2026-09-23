import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WidgetApp } from './WidgetApp';
import { applyResolvedTheme, readStartupTheme } from '../workbench/theme';
import './widget.css';

// Entry de la ventana del WIDGET FLOTANTE (M3). Aplica el tema de arranque (hint de localStorage,
// compartido con la app principal) ANTES de montar React para evitar el parpadeo; luego cada snapshot
// trae el tema resuelto y lo re-aplica (ver WidgetApp). Fallback 'dark' (default de la app).
applyResolvedTheme(readStartupTheme() ?? 'dark');

const container = document.getElementById('widget-root');
if (!container) throw new Error('No se encontro el nodo #widget-root en widget.html');

createRoot(container).render(
  <StrictMode>
    <WidgetApp />
  </StrictMode>,
);
