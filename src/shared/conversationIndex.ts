// Contrato del indice propio de Mage por conversacion (2.1) y del registro de artifacts (2.4).
// Vive en `shared` porque cruza el IPC: `main` lo persiste (conversationIndexStore) y el renderer lo
// lee al reabrir una conversacion. Solo TIPOS y constantes: sin Zod, para no arrastrarlo al renderer.

// Preferencias de una conversacion, con el vocabulario de MAGE (el CLI usa otro para el modo de
// permiso: `auto`, etc.). Todos opcionales: una conversacion puede tener solo el modelo fijado.
export interface ConversationPrefs {
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: 'default' | 'acceptEdits' | 'plan';
  // Tools con "Permitir siempre aqui" (2.3b). Es una LISTA y no una cadena, asi que la fusion parcial
  // del indice la reemplaza entera: la lista que manda el renderer es siempre el estado completo de
  // esa conversacion (se concede en la tarjeta y se revoca en el panel, nunca por parches sueltos).
  readonly alwaysAllowTools?: readonly string[];
}

// Artifact publicado: pertenece a la cuenta que lo publico y NO cambia de dueño al abrir la
// conversacion con otra cuenta. Lo rellena la Fase G.
export interface ArtifactRecord {
  readonly accountDir: string;
  readonly title: string;
  readonly favicon: string;
  readonly publishedAtMs: number;
}

// Version del fichero persistido (userData/conversation-index.json).
export const CONVERSATION_INDEX_VERSION = 1;

// Tope de artifacts recordados: al pasarse se desaloja el de `publishedAtMs` mas antiguo. Las
// conversaciones NO se acotan (una entrada son ~80 bytes; 10 000 conversaciones son 800 KB), pero se
// borran cuando se borra la conversacion — si no, el fichero crece para siempre con basura.
export const MAX_ARTIFACTS = 500;
