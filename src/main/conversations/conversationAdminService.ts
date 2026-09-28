import { dirname, join } from 'node:path';
import type {
  DeleteConversationParams,
  MoveConversationParams,
  MoveConversationResult,
} from '@shared/conversations';
import type { ConversationPrivacy } from '@shared/state';
import { resolveTranscriptPath } from '../transcripts/transcriptPath';
import { pathEquals } from '../os/pathUtils';

// Borra y mueve conversaciones EN DISCO (#2 de AJUSTES): reubica/elimina el `.jsonl` de la sesion (y
// su carpeta de subagentes) bajo el projects/ del dir efectivo. Solo FS con DI -> testeable. La
// resolucion del perfil privado se inyecta (la sabe AccountService); NO se hardcodea aqui.

export interface ConversationAdminDeps {
  readonly exists: (path: string) => boolean;
  readonly removeFile: (path: string) => void;
  readonly removeDir: (path: string) => void; // recursivo
  readonly ensureDir: (path: string) => void; // mkdir -p del directorio destino
  readonly move: (from: string, to: string) => void; // rename (mismo volumen)
  // Ruta REAL (sigue enlaces). `projects/` es un junction COMPARTIDO entre cuentas, asi que dos rutas
  // distintas pueden ser el mismo fichero.
  readonly realpath: (path: string) => string;
  // Ruta del perfil privado de una cuenta SIN crearlo (para el ORIGEN, que ya existe).
  readonly privateProfileDir: (accountDir: string) => string;
  // Ruta del perfil privado CREANDOLO si falta (para el DESTINO privado).
  readonly ensurePrivateProfile: (accountDir: string) => string;
}

export class ConversationAdminService {
  constructor(private readonly deps: ConversationAdminDeps) {}

  // Elimina la transcripcion de una conversacion y su carpeta de subagentes (si existe). Idempotente:
  // si el fichero ya no esta, no falla (el objetivo —que no exista— se cumple igual).
  deleteConversation(params: DeleteConversationParams): void {
    const effective = this.sourceDir(params.accountDir, params.privacy);
    const file = resolveTranscriptPath(effective, params.cwd, params.sessionId);
    if (this.deps.exists(file)) this.deps.removeFile(file);
    const subagents = join(dirname(file), params.sessionId);
    if (this.deps.exists(subagents)) this.deps.removeDir(subagents);
  }

  // Mueve la transcripcion (y subagentes) al projects/ del destino. Devuelve el dir efectivo destino
  // (la pestana lo usa como configDir para reanudar/localizar la conversacion movida).
  moveConversation(params: MoveConversationParams): MoveConversationResult {
    const srcDir = this.sourceDir(params.accountDir, params.privacy);
    const destDir =
      params.destPrivacy === 'private'
        ? this.deps.ensurePrivateProfile(params.destAccountDir)
        : params.destAccountDir;

    const srcFile = resolveTranscriptPath(srcDir, params.cwd, params.sessionId);
    const destFile = resolveTranscriptPath(destDir, params.cwd, params.sessionId);
    if (srcFile === destFile) return { configDir: destDir }; // mismo destino: nada que mover
    // Conversacion COMPARTIDA entre cuentas (P-026 2.7): `projects/` es un junction a la misma carpeta
    // en todas, asi que el «destino» es el mismo fichero y `assertFreeDestination` lanzaba «El destino
    // ya existe». No hay nada que mover: basta con reabrirla bajo la otra cuenta.
    if (this.isSameFile(srcFile, destFile)) return { configDir: destDir };

    if (!this.deps.exists(srcFile)) {
      throw new Error(`No existe la transcripcion a mover: ${srcFile}`);
    }
    // El destino NO se pisa nunca. `rename` no protege de esto y ademas se comporta distinto en cada
    // SO: en POSIX sobrescribe en SILENCIO (se perderia la transcripcion que hubiera en el destino) y
    // en Windows falla con un error crudo sin contexto. Puede pasar de verdad: mover A->B y luego
    // B->A cuando quedo un residuo, o un movimiento anterior interrumpido a medias.
    this.assertFreeDestination(destFile, srcFile);
    const destSub = join(dirname(destFile), params.sessionId);
    const srcSub = join(dirname(srcFile), params.sessionId);
    if (this.deps.exists(srcSub)) this.assertFreeDestination(destSub, srcSub);

    this.deps.ensureDir(dirname(destFile));
    this.deps.move(srcFile, destFile);
    if (this.deps.exists(srcSub)) this.deps.move(srcSub, destSub);
    return { configDir: destDir };
  }

  // Precondicion de no-colision: mejor abortar el movimiento entero con las dos rutas que destruir
  // datos o dejarlo a medias. Se comprueba ANTES de mover nada (el .jsonl y los subagentes se validan
  // juntos, para no mover el fichero y morir despues con la carpeta).
  private assertFreeDestination(destination: string, source: string): void {
    if (!this.deps.exists(destination)) return;
    throw new Error(
      `El destino ya existe y no se sobrescribe: "${destination}" (origen: "${source}"). ` +
        'Borra o renombra el destino antes de mover la conversacion.',
    );
  }

  private isSameFile(a: string, b: string): boolean {
    if (!this.deps.exists(a) || !this.deps.exists(b)) return false;
    return pathEquals(this.deps.realpath(a), this.deps.realpath(b));
  }

  // Dir efectivo de ORIGEN: el perfil privado (sin crearlo, ya existe) o la cuenta tal cual.
  private sourceDir(accountDir: string, privacy: ConversationPrivacy): string {
    return privacy === 'private' ? this.deps.privateProfileDir(accountDir) : accountDir;
  }
}
