import type { LogEntry, LogLevel, LogSource } from '@shared/debug';
import { redact } from './redact';

// Reloj inyectable (DI -> tests deterministas).
export type Clock = () => string;

// Suscriptor del stream; recibe cada entrada ya redactada.
export type LogListener = (entry: LogEntry) => void;

// Funcion de log ligada a un source (la que se inyecta en el motor, main, etc.).
export type LogFn = (level: LogLevel, message: string, data?: unknown) => void;

// Tope del historial en memoria (backlog para la ventana de debug al abrir). Acotado para no
// crecer sin limite en sesiones largas.
const MAX_HISTORY = 2000;

// Bus central de logs: unico punto por el que pasan TODAS las entradas de la app en dev.
// El resto del codigo publica aqui (inyectado por constructor/param); nunca emite por su cuenta.
// Redacta credenciales ANTES de notificar a cualquier suscriptor (defensa en profundidad).
export class LogBus {
  private nextId = 1;
  private readonly listeners = new Set<LogListener>();
  private readonly buffer: LogEntry[] = [];

  // now: reloj inyectable; por defecto ISO 8601 UTC.
  constructor(private readonly now: Clock = () => new Date().toISOString()) {}

  // Publica una entrada. `data` se redacta y se congela dentro de la entrada resultante.
  publish(source: LogSource, level: LogLevel, message: string, data?: unknown): LogEntry {
    // Sin suscriptores, un `debug` no se clona NI se retiene (P6). En produccion `listeners` esta
    // siempre vacio —la ventana de debug solo existe en dev—, y aqui pasa CADA evento del motor,
    // incluidos todos los `stream_delta` y todos los `tool_result`. `redact` devuelve los primitivos
    // tal cual, asi que el buffer de 2.000 entradas quedaba reteniendo los strings completos de cada
    // salida de tool: cientos de kB o MB por entrada. El coste de CPU era bajo; el de memoria no.
    // Los niveles por encima de `debug` SI se guardan aunque nadie escuche: son el backlog que se
    // reproduce al abrir la ventana de debug, y perderlos dejaria "nunca en silencio" en mentira.
    if (this.listeners.size === 0 && level === 'debug') {
      return { id: this.nextId++, timestamp: this.now(), source, level, message };
    }
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: this.now(),
      source,
      level,
      message,
      ...(data === undefined ? {} : { data: redact(data) }),
    };
    this.buffer.push(entry);
    if (this.buffer.length > MAX_HISTORY) this.buffer.shift();
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  // Backlog acotado (mas antiguo -> mas reciente) para reproducir al abrir la ventana de debug.
  history(): readonly LogEntry[] {
    return this.buffer;
  }

  // Devuelve una LogFn ligada a un source concreto (comodidad para inyectar en subsistemas).
  loggerFor(source: LogSource): LogFn {
    return (level, message, data) => {
      this.publish(source, level, message, data);
    };
  }

  // Suscribe un listener; devuelve funcion para desuscribir. Precondicion implicita: idempotente.
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
