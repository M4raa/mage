import { adaptCodexLine, codexTurnsToLines, type CodexTurn } from '@shared/codexTranscript';
import type { TranscriptBatch } from '@shared/transcripts';
import { staticTranscriptBatch } from '../transcripts/staticBatch';
import type { TranscriptSource } from '../transcripts/transcriptSource';
import type { CodexHistoryService } from './codexHistory';

// Qué se lee de una conversación de Codex, al reabrirla y al migrarla. Medido con codex-cli 0.164.0: los hilos anteriores
// a 0.162 no guardan sus herramientas en la base del historial, así que `thread/turns/list` solo traería sus mensajes. Por eso:
// - un hilo SIN segmentos (nunca se rebobinó) se lee de su rollout, como siempre: no hay nada descartado;
// - un hilo CON segmentos (hubo un `thread/revert`) se lee de `thread/turns/list`, que solo trae lo vigente. El rollout
//   original conserva el turno descartado y los segmentos solo lo posterior: ninguno de los dos vale.
// null: la cuenta no tiene ese hilo.
export function codexTranscriptSource(history: Pick<CodexHistoryService, 'findRollout' | 'hasSegments'>, home: string, threadId: string): TranscriptSource | null {
  if (history.hasSegments(home, threadId)) return { kind: 'codexTurns', home, threadId };
  const rollout = history.findRollout(home, threadId);
  return rollout === null ? null : { kind: 'file', filePath: rollout, adapt: adaptCodexLine, activeBranch: false };
}

// Un único lote final con los turnos vigentes. `reset`: cada apertura trae el hilo entero, así que sustituye lo que el
// renderer tuviera de una lectura anterior. Un fallo de la RPC se propaga: la pestaña lo enseña, sin caer al rollout.
export async function* codexTurnsBatches(listTurns: () => Promise<readonly CodexTurn[]>): AsyncGenerator<TranscriptBatch> {
  yield { ...staticTranscriptBatch(codexTurnsToLines(await listTurns())), reset: true };
}
