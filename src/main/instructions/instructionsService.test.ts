import { describe, expect, it } from 'vitest';
import { InstructionsService, type InstructionsDeps } from './instructionsService';

const CWD = 'C:\\sourcecode\\mage';
const ACCOUNT = 'C:\\Users\\u\\.claude';
const PROJECT_FILE = 'C:\\sourcecode\\mage\\CLAUDE.md';
const USER_FILE = 'C:\\Users\\u\\.claude\\CLAUDE.md';

function service(files: Readonly<Record<string, string>>, overrides: Partial<InstructionsDeps> = {}): InstructionsService {
  return new InstructionsService({
    exists: (path) => path in files,
    readFile: (path) => files[path] ?? '',
    ...overrides,
  });
}

describe('InstructionsService.read', () => {
  it('read_ambosFicherosPresentes_devuelveLosDos', () => {
    const result = service({ [PROJECT_FILE]: '# Proyecto', [USER_FILE]: '# Usuario' }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result).toEqual([
      { scope: 'project', path: PROJECT_FILE, content: '# Proyecto' },
      { scope: 'user', path: USER_FILE, content: '# Usuario' },
    ]);
  });

  it('read_soloProyecto_usuarioEsNull', () => {
    const result = service({ [PROJECT_FILE]: '# Proyecto' }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result[0]?.content).toBe('# Proyecto');
    expect(result[1]?.content).toBeNull();
  });

  it('read_ninguno_ambosNull', () => {
    // Que no haya CLAUDE.md NO es un error: la mayoria de los proyectos no lo tienen.
    const result = service({}).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.map((f) => f.content)).toEqual([null, null]);
  });

  it('read_ficheroVacio_contentEsCadenaVacia', () => {
    // Vacio ≠ ausente: la misma distincion que ya paga el compare-and-swap de la config compartida.
    const result = service({ [PROJECT_FILE]: '' }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result[0]?.content).toBe('');
  });

  it('read_errorDeLecturaNoEsEnoent_lanza', () => {
    // Prohibido `catch { return null }`: un fallo de permisos disfrazado de "no hay fichero" es peor
    // que un error visible.
    const roto = service(
      { [PROJECT_FILE]: 'x' },
      {
        readFile: () => {
          throw new Error('EACCES: permission denied');
        },
      },
    );

    expect(() => roto.read({ cwd: CWD, accountDir: ACCOUNT })).toThrow(/EACCES/);
  });

  it('read_siempreDevuelveProyectoPrimero', () => {
    const result = service({ [USER_FILE]: '# Usuario' }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.map((f) => f.scope)).toEqual(['project', 'user']);
  });
});

describe('InstructionsService.read con puente (grupo H)', () => {
  const OWN_PROJECT = 'C:\\sourcecode\\mage\\AGENTS.md';
  const spec = { target: 'AGENTS.md', projectOwnFiles: ['AGENTS.md'], userOwnPaths: ['C:\\Users\\u\\.codex\\AGENTS.md'] } as const;
  const bridged = (files: Readonly<Record<string, string>>): InstructionsService =>
    service(files, { bridgeSpecFor: (provider) => (provider === 'codex' ? spec : null), claudeUserDir: ACCOUNT });

  it('read_codexSoloConClaudeMd_marcaElPuenteComoAgentsMd', () => {
    const result = bridged({ [PROJECT_FILE]: '# Proyecto' }).read({ cwd: CWD, accountDir: 'C:\\x', provider: 'codex' });

    expect(result[0]).toEqual({ scope: 'project', path: PROJECT_FILE, content: '# Proyecto', bridge: { target: 'AGENTS.md', ownFile: null } });
    expect(result[1]?.path).toBe(USER_FILE);
  });

  it('read_codexConSuAgentsMd_diceCualEsElSuyo', () => {
    const result = bridged({ [PROJECT_FILE]: '# Proyecto', [OWN_PROJECT]: '# A' }).read({ cwd: CWD, accountDir: 'C:\\x', provider: 'codex' });

    expect(result[0]?.bridge).toEqual({ target: 'AGENTS.md', ownFile: OWN_PROJECT });
  });

  it('read_claude_sinCampoBridge', () => {
    const result = bridged({ [PROJECT_FILE]: '# Proyecto' }).read({ cwd: CWD, accountDir: ACCOUNT, provider: 'claude' });

    expect(result[0]).toEqual({ scope: 'project', path: PROJECT_FILE, content: '# Proyecto' });
  });
});
