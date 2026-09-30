import { describe, expect, it } from 'vitest';
import {
  buildSlashCatalog,
  completionFor,
  filterSlashCommands,
  SLASH_COMMANDS,
  SLASH_SUGGESTION_LIMIT,
  type SlashCommand,
} from './slashCommands';

describe('filterSlashCommands', () => {
  it('textoNormal_devuelveVacio', () => {
    expect(filterSlashCommands('hola')).toEqual([]);
    expect(filterSlashCommands('')).toEqual([]);
  });

  it('soloBarra_devuelveLosPrimerosHastaElTope', () => {
    expect(filterSlashCommands('/')).toHaveLength(SLASH_SUGGESTION_LIMIT);
  });

  it('prefijo_filtraPorInicioDeNombre', () => {
    const result = filterSlashCommands('/comp');

    expect(result.map((c) => c.name)).toEqual(['compact']);
  });

  it('unaLetra_ofreceTodosLosQueEmpiezanPorElla', () => {
    // Caso reportado en la verificacion GUI (D6): "/m" no ofrecia /mcp.
    const names = filterSlashCommands('/m').map((c) => c.name);

    expect(names).toContain('mcp');
    expect(names).toContain('model');
  });

  it('listaDeRespaldo_noOfreceLosComandosSoloDeLaTui', () => {
    // Encontrado por `pnpm verify:gui` el 2026-08-12: D4 quito los 6 comandos de la TUI del catalogo de
    // la SESION, pero la lista de respaldo (la que se usa mientras no hay sesion viva, o sea en toda
    // conversacion recien abierta, porque `ensureSession` es perezoso) los seguia ofreciendo.
    const names = filterSlashCommands('/').map((c) => c.name);
    const everything = SLASH_COMMANDS.map((c) => c.name);

    for (const tuiOnly of ['help', 'hooks', 'memory', 'permissions', 'status']) {
      expect(everything).not.toContain(tuiOnly);
      expect(names).not.toContain(tuiOnly);
    }
  });

  it('coincidenciaPorDentro_vaDespuesDeLosPrefijos', () => {
    const names = filterSlashCommands('/re').map((c) => c.name);

    expect(names).toEqual(['rename', 'security-review']);
  });

  it('insensibleAMayusculas', () => {
    expect(filterSlashCommands('/CLE').map((c) => c.name)).toEqual(['clear']);
  });

  it('conArgumento_noSugiere', () => {
    expect(filterSlashCommands('/compact ahora')).toEqual([]);
  });

  it('prefijoSinCoincidencias_devuelveVacio', () => {
    expect(filterSlashCommands('/zzz')).toEqual([]);
  });

  it('nuncaExcedeElTopeDeSugerencias', () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThan(SLASH_SUGGESTION_LIMIT);
    expect(filterSlashCommands('/e').length).toBeLessThanOrEqual(SLASH_SUGGESTION_LIMIT);
  });
});

describe('completionFor', () => {
  it('devuelveBarraNombreYEspacio', () => {
    expect(completionFor({ name: 'compact', description: 'x' })).toBe('/compact ');
  });
});

describe('buildSlashCatalog (D4)', () => {
  // Los nombres del `session_init` llegan sin descripcion; las descripciones vienen luego del
  // `initialize` (D2). Este helper simula el primer caso.
  function named(...names: readonly string[]): readonly SlashCommand[] {
    return names.map((name) => ({ name, description: '' }));
  }

  it('buildSlashCatalog_sesionSinComandos_caeALaListaCurada', () => {
    // Mientras no llega el session_init (o un proveedor que no los reporta) mejor un autocompletado
    // aproximado que ninguno.
    expect(buildSlashCatalog([])).toBe(SLASH_COMMANDS);
  });

  it('buildSlashCatalog_comandoCuradoSinDescripcionDelCli_reutilizaLaCurada', () => {
    const catalog = buildSlashCatalog(named('compact'));

    expect(catalog).toEqual([{ name: 'compact', description: 'Compacta el contexto de la conversación', argumentHint: null, aliases: [] }]);
  });

  it('buildSlashCatalog_descripcionDelCli_ganaSobreLaCurada', () => {
    // La respuesta al `initialize` trae descripciones reales: son mas fiables que las nuestras.
    const catalog = buildSlashCatalog([{ name: 'compact', description: 'Compact the conversation' }]);

    expect(catalog).toEqual([{ name: 'compact', description: 'Compact the conversation', argumentHint: null, aliases: [] }]);
  });

  it('buildSlashCatalog_comandoDescubierto_describeSuOrigen', () => {
    const catalog = buildSlashCatalog(named('recap', 'itb-skills:itb-core'));

    expect(catalog.find((c) => c.name === 'recap')?.description).toBe('Comando propio de esta sesión');
    expect(catalog.find((c) => c.name === 'itb-skills:itb-core')?.description).toBe(
      'Comando de un plugin o skill',
    );
  });

  it('buildSlashCatalog_curadoQueLaSesionNoOfrece_seDescarta', () => {
    // Los 6 curados que el CLI headless NO tiene (cost/help/hooks/memory/permissions/status) no deben
    // ofrecerse: al enviarlos, el modelo los recibe como texto y responde a un prompt "/status".
    const catalog = buildSlashCatalog(named('compact', 'model'));

    expect(catalog.map((c) => c.name)).toEqual(['compact', 'model']);
    expect(catalog.some((c) => c.name === 'status')).toBe(false);
  });

  it('buildSlashCatalog_normalizaBarrasEspaciosYDuplicados', () => {
    const catalog = buildSlashCatalog(named('/compact', ' compact ', '', '   ', 'model'));

    expect(catalog.map((c) => c.name)).toEqual(['compact', 'model']);
  });

  it('buildSlashCatalog_duplicadoConDescripcion_seQuedaLaUltima', () => {
    const catalog = buildSlashCatalog([
      { name: 'compact', description: '' },
      { name: 'compact', description: 'del CLI' },
    ]);

    expect(catalog).toEqual([{ name: 'compact', description: 'del CLI', argumentHint: null, aliases: [] }]);
  });

  it('buildSlashCatalog_ordenaAlfabeticamente', () => {
    const catalog = buildSlashCatalog(named('zzz', 'compact', 'agents'));

    expect(catalog.map((c) => c.name)).toEqual(['agents', 'compact', 'zzz']);
  });

  it('buildSlashCatalog_listaRealDelCli_seFiltraConNombresNamespaced', () => {
    // Muestra LITERAL del stream del CLI 2.1.220.
    const catalog = buildSlashCatalog(named('caveman', 'itb-skills:itb-core', 'compact', 'code-review', 'context'));

    const names = filterSlashCommands('/co', catalog).map((c) => c.name);
    expect(names).toContain('code-review');
    expect(names).toContain('compact');
    expect(names).toContain('context');
    expect(filterSlashCommands('/itb', catalog).map((c) => c.name)).toEqual(['itb-skills:itb-core']);
  });
});

describe('filterSlashCommands con catalogo de sesion', () => {
  it('filterSlashCommands_catalogoExplicito_ignoraLaListaCurada', () => {
    const catalog = buildSlashCatalog([{ name: 'deploy', description: '' }]);

    expect(filterSlashCommands('/comp', catalog)).toEqual([]);
    expect(filterSlashCommands('/dep', catalog).map((c) => c.name)).toEqual(['deploy']);
  });

  it('filterSlashCommands_catalogoConMayusculas_sigueSiendoInsensible', () => {
    const catalog = buildSlashCatalog([{ name: 'Recap', description: '' }]);

    expect(filterSlashCommands('/rec', catalog).map((c) => c.name)).toEqual(['Recap']);
  });
});

// --- 2.2: pista de argumento y alias -------------------------------------------------------------

describe('buildSlashCatalog / filterSlashCommands — argumentHint y aliases', () => {
  const withHints = [
    { name: 'compact', description: 'Compacta', argumentHint: '[foco]', aliases: ['c', 'compactar'] },
    { name: 'itb-skills:itb-core', description: '', argumentHint: null, aliases: [] },
  ];

  it('buildSlashCatalog_conservaArgumentHintYAliases', () => {
    const catalog = buildSlashCatalog(withHints);

    expect(catalog[0]).toEqual({
      name: 'compact',
      description: 'Compacta',
      argumentHint: '[foco]',
      aliases: ['c', 'compactar'],
    });
  });

  it('buildSlashCatalog_argumentHintVacio_quedaEnNull', () => {
    // Medido: la mayoria de los comandos traen `argumentHint: ''`. Pintar una cadena vacia deja un
    // hueco raro en el popover; `null` es "no hay pista".
    const catalog = buildSlashCatalog([{ name: 'recap', description: 'x', argumentHint: '', aliases: [] }]);

    expect(catalog[0]?.argumentHint).toBeNull();
  });

  it('buildSlashCatalog_aliasIgualAlNombre_seDescarta', () => {
    const catalog = buildSlashCatalog([{ name: 'compact', description: 'x', aliases: ['compact', 'c', 'c'] }]);

    expect(catalog[0]?.aliases).toEqual(['c']);
  });

  it('filterSlashCommands_casaPorAlias', () => {
    const catalog = buildSlashCatalog(withHints);

    expect(filterSlashCommands('/compactar', catalog).map((c) => c.name)).toEqual(['compact']);
  });

  it('filterSlashCommands_aliasYNombreDelMismoComando_noLoDuplica', () => {
    const catalog = buildSlashCatalog([{ name: 'compact', description: 'x', aliases: ['compactar'] }]);

    expect(filterSlashCommands('/compact', catalog).map((c) => c.name)).toEqual(['compact']);
  });

  it('buildSlashCatalog_cacheEnDiscoSinSesion_seUsaLaCache', () => {
    // La cache es lo que el PromptBar pasa cuando la sesion aun no ha reportado nada (`ensureSession`
    // es perezoso). Aqui se comprueba que el catalogo sale de lo que se le pase, no de la lista curada.
    const cached = [{ name: 'itb-skills:itb-core', description: 'De un plugin', argumentHint: null, aliases: [] }];

    expect(buildSlashCatalog(cached).map((c) => c.name)).toEqual(['itb-skills:itb-core']);
  });

  it('buildSlashCatalog_sinNada_caeALaListaCurada', () => {
    expect(buildSlashCatalog([])).toBe(SLASH_COMMANDS);
  });
});
