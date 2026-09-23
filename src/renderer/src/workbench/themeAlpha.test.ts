import { describe, expect, it } from 'vitest';
import { withAlpha } from './theme';

// `withAlpha` es la unica parte con aritmetica de la opacidad de fondo, y come colores que NO
// controlamos: los tokens del tema base son hex nuestros, pero los de un tema importado de Open VSX
// vienen del `.vsix` de un tercero y pueden traer cualquier forma valida de CSS. Devolver null ante lo
// que no entiende es parte del contrato: el llamante deja ese token como esta, que es mejor que pintar
// un color inventado.

describe('withAlpha', () => {
  it('withAlpha_hexDe6Digitos_devuelveRgbaConEseAlfa', () => {
    expect(withAlpha('#141414', 0.6)).toBe('rgba(20, 20, 20, 0.6)');
  });

  it('withAlpha_hexDe3Digitos_loExpandeDuplicandoCadaDigito', () => {
    // #abc es #aabbcc, no #0a0b0c.
    expect(withAlpha('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)');
  });

  it('withAlpha_hexDe8Digitos_descartaSuAlfaYUsaElPedido', () => {
    // Manda el alfa del usuario: si no, el ajuste no haria nada sobre un tema que ya trae opacidad.
    expect(withAlpha('#141414ff', 0.7)).toBe('rgba(20, 20, 20, 0.7)');
  });

  it('withAlpha_hexEnMayusculas_funciona', () => {
    expect(withAlpha('#FFFFFF', 1)).toBe('rgba(255, 255, 255, 1)');
  });

  it('withAlpha_conEspaciosAlrededor_losIgnora', () => {
    // `getComputedStyle` devuelve el valor de una custom property con el espacio de delante intacto.
    expect(withAlpha('  #141414  ', 0.5)).toBe('rgba(20, 20, 20, 0.5)');
  });

  it('withAlpha_rgbConComas_conservaLosCanales', () => {
    expect(withAlpha('rgb(20, 30, 40)', 0.8)).toBe('rgba(20, 30, 40, 0.8)');
  });

  it('withAlpha_rgbaExistente_reemplazaElAlfa', () => {
    expect(withAlpha('rgba(20, 30, 40, 0.2)', 0.9)).toBe('rgba(20, 30, 40, 0.9)');
  });

  it('withAlpha_rgbSinComas_tambien', () => {
    // La sintaxis moderna `rgb(20 30 40)` es la que devuelve Chromium en algunos casos.
    expect(withAlpha('rgb(20 30 40)', 0.5)).toBe('rgba(20, 30, 40, 0.5)');
  });

  it('withAlpha_colorConNombre_devuelveNull', () => {
    // No se resuelven nombres: sin DOM no hay tabla de colores, e inventarla seria peor.
    expect(withAlpha('rebeccapurple', 0.5)).toBeNull();
  });

  it('withAlpha_cadenaVacia_devuelveNull', () => {
    // Es el caso REAL: un token que no existe da cadena vacia en `getComputedStyle`.
    expect(withAlpha('', 0.5)).toBeNull();
  });

  it('withAlpha_hexDeLongitudRara_devuelveNull', () => {
    expect(withAlpha('#12345', 0.5)).toBeNull();
  });

  it('withAlpha_alfaFueraDeRango_lanzaConElValor', () => {
    // Contrato de error del repo: el mensaje lleva el valor recibido.
    expect(() => withAlpha('#141414', 1.5)).toThrow(/1\.5/);
    expect(() => withAlpha('#141414', -0.1)).toThrow(/-0\.1/);
    expect(() => withAlpha('#141414', Number.NaN)).toThrow(/NaN/);
  });

  it('withAlpha_alfaEnLosExtremos_esValido', () => {
    expect(withAlpha('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
    expect(withAlpha('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
  });
});
