// Estado de git de la carpeta de una conversacion (P-026 3.5, fase A). Cruza el IPC: solo datos, nada
// de rutas del binario ni salidas crudas.

export interface GitRepoState {
  readonly kind: 'repo';
  readonly branch: string | null; // null con la HEAD suelta
  readonly detached: boolean;
  readonly headShort: string | null; // 7 caracteres del commit; null en un repo sin commits
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly dirty: boolean;
  readonly added: number; // lineas, de `diff --numstat HEAD`
  readonly removed: number;
  readonly changedFiles: number; // seguidos con cambios (incluye los binarios)
  readonly untracked: number;
}

export type GitSnapshot =
  | { readonly kind: 'unavailable' } // no hay binario de git
  | { readonly kind: 'no-repo' }
  // Hay repo, pero la carpeta no es de confianza: sus hooks y su fsmonitor pueden ejecutar codigo, asi
  // que no se lanza git (D28).
  | { readonly kind: 'untrusted'; readonly repoRoot: string }
  | GitRepoState;

export interface GitParams {
  readonly cwd: string;
  readonly accountDir: string; // para la confianza: suma la de Mage y la del CLI de esa cuenta
}

export interface GitSwitchParams extends GitParams {
  readonly name: string;
}
