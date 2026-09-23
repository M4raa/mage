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
