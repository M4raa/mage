import type { PersistedWorkspace } from '@shared/state';
import { WORKSPACE_SCHEMA } from '@shared/stateSchema';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

// Persistencia del estado del workspace (M2.5) en un JSON bajo userData. Solo FS, con DI ->
// testable sin tocar disco. La lectura es TOLERANTE (fichero ausente o corrupto -> null, arranque
// limpio): es una caché local no crítica, no un dato de negocio cuya corrupción deba abortar. La
// escritura es ATÓMICA (tmp + rename) para no dejar el fichero a medias ante un cierre abrupto.
// El mecanismo de escritura atomica (tmp con sufijo unico + rename) vive en os/atomicFile.ts. El
// sufijo unico importa especialmente aqui: con un nombre fijo, dos escrituras concurrentes (p.ej. dos
// instancias de Mage) comparten el mismo tmp y el rename de una publica el contenido a medio escribir
// de la otra; el load() tolerante devuelve null y el usuario pierde TODAS sus pestanas sin ver un error.
export interface WorkspaceStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
}

// El esquema (laxo en la frontera: valida forma y tipos e ignora campos extra) vive en
// `@shared/stateSchema` porque es de donde `PersistedWorkspace` DERIVA su tipo: declararlo aqui otra
// vez es lo que hizo que cuatro campos del tipo se perdieran al cargar y al guardar (Ronda 3, items
// 12 y 13). Un estado que no encaja se descarta (null) en vez de propagar datos corruptos al renderer.

export class WorkspaceStore {
  constructor(private readonly deps: WorkspaceStoreDeps) {}

  // Lee el estado persistido; null si no existe, no es JSON válido o no encaja con el esquema.
  load(): PersistedWorkspace | null {
    if (!this.deps.exists(this.deps.filePath)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.deps.readFile(this.deps.filePath));
    } catch (err) {
      // Solo un JSON MAL FORMADO justifica caer a defaults (B9). Un EACCES/EBUSY —antivirus o
      // agente de backup reteniendo el fichero, cosa habitual en Windows— era indistinguible del
      // JSON corrupto: se cargaban defaults y el siguiente `save()` SOBRESCRIBIA los datos reales
      // del usuario. Un fallo de lectura tiene que doler, no borrar.
      if (!(err instanceof SyntaxError)) {
        throw new Error(`No se pudo leer ${this.deps.filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return null; // JSON corrupto: arrancar limpio (caché local, no dato crítico)
    }
    const result = WORKSPACE_SCHEMA.safeParse(parsed);
    return result.success ? result.data : null;
  }

  // Guarda el estado de forma atómica. Valida la forma antes de escribir (contrato explícito: un
  // estado mal formado lanza con el detalle, nunca se escribe basura silenciosamente).
  save(state: PersistedWorkspace): void {
    const result = WORKSPACE_SCHEMA.safeParse(state);
    if (!result.success) {
      throw new Error(`Estado de workspace invalido al guardar: ${result.error.message}`);
    }
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(result.data, null, 2));
  }
}
