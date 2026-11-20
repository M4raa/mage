// ¿Hace falta que el usuario confirme modelo y esfuerzo antes de que arranque una sesión delegada? Solo cuando la llamada
// a `mage_create_session` no trae los dos y la creadora trabaja CON el usuario delante. Lo que se sabe de la creadora lo
// da main (índice, cadena de delegación, ajustes de arranque), nunca lo que diga el agente.

export interface CreatorFacts {
  // La creó una tarea programada de Mage (el índice la marca con `createdByTaskId`).
  readonly isTaskRun: boolean;
  // Su propia cadena de creadoras: no vacía = es una sesión delegada.
  readonly creatorChain: readonly string[];
  readonly ultracode: boolean;
}

export interface LaunchCardRequest {
  readonly requested: { readonly model?: string; readonly effort?: string };
  // null = creadora desconocida (el host desde la terminal): no hay a quién enseñar la tarjeta.
  readonly creator: CreatorFacts | null;
}

export function needsLaunchCard(request: LaunchCardRequest): boolean {
  const { requested, creator } = request;
  if (creator === null) return false;
  if (creator.isTaskRun || creator.creatorChain.length > 0 || creator.ultracode) return false;
  return requested.model === undefined || requested.effort === undefined;
}
