// Modelo de datos de las TRANSCRIPCIONES PERSISTIDAS (~/.claude*/projects/**/*.jsonl).
// Distinto del modelo de eventos EN VIVO (src/shared/events.ts): esto es el resultado de leer y
// normalizar un archivo ya escrito en disco por el CLI, no el stream de un proceso en marcha.

// Categoria de una linea: 'turn' = user/assistant/system (interpretable); 'metadata' = uno de los
// >10 tipos propios de la persistencia (mode, attachment, file-history-snapshot, ...); 'unknown' =
// cualquier tipo aun no visto/catalogado. 'metadata' y 'unknown' se tratan igual para el render
// (fila colapsada con su `kind` crudo) pero se distinguen para poder detectar tipos nuevos.
export type TranscriptLineCategory = 'turn' | 'metadata' | 'unknown';

// Uso de tokens de UNA linea assistant (de message.usage). Todos los contadores son enteros >=0
// (nunca float, nunca negativos): un valor invalido del origen se sanea a 0, no se descarta.
export interface TranscriptTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly model: string | null; // message.model, ej. "claude-sonnet-5"; null si no viene
}

// Una entrada normalizada de la transcripcion. `raw` conserva el payload completo (JSON ya
// parseado) para expandir bajo demanda en la UI sin tener que releer el archivo.
export interface TranscriptEntry {
  readonly index: number; // posicion 0-based en el archivo; clave estable para la virtualizacion
  readonly uuid: string | null;
  readonly parentUuid: string | null;
  readonly isSidechain: boolean;
  // Entrada que el CLI inyecta para su propia contabilidad (aviso de imagen pegada,
  // <system-reminder>...): NO es un mensaje del usuario y no se pinta en el hilo. MEDIDO: el campo
  // aparece como true Y como false en transcripciones reales, asi que su AUSENCIA no significa "es
  // meta" -> el filtro del hilo compara `=== true`. El panel de Logs si las sigue viendo (son trazas
  // legitimas del protocolo): el filtro es del render de la conversacion, no de la lectura.
  readonly isMeta: boolean;
  readonly timestampMs: number | null; // epoch UTC; null si el campo falta o no parsea
  readonly category: TranscriptLineCategory;
  readonly kind: string; // el `type` crudo de la linea (user/assistant/mode/attachment/...)
  readonly summary: string; // frase corta para la fila colapsada
  readonly tokenUsage: TranscriptTokenUsage | null; // solo lineas assistant con message.usage
  readonly raw: unknown; // payload completo de la linea ya parseada
}

// Error de parseo de una linea concreta (JSON invalido o sin campo `type`). Nunca se lanza: se
// acumula junto a las entradas validas del mismo lote.
export interface TranscriptParseError {
  readonly lineNumber: number; // 1-based (numero de linea real del archivo)
  readonly message: string;
}

// Posicion de reanudacion de una lectura de transcripcion (I5: lectura incremental/tail). Byte EXACTO
// ya consumido (para `createReadStream({ start })`) + numero de linea FISICA ya consumido (blancas
// INCLUIDAS: es lo que sigue dando `TranscriptEntry.index`/`TranscriptParseError.lineNumber` sin
// colisionar con lo ya acumulado, y con lineas en blanco de por medio no coincide con
// `totalLinesSoFar`, que las excluye) + el propio `totalLinesSoFar` acumulado. La posicion cero
// (`TRANSCRIPT_TAIL_START`) es leer desde el principio: mismo comportamiento que siempre.
export interface TranscriptTailPosition {
  readonly bytesRead: number;
  readonly rawLineNumber: number;
  readonly totalLinesSoFar: number;
}

export const TRANSCRIPT_TAIL_START: TranscriptTailPosition = { bytesRead: 0, rawLineNumber: 0, totalLinesSoFar: 0 };

// Lote de entradas entregado progresivamente main -> renderer mientras se lee el archivo.
export interface TranscriptBatch {
  readonly entries: readonly TranscriptEntry[];
  readonly errors: readonly TranscriptParseError[];
  readonly isFinal: boolean; // true en el ultimo lote (fin de archivo)
  readonly totalLinesSoFar: number; // lineas procesadas (validas + con error) hasta este lote
  // I5: posicion de reanudacion ACUMULADA hasta este lote (incluye lo leido en lecturas anteriores si
  // esta fue una reanudacion). El renderer solo necesita guardar la del ultimo lote recibido.
  readonly bytesReadSoFar: number;
  readonly rawLineNumber: number;
}
