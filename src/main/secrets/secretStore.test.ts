import { describe, expect, it } from 'vitest';
import { foreignText } from '@shared/i18n/localizedText';
import { jsonMessage, thrownText } from '@testing/localizedText';
import { SecretStore, type SecretCipher } from './secretStore';
import type { VaultStatus } from './vaultGate';

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
function memoryStore(cipher: SecretCipher = fakeCipher(), initial?: string, status?: () => VaultStatus): { store: SecretStore; files: Map<string, string> } {
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
    removeFile: () => undefined,
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
    tempSuffix: () => String((counter += 1)),
    ...(status === undefined ? {} : { status }),
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

  it('get_ficheroCorrupto_lanzaLaClaveConElMensajeDeJsonComoDetalle', () => {
    const { store } = memoryStore(fakeCipher(), '{ esto no es json');

    const text = thrownText(() => store.get('a'));

    expect(text.key).toBe('errors.vault.fileInvalidJson');
    expect(text.values).toEqual({ path: FILE });
    expect(text.parts?.['detail']).toEqual(foreignText(jsonMessage('{ esto no es json')));
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

  it('get_cifradoPorOtroUsuario_lanzaLaClaveConElIdYElErrorDelCifrado', () => {
    const initial = JSON.stringify({ version: 1, secrets: { a: Buffer.from('ajeno').toString('base64') } });
    const { store } = memoryStore(fakeCipher(), initial);

    const text = thrownText(() => store.get('a'));

    expect(text).toEqual({ key: 'errors.vault.decryptFailed', values: { id: '"a"' }, parts: { detail: foreignText('no es de este usuario') } });
  });

  it('set_sinCifradoDisponible_lanzaLaClaveDelCifrado', () => {
    const { store } = memoryStore(fakeCipher({ isEncryptionAvailable: () => false }));

    expect(thrownText(() => store.set('a', 'x')).key).toBe('errors.vault.cipherUnavailable');
  });
});


describe('A12 — lectura con backend inseguro', () => {
  it.each(['basic_text', 'unknown'])('get_backend_%s_rechazaSinDescifrar', backend => {
    let selected = 'gnome_libsecret';
    let decrypts = 0;
    const cipher = fakeCipher({ getSelectedStorageBackend: () => selected });
    const { store } = memoryStore({ ...cipher, decryptString: encrypted => { decrypts++; return cipher.decryptString(encrypted); } });
    store.set('fixture', 'dato artificial');
    selected = backend;
    expect(() => store.get('fixture')).toThrow(/backend de cifrado/);
    expect(decrypts).toBe(0);
    expect(store.has('fixture')).toBe(true);
    store.delete('fixture');
    expect(store.has('fixture')).toBe(false);
  });
});


it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])('A12_backendSeguro_%s_conservaRoundTrip', backend => {
  const { store } = memoryStore(fakeCipher({ getSelectedStorageBackend: () => backend }));
  store.set('fixture', 'dato artificial');
  expect(store.get('fixture')).toBe('dato artificial');
});

it('A12_backendSeguroSinDisponibilidad_rechazaEscrituraYLectura', () => {
  let available = true;
  const { store, files } = memoryStore(fakeCipher({ getSelectedStorageBackend: () => 'gnome_libsecret', isEncryptionAvailable: () => available }));
  store.set('fixture', 'dato artificial');
  const before = files.get(FILE);
  available = false;
  expect(() => store.set('otro', 'otro dato artificial')).toThrow(/cifrado del sistema no esta disponible/);
  expect(() => store.get('fixture')).toThrow(/cifrado del sistema no esta disponible/);
  expect(files.get(FILE)).toBe(before);
});

// D1 (F2.7): sin bóveda usable, todo lo que cifra o descifra lanza el mensaje decidido al arrancar, sin tocar el cifrado.
describe('SecretStore con la bóveda no usable', () => {
  const D1 = 'No se puede crear ni usar esta cuenta de API: el llavero seguro de Linux está bloqueado.';
  const unusable = (): VaultStatus => ({ usable: false, reason: foreignText(D1) });

  it('setYGet_bovedaNoUsable_lanzanElMensajeD1SinCifrarNiDescifrar', () => {
    let calls = 0;
    const counting = fakeCipher({ encryptString: () => { calls += 1; return Buffer.from('x'); }, decryptString: () => { calls += 1; return 'x'; } });
    const { store } = memoryStore(counting, JSON.stringify({ version: 1, secrets: { guardado: 'eA==' } }), unusable);

    expect(() => store.set('nuevo', 'dato artificial')).toThrow(D1);
    expect(() => store.get('guardado')).toThrow(D1);
    expect(() => store.assertUsable()).toThrow(D1);
    expect(calls).toBe(0);
  });

  it('getHasDelete_bovedaNoUsable_loQueNoCifraSigueFuncionando', () => {
    const { store } = memoryStore(fakeCipher(), JSON.stringify({ version: 1, secrets: { guardado: 'eA==' } }), unusable);

    expect(store.get('no-existe')).toBeNull();
    expect(store.has('guardado')).toBe(true);
    store.delete('guardado');
    expect(store.has('guardado')).toBe(false);
  });

  it('assertUsable_bovedaUsable_noLanza', () => {
    const { store } = memoryStore(fakeCipher(), undefined, () => ({ usable: true }));

    expect(() => store.assertUsable()).not.toThrow();
  });
});
