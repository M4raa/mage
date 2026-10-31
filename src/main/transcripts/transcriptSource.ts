import type { LineAdapter } from './transcriptReader';

// De dónde sale una transcripción que abre main: un fichero NDJSON (Claude, o el rollout de Codex) o los turnos vigentes
// de un hilo de Codex con revert, que se piden a su app-server.
export type TranscriptSource =
  | { readonly kind: 'file'; readonly filePath: string; readonly adapt?: LineAdapter; readonly activeBranch: boolean }
  | { readonly kind: 'codexTurns'; readonly home: string; readonly threadId: string };
