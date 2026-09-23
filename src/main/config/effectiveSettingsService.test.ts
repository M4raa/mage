import { describe, expect, it, vi } from 'vitest';
import { EffectiveSettingsService } from './effectiveSettingsService';

const CWD = 'C:\\proj';
const ACCOUNT = 'C:\\Users\\u\\.claude';
const ACCOUNT_FILE = 'C:\\Users\\u\\.claude\\settings.json';
const PROJECT_FILE = 'C:\\proj\\.claude\\settings.json';
const LOCAL_FILE = 'C:\\proj\\.claude\\settings.local.json';
const COMMON_FILE = 'C:\\userData\\shared-config\\settings-common.json';

const hookFile = (event: string, command: string): string =>
  JSON.stringify({ hooks: { [event]: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] } });

function service(files: Readonly<Record<string, string>>, log = vi.fn()): EffectiveSettingsService {
  return new EffectiveSettingsService({
    exists: (path) => path in files,
    readFile: (path) => files[path] ?? '',
    commonSettingsPath: COMMON_FILE,
    log,
  });
}

describe('EffectiveSettingsService.read', () => {
  it('read_hooksEnLasTresFuentes_devuelveLaUnionEtiquetada', () => {
    // MEDIDO (2026-08-02): los hooks se CONCATENAN entre fuentes, no se pisan.
    const result = service({
      [ACCOUNT_FILE]: hookFile('PreToolUse', 'echo cuenta'),
      [PROJECT_FILE]: hookFile('PreToolUse', 'echo proyecto'),
      [COMMON_FILE]: hookFile('Stop', 'echo comun'),
    }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.hooks).toEqual([
      { event: 'PreToolUse', matcher: 'Bash', command: 'echo cuenta', origin: 'account' },
      { event: 'PreToolUse', matcher: 'Bash', command: 'echo proyecto', origin: 'project' },
      { event: 'Stop', matcher: 'Bash', command: 'echo comun', origin: 'mageCommon' },
    ]);
  });

  it('read_reglaRepetidaEnDosFuentes_apareceDosVecesConSuOrigen', () => {
    // No se deduplica a proposito: esconder que la misma regla esta declarada dos veces seria mentir
    // sobre lo que hay en disco.
    const rules = JSON.stringify({ permissions: { allow: ['Bash(git status)'] } });
    const result = service({ [ACCOUNT_FILE]: rules, [COMMON_FILE]: rules }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.rules).toEqual([
      { pattern: 'Bash(git status)', effect: 'allow', origin: 'account' },
      { pattern: 'Bash(git status)', effect: 'allow', origin: 'mageCommon' },
    ]);
  });

  it('read_losTresEfectos_seEtiquetanEnElOrdenEnQueElCliLosAplica', () => {
    // `deny` primero, `ask` despues y `allow` al final: es el orden de precedencia del CLI, y la lista
    // se lee de arriba abajo. `ask` estuvo sin leer (2.3b): una conversacion con solo reglas `ask` se
    // veia como una conversacion sin ninguna regla.
    const result = service({
      [ACCOUNT_FILE]: JSON.stringify({ permissions: { allow: ['Read(*)'], deny: ['Bash(rm -rf *)'], ask: ['Write(*)'] } }),
    }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.rules).toEqual([
      { pattern: 'Bash(rm -rf *)', effect: 'deny', origin: 'account' },
      { pattern: 'Write(*)', effect: 'ask', origin: 'account' },
      { pattern: 'Read(*)', effect: 'allow', origin: 'account' },
    ]);
  });

  it('read_settingsLocalDelProyecto_seLeeYSeEtiquetaComoProjectLocal', () => {
    // `.claude/settings.local.json` es donde el propio CLI escribe lo que el usuario acepta con su
    // "always allow": sin leerlo, el panel de Permisos decia "no hay reglas" mientras el agente ya no
    // preguntaba por esa tool.
    const result = service({
      [LOCAL_FILE]: JSON.stringify({ permissions: { allow: ['Bash(pnpm test:*)'] } }),
    }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.rules).toEqual([{ pattern: 'Bash(pnpm test:*)', effect: 'allow', origin: 'projectLocal' }]);
  });

  it('read_settingsJsonCorrupto_devuelveLasOtrasFuentesYUnAviso', () => {
    // Una fuente rota no puede dejar la vista en blanco, pero tampoco se traga en silencio.
    const log = vi.fn();
    const result = service({ [ACCOUNT_FILE]: '{no es json', [COMMON_FILE]: hookFile('Stop', 'echo comun') }, log).read({
      cwd: CWD,
      accountDir: ACCOUNT,
    });

    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]?.origin).toBe('mageCommon');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('settings.json'));
  });

  it('read_formaInesperada_seIgnoraConAviso', () => {
    const log = vi.fn();
    const result = service({ [ACCOUNT_FILE]: JSON.stringify({ hooks: 'nope' }) }, log).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.hooks).toEqual([]);
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('forma esperada'));
  });

  it('read_sinPermissions_devuelveListaVacia', () => {
    const result = service({ [ACCOUNT_FILE]: JSON.stringify({ model: 'opus' }) }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.rules).toEqual([]);
    expect(result.hooks).toEqual([]);
  });

  it('read_ficheroDelProyectoAusente_noEsError', () => {
    const log = vi.fn();
    const result = service({ [ACCOUNT_FILE]: hookFile('Stop', 'echo cuenta') }, log).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.hooks).toHaveLength(1);
    expect(log).not.toHaveBeenCalled(); // ausente no es "roto"
  });

  it('read_soloMageCommonEsEditable', () => {
    // Mage no reescribe el settings.json del usuario ni el del proyecto.
    expect(service({}).read({ cwd: CWD, accountDir: ACCOUNT }).editableOrigin).toBe('mageCommon');
  });

  it('read_hookSinMatcher_matcherEsNull', () => {
    const file = JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'echo x' }] }] } });

    const result = service({ [ACCOUNT_FILE]: file }).read({ cwd: CWD, accountDir: ACCOUNT });

    expect(result.hooks[0]).toEqual({ event: 'Stop', matcher: null, command: 'echo x', origin: 'account' });
  });
});
