// Únicos errores cuyos mensajes pueden cruzar la frontera MCP.
export class MagePolicyError extends Error {}

export function scopeDenied(): never {
  throw new MagePolicyError('scope_denied');
}
export async function callPort<T>(operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    throw new MagePolicyError(`port_error: ${operation}`, { cause });
  }
}
