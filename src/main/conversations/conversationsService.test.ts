import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConversationsService, type ConversationsDeps } from './conversationsService';

const ACC = join('/home/u', '.claude-p');
const SHARED = join(ACC, 'projects');
const PRIVATE = join(ACC, 'mage-private', 'projects');

const userLine = (text: string, cwd: string): string =>
  JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: text } });

// FS simulado: mapa ruta->entradas de dir, set de dirs, mapa ruta->prefijo, mapa ruta->mtime.
function deps(over: Partial<ConversationsDeps> = {}): ConversationsDeps {
  return {
    exists: () => true,
    listDir: () => [],
    isDirectory: () => true,
    statFile: () => ({ mtimeMs: 0, sizeBytes: 0 }),
    readPrefix: () => '',
    readSuffix: () => '',
    ...over,
  };
}

describe('ConversationsService.listConversations', () => {
  it('accountDirVacio_lanza', () => {
    const service = new ConversationsService(deps({}));

    expect(() => service.listConversations('  ')).toThrow(/vacio/i);
  });

  it('listaCompartidasYPrivadas_conPrivacyYConfigDirCorrectos', () => {
    const folderShared = join(SHARED, 'C--proj');
    const folderPriv = join(PRIVATE, 'C--proj');
    const service = new ConversationsService(
      deps({
        exists: (p) => p === SHARED || p === PRIVATE,
        listDir: (p) => {
          if (p === SHARED) return ['C--proj'];
          if (p === PRIVATE) return ['C--proj'];
          if (p === folderShared) return ['s1.jsonl'];
          if (p === folderPriv) return ['s2.jsonl'];
          return [];
        },
        statFile: (p: string) => ({ mtimeMs: p.includes('s2') ? 2000 : 1000, sizeBytes: p.includes('s2') ? 4096 : 1024 }),
        readPrefix: (p) => (p.includes('s2') ? userLine('privada', 'C:\\proj') : userLine('compartida', 'C:\\proj')),
      }),
    );

    const list = service.listConversations(ACC);

    expect(list).toHaveLength(2);
    // mas reciente primero (s2, mtime 2000).
    expect(list[0]).toMatchObject({ sessionId: 's2', privacy: 'private', configDir: join(ACC, 'mage-private'), title: 'privada' });
    expect(list[1]).toMatchObject({ sessionId: 's1', privacy: 'shared', configDir: ACC, title: 'compartida' });
  });

  it('ignoraSubcarpetasDeSubagentes_soloJsonlDeNivelSuperior', () => {
    const folder = join(SHARED, 'C--proj');
    const service = new ConversationsService(
      deps({
        exists: (p) => p === SHARED,
        listDir: (p) => {
          if (p === SHARED) return ['C--proj'];
          if (p === folder) return ['s1.jsonl', 's1']; // 's1' = carpeta de subagentes
          return [];
        },
        isDirectory: (p) => p !== join(folder, 's1.jsonl'),
        readPrefix: () => userLine('hola', 'C:\\proj'),
      }),
    );

    const list = service.listConversations(ACC);

    expect(list.map((c) => c.sessionId)).toEqual(['s1']); // solo el .jsonl
  });

  it('rootInexistente_noLanzaYDevuelveVacio', () => {
    const service = new ConversationsService(deps({ exists: () => false }));

    expect(service.listConversations(ACC)).toEqual([]);
  });

  it('ficheroIlegible_seSaltaSinAbortar', () => {
    const folder = join(SHARED, 'C--proj');
    const service = new ConversationsService(
      deps({
        exists: (p) => p === SHARED,
        listDir: (p) => (p === SHARED ? ['C--proj'] : p === folder ? ['ok.jsonl', 'bad.jsonl'] : []),
        readPrefix: (p) => {
          if (p.includes('bad')) throw new Error('EIO');
          return userLine('bien', 'C:\\proj');
        },
      }),
    );

    const list = service.listConversations(ACC);

    expect(list.map((c) => c.sessionId)).toEqual(['ok']);
  });

  it('sinTitulo_caeAlSessionId', () => {
    // Un mensaje de solo imagen es real pero no da titulo.
    const folder = join(SHARED, 'C--proj');
    const image = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: {} }] } });
    const service = new ConversationsService(
      deps({
        exists: (p) => p === SHARED,
        listDir: (p) => (p === SHARED ? ['C--proj'] : p === folder ? ['abc.jsonl'] : []),
        readPrefix: () => image,
      }),
    );

    expect(service.listConversations(ACC)[0]?.title).toBe('abc');
  });

  // Carpeta con un solo .jsonl, para las pruebas de cabeza/cola.
  function singleFile(over: Partial<ConversationsDeps>): ConversationsService {
    const folder = join(SHARED, 'C--proj');
    return new ConversationsService(
      deps({
        exists: (p) => p === SHARED,
        listDir: (p) => (p === SHARED ? ['C--proj'] : p === folder ? ['s1.jsonl'] : []),
        ...over,
      }),
    );
  }

  it('listConversations_customTitleSoloEnLaCola_loUsa', () => {
    const readSuffix = vi.fn(() => `{"partida\n${JSON.stringify({ type: 'custom-title', customTitle: 'Renombrada' })}`);
    const service = singleFile({
      statFile: () => ({ mtimeMs: 0, sizeBytes: 500_000 }),
      readPrefix: () => userLine('prompt', 'C:\\proj'),
      readSuffix,
    });

    expect(service.listConversations(ACC)[0]?.title).toBe('Renombrada');
    expect(readSuffix).toHaveBeenCalledTimes(1);
  });

  it('listConversations_ficheroPequeno_noLeeLaCola', () => {
    const readSuffix = vi.fn(() => '');
    const service = singleFile({ statFile: () => ({ mtimeMs: 0, sizeBytes: 100 }), readPrefix: () => userLine('hola', 'C:\\p'), readSuffix });

    service.listConversations(ACC);

    expect(readSuffix).not.toHaveBeenCalled();
  });

  it('listConversations_sinMensajeDeUsuario_seExcluye', () => {
    const service = singleFile({ readPrefix: () => JSON.stringify({ type: 'custom-title', customTitle: 'x' }) });

    expect(service.listConversations(ACC)).toEqual([]);
  });

  it('listConversations_sinMensajeEnCabezaNiColaDeUnFicheroGrande_seConserva', () => {
    // El primer mensaje podria estar en medio: esconderla borraria una conversacion de verdad.
    const service = singleFile({ statFile: () => ({ mtimeMs: 0, sizeBytes: 10_000_000 }), readPrefix: () => '' });

    expect(service.listConversations(ACC).map((c) => c.title)).toEqual(['s1']);
  });

  it('listConversations_tareaProgramada_marcaIsScheduled', () => {
    const service = singleFile({ readPrefix: () => userLine('<scheduled-task name="say-hello" file="x">\nSay\n</scheduled-task>', 'C:\\p') });

    expect(service.listConversations(ACC)[0]).toMatchObject({ title: 'say-hello', isScheduled: true });
  });
});

describe('ConversationsService con el runtime propio (P-032 R4)', () => {
  it('listConversations_runtime_salenConLaCuentaQueLista', () => {
    const runtime = join('/datos', 'runtime', 'projects');
    const folder = join(runtime, 'C--proj');
    const service = new ConversationsService(
      deps({
        exists: (p) => p === runtime,
        listDir: (p) => (p === runtime ? ['C--proj'] : p === folder ? ['r1.jsonl'] : []),
        readPrefix: () => userLine('hola runtime', 'C:\proj'),
        runtimeProjectsDir: () => runtime,
      }),
    );

    const list = service.listConversations(ACC);

    expect(list).toEqual([expect.objectContaining({ sessionId: 'r1', configDir: ACC, privacy: 'shared', title: 'hola runtime' })]);
  });
});
