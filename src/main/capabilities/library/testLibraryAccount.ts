// Cuenta de Claude de PRUEBA para verify:gui: el harness aísla el userData pero no el HOME, y la biblioteca no
// puede escribir en las cuentas reales de la máquina. Solo sin empaquetar y solo DENTRO del userData (como T6).
import { isAbsolute, relative, resolve } from 'node:path';
import type { LibraryAccount } from './libraryService';

export const TEST_LIBRARY_CLAUDE_DIR_ENV = 'MAGE_TEST_LIBRARY_CLAUDE_DIR';

export interface TestLibraryDirInput {
  readonly env: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
  readonly userDataDir: string;
}

function isStrictlyInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// null no es un error: es «no hay cuenta de prueba».
export function decideTestLibraryClaudeDir(input: TestLibraryDirInput): string | null {
  const value = input.env[TEST_LIBRARY_CLAUDE_DIR_ENV];
  if (input.isPackaged || value === undefined || value === '' || !isAbsolute(value)) return null;
  return isStrictlyInside(input.userDataDir, value) ? resolve(value) : null;
}

export function testLibraryAccounts(dir: string | null): readonly LibraryAccount[] {
  return dir === null ? [] : [{ configDir: dir, engine: 'claude' }];
}
