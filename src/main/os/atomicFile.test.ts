import { describe, expect, it, vi } from 'vitest';
import {
  describeStaleWrite,
  readSnapshot,
  writeAtomic,
  writeAtomicIfUnchanged,
  type AtomicWriteDeps,
} from './atomicFile';

// FS en memoria con ganchos para simular escrituras concurrentes en el momento exacto.
function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const removed: string[] = [];
  let onBeforeSecondRead: (() => void) | null = null;
  let reads = 0;

  const deps: AtomicWriteDeps = {
    exists: (path) => {
      // El segundo `exists` de writeAtomicIfUnchanged es la revalidacion previa a publicar: ahi es donde
      // se inyecta la escritura ajena para probar la ventana estrecha.
      reads += 1;
      if (reads === 2 && onBeforeSecondRead !== null) {
        const hook = onBeforeSecondRead;
        onBeforeSecondRead = null;
        hook();
      }
      return files.has(path);
    },
    readFile: (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    writeFile: (path, data) => {
      files.set(path, data);
    },
    rename: (from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, content);
    },
    removeFile: (path) => {
      removed.push(path);
      files.delete(path);
    },
    tempSuffix: () => 'suf',
  };

  return {
    deps,
    files,
    removed,
    // Simula que otro proceso escribe el fichero justo antes de que publiquemos.
    interposeWrite: (path: string, content: string) => {
      onBeforeSecondRead = () => files.set(path, content);
    },
    interposeDelete: (path: string) => {
      onBeforeSecondRead = () => files.delete(path);
    },
    // Todo lo que queda en el FS que parezca temporal.
    leftoverTemps: () => [...files.keys()].filter((p) => p.endsWith('.tmp')),
  };
}

describe('readSnapshot', () => {
  it('snapshot_ficheroAusente_devuelveNull', () => {
    const fs = fakeFs();

    expect(readSnapshot(fs.deps, '/data/a.json')).toBeNull();
  });

  // Ausente y vacio son estados DISTINTOS: el CAS de creacion depende de poder distinguirlos.
  it('snapshot_ficheroVacio_noEsLoMismoQueAusente', () => {
    const fs = fakeFs({ '/data/a.json': '' });

    expect(readSnapshot(fs.deps, '/data/a.json')).toBe('');
  });
});

describe('writeAtomic', () => {
  it('write_publicaViaTemporalYNoDejaResiduo', () => {
    const fs = fakeFs();

    writeAtomic(fs.deps, '/data/a.json', '{"x":1}');

    expect(fs.files.get('/data/a.json')).toBe('{"x":1}');
    expect(fs.leftoverTemps()).toEqual([]);
  });

  it('write_pisaSinPreguntar_esElContratoDeEsteMetodo', () => {
    const fs = fakeFs({ '/data/a.json': 'viejo' });

    writeAtomic(fs.deps, '/data/a.json', 'nuevo');

    expect(fs.files.get('/data/a.json')).toBe('nuevo');
  });

  // Sin esto, cada rename fallido dejaba un .tmp huerfano junto al fichero real.
  it('write_renameFalla_limpiaElTemporalYPropagaElError', () => {
    const fs = fakeFs();
    const rename = vi.fn(() => {
      throw new Error('EPERM: fichero en uso');
    });

    expect(() => writeAtomic({ ...fs.deps, rename }, '/data/a.json', 'x')).toThrow(/EPERM/);
    expect(fs.removed).toEqual(['/data/a.json.suf.tmp']);
  });
});

describe('writeAtomicIfUnchanged', () => {
  it('cas_contenidoIntacto_publica', () => {
    const fs = fakeFs({ '/data/a.json': 'v1' });

    const result = writeAtomicIfUnchanged(fs.deps, '/data/a.json', 'v2', 'v1');

    expect(result).toEqual({ status: 'written' });
    expect(fs.files.get('/data/a.json')).toBe('v2');
    expect(fs.leftoverTemps()).toEqual([]);
  });

  // EL caso que el tmp+rename de siempre perdia en silencio.
  it('cas_cambioDebajo_noEscribeNadaYDevuelveLoQueHayAhora', () => {
    const fs = fakeFs({ '/data/a.json': 'lo cambio el CLI' });

    const result = writeAtomicIfUnchanged(fs.deps, '/data/a.json', 'mi version', 'lo que yo lei');

    expect(result).toEqual({ status: 'stale', actual: 'lo cambio el CLI' });
    expect(fs.files.get('/data/a.json')).toBe('lo cambio el CLI'); // intacto
    expect(fs.leftoverTemps()).toEqual([]); // ni siquiera se escribio el temporal
  });

  it('cas_creacionConFicheroAusente_publica', () => {
    const fs = fakeFs();

    const result = writeAtomicIfUnchanged(fs.deps, '/data/a.json', 'nuevo', null);

    expect(result).toEqual({ status: 'written' });
    expect(fs.files.get('/data/a.json')).toBe('nuevo');
  });

  it('cas_creacionPeroYaExiste_esStale', () => {
    const fs = fakeFs({ '/data/a.json': 'me adelante' });

    const result = writeAtomicIfUnchanged(fs.deps, '/data/a.json', 'nuevo', null);

    expect(result).toEqual({ status: 'stale', actual: 'me adelante' });
  });

  it('cas_esperabaContenidoPeroDesaparecio_esStale', () => {
    const fs = fakeFs();

    const result = writeAtomicIfUnchanged(fs.deps, '/data/a.json', 'v2', 'v1');

    expect(result).toEqual({ status: 'stale', actual: null });
  });

  // La revalidacion JUSTO ANTES de publicar: alguien escribe despues de la primera comprobacion y
  // despues de escribirse el temporal. Sin esta segunda lectura, ese cambio se habria pisado.
  it('cas_escrituraAjenaTrasLaPrimeraComprobacion_seDetectaYSeDescartaElTemporal', () => {
    const fs = fakeFs({ '/data/a.json': 'v1' });
    fs.interposeWrite('/data/a.json', 'v1-tocado-por-otro');

    const result = writeAtomicIfUnchanged(fs.deps, '/data/a.json', 'v2', 'v1');

    expect(result).toEqual({ status: 'stale', actual: 'v1-tocado-por-otro' });
    expect(fs.files.get('/data/a.json')).toBe('v1-tocado-por-otro'); // no lo pisamos
    expect(fs.removed).toEqual(['/data/a.json.suf.tmp']);
    expect(fs.leftoverTemps()).toEqual([]);
  });

  it('cas_borradoAjenoTrasLaPrimeraComprobacion_seDetecta', () => {
    const fs = fakeFs({ '/data/a.json': 'v1' });
    fs.interposeDelete('/data/a.json');

    const result = writeAtomicIfUnchanged(fs.deps, '/data/a.json', 'v2', 'v1');

    expect(result).toEqual({ status: 'stale', actual: null });
  });

  it('cas_sinRemoveFile_noRompeAunqueDejeElTemporal', () => {
    const fs = fakeFs({ '/data/a.json': 'v1' });
    const { removeFile: _omitted, ...withoutRemove } = fs.deps;
    fs.interposeWrite('/data/a.json', 'otro');

    const result = writeAtomicIfUnchanged(withoutRemove, '/data/a.json', 'v2', 'v1');

    expect(result.status).toBe('stale');
    expect(fs.leftoverTemps()).toEqual(['/data/a.json.suf.tmp']); // documentado: queda residuo
  });

  it('cas_removeFileFalla_noTapaElResultado', () => {
    const fs = fakeFs({ '/data/a.json': 'v1' });
    const removeFile = () => {
      throw new Error('EBUSY');
    };
    fs.interposeWrite('/data/a.json', 'otro');

    const result = writeAtomicIfUnchanged({ ...fs.deps, removeFile }, '/data/a.json', 'v2', 'v1');

    expect(result.status).toBe('stale');
  });
});

describe('describeStaleWrite', () => {
  it('describe_noFiltraElContenido_soloRutaYTamanos', () => {
    const message = describeStaleWrite('/data/a.json', 'hola', 'un secreto muy largo');

    expect(message).toContain('/data/a.json');
    expect(message).toContain('4 caracteres');
    expect(message).toContain('20 caracteres');
    expect(message).not.toContain('secreto');
  });

  it('describe_ausenciaEnCadaLado_seDiceExplicitamente', () => {
    expect(describeStaleWrite('/a', null, 'x')).toContain('no existia');
    expect(describeStaleWrite('/a', 'x', null)).toContain('ha desaparecido');
  });
});
