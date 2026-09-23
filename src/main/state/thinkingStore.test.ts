import { describe, expect, it, vi } from 'vitest';
import { COMPACT_AT_BLOCKS, MAX_THINKING_BLOCKS, MAX_THINKING_CHARS, ThinkingBuffer, ThinkingStore } from './thinkingStore';
import type { MageEvent } from '@shared/events';

// Lo que se guarda aqui es lo UNICO que existe: el CLI persiste sus bloques `thinking` vacios (medido),
// asi que si esto pierde un bloque, el texto no esta en ningun otro sitio. Por eso los casos que
// importan son los bordes de la escritura y la tolerancia al leer.

function deps(files: Record<string, string> = {}) {
  const store = { ...files };
  const dirs = new Set<string>();
  return {
    fake: {
      dir: '/data/thinking',
      join: (...parts: readonly string[]) => parts.join('/'),
      exists: (path: string) => path in store || dirs.has(path),
      mkdir: (path: string) => void dirs.add(path),
      appendFile: (path: string, data: string) => {
        store[path] = (store[path] ?? '') + data;
      },
      readFile: (path: string) => store[path] ?? '',
      removeFile: (path: string) => {
        delete store[path];
      },
      writeFile: (path: string, data: string) => {
        store[path] = data;
      },
    },
    store,
  };
}

describe('ThinkingStore', () => {
  // Compactacion al ESCRIBIR (auditoria B.4.1). Antes el tope de 400 era solo de presentacion: el
  // fichero crecia sin limite y se leia entero, con readFileSync y en el main, cada vez que se abria la
  // conversacion.
  it('append_alPasarDelUmbral_dejaElFicheroEnElTopeYNoSigueCreciendo', () => {
    // Arrange
    const { fake, store } = deps();
    const s = new ThinkingStore(fake);

    // Act: uno mas de los que se toleran acumulados.
    for (let i = 0; i < COMPACT_AT_BLOCKS + 1; i += 1) s.append('s', `pensamiento ${i}`);

    // Assert: el FICHERO (no solo lo que devuelve read) se quedo en el tope, con los mas recientes.
    const lines = (store['/data/thinking/s.jsonl'] ?? '').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(MAX_THINKING_BLOCKS);
    expect(JSON.parse(lines[lines.length - 1] ?? '""')).toBe(`pensamiento ${COMPACT_AT_BLOCKS}`);
    expect(s.read('s')[0]).toBe(`pensamiento ${COMPACT_AT_BLOCKS + 1 - MAX_THINKING_BLOCKS}`);
  });

  it('append_pordebajoDelUmbral_noReescribeElFichero', () => {
    // Arrange: un `writeFile` que lanza delata cualquier compactacion que no toque.
    const { fake, store } = deps();
    const s = new ThinkingStore({ ...fake, writeFile: () => { throw new Error('no deberia compactar'); } });

    // Act
    for (let i = 0; i < COMPACT_AT_BLOCKS; i += 1) s.append('s', `p${i}`);

    // Assert: se mira el FICHERO, no `read()`, que recorta a MAX_THINKING_BLOCKS al servir.
    const lines = (store['/data/thinking/s.jsonl'] ?? '').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(COMPACT_AT_BLOCKS);
  });

  it('append_sobreUnFicheroYaCrecido_loCompactaSinConocerLaCuentaPrevia', () => {
    // Arrange: proceso recien arrancado (mapa de cuentas vacio) sobre un .jsonl heredado enorme.
    const heredado = Array.from({ length: COMPACT_AT_BLOCKS + 50 }, (_, i) => JSON.stringify(`viejo ${i}`)).join('\n') + '\n';
    const { fake, store } = deps({ '/data/thinking/s.jsonl': heredado });
    const s = new ThinkingStore(fake);

    // Act
    s.append('s', 'nuevo');

    // Assert
    const lines = (store['/data/thinking/s.jsonl'] ?? '').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(MAX_THINKING_BLOCKS);
    expect(JSON.parse(lines[lines.length - 1] ?? '""')).toBe('nuevo');
  });

  it('append_yLuegoRead_devuelveLosTextosEnOrden', () => {
    const { fake } = deps();
    const s = new ThinkingStore(fake);

    s.append('sesion-1', 'primero');
    s.append('sesion-1', 'segundo');

    expect(s.read('sesion-1')).toEqual(['primero', 'segundo']);
  });

  it('append_textoVacioODeSoloEspacios_noGuardaNada', () => {
    // Un bloque sin texto no aporta y ademas DESCUADRARIA la correspondencia por orden con los bloques
    // vacios de la transcripcion, que es lo unico que los empareja.
    const { fake } = deps();
    const s = new ThinkingStore(fake);

    s.append('sesion-1', '');
    s.append('sesion-1', '   \n  ');

    expect(s.read('sesion-1')).toEqual([]);
  });

  it('append_conSaltosDeLineaYComillas_sobreviveALaIdaYVuelta', () => {
    // Se guarda una linea por bloque, asi que un texto con saltos tiene que ir escapado o partiria el
    // fichero en dos entradas.
    const { fake } = deps();
    const s = new ThinkingStore(fake);
    const texto = 'linea 1\nlinea 2 con "comillas" y \\barra';

    s.append('sesion-1', texto);

    expect(s.read('sesion-1')).toEqual([texto]);
  });

  it('append_textoEnorme_seRecortaAlTope', () => {
    const { fake } = deps();
    const s = new ThinkingStore(fake);

    s.append('sesion-1', 'x'.repeat(MAX_THINKING_CHARS + 5000));

    const [guardado] = s.read('sesion-1');
    expect(guardado?.length).toBe(MAX_THINKING_CHARS + 1); // el recorte + la elipsis
    expect(guardado?.endsWith('…')).toBe(true);
  });

  it('append_sessionIdVacio_lanzaConElValor', () => {
    const { fake } = deps();

    expect(() => new ThinkingStore(fake).append('', 'algo')).toThrow(/""/);
  });

  it('append_sessionIdConBarrasOPuntos_noSeSaleDelDirectorio', () => {
    // El id viene de fuera: aunque el CLI mande un UUID, esto es una ruta y se sanea.
    const { fake, store } = deps();

    new ThinkingStore(fake).append('../../etc/passwd', 'algo');

    expect(Object.keys(store)).toEqual(['/data/thinking/______etc_passwd.jsonl']);
  });

  it('read_sinFichero_devuelveVacio', () => {
    // Conversacion anterior a esto, o sin ningun pensamiento: el bloque se queda como estaba.
    const { fake } = deps();

    expect(new ThinkingStore(fake).read('sesion-nueva')).toEqual([]);
  });

  it('read_conUnaLineaAMedioEscribir_devuelveLasDemas', () => {
    // Escribir es append: la unica linea que puede quedar rota es la ultima, y perderla no puede
    // llevarse por delante las anteriores.
    const { fake } = deps({ '/data/thinking/s.jsonl': '"bueno"\n"tambien bueno"\n{"roto' });

    expect(new ThinkingStore(fake).read('s')).toEqual(['bueno', 'tambien bueno']);
  });

  it('read_conMasBloquesQueElTope_devuelveLosMASRECIENTES', () => {
    // Al reanudar interesa lo ultimo que penso el agente, no lo de hace doscientos turnos.
    const lines = Array.from({ length: MAX_THINKING_BLOCKS + 10 }, (_, i) => JSON.stringify(`p${i}`)).join('\n');
    const { fake } = deps({ '/data/thinking/s.jsonl': lines });

    const leidos = new ThinkingStore(fake).read('s');

    expect(leidos).toHaveLength(MAX_THINKING_BLOCKS);
    expect(leidos[leidos.length - 1]).toBe(`p${MAX_THINKING_BLOCKS + 9}`);
  });

  it('forget_borraElFicheroDeEsaConversacion', () => {
    const { fake, store } = deps();
    const s = new ThinkingStore(fake);
    s.append('s1', 'algo');

    s.forget('s1');

    expect(store['/data/thinking/s1.jsonl']).toBeUndefined();
    expect(s.read('s1')).toEqual([]);
  });

  it('forget_sinFichero_noLanza', () => {
    const { fake } = deps();
    const remove = vi.fn();

    expect(() => new ThinkingStore({ ...fake, removeFile: remove }).forget('no-existe')).not.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
});

const delta = (text: string): MageEvent => ({ kind: 'thinking_delta', text });
const otro: MageEvent = { kind: 'stream_delta', text: 'respuesta' };

describe('ThinkingBuffer', () => {
  it('accept_variosDeltas_noCierraHastaQueLlegaOtroEvento', () => {
    // El CLI no marca el final de un bloque de pensamiento: el cierre se deduce.
    const b = new ThinkingBuffer();

    expect(b.accept(delta('pien'))).toBeNull();
    expect(b.accept(delta('sando'))).toBeNull();
    expect(b.accept(otro)).toBe('piensando');
  });

  it('accept_dosBloquesSeguidos_noSeMezclan', () => {
    const b = new ThinkingBuffer();
    b.accept(delta('uno'));
    b.accept(otro);

    b.accept(delta('dos'));

    expect(b.accept(otro)).toBe('dos');
  });

  it('accept_eventoQueNoEsPensamientoSinNadaAcumulado_devuelveNull', () => {
    // Sin esto, cada evento de un turno sin pensamiento guardaria una cadena vacia.
    expect(new ThinkingBuffer().accept(otro)).toBeNull();
  });

  it('flush_conBloqueAbierto_loDevuelveYLoVacia', () => {
    // El ultimo bloque de una sesion puede no tener ningun evento detras.
    const b = new ThinkingBuffer();
    b.accept(delta('lo ultimo'));

    expect(b.flush()).toBe('lo ultimo');
    expect(b.flush()).toBeNull();
  });
});
