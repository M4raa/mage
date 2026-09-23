import { resolvePanelDefinitions } from '../panels/panelRegistry';
import { usePanelLayoutStore } from '../panelLayoutStore';
import { SplitZones } from './dock/DockZone';

const BORDER = 'border-t border-mg-border';

// Borde inferior COMPARTIDO (F6 Fase 4 + ajuste 2026-08-06): 'a' = mitad izquierda, 'b' = mitad
// derecha (§3.1 de PLAN-F6-PANELES.md), lado a lado si ambas tienen algo abierto, con divisor de
// SPLIT ajustable entre ambas (ver SplitZones). Sin stripe de iconos propia: la posicion "abajo" que
// dispara estos paneles vive en las barras laterales (AccountRail.tsx para 'a', RightDock.tsx para
// 'b') — el icono esta en el lado, el panel aqui, igual que el modelo que describio el usuario viendo
// JetBrains en vivo. Ningun panel del catalogo tiene `defaultAnchor: 'bottom'` por defecto, asi que en
// una instalacion nueva este borde ni se pinta; en cuanto el usuario mueva cualquier panel aqui con
// "Mover a...", aparece de verdad, sin tocar App.tsx.
export function BottomDock(): React.JSX.Element | null {
  const stripe = usePanelLayoutStore((s) => s.layout.stripes.bottom);

  const zoneAPanels = resolvePanelDefinitions(stripe.a.panelIds);
  const zoneBPanels = resolvePanelDefinitions(stripe.b.panelIds);
  if (zoneAPanels.length === 0 && zoneBPanels.length === 0) return null; // ningun pane que pintar

  return (
    <SplitZones
      anchor="bottom"
      stripe={stripe}
      borderClassNameA={BORDER}
      borderClassNameB={BORDER}
      resizeAriaLabelA="Redimensionar panel inferior izquierdo"
      resizeAriaLabelB="Redimensionar panel inferior derecho"
      splitAriaLabel="Redimensionar reparto entre izquierda y derecha, borde inferior"
    />
  );
}
