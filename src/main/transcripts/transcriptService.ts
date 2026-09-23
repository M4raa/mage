import type { TranscriptBatch, TranscriptTailPosition } from '@shared/transcripts';
import { TRANSCRIPT_TAIL_START } from '@shared/transcripts';
import { readTranscriptBatches } from './transcriptReader';

// Espera por defecto a que el fichero aparezca: el CLI vuelca el .jsonl al arrancar el primer turno,
// asi que abrir Logs/Contexto de una sesion recien creada puede adelantarse unos segundos al fichero.
// Sondeo acotado (no cuelga indefinidamente) y cancelable por el AbortSignal (cierre de pestana).
const DEFAULT_POLL_INTERVAL_MS = 400;
const DEFAULT_MAX_WAIT_MS = 30_000;

// Dependencias inyectables -> modulo testable sin tocar el FS real ni timers reales.
export interface TranscriptDeps {
  readonly exists: (filePath: string) => boolean;
  // Tamano actual del fichero en bytes, o -1 si no existe (I5: valida que una posicion de reanudacion
  // recordada siga siendo alcanzable antes de pedir un rango que ya no existe).
  readonly sizeOf: (filePath: string) => number;
  // `start` (I5): byte por el que empezar a leer (tail). Sin el, desde el principio (de siempre).
  readonly createReadStream: (filePath: string, start?: number) => NodeJS.ReadableStream;
  // Espera async entre sondeos de existencia. Inyectable para test (sin setTimeout real).
  readonly delay?: (ms: number) => Promise<void>;
}

// Configuracion del sondeo de aparicion del fichero (con defaults).
export interface TranscriptServiceOptions {
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
}

// Orquesta la apertura y lectura en streaming de una transcripcion persistida. No conoce IPC: el
// llamador (registerIpcHandlers en main/index.ts) conecta el generator con webContents.send y con
// la cancelacion del usuario.
export class TranscriptService {
  private readonly delay: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly deps: TranscriptDeps,
    options: TranscriptServiceOptions = {},
  ) {
    this.delay = deps.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  }

  // Abre `filePath` y va entregando lotes segun se leen. Antes de leer, ESPERA (sondeo acotado) a que
  // el fichero exista: una sesion recien arrancada aun no ha volcado su transcripcion, y lanzar de
  // inmediato dejaba al usuario con un error que el fichero desmentia segundos despues (carrera). Se
  // detiene sin lanzar si `signal` se aborta (cierre de pestana/cancelacion) — la cancelacion real
  // durante la lectura ocurre dentro de readTranscriptBatches (cierra readline directamente). Solo
  // lanza si, agotada la espera, el fichero SIGUE sin existir (contrato explicito: el mensaje incluye
  // la ruta recibida, nunca un catch silencioso).
  // `from` (I5): posicion de reanudacion. Si el fichero es hoy MAS PEQUEÑO que `from.bytesRead` (se
  // truncó/reescribió por fuera, nunca deberia pasar con el CLI pero no se asume), la posicion
  // recordada ya no vale y se relee entero — mejor eso que pedir un rango que ya no existe.
  async *openStream(filePath: string, signal: AbortSignal, from: TranscriptTailPosition = TRANSCRIPT_TAIL_START): AsyncGenerator<TranscriptBatch> {
    if (filePath.trim().length === 0) {
      throw new Error(`Ruta de transcripcion invalida: "${filePath}"`);
    }
    if (signal.aborted) return;

    const resumeFrom = from.bytesRead > 0 && this.deps.sizeOf(filePath) < from.bytesRead ? TRANSCRIPT_TAIL_START : from;

    const appeared = await this.waitForFile(filePath, signal);
    if (signal.aborted) return; // cancelado mientras se esperaba al fichero: ni error ni lotes
    if (!appeared) {
      throw new Error(`No existe la transcripcion en la ruta: "${filePath}"`);
    }

    const stream = this.deps.createReadStream(filePath, resumeFrom.bytesRead);
    // El offset solo avanza hasta el ULTIMO salto de linea visto (B15). Antes se sumaba TODO lo que
    // emitia el stream, incluida una linea final a medias —el CLI estaba escribiendola—, y esa
    // posicion se guardaba como punto de reanudacion: al refrescar se empezaba a mitad de una linea
    // ya completa, salia un segundo "JSON invalido" y esa entrada se perdia PARA SIEMPRE.
    let bytesRead = resumeFrom.bytesRead;
    let pendingBytes = 0;
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      const lastNewline = buffer.lastIndexOf(0x0a);
      if (lastNewline === -1) {
        pendingBytes += buffer.length;
        return;
      }
      bytesRead += pendingBytes + lastNewline + 1;
      pendingBytes = buffer.length - lastNewline - 1;
    });
    // Un error del stream (EACCES, o el fichero borrado entre el `exists()` y la apertura) tiene que
    // llegar al llamante como error, no propagarse crudo hasta el IPC (4.5).
    let streamError: Error | null = null;
    stream.on('error', (err: Error) => {
      streamError = err;
    });
    for await (const batch of readTranscriptBatches(stream, signal, resumeFrom.rawLineNumber, resumeFrom.totalLinesSoFar)) {
      // Al cancelar, readline cierra su iterador y el ultimo lote sale marcado isFinal:true (como
      // si el archivo hubiera terminado de verdad); NO se propaga ese ultimo lote para no mentirle
      // al renderer sobre que la transcripcion se leyo completa.
      if (signal.aborted) return;
      // `bytesRead` es exacto en el ultimo lote (isFinal): todos los 'data' del stream ya dispararon
      // para entonces (mismo emitter, mismo loop de eventos que agoto readline antes de cerrarse).
      if (streamError !== null) {
        throw new Error(`No se pudo leer la transcripcion "${filePath}": ${(streamError as Error).message}`);
      }
      yield { ...batch, bytesReadSoFar: bytesRead };
    }
  }

  // Sondea la existencia del fichero hasta que aparece, se aborta la senal, o se agota `maxWaitMs`.
  // El limite se mide en NUMERO de intentos (determinista, sin reloj) = ceil(maxWait / intervalo).
  // Devuelve true si el fichero existe; false si se agoto la espera o se cancelo.
  private async waitForFile(filePath: string, signal: AbortSignal): Promise<boolean> {
    if (this.deps.exists(filePath)) return true;
    const maxAttempts = Math.max(1, Math.ceil(this.maxWaitMs / this.pollIntervalMs));
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal.aborted) return false;
      await this.delay(this.pollIntervalMs);
      if (signal.aborted) return false;
      if (this.deps.exists(filePath)) return true;
    }
    return false;
  }
}
