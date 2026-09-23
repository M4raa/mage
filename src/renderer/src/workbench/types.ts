// Tipos de dominio de la UI del workbench (cuentas, pestanas, bloques). Son de PRESENTACION; el
// modelo de eventos del motor (MageEvent) vive en @shared/events y el de cuentas (AccountInfo) en
// @shared/accounts; ambos se mapean a estos tipos en la frontera (accountView.ts / engineBlocks.ts).

import type { AskQuestion } from '@shared/askUserQuestion';
import type { ArtifactDraft, ArtifactPublication } from '@shared/artifacts';
import type { DiffLine } from './diffLines';
import type { ToolClass } from './toolClassify';
import type { LoginStatus } from '@shared/accounts';
import type { ConversationPrivacy } from '@shared/state';
import type { PermissionMode } from '@shared/ipc';

// Paleta acentual de una cuenta. El acento tine avatar, border de pestana, chips, punto del agente
// y fill de sus barras de uso — nada mas (regla del handoff).
export interface Accent {
  readonly base: string; // color principal del acento
  readonly tint: string; // texto tenido
  readonly bgActive: string; // fondo del avatar activo
  readonly borderInactive: string; // borde del avatar inactivo
}

export type WorkerActivity = 'working' | 'idle';

export interface UsageWindow {
  readonly pct: number; // 0..100
  readonly label: string; // ej. "1 h 24 m" (reset) o "lun 09:00"
}

export interface Account {
  readonly id: string; // configDir de la cuenta (identificador estable y unico)
  readonly monogram: string; // letra del avatar
  readonly alias: string; // "claude-p" (nombre del dir sin el punto inicial)
  readonly provider: string; // "Claude" | "Gemini" ...
  readonly defaultModel: string; // id de modelo por defecto (settings.json -> model, o "sonnet")
  readonly accent: Accent;
  readonly activity: WorkerActivity; // punto del rail
  readonly usage: { readonly fiveHour: UsageWindow; readonly weekly: UsageWindow };
  readonly email: string | null; // para la cabecera del sidebar
  readonly loginStatus: LoginStatus; // para insignia de login en el rail (onboarding)
  readonly isMain: boolean; // ~/.claude (no se puede eliminar)
}

export type ChatStatus = 'idle' | 'streaming' | 'needs_permission' | 'error';

// Una pestana ES una conversacion real ligada a {cuenta, proyecto, modelo}, con su AgentSession
// aislada. El id es interno (contador); accountId es el configDir de la cuenta (fija su acento).
export interface Tab {
  readonly id: string;
  readonly accountId: string;
  readonly accountAlias: string;
  readonly cwd: string; // carpeta del proyecto (cwd real de la sesion)
  readonly model: string; // id de modelo (--model)
  readonly provider: string; // 'claude' | 'openai' | 'gemini' | 'ollama' | 'lmstudio'
  readonly title: string;
  // Privacidad de la conversacion (M2.6). 'shared' (por defecto) usa el pozo comun; 'private' usa el
  // perfil privado (mage-private) de la cuenta con su mismo login. Factura SIEMPRE la cuenta activa.
  readonly privacy: ConversationPrivacy;
  // Config dir EFECTIVO con el que se lanzo/reanuda la sesion (cuenta o perfil privado). Lo fija
  // ensureSession al crear la sesion; se usa como accountDir al abrir transcripciones/memoria.
  readonly resolvedConfigDir?: string;
  // sessionId de una conversacion previa a reanudar (M2.5), fijado al restaurar el workspace. Se usa
  // en ensureSession (con `claude --resume`) y se limpia al crear/reanudar la sesion viva.
  readonly resumeSessionId?: string;
  // Nivel de esfuerzo (--effort, M2.4). undefined -> default del CLI. Fijado al crear la pestana.
  readonly effort?: string;
  // Tope de gasto (--max-budget-usd, M2.4) en CENTAVOS ENTEROS. undefined -> sin tope.
  readonly maxBudgetUsdCents?: number;
  // Modo de permiso (M2.6). undefined -> 'default'. Cambia con el ciclo shift+tab / chip del PromptBar.
  readonly permissionMode?: PermissionMode;
  // Marcas de tiempo (ms epoch) que ORDENAN el sidebar por recencia: creacion de la conversacion y
  // ultimo mensaje enviado. Abrir una conversacion NO las toca (por eso no salta de sitio); escribir
  // en ella si (pasa al principio de su seccion).
  readonly createdAtMs?: number;
  readonly lastMessageAtMs?: number;
  // Anclada (Ronda 3, item 12): va primero en la barra y la respetan los cierres en masa.
  readonly pinned?: boolean;
  // Color MANUAL de la pestaña (indice de acento del tema, 0..5). undefined -> hereda el acento de su
  // cuenta. Se guarda el indice, no un hex: asi conmuta con el tema claro/oscuro como todo lo demas.
  readonly colorIndex?: number;
  // Tools con "Permitir siempre aqui" concedido EN ESTA conversacion (2.3b): sus can_use_tool se
  // auto-aprueban sin tarjeta ni pregunta. Persiste en el indice propio de Mage (conversationIndex),
  // asi que sobrevive al cierre de la pestaña y a reabrir la conversacion desde el historial.
  // Se ve y se revoca en el panel de Permisos.
  readonly alwaysAllowTools?: readonly string[];
}

// --- Bloques del chat -------------------------------------------------------------------------

// Un fragmento de texto del agente: normal o codigo inline.
export interface TextRun {
  readonly code: boolean;
  readonly text: string;
}

// Adjunto de imagen de un mensaje del usuario. `data` es base64 SIN el prefijo `data:`; se compone al
// pintar. La CSP de Mage permite `img-src 'self' data:` en dev y en produccion (medido en
// src/main/index.ts), que es donde suelen morir estas cosas al empaquetar.
//
// Se RE-EXPORTA del contrato IPC en vez de declararse otra vez: desde la Fase E tambien viaja a `main`
// en el envio, y dos declaraciones de la misma forma es justo lo que la Fase A vino a arreglar.
export type { ImageAttachment } from '@shared/ipc';
import type { ImageAttachment } from '@shared/ipc';

// Tipos de imagen que Mage pinta. Cualquier otro media_type del CLI se descarta como adjunto (el
// texto del mensaje se conserva): mejor sin miniatura que con un `data:` que el navegador no decodifica.
export const SUPPORTED_IMAGE_MEDIA_TYPES: readonly ImageAttachment['mediaType'][] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

export type Block =
  | {
      readonly kind: 'user';
      readonly id: string;
      readonly text: string;
      readonly time: string;
      // OBLIGATORIO y posiblemente vacio (no opcional): los bloques no se persisten, asi que no hay
      // estado viejo que tolerar, y un array obligatorio convierte en error de compilacion cualquier
      // constructor que se lo olvide.
      readonly attachments: readonly ImageAttachment[];
    }
  | {
      readonly kind: 'tool';
      readonly id: string;
      readonly toolUseId: string; // para emparejar el tool_result que rellena meta/output
      readonly tool: string; // "Bash"
      // Clase de la tool (2.12.2), decidida UNA vez al crear el bloque: es lo que elige el glifo y lo
      // que decide si puede esconderse dentro de una racha-resumen.
      readonly toolClass: ToolClass;
      readonly command: string; // "npm test"
      readonly meta: string; // "exit 1 · 2.4 s" (vacio mientras se ejecuta)
      // Explicito: antes habia que ADIVINARLO leyendo el texto de `meta`, y de eso depende que una
      // tool con error no se esconda nunca en una racha.
      readonly isError: boolean;
      readonly output: readonly TextRun[]; // lineas de salida (code=true en resaltados)
      readonly filePath: string | null; // archivo afectado (tools de fichero) para abrir/guardar
      readonly diff: readonly DiffLine[] | null; // diff con numeros de linea (Edit)
      readonly writtenContent: readonly string[] | null; // Write que CREA fichero: no hay diff
      // Publicacion de artifact (2.4), cuando esta tool lo es. Se guarda YA VALIDADA (nunca el input
      // crudo de la tool, que puede traer cualquier cosa y ser enorme): sin `url` mientras no se ha
      // publicado, y entonces se pinta la caja de tool normal en vez de una tarjeta a medias.
      readonly artifact: ArtifactPublication | null;
      readonly artifactDraft: ArtifactDraft | null;
    }
  // Subagente (Task/Agent). `agentId` llega con el tool_result; hasta entonces no se puede abrir su
  // transcripcion. La anidacion no se modela (nivel 1), igual que en subagentView.ts.
  | {
      readonly kind: 'subagent';
      readonly id: string;
      readonly toolUseId: string;
      readonly agentType: string | null;
      readonly description: string | null;
      readonly agentId: string | null;
      readonly status: string | null;
    }
  // Pensamiento del agente. `runs` esta VACIO en una conversacion reanudada: el CLI persiste los
  // bloques `thinking` con texto "" (medido), asi que como mucho se puede decir "pensó".
  | {
      readonly kind: 'thinking';
      readonly id: string;
      readonly runs: readonly TextRun[];
      readonly streaming: boolean;
      readonly elapsedMs: number | null;
    }
  | { readonly kind: 'agent'; readonly id: string; readonly runs: readonly TextRun[]; readonly streaming: boolean }
  // Pregunta del agente (AskUserQuestion, 2.3). Es el MISMO can_use_tool que el panel de permiso: se
  // contesta EXACTAMENTE UNA VEZ, y por eso mientras `state === 'pending'` el panel de permiso no
  // ofrece Permitir/Denegar para este requestId — contestar dos veces hace que
  // `AgentSession.answerPermission` lance y la pestaña se vaya a error.
  | {
      readonly kind: 'question';
      readonly id: string;
      readonly requestId: string;
      readonly questions: readonly AskQuestion[];
      readonly state: 'pending' | 'answered' | 'cancelled';
      readonly answers: Readonly<Record<string, string>> | null; // relleno solo si state === 'answered'
    }
  // Peticion de PERMISO en el chat (2.3b, peticion del usuario: "en vez de que me salga un mensaje,
  // quiero que directamente me salga la accion que se quiere realizar y las acciones de permitir,
  // denegar"). Mismo contrato que la tarjeta de pregunta: es el MISMO can_use_tool que ve el panel de
  // Permisos y se contesta EXACTAMENTE UNA VEZ — el panel y la tarjeta comparten `pendingByChat`, asi
  // que en cuanto una contesta, la otra se queda sin peticion pendiente y no puede volver a hacerlo.
  //
  // El diff completo NO se guarda aqui: la tarjeta ensena la accion y el resumen, y "Mas informacion"
  // abre el panel, que es quien pinta el diff (decision del usuario). Lo que se conserva tras
  // contestar es el relato: que se pidio y que se decidio.
  | {
      readonly kind: 'permission';
      readonly id: string;
      readonly requestId: string;
      readonly toolName: string;
      readonly prompt: string;
      readonly target: string;
      readonly summary: string;
      readonly state: 'pending' | 'allowed' | 'denied' | 'cancelled';
    }
  | { readonly kind: 'error'; readonly id: string; readonly message: string }
  // Marcador de sistema (M2.4): eventos de la sesion que no son conversacion (p.ej. "contexto
  // compactado"). Se renderiza como una linea tenue centrada.
  | { readonly kind: 'system'; readonly id: string; readonly text: string };

// --- Inspector: permiso -----------------------------------------------------------------------

export interface PermissionView {
  readonly prompt: string; // "El agente quiere escribir en el proyecto:"
  readonly target: string; // "Write src/services/TokenService.ts"
  readonly toolLabel: string; // "Write" (para "Permitir siempre X aqui")
  readonly diff: readonly DiffLine[];
  readonly summary: string; // "+14 −3 · 2 tests actualizados"
}

export interface ContextInfo {
  readonly usedTokens: string; // "128,4k"
  readonly maxTokens: string; // "200k"
  readonly usedPct: number; // 64
  readonly tokensOut: string; // "22,1k"
}

// Limite de uso alcanzado en una conversacion (H4). `summary` es el texto TAL CUAL del CLI ("You've hit
// your session limit · resets 3pm"): es el unico que sabe cuando se restablece y en que zona horaria,
// asi que no se reescribe. `resetsAtMs` YA no es siempre null: desde 9.3 lo trae el `rate_limit_event`
// del stream cuando el CLI rechaza el turno (medido en S3, en segundos; se convierte en normalize).
// Sigue siendo null en el otro camino, el `assistant` con `error: "rate_limit"`, que solo trae texto.
export interface RateLimitNotice {
  readonly summary: string;
  readonly resetsAtMs: number | null;
}

// Un adjunto ya validado y leido a base64, listo para enviar. Se guarda tambien su tamaño en bytes
// para poder validar el CONJUNTO (numero y peso total) al añadir mas. Vive aqui, y no en PromptBar,
// porque el BORRADOR lo guarda el store por pestaña (auditoria B.1.2).
export interface PendingAttachment {
  readonly attachment: ImageAttachment;
  readonly byteLength: number;
}

// Lo que el usuario lleva escrito en UNA conversacion y aun no ha enviado. Antes era estado local del
// `PromptBar`, que NO se remonta al cambiar de pestaña: escribias medio prompt en A, pinchabas B en el
// sidebar y el Enter mandaba tu texto y tus imagenes a B (auditoria B.1.2).
export interface PromptDraft {
  readonly text: string;
  readonly attachments: readonly PendingAttachment[];
}
