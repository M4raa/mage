import { describe, expect, it } from 'vitest';
import type { DiscoverPluginView, InstalledPluginView } from '@shared/capabilities';
import { categoriesOf, filterDiscover, filterInstalled, parseDiscoverSort, sortDiscover } from './pluginsModel';

const installed = (patch: Partial<InstalledPluginView>): InstalledPluginView => ({
  id: 'a@m',
  name: 'a',
  marketplace: 'm',
  scopes: ['user'],
  version: null,
  enabled: true,
  ...patch,
});

const discover = (patch: Partial<DiscoverPluginView>): DiscoverPluginView => ({
  id: 'a@m',
  name: 'a',
  marketplace: 'm',
  description: '',
  category: null,
  author: null,
  homepage: null,
  installs: null,
  skills: null,
  installed: false,
  ...patch,
});

describe('filterInstalled', () => {
  it('filterInstalled_soloProyecto_losQueNoSonTuyos', () => {
    const plugins = [installed({ name: 'u' }), installed({ name: 'p', scopes: ['project'] })];

    const result = filterInstalled(plugins, '', 'project');

    expect(result.map((p) => p.name)).toEqual(['p']);
  });

  it('filterInstalled_desactivados_soloEsos', () => {
    const plugins = [installed({ name: 'on' }), installed({ name: 'off', enabled: false })];

    expect(filterInstalled(plugins, '', 'disabled').map((p) => p.name)).toEqual(['off']);
  });
});

describe('filterDiscover', () => {
  it('filterDiscover_categoria_soloEsa', () => {
    const plugins = [discover({ name: 'a', category: 'dev' }), discover({ name: 'b', category: 'ops' })];

    expect(filterDiscover(plugins, '', 'ops').map((p) => p.name)).toEqual(['b']);
  });

  it('filterDiscover_textoEnAutor_loEncuentra', () => {
    const plugins = [discover({ name: 'a', author: 'Ana Pérez' }), discover({ name: 'b' })];

    expect(filterDiscover(plugins, 'ANA', '').map((p) => p.name)).toEqual(['a']);
  });
});

describe('sortDiscover', () => {
  it('sortDiscover_instalaciones_sinDatoAlFinal', () => {
    const plugins = [discover({ name: 'z' }), discover({ name: 'b', installs: 3 }), discover({ name: 'a', installs: 900 }), discover({ name: 'c', installs: 0 })];

    expect(sortDiscover(plugins, 'installs').map((p) => p.name)).toEqual(['a', 'b', 'c', 'z']);
  });

  it('sortDiscover_nombre_alfabetico', () => {
    const plugins = [discover({ name: 'b' }), discover({ name: 'a' })];

    expect(sortDiscover(plugins, 'name').map((p) => p.name)).toEqual(['a', 'b']);
  });
});

describe('categoriesOf', () => {
  it('categoriesOf_repetidasYNulas_unicasOrdenadas', () => {
    const plugins = [discover({ category: 'ops' }), discover({ category: null }), discover({ category: 'dev' }), discover({ category: 'ops' })];

    expect(categoriesOf(plugins)).toEqual(['dev', 'ops']);
  });
});

describe('parseDiscoverSort', () => {
  it('parseDiscoverSort_desconocido_installs', () => {
    expect(parseDiscoverSort('raro')).toBe('installs');
  });
});
