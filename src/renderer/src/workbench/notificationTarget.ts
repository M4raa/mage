import type { NotificationTarget } from '@shared/ipc';

// A donde lleva el clic en una notificacion del SO (P-028 40). PURO: recibe lo que sabe el store.
//   1. La pestaña que la pidio, si sigue abierta en esta ventana (por id o por la sesion que corre).
//   2. Si no, la conversacion en el historial: solo se RESALTA su fila. Reabrirla con `openConversation`
//      cortaria la sesion viva en segundo plano (decision a de 40).
//   3. Nada: la ventana ya se ha enfocado y no hay a donde ir.
export type NotificationDestination =
  | { readonly kind: 'tab'; readonly tabId: string; readonly accountId: string }
  | { readonly kind: 'history'; readonly sessionId: string; readonly accountId: string | null }
  | { readonly kind: 'none' };

export interface NotificationTargetContext {
  readonly tabs: readonly { readonly id: string; readonly accountId: string; readonly resumeSessionId?: string }[];
  readonly sessionIdByChat: Readonly<Record<string, string>>;
  // Cuenta de las sesiones en segundo plano (pestaña cerrada con trabajo en vuelo).
  readonly backgroundAccountBySession: Readonly<Record<string, string>>;
  readonly historySessionIds: ReadonlySet<string>;
}

export function resolveNotificationTarget(target: NotificationTarget, context: NotificationTargetContext): NotificationDestination {
  const tab = findTab(target, context);
  if (tab !== undefined) return { kind: 'tab', tabId: tab.id, accountId: tab.accountId };
  const backgroundAccount = context.backgroundAccountBySession[target.sessionId];
  if (backgroundAccount !== undefined || context.historySessionIds.has(target.sessionId)) {
    return { kind: 'history', sessionId: target.sessionId, accountId: backgroundAccount ?? null };
  }
  return { kind: 'none' };
}

function findTab(target: NotificationTarget, context: NotificationTargetContext): NotificationTargetContext['tabs'][number] | undefined {
  if (target.tabId !== undefined) {
    const byId = context.tabs.find((tab) => tab.id === target.tabId);
    if (byId !== undefined) return byId;
  }
  // En otra ventana los ids de pestaña no significan nada: se busca por la sesion.
  return context.tabs.find((tab) => (context.sessionIdByChat[tab.id] ?? tab.resumeSessionId) === target.sessionId);
}
