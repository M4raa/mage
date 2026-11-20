import type { LocalizedText } from './i18n/localizedText';

// Lista de artifacts de las cuentas de Claude (los creados y los compartidos con cada una), tal como cruza el IPC.
// Es lo UNICO que llega al renderer de la frame API: ni el token, ni `owner_account`, ni nada del «boot» de lectura.

// «Creados» (`mine`) y «Compartidos conmigo» (`shared`): se piden aparte (`rel=all` no los mezcla, medido).
export type ArtifactRel = 'mine' | 'shared';
export const ARTIFACT_RELS: readonly ArtifactRel[] = ['mine', 'shared'];

// Las dos clases que lista el CLI; el resto de filas se descartan.
export type ArtifactKind = 'page' | 'document';

export interface ArtifactSummary {
  readonly accountId: string;
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly rel: ArtifactRel;
  readonly title: string;
  // `https://claude.ai/...`, o '' si la fila no traia una URL de claude.ai valida.
  readonly openUrl: string;
  // Quien puede verlo: `owner`, `users`, `org`, `public` (o lo que mande el servidor, tal cual).
  readonly audience: string;
  // Epoch ms (UTC) de `sort_time`; null si no venia o no era una fecha valida.
  readonly sortTime: number | null;
  // Compartido desde otra organizacion (`outside_organization`).
  readonly external: boolean;
}

export interface ArtifactPage {
  readonly accountId: string;
  readonly rel: ArtifactRel;
  readonly items: readonly ArtifactSummary[];
  // Para «Cargar más»; null si no hay mas.
  readonly nextPageToken: string | null;
}

// Cada lista de cada cuenta falla sola: un error de una no esconde las demas.
export type ArtifactPageResult =
  | { readonly ok: true; readonly page: ArtifactPage }
  | { readonly ok: false; readonly error: LocalizedText };

export interface AccountArtifacts {
  readonly accountId: string;
  readonly mine: ArtifactPageResult;
  readonly shared: ArtifactPageResult;
}

export interface ArtifactsListParams {
  // true = «Actualizar»: salta la cache de main.
  readonly refresh: boolean;
}

export interface ArtifactsMoreParams {
  readonly accountId: string;
  readonly rel: ArtifactRel;
  readonly pageToken: string;
}
