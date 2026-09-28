import type { ChatStatus } from './types';

// Que hacer al pulsar otra cuenta en la cabecera con una conversacion abierta (P-026 2.7, D5/D6).
// Antes solo cambiaba la cuenta activa y la conversacion se quedaba donde estaba, sin decir nada.
//   - 'switch': solo cambiar de cuenta (no hay conversacion que llevarse, o no se puede).
//   - 'switch-and-new-chat': la conversacion tiene un turno EN MARCHA (D5: «activo» = eso). Sigue
//     trabajando en su cuenta, y en la destino se abre un chat nuevo.
//   - 'ask': conversacion parada con algo que migrar: se pregunta si llevarsela (sin «recordar», D6).
export type AccountSwitchPlan = 'switch' | 'switch-and-new-chat' | 'ask';

export interface AccountSwitchContext {
  // La pestaña que se esta mirando; undefined si no hay ninguna.
  readonly activeTab: { readonly accountId: string; readonly resumeSessionId?: string } | undefined;
  readonly status: ChatStatus | undefined;
  readonly liveSessionId: string | undefined;
  readonly destAccountId: string;
  // Una cuenta sin sesion no puede ni abrir un chat ni reanudar uno: solo se cambia (y avisa su panel).
  readonly destLoggedIn: boolean;
}

export function planAccountSwitch(ctx: AccountSwitchContext): AccountSwitchPlan {
  const tab = ctx.activeTab;
  if (tab === undefined || tab.accountId === ctx.destAccountId || !ctx.destLoggedIn) return 'switch';
  if (ctx.status === 'streaming' || ctx.status === 'needs_permission') return 'switch-and-new-chat';
  const migratable = ctx.liveSessionId !== undefined || tab.resumeSessionId !== undefined;
  return migratable ? 'ask' : 'switch';
}
