// Fija la tolerancia que Mage pide a zod en sus esquemas de frontera. zod 4 cambió `.default`, `.catch`
// y su relación con `.optional()`; estos casos son los resultados medidos con zod 3.25 y no pueden moverse.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const strings = z.array(z.string());
const FALLBACK = ['X'];
type Case = readonly [label: string, input: Record<string, unknown>, expected: unknown];

// Las seis entradas que llegan de un fichero o de un CLI: clave ausente, `undefined`, `null`, otro tipo, válido y elemento malo.
function cases(nul: unknown, wrong: unknown, badItem: unknown): Case[] {
  return [
    ['missing', {}, {}],
    ['undefined', { f: undefined }, { f: undefined }],
    ['null', { f: null }, { f: nul }],
    ['wrongType', { f: 42 }, { f: wrong }],
    ['valid', { f: ['a'] }, { f: ['a'] }],
    ['badItem', { f: [1] }, { f: badItem }],
  ];
}

const PATTERNS: readonly [name: string, field: z.ZodType, table: Case[]][] = [
  ['optional().catch(X)', strings.optional().catch(FALLBACK), cases(FALLBACK, FALLBACK, FALLBACK)],
  ['catch(X).optional()', strings.catch(FALLBACK).optional(), cases(FALLBACK, FALLBACK, FALLBACK)],
  ['nullish().catch(null)', strings.nullish().catch(null), cases(null, null, null)],
  ['nullable().optional().catch(null)', strings.nullable().optional().catch(null), cases(null, null, null)],
];

describe('zod tolerance (behaviour measured on zod 3)', () => {
  for (const [name, field, table] of PATTERNS) {
    it.each(table)(`${name}_%s_keepsZod3Result`, (_label, input, expected) => {
      // Arrange
      const schema = z.object({ f: field });
      // Act
      const result = schema.parse(input);
      // Assert
      expect(result).toStrictEqual(expected);
    });
  }

  it('catch_missingKey_returnsFallback', () => {
    // Arrange
    const schema = z.object({ f: strings.catch(FALLBACK) });
    // Act
    const result = schema.parse({});
    // Assert
    expect(result).toStrictEqual({ f: FALLBACK });
  });

  it.each([[{}], [{ f: undefined }]])('default_absentValue_returnsDefault', (input) => {
    // Arrange
    const schema = z.object({ f: strings.default([]) });
    // Act
    const result = schema.parse(input);
    // Assert
    expect(result).toStrictEqual({ f: [] });
  });

  it.each([[null], [42], [[1]]])('default_invalidValue_stillFails', (value) => {
    // Arrange
    const schema = z.object({ f: strings.default([]) });
    // Act
    const result = schema.safeParse({ f: value });
    // Assert
    expect(result.success).toBe(false);
  });

  it('defaultObject_absent_returnsEmptyObject', () => {
    // Arrange
    const schema = z.object({ r: z.object({ s: strings.optional() }).default({}) });
    // Act
    const result = schema.parse({});
    // Assert
    expect(result).toStrictEqual({ r: {} });
  });

  it.each([[undefined, null], [null, null], [42, 'n42']])('transformCatch_%s_returnsTransformedOrNull', (value, expected) => {
    // Arrange
    const schema = z.unknown().transform((v) => (typeof v === 'number' ? `n${v}` : null)).catch(null);
    // Act
    const result = schema.parse(value);
    // Assert
    expect(result).toBe(expected);
  });
});
