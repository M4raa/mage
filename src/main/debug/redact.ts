// Redaccion de credenciales para el stream de logs (defensa en profundidad).
// INVARIANTE DE SEGURIDAD: ni tokens, ni oauthAccount, ni userID/machineID, ni el contenido de
// .credentials.json deben salir jamas al stream de debug. Enmascaramos por NOMBRE de campo (el
// dato de un log puede ser cualquier cosa), de forma recursiva y a prueba de ciclos.

export const REDACTED = '[REDACTED]';

// Profundidad maxima de recursion (evita estructuras patologicas; suficiente para logs reales).
const MAX_DEPTH = 8;

// Fragmentos sensibles buscados sobre la clave normalizada (solo letras/digitos, minusculas).
// Cubre accessToken/refreshToken/token, credentials, apiKey/ANTHROPIC_API_KEY, oauthAccount,
// userID/user_id, machineID, secret, password, authorization, bearer.
const SENSITIVE_FRAGMENTS = [
  'token',
  'credential',
  'apikey',
  'secret',
  'password',
  'oauthaccount',
  'userid',
  'machineid',
  'authorization',
  'bearer',
] as const;

// Normaliza una clave para comparar: minusculas y sin separadores (api_key -> apikey).
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

// Devuelve una copia redactada de `value`. No muta la entrada. Los campos sensibles (por nombre)
// se sustituyen por REDACTED; los ciclos y el exceso de profundidad se cortan con un marcador.
export function redact(value: unknown): unknown {
  return redactAt(value, 0, new WeakSet<object>());
}

function redactAt(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  // Guard: primitivos y nulos se devuelven tal cual (no hay clave que enmascarar aqui).
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[Truncated: max depth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactAt(item, depth + 1, seen));
  }
  return redactObject(value as Record<string, unknown>, depth, seen);
}

function redactObject(
  obj: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactAt(obj[key], depth + 1, seen);
  }
  return result;
}
