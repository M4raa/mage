// Modo bench de verify:gui sin credenciales del usuario: una cuenta de Claude por clave de API DESECHABLE que da quien lo
// lanza, y la comprobación de que las credenciales del usuario no cambian ni se copian.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const BENCH_KEY_ENV = 'MAGE_BENCH_ANTHROPIC_API_KEY';
const CREDENTIAL_NAMES = new Set(['.credentials.json', 'auth.json']);

export function benchApiKey(provider, env) {
  if (provider !== 'claude') throw new Error(`--bench solo admite --provider=claude con una clave de API desechable (recibido: ${JSON.stringify(provider)})`);
  const key = env[BENCH_KEY_ENV];
  if (typeof key !== 'string' || key.trim().length === 0) throw new Error(`--bench no copia credenciales: exporta ${BENCH_KEY_ENV} con una clave de API DESECHABLE`);
  return key.trim();
}

// La cuenta de Claude que el bench acaba de dar de alta, por su carpeta (la casa de prueba trae además una `.claude` vacía).
// En el renderer el id de una cuenta de Claude ES su config dir: la cuenta no tiene otro campo con la carpeta.
export function benchAccountId(accounts, configDir) {
  const match = accounts.find((a) => a.providerId === 'claude' && a.id === configDir);
  if (match === undefined) {
    const claude = accounts.filter((a) => a.providerId === 'claude').length;
    throw new Error(`Mage no ve la cuenta del bench entre sus ${claude} cuentas de Claude`);
  }
  return match.id;
}

// Los ficheros de credenciales del usuario que el bench nunca debe cambiar ni copiar.
export function userCredentialFiles(home) {
  return [path.join(home, '.claude', '.credentials.json'), path.join(home, '.codex', 'auth.json')];
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Huella de cada fichero (null si no existe). Nunca se imprime el contenido.
export function credentialFingerprints(files) {
  return Object.fromEntries(files.map((file) => [file, fs.existsSync(file) ? sha256(file) : null]));
}

// Ficheros con nombre de credencial bajo `root` cuyo contenido es IGUAL al de alguno del usuario.
export function copiesUnder(root, fingerprints) {
  const wanted = new Set(Object.values(fingerprints).filter((value) => value !== null));
  if (wanted.size === 0 || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && CREDENTIAL_NAMES.has(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => wanted.has(sha256(file)));
}

// Compara dos huellas: los ficheros del usuario que cambiaron entre el principio y el final del bench.
export function changedFiles(before, after) {
  return Object.keys(before).filter((file) => before[file] !== after[file]);
}
