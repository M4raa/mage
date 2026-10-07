import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodexHistoryService } from './codexHistory';
import type { ConversationsDeps } from './conversationsService';

const HOME = join('C:', 'home', '.codex-x');
const ROLLOUT = readFileSync(join(__dirname, '..', '..', 'shared', 'fixtures', 'codex-rollout.jsonl'), 'utf8');
const FILE = 'rollout-2026-10-05T10-00-00-11111111-2222-3333-4444-555555555555.jsonl';
const DAY = join(HOME, 'sessions', '2026', '10', '05');

// Sistema de ficheros en memoria: ruta -> contenido (los directorios salen de las rutas).
function fakeDeps(files: Record<string, string>): ConversationsDeps {
  const paths = Object.keys(files);
  const children = (dir: string): string[] => [...new Set(paths.filter((p) => p.startsWith(`${dir}\\`)).map((p) => p.slice(dir.length + 1).split('\\')[0]!))];
  return {
    exists: (path) => paths.some((p) => p === path || p.startsWith(`${path}\\`)),
    listDir: children,
    isDirectory: (path) => paths.some((p) => p.startsWith(`${path}\\`)),
    statFile: (path) => ({ mtimeMs: 1000, sizeBytes: files[path]!.length }),
    readPrefix: (path, max) => files[path]!.slice(0, max),
    readSuffix: (path, max) => files[path]!.slice(-max),
  };
}

describe('CodexHistoryService.list', () => {
  it('list_conUnRollout_devuelveSuResumenConProveedorCodex', () => {
    const service = new CodexHistoryService(fakeDeps({ [join(DAY, FILE)]: ROLLOUT }));

    const [first, ...rest] = service.list(HOME);

    expect(rest).toEqual([]);
    expect(first).toMatchObject({ sessionId: '11111111-2222-3333-4444-555555555555', cwd: 'C:\\proyecto', title: 'Lista los ficheros', configDir: HOME, providerId: 'codex', privacy: 'shared' });
  });

  it('list_rolloutSinMensajeDeUsuario_noSale', () => {
    const onlyMeta = ROLLOUT.split('\n').slice(0, 2).join('\n');

    expect(new CodexHistoryService(fakeDeps({ [join(DAY, FILE)]: onlyMeta })).list(HOME)).toEqual([]);
  });

  it('list_sinCarpetaDeSesiones_devuelveVacio', () => {
    expect(new CodexHistoryService(fakeDeps({})).list(HOME)).toEqual([]);
  });

  it('list_homeVacio_lanza', () => {
    expect(() => new CodexHistoryService(fakeDeps({})).list('  ')).toThrow('CODEX_HOME vacio');
  });

  it('list_ficheroIlegible_seIgnoraSinAbortarLaLista', () => {
    const deps = { ...fakeDeps({ [join(DAY, FILE)]: ROLLOUT }), readPrefix: () => { throw new Error('EACCES'); } };

    expect(new CodexHistoryService(deps).list(HOME)).toEqual([]);
  });
});

describe('CodexHistoryService.findRollout', () => {
  const service = new CodexHistoryService(fakeDeps({ [join(DAY, FILE)]: ROLLOUT }));

  it('findRollout_idExistente_devuelveLaRuta', () => {
    expect(service.findRollout(HOME, '11111111-2222-3333-4444-555555555555')).toBe(join(DAY, FILE));
  });

  it('findRollout_idInexistente_null', () => {
    expect(service.findRollout(HOME, 'nope')).toBeNull();
  });

  it('findRollout_idConSeparadores_lanza', () => {
    expect(() => service.findRollout(HOME, '..\\..\\x')).toThrow('no valido');
  });
});
