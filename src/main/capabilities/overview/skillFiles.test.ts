import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SkillFileParams } from '@shared/capabilities';
import type { OverviewFs } from './capabilitiesOverview';
import { readSkillFile, SKILL_MAX_BYTES, splitSkillName } from './skillFiles';

function memoryFs(files: ReadonlyMap<string, string>): OverviewFs {
  return {
    exists: (path) => files.has(path),
    readFile: (path) => Buffer.from(files.get(path) ?? ''),
    listFiles: (dir) => [...files.keys()].filter((key) => key.startsWith(dir + sep)),
  };
}

const ACCOUNT = resolve('home', '.claude');
const PROJECT = resolve('work', 'repo');
const skill = (name: string, origin: SkillFileParams['origin']): SkillFileParams => ({ accountDir: ACCOUNT, name, origin });

describe('readSkillFile', () => {
  it('readSkillFile_usuario_leeSuSkillMd', () => {
    const file = join(ACCOUNT, 'skills', 'caveman', 'SKILL.md');
    const fs = memoryFs(new Map([[file, '# caveman']]));

    const result = readSkillFile({ fs, projectDir: null }, skill('caveman', 'user'));

    expect(result).toEqual({ state: 'ok', path: file, content: '# caveman' });
  });

  it('readSkillFile_proyectoSinCarpeta_missing', () => {
    const fs = memoryFs(new Map([[join(PROJECT, '.claude', 'skills', 'x', 'SKILL.md'), 'x']]));

    const result = readSkillFile({ fs, projectDir: null }, skill('x', 'project'));

    expect(result).toEqual({ state: 'missing' });
  });

  it('readSkillFile_proyectoConCarpeta_leeElDeLaCarpeta', () => {
    const file = join(PROJECT, '.claude', 'skills', 'tocar-main', 'SKILL.md');
    const fs = memoryFs(new Map([[file, 'main']]));

    const result = readSkillFile({ fs, projectDir: PROJECT }, skill('tocar-main', 'project'));

    expect(result).toEqual({ state: 'ok', path: file, content: 'main' });
  });

  it('readSkillFile_organizacionConPrefijo_buscaEnSynced', () => {
    const file = join(ACCOUNT, 'skills', 'synced', 'o_u', 'docx', 'SKILL.md');
    const fs = memoryFs(new Map([[file, 'docx']]));

    const result = readSkillFile({ fs, projectDir: null }, skill('anthropic-skills:docx', 'organization'));

    expect(result).toEqual({ state: 'ok', path: file, content: 'docx' });
  });

  it('readSkillFile_plugin_usaElInstallPath', () => {
    const install = join(ACCOUNT, 'plugins', 'cache', 'mk', 'figma', '1.0.0');
    const file = join(install, 'skills', 'figma-use', 'SKILL.md');
    const installed = JSON.stringify({ version: 2, plugins: { 'figma@mk': [{ scope: 'user', installPath: install }] } });
    const fs = memoryFs(new Map([[join(ACCOUNT, 'plugins', 'installed_plugins.json'), installed], [file, 'figma']]));

    const result = readSkillFile({ fs, projectDir: null }, skill('figma:figma-use', 'plugin'));

    expect(result).toEqual({ state: 'ok', path: file, content: 'figma' });
  });

  it('readSkillFile_pluginConInstallPathFueraDePlugins_missing', () => {
    const install = resolve('elsewhere', 'figma');
    const installed = JSON.stringify({ version: 2, plugins: { 'figma@mk': [{ scope: 'user', installPath: install }] } });
    const fs = memoryFs(new Map([[join(ACCOUNT, 'plugins', 'installed_plugins.json'), installed], [join(install, 'skills', 'figma-use', 'SKILL.md'), 'x']]));

    const result = readSkillFile({ fs, projectDir: null }, skill('figma:figma-use', 'plugin'));

    expect(result).toEqual({ state: 'missing' });
  });

  it('readSkillFile_masDelTope_tooLarge', () => {
    const file = join(ACCOUNT, 'skills', 'big', 'SKILL.md');
    const fs = memoryFs(new Map([[file, 'a'.repeat(SKILL_MAX_BYTES + 1)]]));

    const result = readSkillFile({ fs, projectDir: null }, skill('big', 'user'));

    expect(result).toEqual({ state: 'too_large', path: file, sizeBytes: SKILL_MAX_BYTES + 1 });
  });
});

describe('splitSkillName', () => {
  it.each(['a/b', '..', ':x'])('splitSkillName_conBarraOPuntos_lanza (%s)', (name) => {
    expect(() => splitSkillName(name)).toThrow(JSON.stringify(name));
  });

  it('splitSkillName_conPrefijo_separaPrefijoYBase', () => {
    expect(splitSkillName('p:s')).toEqual({ prefix: 'p', base: 's' });
  });
});
