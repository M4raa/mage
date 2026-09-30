import { describe, expect, it } from 'vitest';
import { resolveDropTarget, type WindowRect } from './dropTarget';

const MAIN: WindowRect = { windowId: 'main', bounds: { x: 0, y: 0, width: 1000, height: 800 } };
const W2: WindowRect = { windowId: 'w2', bounds: { x: 1200, y: 0, width: 800, height: 600 } };

describe('resolveDropTarget', () => {
  it('resolveDropTarget_dentroDeLaPropia_self', () => {
    expect(resolveDropTarget({ x: 500, y: 400 }, [MAIN, W2], 'main')).toEqual({ kind: 'self' });
  });

  it('resolveDropTarget_sobreOtraVentana_laDevuelve', () => {
    expect(resolveDropTarget({ x: 1300, y: 100 }, [MAIN, W2], 'main')).toEqual({ kind: 'window', windowId: 'w2' });
  });

  it('resolveDropTarget_fueraDeTodas_outside', () => {
    expect(resolveDropTarget({ x: 1100, y: 100 }, [MAIN, W2], 'main')).toEqual({ kind: 'outside' });
  });

  it('resolveDropTarget_bordeDerechoExcluido_outside', () => {
    expect(resolveDropTarget({ x: 1000, y: 10 }, [MAIN], 'main')).toEqual({ kind: 'outside' });
  });

  it('resolveDropTarget_solapeConLaPropia_ganaLaPropia', () => {
    const encima: WindowRect = { windowId: 'w2', bounds: { x: 400, y: 300, width: 800, height: 600 } };

    expect(resolveDropTarget({ x: 500, y: 400 }, [MAIN, encima], 'main')).toEqual({ kind: 'self' });
  });

  it('resolveDropTarget_sinVentanas_outside', () => {
    expect(resolveDropTarget({ x: 0, y: 0 }, [], 'main')).toEqual({ kind: 'outside' });
  });
});
