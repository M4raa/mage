import { describe, expect, it } from 'vitest';
import { popoverAnchor } from './popoverAnchor';

describe('popoverAnchor', () => {
  const row = { left: 100, right: 700, top: 500, bottom: 560 };

  it('popoverAnchor_caracterEnMedio_encimaDelCaracter', () => {
    expect(popoverAnchor({ left: 340, right: 348, top: 520, bottom: 538 }, row, 300)).toEqual({ left: 240, bottom: 46 });
  });

  it('popoverAnchor_cercaDelBordeDerecho_seRecorta', () => {
    expect(popoverAnchor({ left: 680, right: 688, top: 520, bottom: 538 }, row, 300).left).toBe(300);
  });

  it('popoverAnchor_popoverMasAnchoQueLaFila_pegadoAlaIzquierda', () => {
    expect(popoverAnchor({ left: 400, right: 408, top: 520, bottom: 538 }, row, 900).left).toBe(0);
  });

  it('popoverAnchor_anchoNegativo_lanza', () => {
    expect(() => popoverAnchor({ left: 0, right: 0, top: 0, bottom: 0 }, row, -1)).toThrow(/-1/);
  });
});
