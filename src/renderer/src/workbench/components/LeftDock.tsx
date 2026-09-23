import { usePanelLayoutStore } from '../panelLayoutStore';
import { SplitZones } from './dock/DockZone';

// Un unico borde para las dos zonas. La separacion entre "arriba" y "medio" la da YA el divisor de
// split de SplitZones (3px de bg-mg-border, ver ZoneResizeHandle) — el `border-t` que la zona 'b'
// llevaba ademas pintaba una SEGUNDA linea pegada a la primera (Ronda 3, item 6).
const BORDER = 'border-r border-mg-border';

// Borde izquierdo (F6, PLAN-F6-PANELES.md §3.2/§6/§7): un pane por zona ABIERTA ('a' = arriba, hoy
// `conversations`; 'b' = medio, hoy `usage`), con divisor de SPLIT ajustable entre ambas (2026-08-06,
// ver SplitZones). La STRIPE de iconos de este borde ya NO vive aqui (feedback del usuario: se veian
// como dos barras laterales pegadas) — sus iconos se pintan dentro de `AccountRail.tsx`, fundidos en
// una sola columna de 52px con el selector de cuentas (incluida la tercera posicion "abajo", que
// apunta al panel COMPARTIDO de abajo, no a este borde — ver ahi).
export function LeftDock(): React.JSX.Element {
  const stripe = usePanelLayoutStore((s) => s.layout.stripes.left);

  return (
    <SplitZones
      anchor="left"
      stripe={stripe}
      borderClassNameA={BORDER}
      borderClassNameB={BORDER}
      resizeAriaLabelA="Redimensionar panel izquierdo arriba"
      resizeAriaLabelB="Redimensionar panel izquierdo medio"
      splitAriaLabel="Redimensionar reparto entre arriba y medio, borde izquierdo"
    />
  );
}
