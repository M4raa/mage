import { describe, expect, it } from 'vitest';
import { deriveDeviceScale, dipToPhysical, physicalToDip } from './deviceScale';

describe('deriveDeviceScale', () => {
  it.each([
    [900, 900, 1],
    [1125, 900, 1.25],
    [1350, 900, 1.5],
    [416, 333, 1.25],
  ])('deriveDeviceScale_measuredSizes_returnsScale: %i px / %i DIP', (widthPx, widthDip, expected) => {
    // Act
    const scale = deriveDeviceScale(widthPx, widthDip);

    // Assert
    expect(scale).toBe(expected);
  });

  it.each([
    [0, 900],
    [900, 0],
    [-1, 900],
    [Number.NaN, 900],
    [900.5, 900],
    [900, Number.POSITIVE_INFINITY],
  ])('deriveDeviceScale_invalidWidth_throws: %s px / %s DIP', (widthPx, widthDip) => {
    // Act y Assert
    expect(() => deriveDeviceScale(widthPx, widthDip)).toThrow(/Ancho no válido/);
  });
});

describe('dipToPhysical', () => {
  it.each([
    [900, 1, 900],
    [900, 1.25, 1125],
    [900, 1.5, 1350],
    [333, 1.25, 416],
    [0, 1.5, 0],
    [-10, 1.5, -15],
  ])('dipToPhysical_atEachScale_rounds: %i DIP a escala %s', (dip, scale, expected) => {
    // Act
    const px = dipToPhysical(dip, scale);

    // Assert
    expect(px).toBe(expected);
  });

  it('dipToPhysical_infiniteCoordinate_throws', () => {
    // Act y Assert
    expect(() => dipToPhysical(Number.POSITIVE_INFINITY, 1)).toThrow(/DIP no válida/);
  });
});

describe('physicalToDip', () => {
  it.each([
    [900, 1, 900],
    [1125, 1.25, 900],
    [1350, 1.5, 900],
    [417, 1.5, 278],
  ])('physicalToDip_atEachScale_rounds: %i px a escala %s', (px, scale, expected) => {
    // Act
    const dip = physicalToDip(px, scale);

    // Assert
    expect(dip).toBe(expected);
  });

  it('physicalToDip_nanCoordinate_throws', () => {
    // Act y Assert
    expect(() => physicalToDip(Number.NaN, 1)).toThrow(/física no válida/);
  });
});

describe('conversion con escala no válida', () => {
  it.each([[0], [-1], [Number.NaN]])('conversion_invalidScale_throws: escala %s', (scale) => {
    // Act y Assert
    expect(() => dipToPhysical(10, scale)).toThrow(/Escala no válida/);
    expect(() => physicalToDip(10, scale)).toThrow(/Escala no válida/);
  });
});
