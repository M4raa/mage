import type { MageEvent } from '@shared/events';
import type { NotificationRule } from '@shared/settings';
import type { NotificationTarget, NotifyParams } from '@shared/ipc';
import type { NotifyLevel } from './notifications';

// Contenido de una notificacion del SO derivado de un evento del motor (M2.3). PURO y testeable: la
// decision de MOSTRARLA (solo si la ventana no tiene el foco) vive en main; aqui solo el "que decir".
export interface NotificationContent {
  readonly title: string;
  readonly body: string;
  // «Subagente terminado»: el clic abre ademas el panel de Actividad (P-028 40).
  readonly opensActivity?: boolean;
}

// Lo que viaja a main: el contenido y a donde lleva el clic (la conversacion que la disparo).
export function toNotifyParams(content: NotificationContent, target: Omit<NotificationTarget, 'opensActivity'>): NotifyParams {
  return { title: content.title, body: content.body, target: { ...target, ...(content.opensActivity === true ? { opensActivity: true } : {}) } };
}

// Aviso DENTRO de Mage de lo que pasa en una conversacion que no esta a la vista (otra pestaña, segundo
// plano) con la ventana enfocada: con foco, main no enseña la del SO. Lo mismo que la del SO, mas el
// limite de uso (que al SO no va: su banner ya lo dice en la pestaña) y un nivel para el toast.
export interface InAppConversationNotice {
  readonly level: NotifyLevel;
  readonly content: NotificationContent;
}

export function inAppNoticeForEvent(event: MageEvent, context: NotificationContext): InAppConversationNotice | null {
  if (event.kind === 'rate_limit') {
    const body = event.summary.trim().length === 0 ? context.tabTitle : `${context.tabTitle}: ${excerpt(event.summary)}`;
    return { level: 'warning', content: { title: 'Límite de uso alcanzado', body } };
  }
  const content = notificationForEvent(event, context);
  return content === null ? null : { level: inAppLevelFor(event), content };
}

function inAppLevelFor(event: MageEvent): NotifyLevel {
  if (event.kind === 'result') return 'success';
  if (event.kind === 'error') return 'error';
  if (event.kind === 'permission_request' || event.kind === 'elicitation_request') return 'warning';
  return 'info';
}

// `origin.kind` del `result` de un turno abierto por la notificacion de una tarea (medido en 2.1.284).
const TASK_NOTIFICATION_ORIGIN = 'task-notification';

// Longitud maxima del extracto del texto que caso con una regla (cuerpo de la notificacion).
const MATCH_EXCERPT_MAX_CHARS = 120;

const SUBAGENT_STOP_HOOK = 'SubagentStop';

// Hooks del CLI que merecen avisar al usuario, con el titulo de su notificacion (D2). Fuente FIABLE:
// el CLI dice cuando necesita atencion, en vez de deducirlo de su texto con una regex.
// Deliberadamente FUERA: `Stop` (ya se avisa con el evento `result`; notificar los dos seria spam),
// `UserPromptSubmit` (lo acaba de hacer el usuario) y `PreCompact`/`SessionEnd` (ruido).
const NOTIFIABLE_HOOKS: ReadonlyMap<string, string> = new Map([
  ['Notification', 'Claude necesita tu atención'],
  [SUBAGENT_STOP_HOOK, 'Subagente terminado'],
]);

// Eventos que merecen avisar al usuario cuando no esta mirando: fin de turno, permiso pendiente
// (bloquea el avance), error, y texto del asistente que casa con una regla regex del usuario
// (assistant_text llega UNA vez por turno, no por delta -> sin spam). El resto es ruido -> null.
export interface NotificationContext {
  readonly tabTitle: string;
  readonly rules?: readonly NotificationRule[];
  // La peticion de permiso ya la contesto Mage sola («Permitir siempre aqui»): no hay nada que pedir al
  // usuario, y avisar «Permiso requerido» era mentirle (P-026, 1.8).
  readonly autoAllowed?: boolean;
}

export function notificationForEvent(event: MageEvent, context: NotificationContext): NotificationContent | null {
  const { tabTitle, rules = [], autoAllowed = false } = context;
  switch (event.kind) {
    case 'result':
      // Un turno que abrio el CLI solo al terminar un subagente en segundo plano (P-028 37a): con nueve
      // agentes serian nueve «Turno completado» que el usuario no pidio. Ya avisa `SubagentStop`.
      return event.result.origin === TASK_NOTIFICATION_ORIGIN ? null : { title: 'Turno completado', body: tabTitle };
    case 'permission_request':
      return autoAllowed ? null : { title: 'Permiso requerido', body: `${tabTitle}: ${event.request.toolName}` };
    case 'elicitation_request':
      return { title: 'Formulario MCP pendiente', body: `${tabTitle}: ${event.request.server}` };
    case 'error':
      return { title: 'Error en la conversación', body: `${tabTitle}: ${event.message}` };
    case 'assistant_text':
      return matchAgainstRules(event.text, tabTitle, rules);
    case 'hook_fired':
      return notificationForHook(event.event, event.detail, tabTitle);
    default:
      return null;
  }
}

// Notificacion de un hook del CLI. El cuerpo usa el `detail` cuando lo hay (el mensaje que manda el
// propio CLI en Notification); si no, el titulo de la pestana basta para saber de donde viene.
function notificationForHook(hookEvent: string, detail: string | null, tabTitle: string): NotificationContent | null {
  const title = NOTIFIABLE_HOOKS.get(hookEvent);
  if (title === undefined) return null;
  const body = detail === null || detail.trim().length === 0 ? tabTitle : `${tabTitle}: ${excerpt(detail)}`;
  return hookEvent === SUBAGENT_STOP_HOOK ? { title, body, opensActivity: true } : { title, body };
}

// Prueba el texto contra las reglas activas. La compilacion del patron va con try/catch: una regex
// invalida se ignora (nunca lanza ni rompe el flujo de eventos). Gana la primera regla que casa.
function matchAgainstRules(
  text: string,
  tabTitle: string,
  rules: readonly NotificationRule[],
): NotificationContent | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (compileSafely(rule.pattern)?.test(text) === true) {
      return { title: `Coincidencia: ${rule.label}`, body: `${tabTitle}: ${excerpt(text)}` };
    }
  }
  return null;
}

// Compila un patron de usuario; null si es una regex invalida (frontera segura, nunca lanza).
// Exportada para que la pantalla de Configuracion pruebe un patron con el MISMO compilador que el
// matcher real (Ronda 3, item 4: el usuario no sabia si su regex casaba hasta que llegaba el turno).
export function compileSafely(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= MATCH_EXCERPT_MAX_CHARS ? flat : `${flat.slice(0, MATCH_EXCERPT_MAX_CHARS)}…`;
}
