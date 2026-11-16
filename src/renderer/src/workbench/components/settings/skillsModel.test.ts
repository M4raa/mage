import { describe, expect, it } from 'vitest';
import type { SlashCommandInfo } from '@shared/events';
import type { InstalledPluginView } from '@shared/capabilities';
import { classifySkill, classifySkills, filterSkills, parseSkillFilter, sortSkills, type SkillEntry } from './skillsModel';

const cmd = (name: string, description: string): SlashCommandInfo => ({ name, description, argumentHint: null, aliases: [] });
const NO_MARKETS: ReadonlyMap<string, string> = new Map();
const entry = (name: string, origin: SkillEntry['origin'], description = ''): SkillEntry => ({ name, description, origin, plugin: null, marketplace: null });

describe('classifySkill', () => {
  it('classifySkill_sufijoUser_tuya', () => {
    const result = classifySkill(cmd('mia', 'Hace algo (user)'), NO_MARKETS);

    expect(result).toEqual({ name: 'mia', description: 'Hace algo', origin: 'user', plugin: null, marketplace: null });
  });

  it('classifySkill_sufijoProject_proyecto', () => {
    expect(classifySkill(cmd('tocar-main', 'Guía (project)'), NO_MARKETS)?.origin).toBe('project');
  });

  it('classifySkill_sincronizadaConPrefijo_organizacionSinSufijo', () => {
    const result = classifySkill(cmd('anthropic-skills:deep-research', 'Investiga (claude.ai sync)'), NO_MARKETS);

    expect(result?.origin).toBe('organization');
    expect(result?.description).toBe('Investiga');
  });

  it('classifySkill_conPrefijoSinSufijo_pluginConSuMarketplace', () => {
    const result = classifySkill(cmd('figma:use', 'Usa Figma'), new Map([['figma', 'claude-plugins-official']]));

    expect(result).toMatchObject({ origin: 'plugin', plugin: 'figma', marketplace: 'claude-plugins-official' });
  });

  it('classifySkill_pluginNoInstalado_marketplaceNull', () => {
    expect(classifySkill(cmd('raro:x', ''), NO_MARKETS)?.marketplace).toBeNull();
  });

  it('classifySkill_promptDeMcp_null', () => {
    expect(classifySkill(cmd('claude.ai Figma:create_design_system_rules (MCP)', 'x'), NO_MARKETS)).toBeNull();
  });

  it('classifySkill_propioDeClaudeCode_null', () => {
    expect(classifySkill(cmd('compact', ''), NO_MARKETS)).toBeNull();
  });
});

describe('classifySkills', () => {
  it('classifySkills_nombreRepetido_soloLaPrimera', () => {
    const plugin: InstalledPluginView = { id: 'p@m', name: 'p', marketplace: 'm', scopes: ['user'], version: null, enabled: true };

    const result = classifySkills([cmd('a', 'uno (user)'), cmd('a', 'dos (project)'), cmd('p:b', '')], [plugin]);

    expect(result.map((e) => [e.name, e.origin, e.marketplace])).toEqual([['a', 'user', null], ['p:b', 'plugin', 'm']]);
  });
});

describe('filterSkills', () => {
  it('filterSkills_textoEnDescripcion_laEncuentra', () => {
    const entries = [entry('a', 'user', 'Diseña interfaces'), entry('b', 'user', 'Otra')];

    expect(filterSkills(entries, 'INTERFACES', 'all').map((e) => e.name)).toEqual(['a']);
  });

  it('filterSkills_filtroOrganizacion_soloEsas', () => {
    const entries = [entry('a', 'user'), entry('b', 'organization')];

    expect(filterSkills(entries, '', 'organization').map((e) => e.name)).toEqual(['b']);
  });

  it('filterSkills_sinFiltro_mismaLista', () => {
    const entries = [entry('a', 'user')];

    expect(filterSkills(entries, '', 'all')).toBe(entries);
  });
});

describe('sortSkills', () => {
  it('sortSkills_porOrigen_tuyasPrimero', () => {
    const entries = [entry('z', 'organization'), entry('b', 'user'), entry('a', 'user'), entry('m', 'plugin')];

    expect(sortSkills(entries, 'origin').map((e) => e.name)).toEqual(['a', 'b', 'm', 'z']);
  });
});

describe('parseSkillFilter', () => {
  it('parseSkillFilter_desconocido_all', () => {
    expect(parseSkillFilter('otra')).toBe('all');
  });
});
