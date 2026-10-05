import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { agyBridgeSpec, bridgeDocument, codexBridgeSpec, inspectBridge, resolveBridge, type BridgeFs } from './instructionsBridge';

const CWD = join('C:', 'proyecto');
const CLAUDE_DIR = join('C:', 'Users', 'u', '.claude');
const CODEX_HOME = join('C:', 'Users', 'u', '.codex');
const PROFILE = join('C:', 'mage', 'agy-profile');
const PROJECT_CLAUDE = join(CWD, 'CLAUDE.md');
const USER_CLAUDE = join(CLAUDE_DIR, 'CLAUDE.md');

const fsOf = (files: Readonly<Record<string, string>>): BridgeFs => ({
  exists: (path) => path in files,
  readFile: (path) => {
    const content = files[path];
    if (content === undefined) throw new Error(`no existe: ${path}`);
    return content;
  },
});

const codex = { cwd: CWD, claudeUserDir: CLAUDE_DIR, spec: codexBridgeSpec(CODEX_HOME) };
const agy = { cwd: CWD, claudeUserDir: CLAUDE_DIR, spec: agyBridgeSpec(PROFILE) };

describe('resolveBridge', () => {
  it('resolveBridge_soloClaudeMdEnProyectoYGlobal_puenteaLosDos', () => {
    const files = resolveBridge(fsOf({ [PROJECT_CLAUDE]: '# P', [USER_CLAUDE]: '# U' }), codex);

    expect(files).toEqual([
      { scope: 'project', path: PROJECT_CLAUDE, content: '# P' },
      { scope: 'user', path: USER_CLAUDE, content: '# U' },
    ]);
  });

  it('resolveBridge_proyectoConAgentsMd_codexNoRecibeElDelProyecto', () => {
    const files = resolveBridge(fsOf({ [PROJECT_CLAUDE]: '# P', [join(CWD, 'AGENTS.md')]: '# A' }), codex);

    expect(files).toEqual([]);
  });

  it('resolveBridge_proyectoConAgentsOverride_codexNoRecibeElDelProyecto', () => {
    const files = resolveBridge(fsOf({ [PROJECT_CLAUDE]: '# P', [join(CWD, 'AGENTS.override.md')]: '# O' }), codex);

    expect(files).toEqual([]);
  });

  // Medido: agy lee GEMINI.md Y AGENTS.md del proyecto; cualquiera de los dos es "el suyo".
  it.each(['GEMINI.md', 'AGENTS.md'])('resolveBridge_proyectoConSu%s_agyNoRecibeElDelProyecto', (own) => {
    const files = resolveBridge(fsOf({ [PROJECT_CLAUDE]: '# P', [join(CWD, own)]: '# propio' }), agy);

    expect(files).toEqual([]);
  });

  it('resolveBridge_codexConAgentsMdEnSuCodexHome_noRecibeElGlobal', () => {
    const files = resolveBridge(fsOf({ [USER_CLAUDE]: '# U', [join(CODEX_HOME, 'AGENTS.md')]: '# H' }), codex);

    expect(files).toEqual([]);
  });

  it.each([join('.gemini', 'GEMINI.md'), join('.gemini', 'config', 'AGENTS.md')])('resolveBridge_agyConSuGlobal%s_noRecibeElGlobal', (own) => {
    const files = resolveBridge(fsOf({ [USER_CLAUDE]: '# U', [join(PROFILE, own)]: '# G' }), agy);

    expect(files).toEqual([]);
  });

  it('resolveBridge_globalPropioPeroProyectoSinElSuyo_soloElDelProyecto', () => {
    const files = resolveBridge(fsOf({ [PROJECT_CLAUDE]: '# P', [USER_CLAUDE]: '# U', [join(CODEX_HOME, 'AGENTS.md')]: '# H' }), codex);

    expect(files.map((file) => file.scope)).toEqual(['project']);
  });

  it('resolveBridge_claudeMdVacioOSoloEspacios_noSePuentea', () => {
    const files = resolveBridge(fsOf({ [PROJECT_CLAUDE]: '  \n', [USER_CLAUDE]: '' }), codex);

    expect(files).toEqual([]);
  });

  it('resolveBridge_sinNingunFichero_vacio', () => {
    expect(resolveBridge(fsOf({}), agy)).toEqual([]);
  });

  it('inspectBridge_cwdVacio_lanzaConElValor', () => {
    expect(() => inspectBridge(fsOf({}), { ...codex, cwd: ' ' })).toThrow('" "');
  });

  it('inspectBridge_conFicheroPropio_loDevuelveEnOwnFile', () => {
    const own = join(CWD, 'AGENTS.md');

    const [project] = inspectBridge(fsOf({ [PROJECT_CLAUDE]: '# P', [own]: '# A' }), codex);

    expect(project).toEqual({ scope: 'project', path: PROJECT_CLAUDE, content: '# P', ownFile: own });
  });
});

describe('bridgeDocument', () => {
  it('bridgeDocument_dosFicheros_unaSeccionPorFicheroConSuRuta', () => {
    const text = bridgeDocument([
      { scope: 'project', path: PROJECT_CLAUDE, content: '# P\n' },
      { scope: 'user', path: USER_CLAUDE, content: '# U' },
    ]);

    expect(text).toContain(`## Instrucciones del proyecto (${PROJECT_CLAUDE})\n\n# P`);
    expect(text).toContain(`## Instrucciones globales del usuario (${USER_CLAUDE})\n\n# U`);
    expect(text.indexOf('# P')).toBeLessThan(text.indexOf('# U'));
  });

  it('bridgeDocument_sinFicheros_lanza', () => {
    expect(() => bridgeDocument([])).toThrow('sin ficheros');
  });
});
