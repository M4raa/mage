import { describe, expect, it } from 'vitest';
import { firstExistingPath } from './agentBinaryResolver';

describe('firstExistingPath', () => {
  it('primeraCandidataExiste_laDevuelve', () => {
    expect(firstExistingPath(['/a', '/b'], (p) => p === '/a')).toBe('/a');
  });

  it('soloLaSegundaExiste_devuelveLaSegunda', () => {
    expect(firstExistingPath(['/a', '/b'], (p) => p === '/b')).toBe('/b');
  });

  it('ningunaExiste_devuelveNull', () => {
    expect(firstExistingPath(['/a', '/b'], () => false)).toBeNull();
  });

  it('listaVacia_devuelveNull', () => {
    expect(firstExistingPath([], () => true)).toBeNull();
  });
});
