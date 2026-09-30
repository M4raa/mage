// Estado de la actualizacion de Mage tal como lo difunde main a las ventanas. Lo calcula la politica
// pura `nextUpdateState` (src/main/update/updatePolicy.ts) a partir de los eventos de electron-updater;
// el renderer solo lo pinta. Solo `ready` se ve: la descarga y los errores se quedan en el log.
export type UpdateState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'downloading'; readonly version: string }
  // `releaseNotes`: las notas de la version que llega, en Markdown (las del `latest.yml` publicado), o
  // null si no vinieron o no eran Markdown.
  | { readonly kind: 'ready'; readonly version: string; readonly releaseNotes: string | null };

export const IDLE_UPDATE_STATE: UpdateState = { kind: 'idle' };
