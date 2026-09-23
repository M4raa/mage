import { describe, expect, it } from 'vitest';
import { getNextFallback, resolveFallbackChain, type FallbackCandidate } from './fallbackPolicy';

function candidate(over: Partial<FallbackCandidate> = {}): FallbackCandidate {
  return { providerId: 'claude', model: 'sonnet', priority: 0, enabled: true, ...over };
}

describe('resolveFallbackChain', () => {
  it('ordenaPorPrioridadAscendente', () => {
    const chain = resolveFallbackChain([
      candidate({ providerId: 'c', priority: 2 }),
      candidate({ providerId: 'a', priority: 0 }),
      candidate({ providerId: 'b', priority: 1 }),
    ]);

    expect(chain.map((c) => c.providerId)).toEqual(['a', 'b', 'c']);
  });

  it('excluyeLosDeshabilitados', () => {
    const chain = resolveFallbackChain([candidate({ providerId: 'a', enabled: false }), candidate({ providerId: 'b' })]);

    expect(chain.map((c) => c.providerId)).toEqual(['b']);
  });

  it('listaVacia_devuelveVacio', () => {
    expect(resolveFallbackChain([])).toEqual([]);
  });

  it('noMutaElArrayRecibido', () => {
    const input = [candidate({ providerId: 'b', priority: 1 }), candidate({ providerId: 'a', priority: 0 })];
    const copy = [...input];

    resolveFallbackChain(input);

    expect(input).toEqual(copy);
  });
});

describe('getNextFallback', () => {
  const chain = resolveFallbackChain([
    candidate({ providerId: 'claude', priority: 0 }),
    candidate({ providerId: 'gemini', priority: 1 }),
    candidate({ providerId: 'openai', priority: 2 }),
  ]);

  it('sinNadaProbado_devuelveElPrimero', () => {
    expect(getNextFallback(chain, new Set())?.providerId).toBe('claude');
  });

  it('conAlgunoYaProbado_saltaAlSiguienteNoProbado', () => {
    expect(getNextFallback(chain, new Set(['claude']))?.providerId).toBe('gemini');
  });

  it('todosProbados_devuelveNull', () => {
    expect(getNextFallback(chain, new Set(['claude', 'gemini', 'openai']))).toBeNull();
  });
});
