import { describe, expect, it } from 'vitest';
import { TOOL_CLASS_GLYPH, type ToolClass } from './toolClassify';
import { describeRun, groupChatRows } from './toolGrouping';
import type { Block } from './types';

// Fabrica una caja de tool ya TERMINADA (con `meta`): una tool en curso no agrupa, y eso tiene su
// propio test.
function tool(id: string, toolClass: ToolClass, over: Partial<Extract<Block, { kind: 'tool' }>> = {}): Block {
  return {
    kind: 'tool',
    id,
    toolUseId: `u-${id}`,
    tool: toolClass === 'read' ? 'Read' : toolClass === 'search' ? 'Grep' : 'Bash',
    toolClass,
    command: 'algo',
    meta: 'ok',
    isError: false,
    output: [],
    filePath: null,
    diff: null,
    writtenContent: null,
    artifact: null,
    artifactDraft: null,
    ...over,
  };
}

const agent = (id: string): Block => ({ kind: 'agent', id, runs: [{ code: false, text: 'texto' }], streaming: false });
const user = (id: string): Block => ({ kind: 'user', id, text: 'hola', time: '', attachments: [] });

// Pensamiento ya TERMINADO: como una tool en curso, uno que se esta escribiendo no agrupa.
function pensamiento(id: string, streaming = false): Block {
  return { kind: 'thinking', id, runs: [{ code: false, text: 'mmm' }], streaming, elapsedMs: 120 };
}

describe('groupChatRows', () => {
  it('groupChatRows_dosLecturasSeguidas_formanUnaRacha', () => {
    const rows = groupChatRows([tool('a', 'read'), tool('b', 'read')]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'run', summary: 'Leídos 2 ficheros' });
  });

  it('groupChatRows_unaSolaLectura_noFormaRacha', () => {
    const rows = groupChatRows([tool('a', 'read')]);

    expect(rows).toEqual([{ kind: 'block', block: expect.objectContaining({ id: 'a' }) }]);
  });

  it('groupChatRows_textoDelAgenteEnMedio_parteLaRacha', () => {
    // Decision §0.1-b, literal: un resumen NUNCA salta por encima de un parrafo del agente.
    const rows = groupChatRows([tool('a', 'read'), agent('x'), tool('b', 'read')]);

    expect(rows.map((r) => r.kind)).toEqual(['block', 'block', 'block']);
  });

  // CAMBIO DE PRODUCTO (2026-09-18, peticion del usuario): la CLASE ya no parte la racha. Antes una
  // edicion en medio dejaba tres filas; ahora todo lo que el agente hizo se pliega a una, porque un
  // turno de veinte acciones seguia empujando la respuesta fuera de la pantalla — que es justo lo que
  // la racha venia a evitar.
  it('groupChatRows_edicionEnMedio_yaNoParteLaRacha', () => {
    const rows = groupChatRows([tool('a', 'read'), tool('b', 'read'), tool('e', 'edit'), tool('c', 'read'), tool('d', 'read')]);

    expect(rows.map((r) => r.kind)).toEqual(['run']);
  });

  it('groupChatRows_lecturaConError_noEntraEnLaRacha', () => {
    // Un fallo NUNCA se esconde en un resumen, sea de la clase que sea.
    const rows = groupChatRows([tool('a', 'read'), tool('b', 'read', { isError: true, meta: 'error' }), tool('c', 'read')]);

    expect(rows.map((r) => r.kind)).toEqual(['block', 'block', 'block']);
  });

  it('groupChatRows_lecturaEnCurso_noEntraEnLaRacha', () => {
    // Sin `meta` la tool sigue corriendo: mientras no se sabe como acaba, se ve.
    const rows = groupChatRows([tool('a', 'read'), tool('b', 'read', { meta: '' })]);

    expect(rows.map((r) => r.kind)).toEqual(['block', 'block']);
  });

  it('groupChatRows_bashEntreDosLecturas_yaNoParteLaRacha', () => {
    const rows = groupChatRows([tool('a', 'read'), tool('b', 'command'), tool('c', 'read')]);

    expect(rows.map((r) => r.kind)).toEqual(['run']);
  });

  // EL MOMENTO de agrupar, que es la otra mitad del cambio: mientras el agente trabaja se ve cada
  // accion aparecer; cuando termina, se pliegan. Sin esto, lo que estaba haciendo desaparecia de la
  // vista justo mientras lo hacia.
  it('turnoVivo_laUltimaRachaSeQuedaAbierta', () => {
    const rows = groupChatRows([tool('a', 'read'), tool('b', 'read'), tool('c', 'read')], true);

    expect(rows.map((r) => r.kind)).toEqual(['block', 'block', 'block']);
  });

  it('turnoVivo_lasRachasANTERIORESsiSePliegan', () => {
    // El agente ya paso de la primera: se pliega. La del final sigue llenandose y se queda abierta.
    const rows = groupChatRows([tool('a', 'read'), tool('b', 'read'), agent('x'), tool('c', 'read'), tool('d', 'read')], true);

    expect(rows.map((r) => r.kind)).toEqual(['run', 'block', 'block', 'block']);
  });

  it('turnoTerminado_laUltimaRachaSePliega', () => {
    const rows = groupChatRows([tool('a', 'read'), tool('b', 'read'), tool('c', 'read')], false);

    expect(rows.map((r) => r.kind)).toEqual(['run']);
  });

  it('groupChatRows_rachaAlFinalDelHilo_seCierra', () => {
    const rows = groupChatRows([agent('x'), tool('a', 'search'), tool('b', 'search')]);

    expect(rows.map((r) => r.kind)).toEqual(['block', 'run']);
    expect(rows[1]).toMatchObject({ summary: '2 búsquedas' });
  });

  it('groupChatRows_hiloVacio_devuelveVacio', () => {
    expect(groupChatRows([])).toEqual([]);
  });

  it('groupChatRows_soloBloquesNoAgrupables_devuelveUnaFilaPorBloque', () => {
    const rows = groupChatRows([user('u'), agent('a'), tool('e', 'edit')]);

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.kind === 'block')).toBe(true);
  });

  it('groupChatRows_conservaElOrdenOriginal', () => {
    // Es lo que garantiza que un resumen no aparezca antes del texto que lo motivo.
    const blocks = [user('u'), tool('a', 'read'), tool('b', 'search'), agent('x'), tool('c', 'edit')];

    const ids = groupChatRows(blocks).flatMap((row) => (row.kind === 'run' ? row.blocks.map((b) => b.id) : [row.block.id]));

    expect(ids).toEqual(['u', 'a', 'b', 'x', 'c']);
  });

  it('groupChatRows_rachaMixta_resumeLasDosClases', () => {
    const rows = groupChatRows([tool('a', 'read'), tool('b', 'read'), tool('c', 'search')]);

    expect(rows[0]).toMatchObject({ kind: 'run', summary: 'Leídos 2 ficheros, 1 búsqueda' });
  });
});

describe('describeRun', () => {
  it('describeRun_dosLecturas_diceLeidos2Ficheros', () => {
    expect(describeRun(new Map([['read', 2]]))).toBe('Leídos 2 ficheros');
  });

  it('describeRun_unaLectura_singular', () => {
    expect(describeRun(new Map([['read', 1]]))).toBe('Leído 1 fichero');
    expect(describeRun(new Map([['search', 1]]))).toBe('1 búsqueda');
  });

  it('describeRun_lecturasYBusquedas_lasListaEnOrdenFijo', () => {
    // Orden FIJO (lecturas antes que busquedas): si dependiera del orden de llegada, el resumen bailaria
    // entre renders con los mismos datos.
    expect(describeRun(new Map([['search', 3], ['read', 1]]))).toBe('Leído 1 fichero, 3 búsquedas');
  });

  it('describeRun_ceroDeTodo_lanza', () => {
    expect(() => describeRun(new Map())).toThrow(/racha sin herramientas/i);
  });
});

// Al pasar a agrupar TODAS las clases, una racha de solo ediciones dejaba `describeRun` sin partes y
// lanzaba — y como corre dentro del `useMemo` de `BlockChat`, el chat ENTERO dejaba de pintarse. Lo
// cazó `pnpm verify:gui` y no un test, así que aquí queda el test: toda clase agrupable necesita su
// etiqueta, y la forma de no volver a olvidarse es recorrerlas todas.
describe('describeRun cubre todas las clases agrupables', () => {
  // Las clases se sacan de `TOOL_CLASS_GLYPH`, que es un `Record<ToolClass, string>` y por tanto el
  // compilador obliga a que esten TODAS. Enumerarlas a mano aqui fue justo el fallo: la lista se
  // quedo corta y el test paso mientras la app se caia.
  const CLASES = Object.keys(TOOL_CLASS_GLYPH) as readonly ToolClass[];

  it('cadaClase_tieneResumenEnSingularYEnPlural', () => {
    for (const toolClass of CLASES) {
      expect(() => describeRun(new Map([[toolClass, 1]])), toolClass).not.toThrow();
      expect(() => describeRun(new Map([[toolClass, 3]])), toolClass).not.toThrow();
      expect(describeRun(new Map([[toolClass, 3]])), toolClass).toContain('3');
    }
  });

  it('todaClaseAgrupable_tieneEtiqueta_ningunaRachaPuedeQuedarseSinResumen', () => {
    // El invariante de verdad: si una clase agrupa, describe. Comprobado por la puerta de entrada
    // (`groupChatRows`) y no solo por `describeRun`, que es donde se rompio.
    for (const toolClass of CLASES) {
      const rows = groupChatRows([tool('a', toolClass), tool('b', toolClass)]);

      expect(rows, toolClass).toHaveLength(1);
      expect(rows[0], toolClass).toMatchObject({ kind: 'run' });
    }
  });

  // 2.4: la tarjeta de un artifact publicado es el ENTREGABLE del turno. Plegarla dentro de un
  // "3 acciones" la hacia desaparecer, y lo caza `verify:gui` con `artifactDentroDeUnaRacha`.
  it('artifactPublicado_noSeEscondeEnLaRacha', () => {
    const publicado = tool('p', 'edit', {
      artifact: { title: 'Informe', description: '', favicon: '📊', localPath: 'C:\tmp\a.html', url: 'https://claude.ai/artifact/x' },
    });

    const rows = groupChatRows([tool('a', 'edit'), publicado, tool('b', 'edit')]);

    expect(rows.map((r) => r.kind)).toEqual(['block', 'block', 'block']);
  });

  it('rachaDeSoloEdiciones_seResume', () => {
    const rows = groupChatRows([tool('a', 'edit'), tool('b', 'edit')]);

    expect(rows.map((r) => r.kind)).toEqual(['run']);
    expect(rows[0]).toMatchObject({ summary: '2 ediciones' });
  });

  // 2026-09-18: el pensamiento partia la racha en tres lineas («Bash», «Pensó», «3 comandos») cuando
  // para quien lee es lo mismo: lo que el agente hizo mientras trabajaba.
  it('pensamientoEntreComandos_seAgrupaConEllos', () => {
    const rows = groupChatRows([tool('a', 'command'), pensamiento('t1'), tool('b', 'command')]);

    expect(rows.map((r) => r.kind)).toEqual(['run']);
    expect(rows[0]).toMatchObject({ summary: '1 pensamiento, 2 comandos' });
  });

  it('pensamientoEnStreaming_noSeAgrupa', () => {
    const rows = groupChatRows([tool('a', 'command'), pensamiento('t1', true), tool('b', 'command')]);

    expect(rows.map((r) => r.kind)).toEqual(['block', 'block', 'block']);
  });
});
