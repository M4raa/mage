import { expect, it } from 'vitest';
import { SecretStore } from './secretStore';

// H2: defensa por backend. No afirma que Electron 44 devuelva true con basic_text;
// esa combinación se inyecta para exigir un rechazo independiente de disponibilidad.
it.each(['basic_text', 'unknown'])('A12_backend_%s_debeRechazarseAunqueDisponibilidadSeaTrue', (backend) => {
  const files = new Map<string, string>();
  const cipher = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  };
  const store = new SecretStore({
    filePath: '/isolated/secrets.json', cipher,
    exists: (p) => files.has(p), readFile: (p) => files.get(p) ?? '',
    writeFile: (p, value) => { files.set(p, value); },
    rename: (from, to) => { files.set(to, files.get(from) ?? ''); files.delete(from); },
    tempSuffix: () => 'fixture',
  });
  expect(() => store.set('synthetic-id', 'synthetic-non-secret')).toThrow();
  expect(files.size).toBe(0);
});
