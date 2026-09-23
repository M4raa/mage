import type { LogLevel } from '@shared/debug';

// Reenvia la consola y los errores no capturados del renderer principal al LogBus de main
// (via window.mageDebug, presente solo en dev). Preserva el comportamiento original de la consola.
// No hace nada en produccion (mageDebug === undefined).

// Mapeo de metodos de consola a niveles del stream.
const CONSOLE_LEVELS: ReadonlyArray<readonly [keyof Console, LogLevel]> = [
  ['log', 'debug'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
];

// Serializa un argumento de consola de forma segura (sin lanzar por ciclos/no-serializables).
// Exportada para test: es la parte con casos raros (ciclos, funciones, undefined).
// OJO con `JSON.stringify`: devuelve `undefined` —no una cadena— para `undefined`, funciones y symbols,
// asi que sin el ultimo guard un `console.log(undefined)` se reportaba al LogBus como cadena VACIA y se
// perdia el dato que se estaba intentando depurar.
export function describeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg); // ciclos y no-serializables
  }
}

// Extrae el maximo contexto de los argumentos: stacks de Error y objetos crudos (cuanto mas
// contexto, mejor para depurar). Devuelve undefined si no hay nada estructurado que adjuntar.
// Exportada para test (misma razon que describeArg).
export function collectContext(args: readonly unknown[]): Record<string, unknown> | undefined {
  const errors = args
    .filter((a): a is Error => a instanceof Error)
    .map((e) => ({ name: e.name, message: e.message, stack: e.stack }));
  const objects = args.filter((a) => typeof a === 'object' && a !== null && !(a instanceof Error));
  const context: Record<string, unknown> = {};
  if (errors.length > 0) context.errors = errors;
  if (objects.length > 0) context.args = objects;
  return Object.keys(context).length > 0 ? context : undefined;
}

export function installRendererLogForwarding(): void {
  const debug = window.mageDebug;
  if (debug === undefined) return; // produccion: sin ventana de debug

  for (const [method, level] of CONSOLE_LEVELS) {
    const original = console[method] as (...args: unknown[]) => void;
    (console[method] as unknown) = (...args: unknown[]): void => {
      original(...args);
      const data = collectContext(args);
      debug.reportRendererLog({
        level,
        message: args.map(describeArg).join(' '),
        ...(data === undefined ? {} : { data }),
      });
    };
  }

  window.addEventListener('error', (event) => {
    debug.reportRendererLog({
      level: 'error',
      message: event.message,
      data: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    debug.reportRendererLog({
      level: 'error',
      message: `Promesa rechazada: ${describeArg(reason)}`,
      ...(reason instanceof Error ? { data: { stack: reason.stack } } : {}),
    });
  });
}
