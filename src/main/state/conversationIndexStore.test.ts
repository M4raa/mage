import { describe, expect, it, vi } from 'vitest';
import { MAX_ARTIFACTS, type ArtifactRecord } from '@shared/conversationIndex';
import { ConversationIndexStore, type ConversationIndexStoreDeps } from './conversationIndexStore';

const FILE = 'C:\\userData\\conversation-index.json';
const SESSION = '9253933c-a6b0-4c70-84a5-e92f45c8adb4';

function buildDeps(overrides: Partial<ConversationIndexStoreDeps> = {}): ConversationIndexStoreDeps {
  return {
    filePath: FILE,
    exists: () => true,
    readFile: () => '{}',
    writeFile: () => undefined,
    removeFile: () => undefined,
    rename: () => undefined,
    tempSuffix: () => 'suf',
    ...overrides,
  };
}

// Store con FS en memoria: el ciclo guardar -> leer es lo que de verdad hay que probar.
function memoryStore(): ConversationIndexStore {
  let content = '';
  return new ConversationIndexStore(
    buildDeps({
      exists: () => content.length > 0,
      readFile: () => content,
      writeFile: (_path, data) => {
        content = data;
      },
    }),
  );
}

const artifact = (publishedAtMs: number): ArtifactRecord => ({
  accountDir: 'C:\\Users\\u\\.claude',
  title: 'Informe',
  favicon: '📊',
  publishedAtMs,
});

describe('ConversationIndexStore — preferencias (2.1)', () => {
  it('loadPrefs_sessionDesconocida_devuelveNull', () => {
    expect(memoryStore().loadPrefs(SESSION)).toBeNull();
  });

  it('loadPrefs_ficheroAusente_devuelveNullSinLanzar', () => {
    const store = new ConversationIndexStore(buildDeps({ exists: () => false }));

    expect(store.loadPrefs(SESSION)).toBeNull();
  });

  it('savePrefs_yLoadPrefs_sobrevivenAlCicloCompleto', () => {
    const store = memoryStore();

    store.savePrefs(SESSION, { model: 'opus', effort: 'high', permissionMode: 'plan' });

    expect(store.loadPrefs(SESSION)).toEqual({ model: 'opus', effort: 'high', permissionMode: 'plan' });
  });

  it('savePrefs_provider_seGuardaYSeConservaEnLosParciales', () => {
    // P-032 R4: el proveedor decide con que runtime se reabre la conversacion.
    const store = memoryStore();
    store.savePrefs(SESSION, { model: 'qwen', provider: 'custom:ollama' });

    store.savePrefs(SESSION, { effort: 'low' });

    expect(store.loadPrefs(SESSION)).toEqual({ model: 'qwen', effort: 'low', provider: 'custom:ollama' });
  });

  it('savePrefs_parcial_conservaLosCamposNoEnviados', () => {
    const store = memoryStore();
    store.savePrefs(SESSION, { model: 'opus', effort: 'high' });

    store.savePrefs(SESSION, { permissionMode: 'acceptEdits' });

    expect(store.loadPrefs(SESSION)).toEqual({ model: 'opus', effort: 'high', permissionMode: 'acceptEdits' });
  });

  it('savePrefs_effortVacio_borraElCampo', () => {
    // Paridad con `setActiveEffort`, que trata '' como "sin esfuerzo": si se conservara el valor viejo,
    // la conversacion seguiria reabriendose con un esfuerzo que el usuario acaba de quitar.
    const store = memoryStore();
    store.savePrefs(SESSION, { model: 'opus', effort: 'high' });

    store.savePrefs(SESSION, { effort: '' });

    expect(store.loadPrefs(SESSION)).toEqual({ model: 'opus' });
  });

  it('savePrefs_withAccountId_persistsIt', () => {
    const store = memoryStore();

    store.savePrefs(SESSION, { model: 'opus', accountId: 'acc-1' });

    expect(store.loadPrefs(SESSION)).toEqual({ model: 'opus', accountId: 'acc-1' });
  });

  it('loadPrefs_invalidAccountId_dropsField', () => {
    const file = JSON.stringify({ version: 2, conversations: { [SESSION]: { model: 'opus', accountId: 42 } }, artifacts: {} });
    const store = new ConversationIndexStore(buildDeps({ readFile: () => file }));

    expect(store.loadPrefs(SESSION)).toEqual({ model: 'opus' });
  });

  it('savePrefs_emptyAccountId_removesIt', () => {
    const store = memoryStore();
    store.savePrefs(SESSION, { model: 'opus', accountId: 'acc-1' });

    store.savePrefs(SESSION, { accountId: '' });

    expect(store.loadPrefs(SESSION)).toEqual({ model: 'opus' });
  });

  it('savePrefs_sessionIdVacio_lanzaConElValorRecibido', () => {
    const writeFile = vi.fn();
    const store = new ConversationIndexStore(buildDeps({ writeFile }));

    expect(() => store.savePrefs('', { model: 'opus' })).toThrow(/sessionId vacio.*""/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('forgetConversation_borraLaEntrada', () => {
    const store = memoryStore();
    store.savePrefs(SESSION, { model: 'opus' });

    store.forgetConversation(SESSION);

    expect(store.loadPrefs(SESSION)).toBeNull();
  });

  it('forgetConversation_sessionDesconocida_noEscribeNada', () => {
    const writeFile = vi.fn();
    const store = new ConversationIndexStore(buildDeps({ writeFile, exists: () => false }));

    store.forgetConversation(SESSION);

    expect(writeFile).not.toHaveBeenCalled();
  });

  it('load_jsonCorrupto_devuelveIndiceVacio', () => {
    const store = new ConversationIndexStore(buildDeps({ readFile: () => '{no es json' }));

    expect(store.loadPrefs(SESSION)).toBeNull();
    expect(store.loadArtifact('https://x')).toBeNull();
  });

  it('load_versionDesconocida_devuelveIndiceVacio', () => {
    const file = JSON.stringify({ version: 99, conversations: { [SESSION]: { model: 'opus' } }, artifacts: {} });
    const store = new ConversationIndexStore(buildDeps({ readFile: () => file }));

    expect(store.loadPrefs(SESSION)).toBeNull();
  });
});

describe('ConversationIndexStore — artifacts (2.4)', () => {
  it('recordArtifact_yLoadArtifact_sobrevivenAlCicloCompleto', () => {
    const store = memoryStore();

    store.recordArtifact('https://claude.ai/a/1', artifact(1_000));

    expect(store.loadArtifact('https://claude.ai/a/1')).toEqual(artifact(1_000));
  });

  it('recordArtifact_masDe500_desalojaElMasAntiguo', () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_ARTIFACTS; i += 1) store.recordArtifact(`https://claude.ai/a/${i}`, artifact(1_000 + i));

    store.recordArtifact('https://claude.ai/a/nuevo', artifact(9_999_999));

    expect(store.loadArtifact('https://claude.ai/a/nuevo')).not.toBeNull();
    expect(store.loadArtifact('https://claude.ai/a/0')).toBeNull(); // el de publishedAtMs menor
    expect(store.loadArtifact('https://claude.ai/a/1')).not.toBeNull();
  });

  it('recordArtifact_mismaUrlOtraCuenta_NO_cambiaDeDueno', () => {
    // EL invariante de producto de 2.4: un artifact pertenece a QUIEN LO PUBLICO. Abrir la conversacion
    // con otra cuenta no lo hereda — si lo hiciera, se abriria con la sesion equivocada, que es justo el
    // fallo que este punto viene a arreglar. El registro solo lo escribe quien VE la publicacion.
    const store = memoryStore();
    store.recordArtifact('https://claude.ai/a/1', { ...artifact(1_000), accountDir: 'C:\\Users\\u\\.claude' });

    // Una segunda lectura desde otra cuenta NO reescribe nada (el renderer solo registra al publicar).
    expect(store.loadArtifact('https://claude.ai/a/1')?.accountDir).toBe('C:\\Users\\u\\.claude');
  });

  it('recordArtifact_urlVacia_lanza', () => {
    expect(() => memoryStore().recordArtifact('', artifact(1))).toThrow(/url vacia/i);
  });

  it('recordArtifact_noPisaLasPreferencias', () => {
    const store = memoryStore();
    store.savePrefs(SESSION, { model: 'opus' });

    store.recordArtifact('https://claude.ai/a/1', artifact(1));

    expect(store.loadPrefs(SESSION)).toEqual({ model: 'opus' });
  });
});

// F2.1: identidades separadas en el índice v2. Disco en memoria con varios ficheros (el índice y su
// respaldo), para comprobar la migración desde v1.
function memoryDisk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const store = new ConversationIndexStore(buildDeps({
    exists: (path) => files.has(path),
    readFile: (path) => files.get(path) ?? '',
    writeFile: (path, data) => { files.set(path.replace(/\.suf\.tmp$|\.tmp$/, ''), data); },
  }));
  return { store, files };
}

const CODEX_REF = { provider: 'codex', accountDir: '/home/u/.codex', nativeId: 'thread-1' };
const V1_FILE = JSON.stringify({ version: 1, conversations: { [SESSION]: { model: 'opus', effort: 'high' } }, artifacts: {} });

describe('ConversationIndexStore — identidades y migración v2 (F2.1)', () => {
  it('read_ficheroV1_conservaLasPreferencias', () => {
    const { store } = memoryDisk({ [FILE]: V1_FILE });

    expect(store.loadPrefs(SESSION)).toEqual({ model: 'opus', effort: 'high' });
  });

  it('write_sobreFicheroV1_dejaRespaldoYEscribeV2', () => {
    const { store, files } = memoryDisk({ [FILE]: V1_FILE });

    store.savePrefs(SESSION, { permissionMode: 'plan' });

    expect(files.get(`${FILE}.v1.bak`)).toBe(V1_FILE);
    expect(JSON.parse(files.get(FILE) ?? '{}')).toMatchObject({ version: 2, conversations: { [SESSION]: { model: 'opus', effort: 'high', permissionMode: 'plan' } } });
  });

  it('write_respaldoYaExistente_noLoPisa', () => {
    const { store, files } = memoryDisk({ [FILE]: V1_FILE, [`${FILE}.v1.bak`]: 'anterior' });

    store.savePrefs(SESSION, { model: 'haiku' });

    expect(files.get(`${FILE}.v1.bak`)).toBe('anterior');
  });

  it('read_versionFutura_indiceVacioSinLanzar', () => {
    const { store } = memoryDisk({ [FILE]: JSON.stringify({ version: 3, conversations: { [SESSION]: { model: 'opus' } }, artifacts: {} }) });

    expect(store.loadPrefs(SESSION)).toBeNull();
  });

  it('resolveConversation_entradaV1SinNativeRef_reutilizaSuClaveYLaCompleta', () => {
    const { store, files } = memoryDisk({ [FILE]: V1_FILE });
    const ref = { provider: 'claude', accountDir: '/home/u/.claude', nativeId: SESSION };

    const resolved = store.resolveConversation(ref);

    expect(resolved).toEqual({ conversationId: SESSION, lastSeq: 0 });
    expect(JSON.parse(files.get(FILE) ?? '{}').conversations[SESSION]).toEqual({ model: 'opus', effort: 'high', nativeRef: ref });
  });

  it('resolveConversation_conversacionNueva_creaLaEntradaConSuIdNativo', () => {
    const { store } = memoryDisk();

    expect(store.resolveConversation(CODEX_REF)).toEqual({ conversationId: 'thread-1', lastSeq: 0 });
    expect(store.loadPrefs('thread-1')).toBeNull();
  });

  it('resolveConversation_dosVeces_noReescribeSiNadaCambia', () => {
    const writeFile = vi.fn();
    let content = '';
    const store = new ConversationIndexStore(buildDeps({
      exists: () => content.length > 0,
      readFile: () => content,
      writeFile: (_path, data) => { writeFile(); content = data; },
    }));
    store.resolveConversation(CODEX_REF);

    store.resolveConversation(CODEX_REF);

    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('resolveConversation_otraCuenta_actualizaLaCuentaDeLaSesionNativa', () => {
    const { store } = memoryDisk();
    store.resolveConversation(CODEX_REF);

    store.resolveConversation({ ...CODEX_REF, accountDir: '/home/u/.codex-2' });

    expect(store.nativeRefOf('thread-1')).toEqual({ ...CODEX_REF, accountDir: '/home/u/.codex-2' });
  });

  it('recordLastSeq_yResolve_devuelveLaUltimaSecuencia', () => {
    const { store } = memoryDisk();
    store.resolveConversation(CODEX_REF);

    store.recordLastSeq('thread-1', 42);

    expect(store.resolveConversation(CODEX_REF).lastSeq).toBe(42);
  });

  it('recordLastSeq_menorQueLaGuardada_noRetrocede', () => {
    const { store } = memoryDisk();
    store.resolveConversation(CODEX_REF);
    store.recordLastSeq('thread-1', 42);

    store.recordLastSeq('thread-1', 7);

    expect(store.resolveConversation(CODEX_REF).lastSeq).toBe(42);
  });

  it('recordLastSeq_conversacionDesconocida_noCreaNada', () => {
    const { store, files } = memoryDisk();

    store.recordLastSeq('nadie', 3);

    expect(files.has(FILE)).toBe(false);
  });

  it('prefs_porIdNativoDeUnaEntradaConOtraClave_usanLaEntrada', () => {
    // Una conversación cuya sesión nativa cambió (bifurcar, mover de cuenta) se sigue encontrando por el id
    // nativo nuevo: las preferencias no se pierden ni se duplican.
    const { store, files } = memoryDisk({ [FILE]: JSON.stringify({ version: 2, conversations: { 'conv-a': { model: 'opus', nativeRef: CODEX_REF } }, artifacts: {} }) });

    store.savePrefs('thread-1', { effort: 'low' });

    expect(store.loadPrefs('thread-1')).toEqual({ model: 'opus', effort: 'low' });
    expect(Object.keys(JSON.parse(files.get(FILE) ?? '{}').conversations)).toEqual(['conv-a']);
  });

  it('forgetConversation_porIdNativo_borraLaEntrada', () => {
    const { store } = memoryDisk({ [FILE]: JSON.stringify({ version: 2, conversations: { 'conv-a': { model: 'opus', nativeRef: CODEX_REF } }, artifacts: {} }) });

    store.forgetConversation('thread-1');

    expect(store.loadPrefs('thread-1')).toBeNull();
    expect(store.nativeRefOf('conv-a')).toBeNull();
  });

  it('resolveConversation_idNativoVacio_lanzaConElValor', () => {
    expect(() => memoryDisk().store.resolveConversation({ ...CODEX_REF, nativeId: '' })).toThrow(/nativeId vacio/);
  });
});

describe('ConversationIndexStore — delegación (H3)', () => {
  const record = { createdBy: { conversationId: 'parent', requestId: 'req-1', at: '2026-11-03T10:00:00.000Z' }, creatorChain: ['root', 'parent'] };

  it('recordDelegation_thenDelegationOf_roundTrip', () => {
    const { store } = memoryDisk();

    store.recordDelegation('child', record);

    expect(store.delegationOf('child')).toEqual(record);
  });

  it('delegationOf_unknown_returnsManual', () => {
    expect(memoryDisk().store.delegationOf('nada')).toEqual({ createdBy: null, creatorChain: [] });
  });

  it('recordDelegation_keepsPrefs', () => {
    const { store } = memoryDisk();
    store.savePrefs('child', { model: 'opus' });

    store.recordDelegation('child', record);

    expect(store.loadPrefs('child')).toEqual({ model: 'opus' });
  });

  it('load_corruptCreatedBy_ignoredOthersKept', () => {
    const file = JSON.stringify({ version: 2, conversations: { c: { model: 'opus', createdBy: { conversationId: '', requestId: 'r', at: 'ayer' }, creatorChain: ['a'] } }, artifacts: {} });
    const { store } = memoryDisk({ [FILE]: file });

    expect(store.delegationOf('c')).toEqual({ createdBy: null, creatorChain: ['a'] });
    expect(store.loadPrefs('c')).toEqual({ model: 'opus' });
  });

  it('recordDelegation_chainTooLong_throwsWithLength', () => {
    const { store } = memoryDisk();

    expect(() => store.recordDelegation('c', { createdBy: null, creatorChain: ['1', '2', '3', '4', '5', '6'] })).toThrow('6');
  });
});

describe('ConversationIndexStore — sesiones del host', () => {
  const OWNER = '/h/.claude-inval';
  const record = { accountId: OWNER, provider: 'claude', model: 'claude-haiku-4-5', effort: 'low', permissionMode: 'default' } as const;

  it('recordHostSession_newConversation_savesPrefsAndOwner', () => {
    const store = memoryStore();

    store.recordHostSession('conv-1', record);

    expect(store.loadPrefs('conv-1')).toEqual({
      model: 'claude-haiku-4-5',
      effort: 'low',
      permissionMode: 'default',
      accountId: OWNER,
      hostOwnerAccountId: OWNER,
    });
  });

  it('recordHostSession_codexProvider_savesProvider', () => {
    const store = memoryStore();

    store.recordHostSession('conv-1', { ...record, provider: 'codex' });

    expect(store.loadPrefs('conv-1')?.provider).toBe('codex');
  });

  it('savePrefs_afterHostSession_keepsOwner', () => {
    const store = memoryStore();
    store.recordHostSession('conv-1', record);

    store.savePrefs('conv-1', { accountId: '/h/.claude-otra', model: 'm2', hostOwnerAccountId: '/h/.claude-otra' });

    const prefs = store.loadPrefs('conv-1');
    expect(prefs?.hostOwnerAccountId).toBe(OWNER);
    expect(prefs?.accountId).toBe('/h/.claude-otra');
  });

  it('recordHostSession_byNativeId_writesResolvedEntry', () => {
    const store = memoryStore();
    const { conversationId } = store.resolveConversation({ provider: 'codex', accountDir: '/h/.codex', nativeId: 'n-1' });

    store.recordHostSession('n-1', { ...record, provider: 'codex' });

    expect(store.loadPrefs(conversationId)?.hostOwnerAccountId).toBe(OWNER);
  });

  it('recordHostSession_emptyId_throws', () => {
    expect(() => memoryStore().recordHostSession('', record)).toThrow('id vacio al guardar la sesion del host');
  });

  it('recordHostSession_emptyAccount_throws', () => {
    expect(() => memoryStore().recordHostSession('conv-1', { ...record, accountId: '' })).toThrow('cuenta vacia en la sesion del host conv-1');
  });
});

// P-038 (lag): el historial del lateral pregunta por cientos de conversaciones en cada refresco; antes cada pregunta
// releía y revalidaba el fichero entero en el hilo de main.
describe('ConversationIndexStore — lectura una sola vez', () => {
  it('loadPrefs_muchasConsultas_leeElDiscoUnaVez', () => {
    let content = '';
    const readFile = vi.fn(() => content);
    const store = new ConversationIndexStore(buildDeps({ exists: () => content.length > 0, readFile, writeFile: (_p, data) => { content = data; } }));
    store.savePrefs(SESSION, { accountId: 'C:/Users/u/.claude-p' });
    readFile.mockClear();

    for (let i = 0; i < 300; i += 1) store.loadPrefs(i % 2 === 0 ? SESSION : `otra-${i}`);

    expect(readFile).toHaveBeenCalledTimes(0);
    expect(store.loadPrefs(SESSION)?.accountId).toBe('C:/Users/u/.claude-p');
  });

  it('loadPrefs_tiendaNueva_leeElFicheroLaPrimeraVez', () => {
    const readFile = vi.fn(() => '{}');
    const store = new ConversationIndexStore(buildDeps({ readFile }));

    store.loadPrefs('a');
    store.loadPrefs('b');

    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
