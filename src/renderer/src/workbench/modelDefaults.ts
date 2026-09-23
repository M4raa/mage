// Resolucion automatica del modelo al crear una conversacion (M2.6 + F3), para no forzar al usuario a
// elegirlo. Modulo PURO -> testable. Orden de prioridad:
//   1) el modelo configurado para ESE PROVEEDOR en Configuracion (F3): es una eleccion explicita del
//      usuario para ese proveedor, asi que gana sobre cualquier heuristica;
//   2) el ultimo modelo usado en esa cuenta con ese proveedor (si hay conversaciones previas),
//   3) el modelo configurado por cuenta (settings.json -> model; solo aplica a Claude, que es de quien
//      es ese fichero),
//   4) el fallback del proveedor ('sonnet' para Claude, el primero de su catalogo para los demas).
//
// Por que el configurado por proveedor va PRIMERO: antes ganaba el "ultimo usado", que para Claude era
// razonable (mantener la ultima eleccion), pero con varios proveedores producia sorpresas — configurar
// "gemini-2.5-pro" y que la conversacion nueva saliera con otro modelo porque fue el ultimo que se toco.

const FALLBACK_MODEL = 'sonnet';

export interface ModelResolutionContext {
  readonly lastUsedModel: string | null; // modelo de la ultima conversacion de la cuenta, o null
  readonly accountDefaultModel: string | null; // Account.defaultModel (settings.json o su fallback)
  // Modelo configurado para el proveedor de la conversacion (F3). null si no hay ninguno fijado.
  readonly providerDefaultModel?: string | null;
  // Fallback del proveedor cuando no hay nada configurado ni usado (p.ej. el primer modelo de su
  // catalogo). Sin el, se cae a 'sonnet', que solo tiene sentido para Claude.
  readonly providerFallbackModel?: string | null;
}

export function resolveDefaultModel(ctx: ModelResolutionContext): string {
  const configuredForProvider = ctx.providerDefaultModel?.trim();
  if (configuredForProvider !== undefined && configuredForProvider.length > 0) return configuredForProvider;
  const lastUsed = ctx.lastUsedModel?.trim();
  if (lastUsed !== undefined && lastUsed.length > 0) return lastUsed;
  const configured = ctx.accountDefaultModel?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  const providerFallback = ctx.providerFallbackModel?.trim();
  if (providerFallback !== undefined && providerFallback.length > 0) return providerFallback;
  return FALLBACK_MODEL;
}
