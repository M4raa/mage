// Estado de la actualizacion de Mage tal como lo difunde main a las ventanas. Lo calcula la politica
// pura `nextUpdateState` (src/main/update/updatePolicy.ts) a partir de los eventos de electron-updater;
// el renderer solo lo pinta. La barra de estado solo enseña `ready`; Configuración enseña todos (F1.3,
// #15: buscando, al día, error, descargando y lista), y es la misma difusión para todas las ventanas.
import type { LocalizedText } from './i18n/localizedText';

export type UpdateState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'upToDate'; readonly version: string }
  | { readonly kind: 'error'; readonly message: LocalizedText }
  | { readonly kind: 'downloading'; readonly version: string }
  // `releaseNotes`: las notas de la version que llega, en Markdown (las del `latest.yml` publicado), o
  // null si no vinieron o no eran Markdown.
  | { readonly kind: 'ready'; readonly version: string; readonly releaseNotes: string | null };

export const IDLE_UPDATE_STATE: UpdateState = { kind: 'idle' };
