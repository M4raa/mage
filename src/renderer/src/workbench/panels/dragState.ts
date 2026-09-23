import { create } from 'zustand';
import type { PanelDefinition } from './panelRegistry';

// Que icono de panel se esta arrastrando AHORA MISMO. Es estado de UI de verdad —lo pintan todas las
// zonas de suelta a la vez— asi que vive en un store y no en una variable de modulo.
//
// Existe por dos reportes del usuario que resultaron ser el mismo problema:
//
//  1. "Al arrastrar un icono, si no hay ya un icono en esa zona, no aparece la zona donde soltarlo;
//     haria falta un placeholder". Una zona vacia medía 28 px invisibles: existia como area de suelta
//     pero no habia nada que mirara, asi que nadie la usaba.
//  2. "Si arrastro un icono a la zona de abajo sin soltar, me posiciono encima del icono de mas arriba
//     y se hace un efecto raro infinito de crece / no crece". Eso es un bucle de layout clasico: al
//     entrar el puntero, la zona AÑADIA el hueco fantasma, con lo que crecia; al crecer —y como la zona
//     de abajo esta empujada contra el fondo por un hueco elastico, o sea que crece HACIA ARRIBA— se
//     movia bajo el cursor, salia del elemento, se quitaba el hueco, encogia, y volvia a entrar.
//
// La solucion de los dos es la misma: el sitio se RESERVA al empezar el arrastre y no cambia mientras
// dura. Lo que hace el `dragover` es solo resaltar. Con el layout quieto no hay bucle posible, y de
// paso la zona vacia se ve desde el primer momento, que es lo que se pedia.
export interface PanelDragState {
  readonly dragging: PanelDefinition | null;
  start: (panel: PanelDefinition) => void;
  end: () => void;
}

export const usePanelDragStore = create<PanelDragState>((set) => ({
  dragging: null,
  start: (panel) => set({ dragging: panel }),
  end: () => set({ dragging: null }),
}));
