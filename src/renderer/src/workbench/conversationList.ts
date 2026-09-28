// Fusion PURA (M2.6, sidebar = historial) del historial EN DISCO con las pestanas ABIERTAS, por
// cuenta y privacidad. Una conversacion abierta (pestana) se muestra con su estado vivo; el resto del
// historial se muestra como filas reabribles. Sin store ni IPC -> testable.
import type { ConversationSummary } from '@shared/conversations';
import type { ConversationPrivacy } from '@shared/state';
import type { Tab } from './types';

// Una pestaña abierta lleva el resumen de su transcripcion en disco, si ya la tiene (P-026, 1.7): sin
// el, su fila decia `claude · opus[1m]` y la de una cerrada `hace 3 min · 2,1 MB`.
export type ConversationRow =
  | { readonly kind: 'tab'; readonly tab: Tab; readonly history?: ConversationSummary }
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
  // Indice sessionId -> resumen del historial (acceso O(1)): deduplica, data una pestaña reabierta que
  // aun no ha recibido mensajes en esta ejecucion y le da su peso en disco.
  const historyBySession = new Map(history.map((item) => [item.sessionId, item]));
  const openSessionIds = new Set(
    openTabs.map((tab) => sessionIdOf(tab, sessionIdByChat)).filter((id): id is string => id !== undefined),
  );
  const rows: ConversationRow[] = [
    ...openTabs.map((tab) => tabRow(tab, historyBySession.get(sessionIdOf(tab, sessionIdByChat) ?? ''))),
    ...history
      .filter((item) => item.privacy === privacy && !openSessionIds.has(item.sessionId))
      .map((item): ConversationRow => ({ kind: 'history', item })),
  ];
  return rows.sort((a, b) => rowRecency(b) - rowRecency(a));
}

function tabRow(tab: Tab, history: ConversationSummary | undefined): ConversationRow {
  return history === undefined ? { kind: 'tab', tab } : { kind: 'tab', tab, history };
}

// Instante (ms epoch) por el que se ordena una fila. Para una pestana: su ultimo mensaje enviado en
// esta ejecucion, o el mtime de su transcripcion, o cuando se creo. 0 si no se sabe nada (pestanas
// restauradas de un formato anterior sin marcas de tiempo) -> al final, pero nunca rompe el orden.
export function rowRecency(row: ConversationRow): number {
  if (row.kind === 'history') return row.item.updatedAtMs;
  return row.tab.lastMessageAtMs ?? row.history?.updatedAtMs ?? row.tab.createdAtMs ?? 0;
}

// --- Formato de la segunda linea de una fila (antes dentro de ChatSidebar) -------------------------

const BYTES_PER_KB = 1024;
const ONE_DECIMAL_BELOW = 10;

// Peso del fichero de la conversacion, compacto. Un decimal solo por debajo de 10 para que la columna
// no baile: "9,4 kB" y "940 kB" ocupan casi lo mismo, pero "1024 kB" frente a "1 MB" no.
export function formatSize(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes < 0) throw new Error(`Tamaño invalido: ${JSON.stringify(bytes)}`);
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  const kb = bytes / BYTES_PER_KB;
  if (kb < BYTES_PER_KB) return withUnit(kb, 'kB');
  return withUnit(kb / BYTES_PER_KB, 'MB');
}

function withUnit(value: number, unit: string): string {
  return value < ONE_DECIMAL_BELOW ? `${value.toFixed(1).replace('.', ',')} ${unit}` : `${Math.round(value)} ${unit}`;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_BEFORE_DATE = 30;

// Tiempo relativo compacto (es). Sin libs: umbrales simples. `now` inyectable para los tests; un
// instante futuro (reloj movido) cuenta como "ahora" en vez de dar un negativo.
export function relativeTime(ms: number, now: number = Date.now()): string {
  const min = Math.floor((now - ms) / MS_PER_MINUTE);
  if (min < 1) return 'ahora';
  if (min < MINUTES_PER_HOUR) return `hace ${min} min`;
  const hours = Math.floor(min / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `hace ${hours} h`;
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days < DAYS_BEFORE_DATE) return `hace ${days} d`;
  return new Date(ms).toISOString().slice(0, 10);
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
