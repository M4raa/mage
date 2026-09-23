import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DebugApp } from './DebugApp';
import './debug.css';

// Entry de la ventana de debug (solo se carga en dev). Aislada de la app principal.
const container = document.getElementById('debug-root');
if (!container) throw new Error('No se encontro el nodo #debug-root en debug.html');

createRoot(container).render(
  <StrictMode>
    <DebugApp />
  </StrictMode>,
);
