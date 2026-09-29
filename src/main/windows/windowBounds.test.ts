import { describe, expect, it } from 'vitest';
import { fitSavedBounds, MIN_VISIBLE_PX, WindowBoundsStore, type WindowBoundsStoreDeps } from './windowBounds';

const MIN = { width: 900, height: 600 };
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };

describe('fitSavedBounds', () => {
  it('fitSavedBounds_sinDato_devuelveNull', () => {
    expect(fitSavedBounds(null, [PRIMARY], MIN)).toBeNull();
  });

  it('fitSavedBounds_dentroDeLaPrincipal_losDevuelveIgual', () => {
    const saved = { x: 100, y: 50, width: 1300, height: 900, maximized: false };

    expect(fitSavedBounds(saved, [PRIMARY], MIN)).toEqual(saved);
  });

  it('fitSavedBounds_enElSegundoMonitor_losRestauraAlli', () => {
    const saved = { x: 2100, y: 100, width: 1400, height: 900, maximized: true };

    expect(fitSavedBounds(saved, [PRIMARY, SECOND], MIN)).toEqual(saved);
  });

  it('fitSavedBounds_monitorDesenchufado_devuelveNull', () => {
    const saved = { x: 2100, y: 100, width: 1400, height: 900, maximized: false };

    expect(fitSavedBounds(saved, [PRIMARY], MIN)).toBeNull();
  });

  it('fitSavedBounds_asomaMenosDelMinimo_devuelveNull', () => {
    const saved = { x: PRIMARY.width - MIN_VISIBLE_PX + 1, y: 0, width: 1000, height: 700, maximized: false };

    expect(fitSavedBounds(saved, [PRIMARY], MIN)).toBeNull();
  });

  it('fitSavedBounds_asomaJustoElMinimo_loAcepta', () => {
    const saved = { x: PRIMARY.width - MIN_VISIBLE_PX, y: 0, width: 1000, height: 700, maximized: false };

    expect(fitSavedBounds(saved, [PRIMARY], MIN)).not.toBeNull();
  });

  it('fitSavedBounds_menorQueElMinimo_seAgranda', () => {
    const saved = { x: 10, y: 10, width: 20, height: 20, maximized: false };

    expect(fitSavedBounds(saved, [PRIMARY], MIN)).toEqual({ ...saved, width: 900, height: 600 });
  });

  it('fitSavedBounds_sinPantallas_devuelveNull', () => {
    expect(fitSavedBounds({ x: 0, y: 0, width: 1000, height: 700, maximized: false }, [], MIN)).toBeNull();
  });
});

function memoryDeps(initial: string | null): WindowBoundsStoreDeps & { files: Map<string, string> } {
  const files = new Map<string, string>();
  if (initial !== null) files.set('/u/window-bounds.json', initial);
  return {
    files,
    filePath: '/u/window-bounds.json',
    exists: (path) => files.has(path),
    readFile: (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`no existe ${path}`);
      return content;
    },
    writeFile: (path, data) => files.set(path, data),
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
    tempSuffix: () => 'tmp',
  };
}

describe('WindowBoundsStore', () => {
  const bounds = { x: 1, y: 2, width: 1000, height: 700, maximized: true };

  it('load_sinFichero_devuelveNull', () => {
    expect(new WindowBoundsStore(memoryDeps(null)).load('main')).toBeNull();
  });

  it('save_yLoad_idaYVueltaPorVentana', () => {
    const store = new WindowBoundsStore(memoryDeps(null));

    store.save('main', bounds);
    store.save('w2', { ...bounds, maximized: false });

    expect(store.load('main')).toEqual(bounds);
    expect(store.load('w2')?.maximized).toBe(false);
  });

  it('load_jsonCorrupto_devuelveNull', () => {
    expect(new WindowBoundsStore(memoryDeps('{no')).load('main')).toBeNull();
  });

  it('load_entradaConBasura_seDescartaSinTirarLasDemas', () => {
    const store = new WindowBoundsStore(memoryDeps(JSON.stringify({ main: { x: 'a' }, w2: bounds })));

    expect(store.load('main')).toBeNull();
    expect(store.load('w2')).toEqual(bounds);
  });

  it('load_falloDeLectura_lanzaConLaRuta', () => {
    const deps = { ...memoryDeps('{}'), readFile: () => { throw new Error('EBUSY'); } };

    expect(() => new WindowBoundsStore(deps).load('main')).toThrow(/window-bounds\.json/);
  });

  it('save_boundsInvalidos_lanzaConElValor', () => {
    const store = new WindowBoundsStore(memoryDeps(null));

    expect(() => store.save('main', { ...bounds, width: -1 })).toThrow(/-1/);
  });
});
