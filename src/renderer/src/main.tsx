import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { installRendererLogForwarding } from './rendererLogForwarding';
import { installDocumentDropGuard } from './documentDropGuard';
import { initUiLanguage } from './i18n/uiLanguage';
import { applyCustomThemeTokens, applyResolvedTheme, readStartupCustomTokens, readStartupTheme } from './workbench/theme';
import './index.css';

// Reenvia consola/errores del renderer al stream de debug (no-op en produccion).
installRendererLogForwarding();
// Soltar un enlace o un fichero fuera del chat no navega la ventana (main también lo impide).
installDocumentDropGuard(document);

// Aplica el tema ANTES de montar React usando los hints de localStorage (sin esto habria un parpadeo al
// tema contrario mientras llega la configuracion por IPC). Primero el tema base (data-theme) y luego,
// si habia un tema importado activo, sus overrides de color. init() reconcilia con el fichero de settings.
applyResolvedTheme(readStartupTheme() ?? 'dark');
const startupCustom = readStartupCustomTokens();
if (startupCustom !== null) applyCustomThemeTokens(startupCustom);

const container = document.getElementById('root');
if (!container) throw new Error('No se encontro el nodo #root en index.html');

// El idioma se resuelve ANTES de montar: sin esperar, quien tiene la interfaz en inglés vería un primer pintado en
// castellano. Si main no contesta, se monta igual en castellano y el error queda en la consola (no se traga).
await initUiLanguage(window.mage).catch((err: unknown) => console.error('[i18n] no se pudo leer el idioma de la interfaz', err));

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
