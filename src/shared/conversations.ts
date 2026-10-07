// Resumen de una conversacion existente en disco (M2.6, sidebar = historial). Se deriva de la
// transcripcion persistida (`<configDir>/projects[/…]/<enc>/<sessionId>.jsonl`). NO incluye el
// contenido ni credenciales; solo metadatos para listar/reabrir.
import type { AccountProviderId } from './accounts';
import type { ConversationPrivacy } from './state';

export interface ConversationSummary {
  readonly sessionId: string;
  // Config dir EFECTIVO donde vive la transcripcion: la cuenta (compartida) o su perfil privado
  // (mage-private). Se usa como accountDir al reanudar y al abrir transcripcion/memoria.
  readonly configDir: string;
  readonly cwd: string; // cwd real leido de la transcripcion (o '' si no se pudo determinar)
  readonly title: string; // custom-title / ai-title / primer prompt / fallback
  readonly privacy: ConversationPrivacy;
  readonly updatedAtMs: number; // mtime del fichero (para ordenar por reciente)
  // PESO de la conversacion: bytes del .jsonl en disco. Sale del MISMO `stat` que ya se hace para el
  // mtime, asi que listar el historial no cuesta ni una llamada mas. Es el tamaño del fichero, no un
  // recuento de tokens: dice cuanto ocupa y cuanto va a tardar en reabrirse, que es lo que se nota.
  readonly sizeBytes: number;
  // La conversacion la empezo una TAREA PROGRAMADA (`<scheduled-task>`), no el usuario: el historial
  // lo marca con una insignia (P-026, D20).
  readonly isScheduled: boolean;
  // CLI al que pertenece (Codex lee sus rollouts, medidos). Ausente = Claude, el historial de siempre.
  readonly providerId?: AccountProviderId;
}

// Borrado de una conversacion en disco (#2 de AJUSTES). accountDir es la cuenta RAIZ; privacy indica
// si vive en el pozo comun o en el perfil privado (main resuelve el dir efectivo).
export interface DeleteConversationParams {
  readonly accountDir: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly privacy: ConversationPrivacy;
}

// Movimiento de una conversacion entre secciones (compartido/privado) y/o cuentas (#2 de AJUSTES).
// Origen = {accountDir, privacy}; destino = {destAccountDir, destPrivacy}. Reubica el .jsonl (y la
// carpeta de subagentes) al projects/ del destino.
export interface MoveConversationParams {
  readonly accountDir: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly privacy: ConversationPrivacy;
  readonly destAccountDir: string;
  readonly destPrivacy: ConversationPrivacy;
}

// Resultado del movimiento: el config dir EFECTIVO donde ha quedado (cuenta o su perfil privado).
export interface MoveConversationResult {
  readonly configDir: string;
}

// Migración de una conversación a una cuenta de OTRO proveedor (o de otra cuenta de Codex/agy): se traduce a
// formato nativo del destino y SIGUE SIENDO LA MISMA conversación; la de origen se retira. Entre cuentas de
// Claude se usa `MoveConversationParams` (mover la transcripción).
export interface MigrateConversationParams {
  readonly sourceAccountDir: string;
  readonly sourceProvider: AccountProviderId;
  readonly sessionId: string;
  readonly cwd: string;
  readonly privacy: ConversationPrivacy;
  readonly destAccountDir: string;
  readonly destProvider: AccountProviderId;
}

export interface MigrateConversationResult {
  // Id de la conversación en el destino (el de Claude, el hilo de Codex o la conversación de agy).
  readonly sessionId: string;
  // Config dir EFECTIVO donde queda (la cuenta, o su perfil privado en Claude).
  readonly configDir: string;
  readonly provider: AccountProviderId;
}
