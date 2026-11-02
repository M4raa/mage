import { TRANSCRIPT_TAIL_START, type TranscriptEntry } from '@shared/transcripts';
import type { BranchReadOptions, TranscriptService } from './transcriptService';

// Lectura COMPLETA de la rama activa en memoria. Es la misma lectura que ve el renderer (`openBranchStream`, A8+),
// para que main resuelva los puntos de rewind con exactamente la rama que se pinta.

export interface ActiveBranchRead {
  readonly entries: readonly TranscriptEntry[];
  // Lineas sueltas ilegibles: no impiden leer la rama (una transcripcion truncada tiene que poder leerse).
  readonly errorCount: number;
}

export async function readActiveBranch(
  service: Pick<TranscriptService, 'openBranchStream'>,
  filePath: string,
  options: BranchReadOptions,
): Promise<ActiveBranchRead> {
  const controller = new AbortController();
  let entries: readonly TranscriptEntry[] = [];
  let errorCount = 0;
  try {
    for await (const batch of service.openBranchStream(filePath, controller.signal, TRANSCRIPT_TAIL_START, options)) {
      // Un lote con `reset` sustituye lo acumulado, errores incluidos.
      if (batch.reset === true) {
        entries = [];
        errorCount = 0;
      }
      entries = entries.concat(batch.entries);
      errorCount += batch.errors.length;
    }
  } finally {
    controller.abort();
  }
  return { entries, errorCount };
}

export async function readActiveBranchEntries(
  service: Pick<TranscriptService, 'openBranchStream'>,
  filePath: string,
  options: BranchReadOptions,
): Promise<readonly TranscriptEntry[]> {
  return (await readActiveBranch(service, filePath, options)).entries;
}
