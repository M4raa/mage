import { z } from 'zod';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

// Boveda de secretos del proceso main (claves de API de proveedores, secretos de extensiones).
//
// Cada valor se cifra con el cifrado del SO que ofrece Electron (`safeStorage`: DPAPI en Windows,
// ligado al usuario de Windows) y se guarda en base64 en un JSON de `userData`. El fichero NO contiene
// nada en claro: copiarlo a otra maquina u otro usuario no sirve para leerlo.
//
// Contrato con el renderer: el renderer NUNCA recibe un secreto. Puede guardar uno (sube una vez, al
// guardarlo), borrarlo y preguntar si existe (`has`); leerlo (`get`) es solo de main, que lo usa al
// reenviar una peticion o al lanzar un hijo.
//
// Sin cifrado disponible se NIEGA a guardar: un secreto en claro "de momento" es exactamente el fallo
// que esta boveda viene a quitar.

// El cifrado del SO. Se inyecta (en produccion, `electron.safeStorage`) para testear sin Electron.
export interface SecretCipher {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (plain: string) => Buffer;
  readonly decryptString: (encrypted: Buffer) => string;
}

export interface SecretStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
  readonly cipher: SecretCipher;
}

const SECRET_FILE_VERSION = 1;
const SECRET_FILE_SCHEMA = z.object({
  version: z.literal(SECRET_FILE_VERSION),
  secrets: z.record(z.string().min(1), z.string().min(1)),
});

type EncodedSecrets = Readonly<Record<string, string>>;

export class SecretStore {
  constructor(private readonly deps: SecretStoreDeps) {}

  set(id: string, value: string): void {
    requireId(id);
    if (value.length === 0) throw new Error(`Secreto vacio para ${JSON.stringify(id)}: para quitarlo se usa delete`);
    if (!this.deps.cipher.isEncryptionAvailable()) {
      throw new Error(`El cifrado del sistema no esta disponible: no se guarda el secreto ${JSON.stringify(id)} en claro`);
    }
    const encoded = this.deps.cipher.encryptString(value).toString('base64');
    this.write({ ...this.read(), [id]: encoded });
  }

  // El secreto descifrado, o null si no hay. Solo para main: nunca se devuelve por IPC.
  get(id: string): string | null {
    requireId(id);
    const encoded = this.read()[id];
    if (encoded === undefined) return null;
    try {
      return this.deps.cipher.decryptString(Buffer.from(encoded, 'base64'));
    } catch (err) {
      // Un secreto cifrado por otro usuario de Windows (fichero copiado) no se puede leer: se dice, sin
      // el valor cifrado en el mensaje.
      throw new Error(`No se pudo descifrar el secreto ${JSON.stringify(id)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  has(id: string): boolean {
    requireId(id);
    return this.read()[id] !== undefined;
  }

  delete(id: string): void {
    requireId(id);
    const secrets = this.read();
    if (secrets[id] === undefined) return;
    const { [id]: _removed, ...rest } = secrets;
    this.write(rest);
  }

  // Un fichero corrupto LANZA en vez de leerse como vacio: tratarlo como vacio haria que el siguiente
  // `set` lo sobrescribiera y se perderian todos los secretos que si eran legibles.
  private read(): EncodedSecrets {
    if (!this.deps.exists(this.deps.filePath)) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.deps.readFile(this.deps.filePath));
    } catch (err) {
      throw new Error(`La boveda ${this.deps.filePath} no es JSON valido: ${err instanceof Error ? err.message : String(err)}`);
    }
    const result = SECRET_FILE_SCHEMA.safeParse(parsed);
    if (!result.success) throw new Error(`La boveda ${this.deps.filePath} no tiene la forma esperada: ${result.error.message}`);
    return result.data.secrets;
  }

  private write(secrets: EncodedSecrets): void {
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify({ version: SECRET_FILE_VERSION, secrets }, null, 2));
  }
}

function requireId(id: string): void {
  if (id.trim().length === 0) throw new Error(`Id de secreto vacio: ${JSON.stringify(id)}`);
}
