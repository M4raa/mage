import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { TranscriptService } from './transcriptService';
import { TRANSCRIPT_TAIL_START } from '@shared/transcripts';

// B15: el offset de reanudacion solo puede avanzar hasta el ULTIMO salto de linea leido. Si cuenta
// tambien una linea a medias —el CLI la esta escribiendo justo entonces—, el siguiente `refresh`
// empieza a mitad de una linea YA completa: sale un segundo "JSON invalido" y esa entrada se pierde
// para siempre. Es el escenario de abrir el panel Logs mientras el agente escribe un tool_result grande.

// Stream falso: un Readable de verdad (readline necesita `resume`, no vale un EventEmitter pelado)
// que emite los chunks dados como Buffers. Se emiten en BUFFER y no en string a proposito: es asi como
// llegan de `fs.createReadStream` sin encoding, y el contador de bytes tiene que funcionar con ambos.
function fakeStream(chunks: readonly string[]): NodeJS.ReadableStream {
  return Readable.from(chunks.map((chunk) => Buffer.from(chunk, "utf8"))) as unknown as NodeJS.ReadableStream;
}

function serviceWith(chunks: readonly string[], onOpen?: (start?: number) => void): TranscriptService {
  return new TranscriptService({
    exists: () => true,
    sizeOf: () => Number.MAX_SAFE_INTEGER,
    createReadStream: (_filePath: string, start?: number) => {
      onOpen?.(start);
      return fakeStream(chunks);
    },
  });
}

async function collect(service: TranscriptService, filePath: string): Promise<readonly { bytesReadSoFar: number }[]> {
  const batches: { bytesReadSoFar: number }[] = [];
  for await (const batch of service.openStream(filePath, new AbortController().signal, TRANSCRIPT_TAIL_START)) {
    batches.push(batch as unknown as { bytesReadSoFar: number });
  }
  return batches;
}

const LINEA_A = '{"type":"user","uuid":"a"}\n';
const LINEA_B = '{"type":"assistant","uuid":"b"}\n';

describe('TranscriptService.openStream — offset de reanudacion', () => {
  it('openStream_ultimaLineaIncompleta_noCuentaSusBytes', async () => {
    // Dos lineas completas y una tercera a medias, sin su salto de linea.
    const service = serviceWith([LINEA_A, LINEA_B, '{"type":"assis']);

    const batches = await collect(service, 'C:\\t.jsonl');

    const ultimo = batches[batches.length - 1];
    expect(ultimo?.bytesReadSoFar).toBe(Buffer.byteLength(LINEA_A + LINEA_B));
  });

  it('openStream_lineaPartidaEntreDosChunks_cuentaLaLineaEnteraUnaVez', async () => {
    // El troceo del stream no tiene por que caer en los limites de linea: la mitad de LINEA_B llega
    // en un chunk y la otra mitad en el siguiente.
    const mitad = Math.floor(LINEA_B.length / 2);
    const service = serviceWith([LINEA_A + LINEA_B.slice(0, mitad), LINEA_B.slice(mitad)]);

    const batches = await collect(service, 'C:\\t.jsonl');

    const ultimo = batches[batches.length - 1];
    expect(ultimo?.bytesReadSoFar).toBe(Buffer.byteLength(LINEA_A + LINEA_B));
  });

  it('openStream_todasLasLineasCompletas_cuentaTodosLosBytes', async () => {
    const service = serviceWith([LINEA_A + LINEA_B]);

    const batches = await collect(service, 'C:\\t.jsonl');

    expect(batches[batches.length - 1]?.bytesReadSoFar).toBe(Buffer.byteLength(LINEA_A + LINEA_B));
  });

  it('openStream_sinNingunSaltoDeLinea_noAvanzaElOffset', async () => {
    // Un fichero que aun no tiene ni una linea terminada no puede mover el punto de reanudacion.
    const service = serviceWith(['{"type":"user"']);

    const batches = await collect(service, 'C:\\t.jsonl');

    for (const batch of batches) expect(batch.bytesReadSoFar).toBe(0);
  });

  it('openStream_rutaVacia_lanzaConElValorRecibido', async () => {
    const service = serviceWith([LINEA_A]);

    await expect(collect(service, '   ')).rejects.toThrow(/"   "/);
  });
});
