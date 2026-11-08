import { isSlashCommandText } from './conversationTitle';
import type { ChatStatus } from './types';

// Que hacer al pulsar otra cuenta en la cabecera con una conversacion abierta (P-026 2.7, D5/D6).
// Antes solo cambiaba la cuenta activa y la conversacion se quedaba donde estaba, sin decir nada.
//   - 'switch': solo cambiar de cuenta (no hay conversacion que llevarse, o no se puede).
//   - 'switch-and-new-chat': la conversacion tiene un turno EN MARCHA (D5: «activo» = eso). Sigue
//     trabajando en su cuenta, y en la destino se abre un chat nuevo.
//   - 'ask': conversacion parada con algo que migrar: se pregunta si llevarsela (sin «recordar», D6).
//   - 'reassign': chat SIN conversación (sin `resumeSessionId` ni bloques de conversación): la pestaña se pasa a la
//     cuenta destino sin preguntar (P-028, punto 31). Si tenía sesión viva sin turnos, se para antes (0.1.4): antes
//     caía en 'switch-and-new-chat', la barra cambiaba de cuenta y la pestaña seguía en la vieja (riesgo de facturación).
export type AccountSwitchPlan = 'switch' | 'switch-and-new-chat' | 'ask' | 'reassign';

export interface AccountSwitchContext {
  // La pestaña que se esta mirando; undefined si no hay ninguna.
  readonly activeTab: { readonly accountId: string; readonly resumeSessionId?: string; readonly accountPinned?: boolean } | undefined;
  readonly status: ChatStatus | undefined;
  readonly liveSessionId: string | undefined;
  readonly destAccountId: string;
  // Una cuenta sin sesion no puede ni abrir un chat ni reanudar uno: solo se cambia (y avisa su panel).
  readonly destLoggedIn: boolean;
  // La pestaña ya tiene conversación en pantalla (ver hasConversationBlocks): ya no es un chat nuevo.
  readonly hasBlocks: boolean;
}

export function planAccountSwitch(ctx: AccountSwitchContext): AccountSwitchPlan {
  const tab = ctx.activeTab;
  if (tab === undefined || tab.accountId === ctx.destAccountId || !ctx.destLoggedIn) return 'switch';
  // Una conversación creada fuera de la ventana se queda con su cuenta: cambiar de cuenta no se la lleva.
  if (tab.accountPinned === true) return 'switch';
  if (ctx.status === 'streaming' || ctx.status === 'needs_permission') return 'switch-and-new-chat';
  // Sin conversación no hay nada que llevarse: la pestaña sigue a la cuenta pulsada (con sesión viva o sin ella).
  if (tab.resumeSessionId === undefined && !ctx.hasBlocks) return 'reassign';
  const migratable = ctx.liveSessionId !== undefined || tab.resumeSessionId !== undefined;
  if (migratable) return 'ask';
  return 'switch';
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

// Bloques que hacen de una pestaña una conversación. Los avisos (`system`, `error`, `command-output`) no: una
// pestaña nueva puede traer el aviso de la carpeta o del espacio de trabajo y sigue siendo un chat nuevo, ni el eco de
// un comando `/`.
const CONVERSATION_BLOCK_KINDS: ReadonlySet<string> = new Set(['user', 'agent', 'tool', 'subagent', 'thinking', 'question', 'permission']);

interface BlockLike {
  readonly kind: string;
  readonly text?: string;
  readonly attachments?: readonly unknown[];
}

// El eco de un comando `/` (sin adjuntos) no es conversación: su salida tampoco lo es (`command-output`).
function isConversationBlock(block: BlockLike): boolean {
  if (!CONVERSATION_BLOCK_KINDS.has(block.kind)) return false;
  if (block.kind !== 'user') return true;
  return (block.attachments?.length ?? 0) > 0 || !isSlashCommandText(block.text ?? '');
}

export function hasConversationBlocks(blocks: readonly BlockLike[]): boolean {
  return blocks.some(isConversationBlock);
}
