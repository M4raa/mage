import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CodexHistoryService } from './codexHistory';
import type { ConversationsDeps } from './conversationsService';

const HOME = join('C:', 'home', '.codex-x');
const ROLLOUT = readFileSync(join(__dirname, '..', '..', 'shared', 'fixtures', 'codex-rollout.jsonl'), 'utf8');
const FILE = 'rollout-2026-10-05T10-00-00-11111111-2222-3333-4444-555555555555.jsonl';
const DAY = join(HOME, 'sessions', '2026', '10', '05');

// Sistema de ficheros en memoria: ruta -> contenido (los directorios salen de las rutas).
function fakeDeps(files: Record<string, string>): ConversationsDeps {
  const paths = Object.keys(files);
  const children = (dir: string): string[] => [...new Set(paths.filter((p) => p.startsWith(`${dir}${sep}`)).map((p) => p.slice(dir.length + 1).split(sep)[0]!))];
  return {
    exists: (path) => paths.some((p) => p === path || p.startsWith(`${path}${sep}`)),
    listDir: children,
    isDirectory: (path) => paths.some((p) => p.startsWith(`${path}${sep}`)),
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

// H4 (devolución 18): Codex no actualiza el mtime de sus rollouts (medido en los de la cuenta real: mtime =
// creación y la última línea, horas después). El instante de la conversación es el mayor de los dos.
describe('CodexHistoryService.list — fecha de la conversación', () => {
  const MTIME_VIEJO = Date.parse('2026-10-05T07:00:00.000Z');
  const MTIME_NUEVO = Date.parse('2026-10-05T09:00:00.000Z');
  const ULTIMA = '2026-10-05T08:00:10.000Z'; // timestamp de la última línea de la fixture
  const withMtime = (contents: string, mtimeMs: number, over: Partial<ConversationsDeps> = {}): ConversationsDeps =>
    ({ ...fakeDeps({ [join(DAY, FILE)]: contents }), statFile: (path: string) => ({ mtimeMs, sizeBytes: contents.length }), ...over });
  const updatedAt = (deps: ConversationsDeps): number | undefined => new CodexHistoryService(deps).list(HOME)[0]?.updatedAtMs;
  const lineAt = (timestamp: string, extra = ''): string => JSON.stringify({ timestamp, ordinal: 99, type: 'event_msg', payload: { type: 'token_count', extra } }) + '\n';

  it('list_mtimeViejoYUltimaLineaNueva_mandaLaLinea', () => {
    expect(updatedAt(withMtime(ROLLOUT, MTIME_VIEJO))).toBe(Date.parse(ULTIMA));
  });

  it('list_mtimePosteriorALaUltimaLinea_mandaElMtime', () => {
    expect(updatedAt(withMtime(ROLLOUT, MTIME_NUEVO))).toBe(MTIME_NUEVO);
  });

  it('list_ultimaLineaTruncada_usaLaAnteriorValida', () => {
    const truncated = ROLLOUT + '{"timestamp":"2026-10-05T10:00:00.000Z","ordinal":11,"type":"resp';

    expect(updatedAt(withMtime(truncated, MTIME_VIEJO))).toBe(Date.parse(ULTIMA));
  });

  it.each([
    ['truncada', '{"timestamp":"2026-10-05T10:0'],
    ['sin JSON', 'no es JSON\n'],
    ['timestamp no ISO', lineAt('ayer')],
    ['timestamp imposible', lineAt('2026-13-45T99:00:00.000Z')],
    ['timestamp numerico', JSON.stringify({ timestamp: 1_800_000_000_000 }) + '\n'],
  ])('list_unicaLineaFinal%s_yCabeceraVieja_usaElMtime', (_name, tail) => {
    // Cabecera con instantes ANTERIORES al mtime: si la última línea no vale, gana el mtime.
    const head = ROLLOUT.split('\n').slice(0, 4).map((l) => l.replace(/"timestamp":"[^"]+"/, '"timestamp":"2026-10-05T06:00:00.000Z"')).join('\n') + '\n';

    expect(updatedAt(withMtime(head + tail, MTIME_VIEJO))).toBe(MTIME_VIEJO);
  });

  it('list_ultimaLineaMasLargaQueLaVentana_amplíaLaLecturaHastaEncontrarla', () => {
    const big = lineAt('2026-10-05T11:00:00.000Z', 'x'.repeat(200 * 1024));
    const readSuffix = vi.fn((_path: string, max: number) => (ROLLOUT + big).slice(-max));

    expect(updatedAt(withMtime(ROLLOUT + big, MTIME_VIEJO, { readSuffix }))).toBe(Date.parse('2026-10-05T11:00:00.000Z'));
    expect(readSuffix.mock.calls.length).toBeGreaterThan(1);
    expect(readSuffix.mock.calls[0]?.[1]).toBeLessThan(big.length);
  });

  it('list_mismoMtimeYTamaño_noReleeLaCola', () => {
    const readSuffix = vi.fn((_path: string, max: number) => ROLLOUT.slice(-max));
    const service = new CodexHistoryService(withMtime(ROLLOUT, MTIME_VIEJO, { readSuffix }));

    service.list(HOME);
    service.list(HOME);

    expect(readSuffix).toHaveBeenCalledTimes(1);
  });
});
