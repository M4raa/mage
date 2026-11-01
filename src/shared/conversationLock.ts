import { z } from 'zod';
import { localizedWithParts, type LocalizedText } from './i18n/localizedText';
import { MAX_ID_CHARS } from './sessionInput';

// Bloqueo de conversación entre instancias de Mage (#55, F2.8; §4 de INFORME-019 con H4 de la devolución 13). Una
// conversación abierta en una instancia (la instalada, la de desarrollo u otro perfil) la tiene esa instancia; las
// demás la ven en solo lectura. Un `claude` lanzado a mano en una terminal no se puede bloquear desde Mage.

// Qué conversación: la misma tripleta que la del índice (`NativeSessionRef`). `accountDir` vacío = runtime propio.
export interface ConversationLockRef {
  readonly provider: string;
  readonly accountDir: string;
  readonly nativeId: string;
}

// Lo que ve un cliente: la tiene esta instancia, o la tiene otra (y si esa otra parece muerta: «Tomar el control»).
export type ConversationLockStatus =
  | { readonly owner: true }
  | { readonly owner: false; readonly profile: LocalizedText; readonly orphan: boolean };

// Una ruta de cuenta razonable cabe de sobra; acotada como cualquier entrada.
const MAX_ACCOUNT_DIR_CHARS = 4096;

export const CONVERSATION_LOCK_PARAMS_SCHEMA = z.object({
  provider: z.string().min(1).max(MAX_ID_CHARS),
  accountDir: z.string().max(MAX_ACCOUNT_DIR_CHARS),
  nativeId: z.string().min(1).max(MAX_ID_CHARS),
  // La pestaña que la abre: con la ventana, identifica a quien la sujeta.
  tabId: z.string().min(1).max(MAX_ID_CHARS),
}).strict();

export type ConversationLockParams = z.infer<typeof CONVERSATION_LOCK_PARAMS_SCHEMA>;

export function readOnlyLockMessage(profile: LocalizedText): LocalizedText {
  return localizedWithParts('prompt.lock.openElsewhere', {}, { profile });
}
