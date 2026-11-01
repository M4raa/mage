import { localized, type LocalizedText } from '@shared/i18n/localizedText';
import type { MessageDelivery } from '@shared/coordination';
import { supportsSteer } from '@shared/providers';

// «Enviar ahora» (F4.1, G-U1/G-U3), como funciones PURAS: si se puede con un turno en marcha y qué avisos deja el
// destino real de un directo. En reposo no aplica: enviar ya sale al instante.

export type SendNowAvailability = { readonly enabled: true } | { readonly enabled: false; readonly reason: LocalizedText };

export interface SendNowInput {
  readonly provider: string;
  // Nombre visible del proveedor para el aviso (p. ej. «agy»).
  readonly providerLabel: string;
  // Tipo del turno en marcha que no admite directos (review/compact), o null.
  readonly notSteerable: string | null;
}

export function sendNowAvailability(input: SendNowInput): SendNowAvailability {
  if (!supportsSteer(input.provider)) return { enabled: false, reason: localized('prompt.sendNow.providerUnsupported', { provider: input.providerLabel }) };
  if (input.notSteerable !== null) return { enabled: false, reason: notSteerableText(input.notSteerable) };
  return { enabled: true };
}

export function notSteerableText(turnKind: string): LocalizedText {
  return localized('chat.steer.notSteerable', { turnKind });
}

// Líneas del hilo que deja el destino de un directo: a la cola por un turno que no lo admite, o un turno nuevo
// porque el anterior ya había acabado. El fallo no es una línea: es un bloque de error (lo pinta el store).
export function deliveryNotices(delivery: MessageDelivery): readonly LocalizedText[] {
  if (delivery.into === 'queue' && delivery.turnKind !== null) return [notSteerableText(delivery.turnKind)];
  if (delivery.into === 'new_turn' && delivery.late) return [localized('chat.steer.late')];
  return [];
}
