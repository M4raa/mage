import { useEffect, useRef } from 'react';
import { resolveTrapTarget, shouldRestoreFocus } from './focusTrap';

// Selector de elementos focusables dentro de un panel de dialogo (subconjunto habitual, sin los que
// estan deshabilitados o con tabindex negativo).
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Hook de accesibilidad para modales (M3) y, desde F6 Fase 4, para paneles acoplables no modales
// (PLAN-F6-PANELES.md §6: mismo contrato de Escape+restauracion de foco, pero SIN robar el foco al
// montar cuando el panel se abrio por hidratacion, y SIN atrapar Tab — un panel de dock no es modal,
// el usuario debe poder tabular fuera de el hacia el resto de la app). Devuelve un ref que se pone en
// el PANEL. Mientras esta abierto: Escape -> onClose; Tab/Shift+Tab atrapados SOLO si `trapTab`
// (resolveTrapTarget, logica pura). Al desmontar: restaura SIEMPRE el foco previo (el contrato de
// "Escape devuelve el foco a quien abrio esto" no depende de si se robo el foco al abrir).
export function useDialogA11y({
  onClose,
  stealFocusOnMount = true,
  trapTab = true,
}: {
  readonly onClose: () => void;
  readonly stealFocusOnMount?: boolean;
  readonly trapTab?: boolean;
}): React.RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // onClose puede cambiar de identidad entre renders; lo guardamos en un ref para no re-montar el efecto.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;

    const doc = panel.ownerDocument;
    const previouslyFocused = doc.activeElement as HTMLElement | null;
    if (stealFocusOnMount) focusFirst(panel);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!appliesToPanel(panel, doc, event, trapTab)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (trapTab && event.key === 'Tab') handleTab(panel, event);
    };

    // El listener va en el DOCUMENTO, no en el panel: cuando el elemento enfocado se DESMONTA (pulsar
    // "Cancelar" en un formulario, borrar una fila de una lista…) Chromium manda el foco a <body> SIN
    // emitir blur, asi que un listener colgado del panel deja de recibir teclas y el modal se queda sin
    // Escape y sin trampa de Tab. Medido con verify:gui: tras "Cancelar" en el formulario de
    // Proveedores, Escape no cerraba Configuracion. `appliesToPanel` acota que teclas son suyas.
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('keydown', onKeyDown);
      // Restaura el foco al elemento que lo tenia antes de abrir (si sigue en el DOM), salvo que otro
      // dialogo lo haya tomado ya (ver shouldRestoreFocus).
      if (previouslyFocused === null || !doc.contains(previouslyFocused)) return;
      if (!shouldRestoreFocus<Node>(doc.activeElement, [doc.body, doc.documentElement], (node) => panel.contains(node))) return;
      previouslyFocused.focus();
    };
  }, [stealFocusOnMount, trapTab]);

  return panelRef;
}

// ¿Le toca a este panel atender la tecla? Si la pulsacion viene de DENTRO del panel, si. Si el foco se
// ha perdido (esta en <body>/<html>, tipico tras desmontar el control enfocado), tambien —pero solo en un
// panel MODAL: un panel acoplable no atrapa nada, y si respondiera al foco perdido se cerraria con
// cualquier Escape de la app. Lo demas (el foco esta en otro sitio con vida propia) no es suyo.
function appliesToPanel(panel: HTMLElement, doc: Document, event: KeyboardEvent, isModal: boolean): boolean {
  const target = event.target as Node | null;
  if (target !== null && panel.contains(target)) return true;
  if (!isModal) return false;
  const focused = doc.activeElement;
  return focused === null || focused === doc.body || focused === doc.documentElement;
}

// Enfoca el primer focusable de `panel`; si no hay ninguno, el propio panel (con tabIndex=-1) para que
// el foco no quede fuera de el. Exportada (F6 Fase 4): ZonePane.tsx la reutiliza para robar el foco
// cuando un panel se activa por una accion explicita SIN que el componente vuelva a montar (mover un
// panel a una zona que ya estaba abierta con otro panel activo — no hay "mount" en ese caso, solo
// cambia `activePanelId`, asi que el hook de arriba, atado al ciclo de montaje, no lo cubriria).
export function focusFirst(panel: HTMLElement): void {
  const focusables = focusablesOf(panel);
  if (focusables.length > 0) {
    focusables[0]?.focus();
    return;
  }
  panel.tabIndex = -1;
  panel.focus();
}

// Atrapa el Tab dentro del panel: calcula (logica pura) si hay que envolver el foco y a que indice.
function handleTab(panel: HTMLElement, event: KeyboardEvent): void {
  const focusables = focusablesOf(panel);
  const activeIndex = focusables.indexOf(panel.ownerDocument.activeElement as HTMLElement);
  const target = resolveTrapTarget(focusables.length, activeIndex, event.shiftKey);
  if (target === null) return; // en medio: comportamiento por defecto
  event.preventDefault();
  focusables[target]?.focus();
}

function focusablesOf(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}
