// Modulo PURO de cadena de fallback entre proveedores/modelos (I9, patron de
// OmniRoute `src/domain/fallbackPolicy.ts`). Se porta la FORMA (tipos + resolucion), no la
// implementacion (la de OmniRoute esta llena de `catch { /* Non-critical */ }`, el antipatron que
// prohibe CLAUDE.md). Sin consumidor todavia: Mage hoy no reintenta automaticamente con otro
// proveedor cuando uno falla (es el usuario quien elige a mano); este modulo queda listo para el dia
// que haga falta, en vez de reinventarse entonces desde cero.

export interface FallbackCandidate {
  readonly providerId: string;
  readonly model: string;
  readonly priority: number; // menor = se intenta antes
  readonly enabled: boolean;
}

export type FallbackChain = readonly FallbackCandidate[];

// Candidatos HABILITADOS, ordenados por prioridad ascendente. No muta `candidates`.
export function resolveFallbackChain(candidates: readonly FallbackCandidate[]): FallbackChain {
  return candidates.filter((c) => c.enabled).toSorted((a, b) => a.priority - b.priority);
}

// Primer candidato de la cadena que NO se haya probado ya (por `providerId`); null si se agoto la
// cadena. `tried` es de quien orquesta el reintento (aqui no hay estado, solo decision).
export function getNextFallback(chain: FallbackChain, tried: ReadonlySet<string>): FallbackCandidate | null {
  return chain.find((c) => !tried.has(c.providerId)) ?? null;
}
