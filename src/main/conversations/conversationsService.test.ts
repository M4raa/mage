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
    const folder = join(SHARED, 'C--proj');
    const service = new ConversationsService(
      deps({
        exists: (p) => p === SHARED,
        listDir: (p) => (p === SHARED ? ['C--proj'] : p === folder ? ['abc.jsonl'] : []),
        readPrefix: () => '',
      }),
    );

    expect(service.listConversations(ACC)[0]?.title).toBe('abc');
  });
});
