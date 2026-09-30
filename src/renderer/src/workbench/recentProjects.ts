import type { ConversationSummary } from '@shared/conversations';
import { isInside, lastPathSegment } from './chatInfoView';

// Proyectos recientes (P-028, punto 16): las carpetas en las que se ha trabajado ultimamente, para
// ofrecerlas como tarjetas en el estado vacio de una conversacion nueva y como «último proyecto» del
// ajuste `newConversationFolder`. PURO: sale del historial que el store ya tiene cargado (incluye lo
// abierto desde la terminal), sin un registro nuevo que mantener.

export interface RecentProject {
  readonly cwd: string;
  readonly name: string;
  readonly updatedAtMs: number;
}

// Cuantas tarjetas se ofrecen (sin buscador: con mas, el estado vacio deja de ser un vistazo).
export const RECENT_PROJECTS_LIMIT = 6;

// Clave de agrupacion: en Windows la misma carpeta llega con distintas mayusculas y separadores segun
// quien la imprima; en POSIX las mayusculas SI distinguen carpetas.
function projectKey(cwd: string, caseInsensitive: boolean): string {
  const normalized = cwd.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export interface RecentProjectsInput {
  readonly history: readonly ConversationSummary[];
  // Raiz de las carpetas temporales de Mage: lo que cuelga de ella no es un proyecto.
  readonly scratchRoot: string | null;
  readonly limit: number;
  readonly caseInsensitive: boolean;
}

// Una entrada por carpeta (la conversacion mas reciente manda), de la mas reciente a la mas antigua.
// Solo el historial COMPARTIDO: una conversacion privada no deja rastro fuera de su perfil. O(n) en
// el historial mas el orden de las carpetas distintas.
export function recentProjects(input: RecentProjectsInput): readonly RecentProject[] {
  if (input.limit <= 0) return [];
  const byKey = new Map<string, RecentProject>();
  for (const item of input.history) {
    if (item.privacy !== 'shared' || item.cwd.trim().length === 0) continue;
    if (input.scratchRoot !== null && isInside(item.cwd, input.scratchRoot)) continue;
    const key = projectKey(item.cwd, input.caseInsensitive);
    const known = byKey.get(key);
    if (known !== undefined && known.updatedAtMs >= item.updatedAtMs) continue;
    byKey.set(key, { cwd: item.cwd, name: lastPathSegment(item.cwd) || item.cwd, updatedAtMs: item.updatedAtMs });
  }
  return [...byKey.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, input.limit);
}
