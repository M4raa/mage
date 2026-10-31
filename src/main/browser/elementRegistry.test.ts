import { describe, expect, it } from 'vitest';
import { ElementRegistry } from './elementRegistry';
import type { RawDomElement } from './domSnapshot';

const a: RawDomElement = { role: 'button', name: 'A', rectDip: [0, 0, 10, 10] };
const b: RawDomElement = { role: 'link', name: 'B', rectDip: [0, 20, 10, 10] };

describe('ElementRegistry', () => {
  it('replace_firstRead_assignsIdsFromOne', () => {
    // Arrange
    const registry = new ElementRegistry();

    // Act
    const result = registry.replace([a, b]);

    // Assert
    expect(result.map((element) => element.id)).toEqual([1, 2]);
    expect(result[0]).toMatchObject({ role: 'button', name: 'A', rectDip: [0, 0, 10, 10] });
    expect(result[1]).toMatchObject({ role: 'link', name: 'B', rectDip: [0, 20, 10, 10] });
  });

  it('replace_secondRead_continuesIdsAndExpiresOld', () => {
    // Arrange
    const registry = new ElementRegistry();
    registry.replace([a, b]);

    // Act
    const second = registry.replace([a]);

    // Assert
    expect(second[0]?.id).toBe(3);
    expect(() => registry.resolve(1)).toThrow(/El elemento 1 no existe o ha caducado/);
    expect(registry.resolve(3)).toEqual(second[0]);
  });

  it('replace_emptyRead_expiresPrevious', () => {
    // Arrange
    const registry = new ElementRegistry();
    registry.replace([a]);

    // Act
    const result = registry.replace([]);

    // Assert
    expect(result).toEqual([]);
    expect(() => registry.resolve(1)).toThrow();
  });

  it('clear_afterRead_expiresAllButKeepsCounter', () => {
    // Arrange
    const registry = new ElementRegistry();
    registry.replace([a]);

    // Act
    registry.clear();

    // Assert
    expect(() => registry.resolve(1)).toThrow();
    expect(registry.replace([b])[0]?.id).toBe(2);
  });

  it.each([0, -1, 1.5])('resolve_invalidId_throws: id %s', (id) => {
    // Arrange
    const registry = new ElementRegistry();
    registry.replace([a]);

    // Act y Assert
    expect(() => registry.resolve(id)).toThrow(`El elemento ${id} no existe o ha caducado`);
  });
});
