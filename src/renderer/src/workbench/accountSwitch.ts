import type { ChatStatus } from './types';

// Que hacer al pulsar otra cuenta en la cabecera con una conversacion abierta (P-026 2.7, D5/D6).
// Antes solo cambiaba la cuenta activa y la conversacion se quedaba donde estaba, sin decir nada.
//   - 'switch': solo cambiar de cuenta (no hay conversacion que llevarse, o no se puede).
//   - 'switch-and-new-chat': la conversacion tiene un turno EN MARCHA (D5: «activo» = eso). Sigue
//     trabajando en su cuenta, y en la destino se abre un chat nuevo.
//   - 'ask': conversacion parada con algo que migrar: se pregunta si llevarsela (sin «recordar», D6).
//   - 'reassign': chat NUEVO (sin sesion, sin `resumeSessionId` y sin bloques): la pestaña se pasa a la
//     cuenta destino sin preguntar (P-028, punto 31). Antes era 'switch' y el primer mensaje salia por
//     la cuenta vieja, que es la que seguia en `tab.accountId`.
export type AccountSwitchPlan = 'switch' | 'switch-and-new-chat' | 'ask' | 'reassign';

export interface AccountSwitchContext {
  // La pestaña que se esta mirando; undefined si no hay ninguna.
  readonly activeTab: { readonly accountId: string; readonly resumeSessionId?: string } | undefined;
  readonly status: ChatStatus | undefined;
  readonly liveSessionId: string | undefined;
  readonly destAccountId: string;
  // Una cuenta sin sesion no puede ni abrir un chat ni reanudar uno: solo se cambia (y avisa su panel).
  readonly destLoggedIn: boolean;
  // La pestaña ya tiene algo en pantalla (bloques del stream o hidratados): ya no es un chat nuevo.
  readonly hasBlocks: boolean;
  // Origen y destino son cuentas de Claude: solo sus transcripciones se pueden mover entre cuentas. Las de
  // Codex (y entre proveedores) tienen otro formato y otro almacén, así que una conversación con
  // contenido no migra: se queda donde está y en la cuenta destino se abre una nueva.
  readonly canMigrate: boolean;
}

export function planAccountSwitch(ctx: AccountSwitchContext): AccountSwitchPlan {
  const tab = ctx.activeTab;
  if (tab === undefined || tab.accountId === ctx.destAccountId || !ctx.destLoggedIn) return 'switch';
  if (ctx.status === 'streaming' || ctx.status === 'needs_permission') return 'switch-and-new-chat';
  const migratable = ctx.liveSessionId !== undefined || tab.resumeSessionId !== undefined;
  if (migratable) return ctx.canMigrate ? 'ask' : 'switch-and-new-chat';
  return ctx.hasBlocks ? 'switch' : 'reassign';
}

// Modelo de un chat nuevo que cambia de cuenta (punto 31): se conserva si la cuenta destino lo ofrece
// —o si aun no se conoce su catalogo, porque el selector conserva siempre el modelo actual— y si no se
// re-resuelve para ella.
export function modelForReassignedTab(
  currentModel: string,
  destCatalogIds: readonly string[] | undefined,
  resolveForDest: () => string,
): string {
  if (destCatalogIds === undefined || destCatalogIds.includes(currentModel)) return currentModel;
  return resolveForDest();
}
