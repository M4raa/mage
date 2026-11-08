import { describe, expect, it } from 'vitest';
import { DEFAULT_DELEGATION, DELEGATION_DEPTH_MAX, DELEGATION_DEPTH_MIN } from '@shared/settings';
import { DEFAULT_MAX_DELEGATION_DEPTH, MAX_DELEGATION_DEPTH, validateDelegation } from './delegation';

describe('validateDelegation', () => {
  it('validateDelegation_humano_devuelveCadenaVacia', () => {
    expect(validateDelegation({ creatorChain: [], maxDepth: 1 })).toEqual([]);
  });
  it.each([1, 2, 3, 4, 5])('validateDelegation_maximoValido_%s', (maxDepth) => {
    expect(validateDelegation({ creatorChain: [], maxDepth })).toEqual([]);
  });
  it.each([0, 6, 1.5, NaN])('validateDelegation_maximoInvalido_rechaza_%s', (maxDepth) => {
    expect(() => validateDelegation({ creatorChain: [], maxDepth })).toThrow(`valor recibido ${maxDepth}`);
  });
  it('validateDelegation_maximoTres_admiteHastaC', () => {
    const a = validateDelegation({ creatorChain: [] });
    const b = validateDelegation({ creatorChain: a, callerId: 'A' });
    const c = validateDelegation({ creatorChain: b, callerId: 'B' });
    expect(c).toEqual(['A', 'B']);
    expect(() => validateDelegation({ creatorChain: c, callerId: 'C' })).toThrow('delegation_depth_exceeded: máximo 3, cadena A→B→C');
  });
  it('validateDelegation_maximoUno_rechazaDelegacionDeAgente', () => {
    expect(() => validateDelegation({ creatorChain: [], callerId: 'A', maxDepth: 1 })).toThrow('delegation_depth_exceeded');
  });
  it.each([
    { creatorChain: ['A', 'A'], callerId: 'B' },
    { creatorChain: ['A', 'B'], callerId: 'A' },
    { creatorChain: ['A', 'A'] },
  ])('validateDelegation_ciclo_precedeProfundidad', (input) => {
    expect(() => validateDelegation({ ...input, maxDepth: 1 })).toThrow(/delegation_cycle: A→/);
  });
});

describe('ajustes de delegación', () => {
  it('delegationDefaults_matchMcpCore', () => {
    expect(DEFAULT_DELEGATION.maxDepth).toBe(DEFAULT_MAX_DELEGATION_DEPTH);
    expect(DELEGATION_DEPTH_MAX).toBe(MAX_DELEGATION_DEPTH);
    expect(DELEGATION_DEPTH_MIN).toBe(1);
  });
});
