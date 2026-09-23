import { z } from 'zod';

// UNICA declaracion de la forma con la que se ESCRIBE el layout de paneles (F6, panels-layout.json).
// Los tipos (`ZoneState`, `StripeState`, `PanelLayoutState` en `panelLayout.ts`) se DERIVAN de aqui.
//
// Modulo aparte por el mismo motivo que `stateSchema.ts`: `panelLayout.ts` exporta funciones y
// constantes que el renderer usa en RUNTIME, asi que declarar el esquema alli metaria Zod en el
// bundle del renderer. Aqui el import de `panelLayout.ts` es de SOLO TIPO y TypeScript lo borra.
//
// Esquema ESTRICTO a proposito (a diferencia del envelope LAXO de lectura, que vive en
// `main/state/panelLayoutStore.ts`): lo que llega a `save()` ya paso por
// `reconcileLayoutWithRegistry`, asi que una forma incompleta es un error de programacion y debe
// lanzar con el detalle. `splitPx` faltaba aqui —solo aqui, la lectura si lo respetaba— y por eso el
// reparto entre las dos zonas de un lado se perdia en CADA guardado.
export const ZONE_STATE_SCHEMA = z.object({
  panelIds: z.array(z.string()), // orden = orden de pestañas dentro del grupo
  activePanelId: z.string().nullable(), // cual de panelIds se ve; null = zona cerrada
  sizePx: z.number(), // ancho (left/right) o alto (bottom) de ESTA zona, abierta o no
});

export const STRIPE_STATE_SCHEMA = z.object({
  a: ZONE_STATE_SCHEMA,
  b: ZONE_STATE_SCHEMA,
  // Reparto entre 'a' y 'b' cuando AMBAS estan abiertas: tamaño de 'a' en el eje de apilado.
  splitPx: z.number(),
});

export const PANEL_LAYOUT_SCHEMA = z.object({
  version: z.number(),
  stripes: z.object({ left: STRIPE_STATE_SCHEMA, right: STRIPE_STATE_SCHEMA, bottom: STRIPE_STATE_SCHEMA }),
});
