import { z } from 'zod';
import type { SlashCommandInfo } from '@shared/events';
import type { ProviderModel } from '@shared/providers';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

// Cache en disco del catalogo de comandos "/" POR CUENTA (2.2), en userData/command-catalog.json.
//
// Existe porque `ensureSession` es PEREZOSO: en una conversacion recien abierta no hay sesion viva, y
// sin esto el popover ofrece los 12 comandos curados en vez de los ~159 del usuario — que es
// exactamente el sintoma que motivo el punto. Se REESCRIBE entera cada vez que una sesion reporta su
// catalogo (nunca se fusiona: un plugin desinstalado tiene que desaparecer).
//
// Es CACHE, no ajuste: por eso no vive en `app-settings.json` (que edita el usuario) ni en el indice de
// conversaciones (que se escribe poco y guarda dato bueno). Mismo patron que WorkspaceStore: DI del FS,
// lectura tolerante (fichero ausente/corrupto -> vacio, que es el comportamiento de antes de la cache)
// y escritura atomica.
export const COMMAND_CATALOG_VERSION = 1;

export interface CommandCatalogEntry {
  readonly measuredAtMs: number;
  readonly commands: readonly SlashCommandInfo[];
  // Catalogo de modelos de la cuenta (P-026 2.4), del MISMO `initialize` que los comandos. Opcional: un
  // fichero de antes no lo trae y sigue valiendo (misma version).
  readonly models?: readonly ProviderModel[];
}

export interface CommandCatalogFile {
  readonly version: number;
  readonly byAccount: Readonly<Record<string, CommandCatalogEntry>>; // clave: config dir EFECTIVO
}

const COMMAND_SCHEMA = z.object({
  name: z.string().min(1),
  description: z.string(),
  argumentHint: z.string().nullable(),
  aliases: z.array(z.string()),
});

const MODEL_SCHEMA = z.object({ id: z.string().min(1), label: z.string() });

const ENTRY_SCHEMA = z.object({
  measuredAtMs: z.number().int().nonnegative(),
  commands: z.array(COMMAND_SCHEMA),
  models: z.array(MODEL_SCHEMA).optional(),
});

const CATALOG_FILE_SCHEMA = z.object({
  version: z.number(),
  byAccount: z.record(z.string(), ENTRY_SCHEMA),
});

export interface CommandCatalogStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
}

const EMPTY_COMMANDS: readonly SlashCommandInfo[] = [];
const EMPTY_MODELS: readonly ProviderModel[] = [];

export class CommandCatalogStore {
  constructor(private readonly deps: CommandCatalogStoreDeps) {}

  // Catalogo cacheado de UNA cuenta. Vacio si no hay fichero, esta corrupto, es de otra version o esa
  // cuenta no tiene entrada: en todos esos casos el comportamiento correcto es el de siempre (los
  // comandos curados), nunca un error.
  load(accountDir: string): readonly SlashCommandInfo[] {
    const file = this.readFileOrNull();
    return file?.byAccount[accountDir]?.commands ?? EMPTY_COMMANDS;
  }

  // Reescribe el catalogo de UNA cuenta conservando el de las demas. `measuredAtMs` lo pasa el llamante
  // (main tiene el reloj; este modulo no lo inventa) para que el fichero diga cuando se midio.
  save(accountDir: string, commands: readonly SlashCommandInfo[], measuredAtMs: number): void {
    // Los modelos de la entrada se conservan: los comandos y los modelos se cachean por separado.
    this.writeEntry(accountDir, measuredAtMs, (entry) => ({ ...entry, commands }));
  }

  // Modelos cacheados de UNA cuenta. Vacio en los mismos casos que `load`: entonces el selector usa la
  // lista de reserva, que es lo de antes de la cache.
  loadModels(accountDir: string): readonly ProviderModel[] {
    return this.readFileOrNull()?.byAccount[accountDir]?.models ?? EMPTY_MODELS;
  }

  saveModels(accountDir: string, models: readonly ProviderModel[], measuredAtMs: number): void {
    this.writeEntry(accountDir, measuredAtMs, (entry) => ({ ...entry, models }));
  }

  // Olvida las entradas de una cuenta borrada: la suya y la de su perfil privado (P-028, punto 30).
  // Sin fichero o sin entradas de esa cuenta, no escribe nada.
  forgetAccount(configDir: string, isOwnedBy: (key: string) => boolean): void {
    if (configDir.length === 0) throw new Error(`Config dir vacio al olvidar el catalogo: ${JSON.stringify(configDir)}`);
    const current = this.readFileOrNull();
    if (current === null) return;
    const kept = Object.entries(current.byAccount).filter(([key]) => !isOwnedBy(key));
    if (kept.length === Object.keys(current.byAccount).length) return;
    const next: CommandCatalogFile = { version: COMMAND_CATALOG_VERSION, byAccount: Object.fromEntries(kept) };
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(next, null, 2));
  }

  private writeEntry(accountDir: string, measuredAtMs: number, update: (entry: CommandCatalogEntry) => CommandCatalogEntry): void {
    if (accountDir.length === 0) {
      throw new Error(`Config dir vacio al guardar el catalogo de comandos: ${JSON.stringify(accountDir)}`);
    }
    const current = this.readFileOrNull();
    const previous = current?.byAccount[accountDir] ?? { measuredAtMs, commands: EMPTY_COMMANDS };
    const next: CommandCatalogFile = {
      version: COMMAND_CATALOG_VERSION,
      byAccount: { ...(current?.byAccount ?? {}), [accountDir]: update({ ...previous, measuredAtMs }) },
    };
    const result = CATALOG_FILE_SCHEMA.safeParse(next);
    if (!result.success) {
      throw new Error(`Catalogo de comandos invalido al guardar: ${result.error.message}`);
    }
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(result.data, null, 2));
  }

  private readFileOrNull(): CommandCatalogFile | null {
    if (!this.deps.exists(this.deps.filePath)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.deps.readFile(this.deps.filePath));
    } catch (err) {
      // B9, la misma leccion que en los otros cuatro stores: un JSON corrupto SI justifica descartar
      // (es cache y se regenera), pero un EACCES/EBUSY —antivirus reteniendo el fichero en Windows—
      // no. Tragandolo, el `save()` siguiente reconstruia el fichero con SOLO la cuenta actual y las
      // demas perdian su catalogo hasta correr un turno.
      if (!(err instanceof SyntaxError)) {
        throw new Error(`No se pudo leer ${this.deps.filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return null; // JSON corrupto: es cache, se regenera al primer turno
    }
    const result = CATALOG_FILE_SCHEMA.safeParse(parsed);
    if (!result.success) return null;
    // Version desconocida: se descarta entera en vez de intentar interpretarla. Es cache.
    return result.data.version === COMMAND_CATALOG_VERSION ? result.data : null;
  }
}
