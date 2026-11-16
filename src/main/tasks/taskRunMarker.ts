// Marca en el índice la conversación que creó una tarea de Mage, UNA vez y en cuanto se conoce su id (llega en cada evento
// de la sesión). Un fallo del índice no corta la sesión: se traza y la conversación queda sin insignia.
export interface TaskRunMarkerDeps {
  readonly record: (conversationId: string) => void;
  readonly warn: (message: string, data: unknown) => void;
}

export function taskRunMarker(deps: TaskRunMarkerDeps): (conversationId: string | null) => void {
  let marked = false;
  return (conversationId) => {
    if (marked || conversationId === null) return;
    marked = true;
    try {
      deps.record(conversationId);
    } catch (err) {
      deps.warn('No se pudo marcar en el índice la conversación de una tarea', { conversationId, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
