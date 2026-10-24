import type { UpdateState } from '@shared/update';

// Texto del estado de la actualizacion en Configuración (F1.3, #15). La barra de estado solo enseña
// `ready`; aqui se ve cada paso de «Buscar actualizaciones». PURO: testable sin store ni IPC.
export function updateStatusText(state: UpdateState): string {
  switch (state.kind) {
    case 'idle':
      return 'Todavía no se han buscado actualizaciones en esta sesión.';
    case 'checking':
      return 'Buscando actualizaciones…';
    case 'upToDate':
      return `Mage está al día (versión ${state.version}).`;
    case 'error':
      return `No se pudo buscar: ${state.message}`;
    case 'downloading':
      return `Hay una versión nueva (${state.version}); se está descargando.`;
    case 'ready':
      return `La versión ${state.version} está lista para instalarse.`;
  }
}

// Mientras busca o descarga, el botón no lanza otra consulta (main tampoco la duplicaría).
export function canCheckForUpdates(state: UpdateState): boolean {
  return state.kind !== 'checking' && state.kind !== 'downloading';
}
