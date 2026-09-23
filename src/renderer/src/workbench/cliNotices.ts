import type { MageEvent } from '@shared/events';

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
const NOTICEABLE_HOOKS: ReadonlyMap<string, string> = new Map([['SubagentStop', 'Subagente terminado']]);

// Sin emoji a proposito (2026-09-17): la linea de aviso ya es visualmente distinta —tenue y centrada—
// y su texto se basta solo. El emoji ademas viajaba a las notificaciones del SO via notify.ts.
export function noticeTextFor(event: MageEvent): string | null {
  switch (event.kind) {
    case 'compacted':
      return `Contexto compactado (${event.trigger === 'auto' ? 'automática' : 'manual'})`;
    case 'permission_mode':
      return `Modo de permiso: ${permissionModeLabel(event.mode)}`;
    case 'rate_limit':
      // El texto lo redacta el CLI ("You've hit your session limit · resets 3pm"): se pasa tal cual
      // porque es el unico que sabe cuando se restablece y en que zona horaria.
      return event.summary.trim().length === 0 ? 'Límite de uso alcanzado' : `${event.summary.trim()}`;
    case 'hook_fired': {
      const label = NOTICEABLE_HOOKS.get(event.event);
      if (label === undefined) return null;
      return event.detail === null || event.detail.trim().length === 0 ? `${label}` : `${label}: ${event.detail.trim()}`;
    }
    default:
      // Todo lo demas vive en Logs. Un `default` y no un caso por variante: son 20 y crecen; lo que
      // importa es que añadir una NO la mete en el hilo por accidente.
      return null;
  }
}

// Vocabulario de Mage para el modo de permiso. El CLI usa el suyo (`auto`, `plan`...) y puede traer
// valores que Mage no conoce: entonces se pinta el crudo en vez de esconder el cambio.
const PERMISSION_MODE_LABELS: Readonly<Record<string, string>> = {
  default: 'manual',
  acceptEdits: 'auto-editar',
  plan: 'plan',
  bypassPermissions: 'sin permisos',
};

function permissionModeLabel(mode: string): string {
  return PERMISSION_MODE_LABELS[mode] ?? mode;
}
