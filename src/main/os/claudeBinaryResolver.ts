import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { firstExistingPath } from './agentBinaryResolver';

// Dependencias inyectables -> testable sin tocar el FS/SO real.
export interface ResolverDeps {
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly fileExists: (path: string) => boolean;
  readonly binOverride?: string | undefined; // p.ej. MAGE_CLAUDE_BIN
}

// Candidatos por SO (relativos a HOME o absolutos). Se encapsula aqui toda la diferencia de SO
// (invariante multiplataforma): ningun otro modulo conoce rutas de `claude`. Solo se listan binarios
// spawneables directamente (el .exe/binario nativo); los shims .cmd exigirian shell:true y quedan
// fuera (el fallback al PATH los cubre si hiciera falta).
const WINDOWS_CANDIDATES = [
  ['.local', 'bin', 'claude.exe'], // instalador nativo de Claude Code
  ['.claude', 'local', 'claude.exe'], // instalacion local (npm) dentro de ~/.claude
];
const POSIX_ABSOLUTE_CANDIDATES = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
const POSIX_HOME_CANDIDATES = [
  ['.local', 'bin', 'claude'], // instalador nativo de Claude Code
  ['.claude', 'local', 'claude'], // instalacion local (npm) dentro de ~/.claude
];

// Localiza el binario `claude`. Prioridad: override explicito -> candidatos por SO -> 'claude'
// en el PATH (ultimo recurso; el spawn debera resolverlo). Nunca devuelve cadena vacia.
export function resolveClaudeBinary(deps: ResolverDeps = defaultDeps()): string {
  if (deps.binOverride && deps.binOverride.length > 0) return deps.binOverride;

  const homeCandidates = deps.platform === 'win32' ? WINDOWS_CANDIDATES : POSIX_HOME_CANDIDATES;
  const posixAbsolute = deps.platform === 'win32' ? [] : POSIX_ABSOLUTE_CANDIDATES;
  const candidates = [...homeCandidates.map((parts) => join(deps.homedir, ...parts)), ...posixAbsolute];
  const found = firstExistingPath(candidates, deps.fileExists);
  if (found !== null) return found;

  // Fallback: confiar en el PATH. En Windows un shim .cmd exigiria shell:true; el .exe directo no.
  return deps.platform === 'win32' ? 'claude.exe' : 'claude';
}

function defaultDeps(): ResolverDeps {
  return {
    platform: platform(),
    homedir: homedir(),
    fileExists: existsSync,
    binOverride: process.env.MAGE_CLAUDE_BIN,
  };
}
