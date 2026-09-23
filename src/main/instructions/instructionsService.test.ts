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
