import type { MageEvent } from '@shared/events';
import { rateLimitLineText } from './rateLimit';
import { renderLocalized } from '@shared/i18n/localizedText';
import { t } from '../i18n/uiLanguage';

// Avisos del propio CLI que van al HILO como linea de sistema tenue (2.5), con su texto en castellano.
//
// Que entra y que no es una decision de producto, no un detalle de render: al hilo solo va lo que
// INTERRUMPE o EXPLICA la conversacion (una notificacion que pide atencion, un limite de uso, un
// cambio de modo de permiso, una compactacion). Todo lo demas —los hooks de ciclo de vida, el uso de
// contexto, los comandos disponibles— se queda en el panel de Logs, que es justo para lo que existe.
//
// PURO y con un `switch` exhaustivo por `kind`: al añadir una variante a `MageEvent`, el compilador
// obliga a decidir si va al hilo.

// Hooks que SI merecen una linea en el hilo. El resto (Stop, UserPromptSubmit, PreCompact...) es ruido:
// `Stop` ya se ve por el fin de turno y `UserPromptSubmit` lo acaba de hacer el usuario.
//
// `Notification` ESTUVO aqui y se quito (2.3b, peticion del usuario: "en vez de que me salga un mensaje,
// quiero que directamente me salga la accion que se quiere realizar"). Ese hook es el que el CLI dispara
// cuando necesita atencion —casi siempre un permiso—, y lo unico que decia era "Claude necesita tu
// atención": ahora la peticion se pinta como TARJETA en el hilo, con la accion y los botones, asi que la
// linea era el aviso de algo que ya esta a la vista. Las notificaciones del SO (notify.ts) siguen
// usandolo: ahi si aporta, porque la ventana no tiene el foco.
// Guarda las CLAVES del catálogo (sin detalle y con detalle): se traducen al montar el texto.
interface HookNoticeKeys {
  readonly plain: 'chat.notice.subagentStop';
  readonly withDetail: 'chat.notice.subagentStopDetail';
}
const NOTICEABLE_HOOKS: ReadonlyMap<string, HookNoticeKeys> = new Map([
  ['SubagentStop', { plain: 'chat.notice.subagentStop', withDetail: 'chat.notice.subagentStopDetail' }],
]);

// Sin emoji a proposito (2026-09-17): la linea de aviso ya es visualmente distinta —tenue y centrada—
// y su texto se basta solo. El emoji ademas viajaba a las notificaciones del SO via notify.ts.
export function noticeTextFor(event: MageEvent): string | null {
  switch (event.kind) {
    case 'notice':
      return renderLocalized(t, event.localized);
    case 'compacted':
      return event.trigger === 'auto' ? t('chat.notice.compactedAuto') : t('chat.notice.compactedManual');
    case 'permission_mode':
      return t('chat.notice.permissionMode', { mode: permissionModeLabel(event.mode) });
    case 'rate_limit':
      // Texto de Mage en castellano, con la hora si la trae el stream (P-028, 20). El del CLI ("You've
      // hit your session limit · resets 3pm") ya no va al hilo: el reductor lo pone en el tooltip.
      return rateLimitLineText(event.resetsAtMs);
    case 'hook_fired': {
      const keys = NOTICEABLE_HOOKS.get(event.event);
      if (keys === undefined) return null;
      return event.detail === null || event.detail.trim().length === 0 ? t(keys.plain) : t(keys.withDetail, { detail: event.detail.trim() });
    }
    default:
      // Todo lo demas vive en Logs. Un `default` y no un caso por variante: son 20 y crecen; lo que
      // importa es que añadir una NO la mete en el hilo por accidente.
      return null;
  }
}

// Vocabulario de Mage para el modo de permiso. El CLI usa el suyo (`auto`, `plan`...) y puede traer
// valores que Mage no conoce: entonces se pinta el crudo en vez de esconder el cambio. Guarda la CLAVE.
const PERMISSION_MODE_LABELS = {
  default: 'chat.notice.mode.default',
  acceptEdits: 'chat.notice.mode.acceptEdits',
  plan: 'chat.notice.mode.plan',
  auto: 'chat.notice.mode.auto',
  bypassPermissions: 'chat.notice.mode.bypassPermissions',
} as const;

function permissionModeLabel(mode: string): string {
  return Object.hasOwn(PERMISSION_MODE_LABELS, mode) ? t(PERMISSION_MODE_LABELS[mode as keyof typeof PERMISSION_MODE_LABELS]) : mode;
}
