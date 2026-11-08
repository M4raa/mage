import { useLayoutEffect } from 'react';

// Cuantos menus, desplegables o popovers con estado ABIERTO LOCAL (un `useState` propio) hay abiertos ahora.
//
// El atajo global vive en `window` y no ve ese estado: con «A la cola ▾» abierto, Escape cerraba el menu Y
// disparaba `session.interrupt`, cortando el turno (0.1.3). El guard de esa accion mira
// `dialogOrPopoverOpen`; este contador es lo que lo alimenta para los menus que no estan en el store. Un
// contador y no un booleano: pueden coincidir dos abiertos (un menu dentro de otro) y cerrar uno no puede
// dar por cerrado el otro.
let openCount = 0;

export function openLocalPopover(): void {
  openCount += 1;
}

export function closeLocalPopover(): void {
  if (openCount === 0) throw new Error(`closeLocalPopover: no hay ningun popover abierto (contador ${openCount})`);
  openCount -= 1;
}

export function hasOpenLocalPopover(): boolean {
  return openCount > 0;
}

// Un componente con menu local llama a este hook con su estado `open`. `useLayoutEffect`: el contador se
// actualiza antes de que el navegador reciba la siguiente tecla.
//
// El decremento se APLAZA un turno de eventos: el Escape que cierra el menu llega a un `keydown` de
// `document`, que cierra el menu, y React re-renderiza en un microtask ANTES de que el mismo evento llegue
// al atajo global de `window`. Con el decremento inmediato, el global ya veria el menu cerrado y cortaria el
// turno; aplazado, ese Escape todavia lo ve abierto.
export function useLocalPopover(open: boolean): void {
  useLayoutEffect(() => {
    if (!open) return;
    openLocalPopover();
    return () => {
      setTimeout(closeLocalPopover, 0);
    };
  }, [open]);
}
