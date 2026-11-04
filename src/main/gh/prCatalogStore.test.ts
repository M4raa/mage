import { describe, expect, it, vi } from 'vitest';
import { migrateTabPr, PrCatalogStore, type PrCatalogStoreDeps } from './prCatalogStore';

const FILE = 'C:\\userData\\pr-catalog.json';
const DEMO7 = 'github.com/acme/demo#7';
const DEMO8 = 'github.com/acme/demo#8';

function memoryStore(initial = ''): { store: PrCatalogStore; log: ReturnType<typeof vi.fn>; content: () => string } {
  let content = initial;
  const log = vi.fn();
  const deps: PrCatalogStoreDeps = {
    filePath: FILE,
    exists: () => content.length > 0,
    readFile: () => content,
    writeFile: (_path, data) => {
      content = data;
    },
    removeFile: () => undefined,
    rename: () => undefined,
    tempSuffix: () => 'suf',
    log,
  };
  return { store: new PrCatalogStore(deps), log, content: () => content };
}

describe('PrCatalogStore', () => {
  it('link_new_createsEntry', () => {
    const { store } = memoryStore();

    store.link({ key: 'GitHub.com/Acme/Demo#7', conversationId: 'c1', primary: true });

    expect(store.list()).toEqual([{ key: DEMO7, links: [{ conversationId: 'c1', primary: true }] }]);
  });

  it('link_primary_unsetsOtherPrimary', () => {
    const { store } = memoryStore();
    store.link({ key: DEMO7, conversationId: 'c1', primary: true });
    store.link({ key: DEMO8, conversationId: 'c1', primary: true });
    store.link({ key: DEMO8, conversationId: 'c2', primary: true });

    const byKey = Object.fromEntries(store.list().map((entry) => [entry.key, entry.links]));

    expect(byKey[DEMO7]).toEqual([{ conversationId: 'c1', primary: false }]);
    expect(byKey[DEMO8]).toEqual([
      { conversationId: 'c1', primary: true },
      { conversationId: 'c2', primary: true },
    ]);
  });

  it('unlink_lastLink_removesEntry', () => {
    const { store } = memoryStore();
    store.link({ key: DEMO7, conversationId: 'c1', primary: false });
    store.link({ key: DEMO7, conversationId: 'c2', primary: false });

    store.unlink(DEMO7, 'c1');
    expect(store.list()[0]?.links).toEqual([{ conversationId: 'c2', primary: false }]);
    store.unlink(DEMO7, 'c2');

    expect(store.list()).toEqual([]);
  });

  it('list_byConversation_filters', () => {
    const { store } = memoryStore();
    store.link({ key: DEMO7, conversationId: 'c1', primary: true });
    store.link({ key: DEMO8, conversationId: 'c2', primary: true });

    expect(store.list('c2').map((entry) => entry.key)).toEqual([DEMO8]);
    expect(store.list('nadie')).toEqual([]);
  });

  it('load_corruptFile_emptyAndWarns', () => {
    const { store, log } = memoryStore('{no es json');

    expect(store.list()).toEqual([]);
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('pr-catalog.json'));
  });

  it('load_wrongVersion_emptyAndWarns', () => {
    const { store, log } = memoryStore('{"version":2,"entries":[]}');

    expect(store.list()).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('link_badKey_throwsWithValue', () => {
    const { store } = memoryStore();

    expect(() => store.link({ key: 'github.com/../x#1', conversationId: 'c1', primary: false })).toThrow('github.com/../x#1');
    expect(() => store.unlink('nope', 'c1')).toThrow('nope');
  });

  it('forgetConversation_removesLinks', () => {
    const { store } = memoryStore();
    store.link({ key: DEMO7, conversationId: 'c1', primary: true });
    store.link({ key: DEMO7, conversationId: 'c2', primary: false });
    store.link({ key: DEMO8, conversationId: 'c1', primary: false });

    store.forgetConversation('c1');

    expect(store.list()).toEqual([{ key: DEMO7, links: [{ conversationId: 'c2', primary: false }] }]);
  });
});

describe('migrateTabPr', () => {
  const params = { cwd: '/r', accountDir: '/acc', conversationId: 'c1', number: 7 };

  it('migrateTabPr_githubRemote_linksPrimary', async () => {
    const { store } = memoryStore();

    const key = await migrateTabPr(params, { remote: async () => ({ host: 'github.com', owner: 'Acme', repo: 'Demo' }), catalog: store });

    expect(key).toBe(DEMO7);
    expect(store.list('c1')).toEqual([{ key: DEMO7, links: [{ conversationId: 'c1', primary: true }] }]);
  });

  it('migrateTabPr_noRemote_null', async () => {
    const { store, content } = memoryStore();

    expect(await migrateTabPr(params, { remote: async () => null, catalog: store })).toBeNull();
    expect(await migrateTabPr(params, { remote: async () => ({ host: 'gitlab.com', owner: 'a', repo: 'b' }), catalog: store })).toBeNull();
    expect(content()).toBe('');
  });

  it('migrateTabPr_badNumber_throwsWithValue', async () => {
    const { store } = memoryStore();

    await expect(migrateTabPr({ ...params, number: 0 }, { remote: async () => null, catalog: store })).rejects.toThrow('0');
  });
});
