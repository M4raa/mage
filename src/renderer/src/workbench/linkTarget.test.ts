import { describe, expect, it } from 'vitest';
import { linkDestination, type LinkClick } from './linkTarget';

const base: LinkClick = { href: 'https://example.com/', modifier: false, invert: false, hasSession: true };

describe('linkDestination', () => {
  it('linkDestination_clicNormalConSesion_internal', () => {
    expect(linkDestination(base)).toBe('internal');
  });

  it('linkDestination_conModificador_external', () => {
    expect(linkDestination({ ...base, modifier: true })).toBe('external');
  });

  it('linkDestination_invertidoSinModificador_external', () => {
    expect(linkDestination({ ...base, invert: true })).toBe('external');
  });

  it('linkDestination_invertidoConModificador_internal', () => {
    expect(linkDestination({ ...base, invert: true, modifier: true })).toBe('internal');
  });

  it('linkDestination_sinSesion_external', () => {
    expect(linkDestination({ ...base, hasSession: false })).toBe('external');
  });

  it('linkDestination_noWeb_external', () => {
    expect(linkDestination({ ...base, href: 'mailto:a@b.c' })).toBe('external');
  });

  it('linkDestination_httpMayusculas_internal', () => {
    expect(linkDestination({ ...base, href: 'HTTP://x.y' })).toBe('internal');
  });
});
