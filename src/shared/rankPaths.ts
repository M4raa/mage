const SCORE_BASENAME_PREFIX = 3;
const SCORE_BASENAME_CONTAINS = 2;
const SCORE_PATH_CONTAINS = 1;

function scoreOf(path: string, query: string): number {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf('/') + 1);
  if (name.startsWith(query)) return SCORE_BASENAME_PREFIX;
  if (name.includes(query)) return SCORE_BASENAME_CONTAINS;
  return lower.includes(query) ? SCORE_PATH_CONTAINS : 0;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const byLengthThenAlpha = (a: string, b: string): number => a.length - b.length || compareText(a, b);

// Ordena rutas relativas (con `/`) por relevancia para una consulta; O(n log n).
export function rankPaths(paths: readonly string[], query: string, limit: number): string[] {
  const needle = query.toLowerCase();
  if (needle.length === 0) return [...paths].sort(byLengthThenAlpha).slice(0, limit);
  return paths
    .map((path) => ({ path, score: scoreOf(path, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || byLengthThenAlpha(a.path, b.path))
    .slice(0, limit)
    .map((entry) => entry.path);
}
