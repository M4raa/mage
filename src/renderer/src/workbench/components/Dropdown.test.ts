import { describe, expect, it } from 'vitest';
import { dropdownMenuPosition } from './Dropdown';

// Rectangulo minimo del trigger: solo se leen left/top/bottom.
function triggerRect(left: number, top: number, height = 20): DOMRect {
  return { left, top, bottom: top + height } as DOMRect;
}

const VIEWPORT = { width: 1000, height: 800 };

describe('dropdownMenuPosition', () => {
  it('dropdownMenuPosition_sinRect_devuelveOrigen', () => {
    expect(dropdownMenuPosition(undefined, 5, VIEWPORT)).toEqual({ left: 0, top: 0 });
  });

  it('dropdownMenuPosition_cabeDebajo_anclaBajoElTrigger', () => {
    const { top } = dropdownMenuPosition(triggerRect(100, 100), 5, VIEWPORT);
    expect(top).toBe(124); // rect.bottom (120) + 4 de separacion
  });

  it('dropdownMenuPosition_noCabeDebajo_vuelcaHaciaArribaAncladoAlTrigger', () => {
    // Trigger pegado al fondo (caso PromptBar): 5 opciones = 150px de menu, no caben debajo.
    const { top } = dropdownMenuPosition(triggerRect(100, 760), 5, VIEWPORT);
    expect(top).toBe(606); // rect.top (760) - 150 - 4
  });

  it('dropdownMenuPosition_menuMasAltoQueLaVentana_seQuedaDentro', () => {
    const { top } = dropdownMenuPosition(triggerRect(100, 40), 60, VIEWPORT);
    expect(top).toBe(8); // margen minimo, nunca negativo
  });

  it('dropdownMenuPosition_triggerPegadoAlBordeDerecho_clampaElLeft', () => {
    const { left } = dropdownMenuPosition(triggerRect(980, 100), 3, VIEWPORT);
    expect(left).toBe(830); // ancho de ventana - ancho del menu
  });
});
