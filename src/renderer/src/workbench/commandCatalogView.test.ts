import { describe, expect, it } from 'vitest';
import { filterCommands, groupCommandsByOrigin, SESSION_GROUP } from './commandCatalogView';
import type { SlashCommandInfo } from '@shared/events';

const cmd = (name: string, description = '', aliases: readonly string[] = []): SlashCommandInfo => ({
  name,
  description,
  argumentHint: null,
  aliases,
});

describe('groupCommandsByOrigin', () => {
  it('groupCommandsByOrigin_namespaced_agrupaPorPrefijo', () => {
    const groups = groupCommandsByOrigin([cmd('itb-skills:itb-core'), cmd('itb-skills:itb-listing'), cmd('obsidian:defuddle')]);

    expect(groups.map((g) => g.origin)).toEqual(['itb-skills', 'obsidian']);
    expect(groups[0]?.commands).toHaveLength(2);
  });

  it('groupCommandsByOrigin_sinPrefijo_vaAlGrupoDeLaSesion', () => {
    const groups = groupCommandsByOrigin([cmd('compact'), cmd('itb-skills:itb-core')]);

    expect(groups[0]?.origin).toBe(SESSION_GROUP); // el de la sesion, SIEMPRE primero
    expect(groups[0]?.commands.map((c) => c.name)).toEqual(['compact']);
  });

  it('groupCommandsByOrigin_variosDosPuntos_usaSoloElPrimerSegmento', () => {
    const groups = groupCommandsByOrigin([cmd('itb-skills:itb-core:algo')]);

    expect(groups[0]?.origin).toBe('itb-skills');
  });

  it('groupCommandsByOrigin_dosPuntosAlPrincipio_vaAlGrupoDeLaSesion', () => {
    // `:algo` no tiene prefijo: el segmento anterior esta vacio.
    expect(groupCommandsByOrigin([cmd(':algo')])[0]?.origin).toBe(SESSION_GROUP);
  });

  it('groupCommandsByOrigin_catalogoVacio_devuelveVacio', () => {
    expect(groupCommandsByOrigin([])).toEqual([]);
  });

  it('groupCommandsByOrigin_ordenaLosGruposAlfabeticamenteYLosComandosDentro', () => {
    const groups = groupCommandsByOrigin([cmd('zeta:b'), cmd('alfa:z'), cmd('alfa:a'), cmd('compact')]);

    expect(groups.map((g) => g.origin)).toEqual([SESSION_GROUP, 'alfa', 'zeta']);
    expect(groups[1]?.commands.map((c) => c.name)).toEqual(['alfa:a', 'alfa:z']);
  });
});

describe('filterCommands', () => {
  const catalog = [cmd('compact', 'Compacta la conversación', ['compactar']), cmd('itb-skills:itb-core', 'Librería ITB')];

  it('filterCommands_porNombre', () => {
    expect(filterCommands(catalog, 'itb').map((c) => c.name)).toEqual(['itb-skills:itb-core']);
  });

  it('filterCommands_porDescripcion', () => {
    expect(filterCommands(catalog, 'conversación').map((c) => c.name)).toEqual(['compact']);
  });

  it('filterCommands_porAlias', () => {
    expect(filterCommands(catalog, 'compactar').map((c) => c.name)).toEqual(['compact']);
  });

  it('filterCommands_consultaVacia_devuelveTodo', () => {
    expect(filterCommands(catalog, '   ')).toHaveLength(2);
  });

  it('filterCommands_sinCoincidencias_devuelveVacio', () => {
    expect(filterCommands(catalog, 'zzz')).toEqual([]);
  });
});
