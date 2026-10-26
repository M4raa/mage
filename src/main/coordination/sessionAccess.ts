// Quién puede dar órdenes a una sesión por el IPC (F2.6, H3 de la devolución 14): la ventana que la creó y la
// ventana principal. Cualquier otro webContents —una ventana secundaria que no es su dueña, o un contenido
// web que llegara a hablar con el preload— recibe un error y la orden no llega al coordinador.

export interface SessionAccessDeps {
  // Dueño de la sesión: el id del webContents que la creó, null si no tiene, undefined si no se sigue.
  readonly ownerOf: (sessionId: string) => number | null | undefined;
  readonly isMainWindow: (webContentsId: number) => boolean;
}

export function canControlSession(deps: SessionAccessDeps, senderId: number, sessionId: string): boolean {
  const owner = deps.ownerOf(sessionId);
  // Una sesión que no se sigue no tiene a quién proteger: el coordinador contesta «Sesion inexistente».
  if (owner === undefined) return true;
  return owner === senderId || deps.isMainWindow(senderId);
}
