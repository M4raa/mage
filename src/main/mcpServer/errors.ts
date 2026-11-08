// Únicos errores cuyos mensajes pueden cruzar la frontera MCP.
export class MagePolicyError extends Error {}

// Rechazo ANTES de crear nada (validación de la petición): el requestId no queda gastado y se puede reintentar.
export class MageValidationError extends MagePolicyError {}

export function scopeDenied(): never {
  throw new MagePolicyError('scope_denied');
}
export async function callPort<T>(operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    // Un error de política que decide el puerto (alcance, confianza, llamante externo) llega al agente con su código.
    if (cause instanceof MagePolicyError) throw cause;
    throw new MagePolicyError(`port_error: ${operation}`, { cause });
  }
}
