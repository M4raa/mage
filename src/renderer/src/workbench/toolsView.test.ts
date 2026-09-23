import { describe, expect, it } from 'vitest';
import { BUILTIN_GROUP, filterTools, groupToolsByOrigin, mcpServerOf } from './toolsView';

// La lista llega del CLI tal cual y se agrupa por lo unico que hay: el nombre. Los casos que importan
// son los bordes del prefijo `mcp__`, porque de ahi sale la cabecera de cada grupo.

describe('mcpServerOf', () => {
  it('mcpServerOf_herramientaDeMcp_devuelveElServidor', () => {
    expect(mcpServerOf('mcp__database__run_query')).toBe('database');
  });

  it('mcpServerOf_nombreDeHerramientaConGuionesBajosDobles_seQuedaConElPrimerCorte', () => {
    // El nombre de la herramienta puede traer `__` dentro; el servidor es lo que hay hasta el PRIMERO.
    expect(mcpServerOf('mcp__chrome-devtools__take__snapshot')).toBe('chrome-devtools');
  });

  it('mcpServerOf_herramientaNativa_devuelveNull', () => {
    expect(mcpServerOf('Read')).toBeNull();
    expect(mcpServerOf('Bash')).toBeNull();
  });

  it('mcpServerOf_prefijoSinServidor_devuelveNull', () => {
    // `mcp__` a secas o `mcp____x` no nombran ningun servidor: mejor tratarlas como nativas que abrir
    // un grupo con cabecera en blanco.
    expect(mcpServerOf('mcp__')).toBeNull();
    expect(mcpServerOf('mcp____herramienta')).toBeNull();
  });

  it('mcpServerOf_servidorSinHerramienta_devuelveNull', () => {
    expect(mcpServerOf('mcp__database')).toBeNull();
  });
});

describe('groupToolsByOrigin', () => {
  it('groupToolsByOrigin_mezcla_poneLasNativasPrimeroYLosServidoresEnAlfabetico', () => {
    const grupos = groupToolsByOrigin(['mcp__playwright__click', 'Read', 'mcp__database__run_query', 'Bash']);

    expect(grupos.map((g) => g.origin)).toEqual([BUILTIN_GROUP, 'database', 'playwright']);
  });

  it('groupToolsByOrigin_dentroDeUnGrupo_ordenaPorNombre', () => {
    const grupos = groupToolsByOrigin(['Write', 'Bash', 'Read']);

    expect(grupos[0]?.tools.map((t) => t.label)).toEqual(['Bash', 'Read', 'Write']);
  });

  it('groupToolsByOrigin_herramientaDeMcp_guardaElNombreCompletoYUnaEtiquetaCorta', () => {
    // El nombre completo es lo que se copia para una regla de permisos; la etiqueta es solo para pintar.
    const [grupo] = groupToolsByOrigin(['mcp__database__run_query']);

    expect(grupo?.tools[0]).toEqual({ name: 'mcp__database__run_query', label: 'run_query' });
  });

  it('groupToolsByOrigin_ordenDeLlegadaDistinto_mismoResultado', () => {
    // Estabilidad: la lista no puede bailar entre sesiones con los mismos datos.
    const a = groupToolsByOrigin(['mcp__b__x', 'Read', 'mcp__a__y']);
    const b = groupToolsByOrigin(['mcp__a__y', 'mcp__b__x', 'Read']);

    expect(a).toEqual(b);
  });

  it('groupToolsByOrigin_listaVacia_devuelveVacio', () => {
    expect(groupToolsByOrigin([])).toEqual([]);
  });
});

describe('filterTools', () => {
  it('filterTools_porNombreDeServidor_encuentraSusHerramientas', () => {
    // El caso real: se recuerda el servidor, no el nombre exacto de la herramienta.
    expect(filterTools(['mcp__database__run_query', 'Read'], 'datab')).toEqual(['mcp__database__run_query']);
  });

  it('filterTools_sinDistinguirMayusculas', () => {
    expect(filterTools(['Read', 'Bash'], 'reAD')).toEqual(['Read']);
  });

  it('filterTools_consultaVacia_devuelveTodo', () => {
    const tools = ['Read', 'Bash'];

    expect(filterTools(tools, '   ')).toBe(tools);
  });

  it('filterTools_sinCoincidencias_devuelveVacio', () => {
    expect(filterTools(['Read'], 'zzz')).toEqual([]);
  });
});
