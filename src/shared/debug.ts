// Contrato compartido del stream de logs de desarrollo (Tarea 1b).
// Un unico modelo de entrada de log recorre toda la app: main, motor y renderer se unifican aqui
// y se empujan a la ventana de debug. La redaccion de credenciales vive en main (defensa en
// profundidad) antes de que nada salga del LogBus.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Origen de una entrada. 'renderer' incluye el reenvio de la consola del renderer principal.
export type LogSource = 'main' | 'engine' | 'renderer';

// Entrada ya normalizada que viaja main -> ventana de debug (con id/timestamp asignados).
export interface LogEntry {
  readonly id: number;
  readonly timestamp: string; // ISO 8601 UTC
  readonly source: LogSource;
  readonly level: LogLevel;
  readonly message: string;
  readonly data?: unknown; // ya redactado en el LogBus
}

// Lo que el renderer principal reporta a main (sin id/timestamp/source: los pone el LogBus).
export interface RendererLogInput {
  readonly level: LogLevel;
  readonly message: string;
  readonly data?: unknown;
}

// Canales IPC dedicados del stream de debug (separados del canal de sesiones del motor).
export const DebugChannel = {
  Log: 'debug:log', // main -> ventana de debug (push de LogEntry)
  RendererLog: 'debug:rendererLog', // renderer principal -> main (RendererLogInput)
} as const;

export type DebugChannel = (typeof DebugChannel)[keyof typeof DebugChannel];

// API que el preload expone como window.mageDebug (disponible en ambas ventanas en dev).
export interface MageDebugApi {
  // Renderer principal -> main: reporta una entrada de su consola/errores.
  reportRendererLog(input: RendererLogInput): void;
  // Ventana de debug: se suscribe al stream; devuelve funcion para desuscribir.
  onLog(listener: (entry: LogEntry) => void): () => void;
}
