import type { ImageAttachment } from './ipc';

// Menciones @ de ficheros de la carpeta de la conversacion (Q05). Contrato main<->renderer: el renderer
// manda rutas y main las resuelve en el MOMENTO DE ENVIAR (clase, tamano y contenido se miden en main
// leyendo el disco; nunca se fia de lo que diga el renderer).

export type MentionKind = 'image' | 'pdf' | 'text' | 'binary';

// Lo que manda el renderer: la clase y el tamano se miden en main.
export interface MentionRef {
  readonly absPath: string;
  readonly relPath: string;
}

export interface MentionCandidate {
  readonly relPath: string;
  readonly absPath: string;
  readonly kind: MentionKind;
  readonly bytes: number;
}

export interface MentionSearchParams {
  readonly cwd: string;
  readonly accountDir: string;
  readonly query: string;
  readonly limit: number;
}

export interface MentionSearchResult {
  readonly candidates: readonly MentionCandidate[];
  readonly truncated: boolean;
  readonly reason: 'ok' | 'untrusted';
}

export type MentionOutcome = 'inline' | 'attached' | 'pathOnly' | 'missing' | 'outsideFolder';

export interface MentionResolveParams {
  readonly cwd: string;
  readonly accountDir: string;
  readonly provider: string;
  readonly refs: readonly MentionRef[];
}

export interface MentionResolution {
  // Lo que se AÑADE al final del mensaje del usuario.
  readonly text: string;
  readonly attachments: readonly ImageAttachment[];
  readonly outcomes: readonly { readonly relPath: string; readonly outcome: MentionOutcome; readonly kind: MentionKind | null }[];
}

export interface MentionPreviewParams {
  readonly cwd: string;
  readonly accountDir: string;
  readonly absPath: string;
}

export type MentionPreview =
  | { readonly kind: 'image'; readonly dataUrl: string }
  | { readonly kind: 'text'; readonly head: string }
  | { readonly kind: 'none' };
