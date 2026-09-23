// Fusion PURA (M2.6, sidebar = historial) del historial EN DISCO con las pestanas ABIERTAS, por
// cuenta y privacidad. Una conversacion abierta (pestana) se muestra con su estado vivo; el resto del
// historial se muestra como filas reabribles. Sin store ni IPC -> testable.
import type { ConversationSummary } from '@shared/conversations';
import type { ConversationPrivacy } from '@shared/state';
import type { Tab } from './types';

export type ConversationRow =
  | { readonly kind: 'tab'; readonly tab: Tab }
  | { readonly kind: 'history'; readonly item: ConversationSummary };

// Titulo de una fila (pestana abierta o entrada de historial), para buscar/mostrar.
export function rowTitle(row: ConversationRow): string {
  return row.kind === 'tab' ? row.tab.title : row.item.title;
}

// Filtra filas por texto (case-insensitive, sin acentos-sensibilidad basica) sobre el titulo. Query
// vacia -> sin filtrar (devuelve todas). PURO: testeable sin store.
export function filterConversationRows(rows: readonly ConversationRow[], query: string): ConversationRow[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...rows];
  return rows.filter((row) => rowTitle(row).toLowerCase().includes(needle));
}

// Devuelve las filas de una seccion (cuenta+privacidad) ordenadas por RECENCIA (mas reciente primero),
// mezclando pestanas abiertas e historial en la misma escala de tiempo. Deliberadamente NO se ponen las
// pestanas abiertas primero: abrir una conversacion no debe moverla de sitio (feedback GUI A6); solo
// ESCRIBIR en ella la sube al principio (el store fija `lastMessageAtMs` al enviar). Se deduplica por
// sessionId (la sesion viva o el resumeSessionId de una pestana === el sessionId del historial).
export function mergeConversationRows(
  tabs: readonly Tab[],
  history: readonly ConversationSummary[],
  sessionIdByChat: Readonly<Record<string, string>>,
  accountId: string,
  privacy: ConversationPrivacy,
): ConversationRow[] {
  const openTabs = tabs.filter((tab) => tab.accountId === accountId && tab.privacy === privacy);
  // Indice sessionId -> mtime del historial (acceso O(1)): sirve para deduplicar Y para datar una
  // pestana reabierta que aun no ha recibido mensajes en esta ejecucion.
  const historyUpdatedAt = new Map(history.map((item) => [item.sessionId, item.updatedAtMs]));
  const openSessionIds = new Set(
    openTabs.map((tab) => sessionIdOf(tab, sessionIdByChat)).filter((id): id is string => id !== undefined),
  );
  const rows: ConversationRow[] = [
    ...openTabs.map((tab): ConversationRow => ({ kind: 'tab', tab })),
    ...history
      .filter((item) => item.privacy === privacy && !openSessionIds.has(item.sessionId))
      .map((item): ConversationRow => ({ kind: 'history', item })),
  ];
  return rows.sort((a, b) => rowRecency(b, sessionIdByChat, historyUpdatedAt) - rowRecency(a, sessionIdByChat, historyUpdatedAt));
}

// Instante (ms epoch) por el que se ordena una fila. Para una pestana: su ultimo mensaje enviado en
// esta ejecucion, o el mtime de su transcripcion, o cuando se creo. 0 si no se sabe nada (pestanas
// restauradas de un formato anterior sin marcas de tiempo) -> al final, pero nunca rompe el orden.
export function rowRecency(
  row: ConversationRow,
  sessionIdByChat: Readonly<Record<string, string>>,
  historyUpdatedAt: ReadonlyMap<string, number>,
): number {
  if (row.kind === 'history') return row.item.updatedAtMs;
  const { tab } = row;
  if (tab.lastMessageAtMs !== undefined) return tab.lastMessageAtMs;
  const sessionId = sessionIdOf(tab, sessionIdByChat);
  const fromHistory = sessionId === undefined ? undefined : historyUpdatedAt.get(sessionId);
  return fromHistory ?? tab.createdAtMs ?? 0;
}

// Sesion asociada a una pestana: la viva si existe, o la que reanuda.
function sessionIdOf(tab: Tab, sessionIdByChat: Readonly<Record<string, string>>): string | undefined {
  return sessionIdByChat[tab.id] ?? tab.resumeSessionId;
}

// --- Apertura de una conversacion del historial --------------------------------------------------

// Que hacer al pulsar una fila del historial.
//  - 'activate': ya esta abierta en la cuenta activa -> solo enfocar su pestana.
//  - 'reassign': esta abierta en OTRA cuenta pero SIN sesion viva -> la pestana pasa a la cuenta activa.
//    Es el punto del historial compartido: con una cuenta seleccionada se abren con ELLA todas las
//    conversaciones compartidas, sin que la app te cambie de cuenta por detras.
//  - 'follow': esta abierta en otra cuenta y con sesion VIVA -> no se puede tener dos procesos del CLI
//    escribiendo la misma transcripcion, asi que se va a donde esta viva y el rail sigue a esa cuenta
//    (mentir sobre que cuenta la sostiene seria peor).
//  - 'create': no esta abierta -> pestana nueva con la cuenta activa.
export type OpenConversationPlan =
  | { readonly action: 'activate'; readonly tabId: string }
  | { readonly action: 'reassign'; readonly tabId: string }
  | { readonly action: 'follow'; readonly tabId: string; readonly accountId: string }
  | { readonly action: 'create' };

export interface OpenConversationContext {
  readonly tabs: readonly Tab[];
  readonly sessionIdByChat: Readonly<Record<string, string>>;
  readonly activeAccountId: string;
  readonly sessionId: string; // la conversacion que se quiere abrir
}

// PURA: decide sin tocar el store. La busqueda es por sessionId sobre TODAS las pestanas (no solo las de
// la cuenta activa) justamente porque una conversacion compartida puede estar abierta bajo otra cuenta:
// `projects/` es comun a todas, asi que la misma transcripcion se ve desde cualquiera.
export function planOpenConversation(context: OpenConversationContext): OpenConversationPlan {
  if (context.sessionId.length === 0) {
    throw new Error('sessionId vacio al abrir una conversacion del historial');
  }
  const existing = context.tabs.find(
    (tab) => sessionIdOf(tab, context.sessionIdByChat) === context.sessionId,
  );
  if (existing === undefined) return { action: 'create' };
  if (existing.accountId === context.activeAccountId) return { action: 'activate', tabId: existing.id };
  const isLive = context.sessionIdByChat[existing.id] !== undefined;
  return isLive
    ? { action: 'follow', tabId: existing.id, accountId: existing.accountId }
    : { action: 'reassign', tabId: existing.id };
}
