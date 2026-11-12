import { join } from 'node:path';

// Migración de las conversaciones privadas (retiradas de Mage el 2026-11-12).
//
// T-B3a: las conversaciones «normales» viven en `<cuenta>/projects`. Al arrancar, lo que haya en
// `<cuenta>/mage-private/projects/<enc>/<entrada>` (transcripciones `.jsonl`, carpetas de subagentes,
// `memory`…) se MUEVE a `<cuenta>/projects/<enc>/<entrada>`, entrada a entrada y sin pisar NUNCA nada:
// si el destino existe, la entrada se queda donde está y se anota. Es idempotente: con el origen ya
// vacío no hace nada.
//
// T-B3b: las carpetas `mage-private` NO se borran nunca (no se barren: tienen credenciales propias).
// Mage solo deja de crearlas y de usarlas.

const PRIVATE_PROFILE_DIR = 'mage-private';
const PROJECTS_DIR = 'projects';

// Dónde vivía el perfil privado de una cuenta. Lo usa también el borrado de cuenta, para desenlazar
// los enlaces que ese perfil antiguo conserve hacia el comun.
export function retiredProfileDirOf(accountDir: string): string {
  return join(accountDir, PRIVATE_PROFILE_DIR);
}

export interface PrivateMigrationDeps {
  readonly exists: (path: string) => boolean;
  readonly listDir: (path: string) => readonly string[];
  readonly isDirectory: (path: string) => boolean;
  readonly ensureDir: (path: string) => void;
  readonly move: (from: string, to: string) => void;
  readonly log: (level: 'info' | 'warn', message: string) => void;
}

export interface PrivateMigrationResult {
  readonly moved: number;
  readonly skipped: number;
}

// Mueve UNA entrada; devuelve true si se movió. Un fallo se anota y cuenta como saltada.
function moveEntry(from: string, toDir: string, to: string, deps: PrivateMigrationDeps): boolean {
  if (deps.exists(to)) {
    deps.log('warn', `Conversación privada no movida: el destino ya existe (${from} -> ${to})`);
    return false;
  }
  try {
    deps.ensureDir(toDir);
    deps.move(from, to);
    return true;
  } catch (error) {
    deps.log('warn', `Conversación privada no movida (${from} -> ${to}): ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// Migra UNA cuenta. Una entrada que no es carpeta (un fichero suelto) se salta sin listarla.
function migrateAccount(account: string, deps: PrivateMigrationDeps): PrivateMigrationResult {
  let moved = 0;
  let skipped = 0;
  const source = join(account, PRIVATE_PROFILE_DIR, PROJECTS_DIR);
  if (!deps.exists(source)) return { moved, skipped };
  for (const encoded of deps.listDir(source)) {
    if (!deps.isDirectory(join(source, encoded))) continue;
    const toDir = join(account, PROJECTS_DIR, encoded);
    for (const name of deps.listDir(join(source, encoded))) {
      if (moveEntry(join(source, encoded, name), toDir, join(toDir, name), deps)) moved++;
      else skipped++;
    }
  }
  return { moved, skipped };
}

export function migratePrivateConversations(accountDirs: readonly string[], deps: PrivateMigrationDeps): PrivateMigrationResult {
  let moved = 0;
  let skipped = 0;
  for (const account of accountDirs) {
    try {
      const result = migrateAccount(account, deps);
      moved += result.moved;
      skipped += result.skipped;
    } catch (error) {
      // La migración nunca puede tumbar el arranque: se anota la cuenta y se sigue con la siguiente.
      deps.log('warn', `Conversaciones privadas no migradas en ${account}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (moved + skipped > 0) deps.log('info', `Conversaciones privadas pasadas al historial normal: ${moved} movidas, ${skipped} sin mover`);
  return { moved, skipped };
}
