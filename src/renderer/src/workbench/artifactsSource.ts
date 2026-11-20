import type { AccountArtifacts, ArtifactPage, ArtifactsListParams, ArtifactsMoreParams, ArtifactsOpenParams, ArtifactsVisibilityParams, ArtifactVisibility } from '@shared/artifactLibrary';

// De dónde leen la pantalla «Artifacts» y la tarjeta del chat. Es un objeto (no funciones sueltas) para que verify:gui
// siembre las respuestas sustituyendo sus funciones a través de `__mageDev` (devBridge.ts) sin red ni CLI:
// `window.mage` no se puede sustituir. En producción, siempre el IPC.
export const artifactsSource: {
  list: (params: ArtifactsListParams) => Promise<readonly AccountArtifacts[]>;
  more: (params: ArtifactsMoreParams) => Promise<ArtifactPage>;
  open: (params: ArtifactsOpenParams) => Promise<{ readonly title: string }>;
  visibility: (params: ArtifactsVisibilityParams) => Promise<ArtifactVisibility | null>;
  publisher: (url: string) => Promise<string | null>;
} = {
  list: (params) => window.mage.listArtifacts(params),
  more: (params) => window.mage.moreArtifacts(params),
  open: (params) => window.mage.openArtifactInViewer(params),
  visibility: (params) => window.mage.artifactVisibility(params),
  publisher: (url) => window.mage.lookupArtifactPublisher(url),
};
