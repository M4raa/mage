import { resolveToolPath } from '../runtime/tools/pathGuard';

export interface MentionGuardDeps {
  readonly isTrusted: (cwd: string, accountDir: string) => boolean;
  readonly realpath: (path: string) => string | null;
  readonly platform: string;
}

export type GuardResult =
  | { readonly state: 'ok'; readonly real: string }
  | { readonly state: 'outside' }
  | { readonly state: 'missing' };

// Un fichero solo se puede mencionar si la carpeta es de confianza y su RUTA REAL (tras seguir enlaces
// simbolicos y junctions) cae dentro de la ruta real de la carpeta. Compartido por resolver y vista previa.
export function guardMention(cwd: string, accountDir: string, absPath: string, deps: MentionGuardDeps): GuardResult {
  if (!deps.isTrusted(cwd, accountDir)) return { state: 'outside' };
  const scope = { cwd, extraDirs: [], platform: deps.platform, realpath: deps.realpath };
  if (resolveToolPath(absPath, scope).pathClass === 'outside') return { state: 'outside' };
  const real = deps.realpath(absPath);
  return real === null ? { state: 'missing' } : { state: 'ok', real };
}
