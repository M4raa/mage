import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOM_SELECTOR,
  MAX_DOM_NODES,
  MAX_SELECTOR_LENGTH,
  parseDomSnapshot,
  resolveReadDomOptions,
} from './domSnapshot';

const button = { role: 'button', name: 'Enviar', rectDip: [178, 67, 29, 21] };

describe('resolveReadDomOptions', () => {
  it('resolveReadDomOptions_empty_returnsDefaults', () => {
    // Act
    const options = resolveReadDomOptions({});

    // Assert
    expect(options).toEqual({ selector: DEFAULT_DOM_SELECTOR, maxNodes: MAX_DOM_NODES });
  });

  it('resolveReadDomOptions_validValues_returnsThem', () => {
    // Act
    const trimmed = resolveReadDomOptions({ selector: ' #a ', maxNodes: 1 });
    const onlyMax = resolveReadDomOptions({ maxNodes: MAX_DOM_NODES });

    // Assert
    expect(trimmed).toEqual({ selector: '#a', maxNodes: 1 });
    expect(onlyMax.maxNodes).toBe(MAX_DOM_NODES);
  });

  it.each([0, MAX_DOM_NODES + 1, 1.5, -1, Number.NaN])(
    'resolveReadDomOptions_invalidMaxNodes_throws: %s',
    (maxNodes) => {
      // Act y Assert
      expect(() => resolveReadDomOptions({ maxNodes })).toThrow(/maxNodes/);
    },
  );

  it.each(['', '   ', 'a'.repeat(MAX_SELECTOR_LENGTH + 1)])(
    'resolveReadDomOptions_invalidSelector_throws: selector de %s caracteres',
    (selector) => {
      // Act y Assert
      expect(() => resolveReadDomOptions({ selector })).toThrow(/Selector no válido/);
    },
  );
});

describe('parseDomSnapshot', () => {
  it('parseDomSnapshot_validArray_returnsElements', () => {
    // Arrange
    const elements = [button, { role: 'link', name: '', rectDip: [-5, 0, 0, 0] }];

    // Act
    const result = parseDomSnapshot(elements, MAX_DOM_NODES);

    // Assert
    expect(result).toEqual(elements);
  });

  it('parseDomSnapshot_emptyArray_returnsEmpty', () => {
    // Act
    const result = parseDomSnapshot([], MAX_DOM_NODES);

    // Assert
    expect(result).toEqual([]);
  });

  it.each([
    ['objeto en lugar de array', {}],
    ['null', null],
    ['cadena', '[]'],
    ['sin name', [{ role: 'button', rectDip: [0, 0, 1, 1] }]],
    ['rectDip con 3 valores', [{ ...button, rectDip: [0, 0, 1] }]],
    ['rectDip con NaN', [{ ...button, rectDip: [0, 0, Number.NaN, 1] }]],
    ['tamaño negativo', [{ ...button, rectDip: [0, 0, -1, 1] }]],
    ['role vacío', [{ ...button, role: '' }]],
    ['name de 201 caracteres', [{ ...button, name: 'x'.repeat(201) }]],
    ['clave de más', [{ ...button, extra: 1 }]],
  ])('parseDomSnapshot_invalidShape_throws: %s', (_label, value) => {
    // Act y Assert
    expect(() => parseDomSnapshot(value, MAX_DOM_NODES)).toThrow(/no tiene la forma esperada/);
  });

  it('parseDomSnapshot_moreThanMaxNodes_throws', () => {
    // Act y Assert
    expect(() => parseDomSnapshot([button, button, button], 2)).toThrow(/no tiene la forma esperada/);
  });
});
