import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { installRendererLogForwarding } from './rendererLogForwarding';
import { applyCustomThemeTokens, applyResolvedTheme, readStartupCustomTokens, readStartupTheme } from './workbench/theme';
import './index.css';

// Reenvia consola/errores del renderer al stream de debug (no-op en produccion).
installRendererLogForwarding();

// Aplica el tema ANTES de montar React usando los hints de localStorage (sin esto habria un parpadeo al
// tema contrario mientras llega la configuracion por IPC). Primero el tema base (data-theme) y luego,
// si habia un tema importado activo, sus overrides de color. init() reconcilia con el fichero de settings.
applyResolvedTheme(readStartupTheme() ?? 'dark');
const startupCustom = readStartupCustomTokens();
if (startupCustom !== null) applyCustomThemeTokens(startupCustom);

const container = document.getElementById('root');
if (!container) throw new Error('No se encontro el nodo #root en index.html');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {/* reducedMotion="user": si el SO pide movimiento reducido, motion/react recorta solas las
          animaciones de transform a un cambio instantaneo (deja opacity), sin tocar cada componente
          — mismo criterio que ya sigue mg-sparkle a mano en index.css. */}
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
