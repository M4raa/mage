import { describe, expect, it } from 'vitest';
import { SecretStore, type SecretCipher } from './secretStore';

const FILE = '/userData/secrets.json';

// `safeStorage` falso: "cifra" invirtiendo y marcando el texto, asi el test puede afirmar que en disco
// NO queda el valor en claro sin depender de DPAPI.
function fakeCipher(overrides: Partial<SecretCipher> = {}): SecretCipher {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`, 'utf8'),
    decryptString: (encrypted) => {
      const text = encrypted.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('no es de este usuario');
      return [...text.slice('enc:'.length)].reverse().join('');
    },
    ...overrides,
  };
}

// FS en memoria (writeAtomic escribe un temporal y lo renombra).
function memoryStore(cipher: SecretCipher = fakeCipher(), initial?: string): { store: SecretStore; files: Map<string, string> } {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set(FILE, initial);
  let counter = 0;
  const store = new SecretStore({
    filePath: FILE,
    cipher,
    exists: (path) => files.has(path),
    readFile: (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT ${path}`);
      return content;
    },
    writeFile: (path, data) => void files.set(path, data),
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
    tempSuffix: () => String((counter += 1)),
  });
  return { store, files };
}

describe('SecretStore', () => {
  it('set_yLuegoGet_devuelveElValorYEnDiscoNoEstaEnClaro', () => {
    const { store, files } = memoryStore();

    store.set('provider-api-key:custom:x', 'sk-super-secreta');

    expect(store.get('provider-api-key:custom:x')).toBe('sk-super-secreta');
    expect(files.get(FILE)).not.toContain('sk-super-secreta');
  });

  it('has_conYSinSecreto_diceSiExisteSinDescifrar', () => {
    let decrypts = 0;
    const { store } = memoryStore(
      fakeCipher({
        decryptString: () => {
          decrypts += 1;
          return '';
        },
      }),
    );
    store.set('a', 'valor');

    expect(store.has('a')).toBe(true);
    expect(store.has('b')).toBe(false);
    expect(decrypts).toBe(0);
  });

  it('get_sinFichero_devuelveNull', () => {
    const { store } = memoryStore();

    expect(store.get('a')).toBeNull();
    expect(store.has('a')).toBe(false);
  });

  it('delete_existente_loQuitaYConservaElResto', () => {
    const { store } = memoryStore();
    store.set('a', '1');
    store.set('b', '2');

    store.delete('a');

    expect(store.has('a')).toBe(false);
    expect(store.get('b')).toBe('2');
  });

  it('delete_inexistente_noEscribeNada', () => {
    const { store, files } = memoryStore();

    store.delete('a');

    expect(files.has(FILE)).toBe(false);
  });

  it('set_sinCifradoDisponible_lanzaYNoEscribe', () => {
    const { store, files } = memoryStore(fakeCipher({ isEncryptionAvailable: () => false }));

    expect(() => store.set('a', 'sk')).toThrow(/cifrado del sistema no esta disponible/);
    expect(files.has(FILE)).toBe(false);
  });

  it('set_valorVacio_lanza', () => {
    const { store } = memoryStore();

    expect(() => store.set('a', '')).toThrow(/"a"/);
  });

  it('set_idVacio_lanzaConElValorRecibido', () => {
    const { store } = memoryStore();

    expect(() => store.set('  ', 'x')).toThrow(/"  "/);
  });

  it('get_ficheroCorrupto_lanzaEnVezDeLeerloComoVacio', () => {
    // Leerlo como vacio haria que el siguiente set lo sobrescribiera: se perderian todos los secretos.
    const { store } = memoryStore(fakeCipher(), '{ esto no es json');

    expect(() => store.get('a')).toThrow(/no es JSON valido/);
    expect(() => store.set('a', 'x')).toThrow(/no es JSON valido/);
  });

  it('get_formaInesperada_lanza', () => {
    const { store } = memoryStore(fakeCipher(), JSON.stringify({ version: 2, secrets: {} }));

    expect(() => store.has('a')).toThrow(/forma esperada/);
  });

  it('get_cifradoPorOtroUsuario_lanzaSinCitarElCifrado', () => {
    const initial = JSON.stringify({ version: 1, secrets: { a: Buffer.from('ajeno').toString('base64') } });
    const { store } = memoryStore(fakeCipher(), initial);

    expect(() => store.get('a')).toThrow(/No se pudo descifrar el secreto "a": no es de este usuario/);
  });
});
