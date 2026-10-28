import type { GitSnapshot } from '@shared/git';
import type { GhPullRequest, GhSnapshot } from '@shared/gh';
import type { IconName } from './components/Icon';
import { t } from '../i18n/uiLanguage';
// Modelo de vista de las etiquetas de informacion del chat (la fila que va encima del input). PURO:
// datos -> etiquetas.
//
// Peticion del usuario: "encima de la barra de input deberian salir etiquetas de informacion del chat,
// como el directorio del chat (que al darle clic te de acceso directo, y asi ver los archivos que
// genera o acceder al scratchpad), proyecto abierto, etc, cosas interesantes de ver de un vistazo".

export interface ChatChip {
  // Nombre del icono del set propio (components/Icon.tsx), NO un caracter: un emoji de color no
  // hereda `currentColor` y con un tema claro importado se queda como una mancha ajena a la paleta.
  readonly icon: IconName;
  readonly label: string;
  // Texto largo del tooltip y del nombre accesible. Nunca es solo decorativo: es donde va el dato
  // completo que la etiqueta corta no puede enseñar (la ruta entera, el modelo resuelto).
  readonly title: string;
}

// Ultimo segmento de una ruta, con separadores de los DOS mundos: el cwd viene del SO y en Windows
// llega con barras invertidas, pero un proyecto abierto desde WSL o una ruta escrita a mano puede
// traer barras normales. Cadena vacia si no hay ningun segmento.
export function lastPathSegment(path: string): string {
  const segments = path.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? '';
}

// ¿Esta `path` dentro de `parent` (o es `parent`)? Comparacion por SEGMENTOS, no por prefijo de
// cadena: `C:/tmp/scratchpad-viejo` empieza por `C:/tmp/scratchpad` y no esta dentro. En Windows
// ademas no distingue mayusculas.
export function isInside(path: string, parent: string): boolean {
  const a = path.split(/[\\/]+/).filter((s) => s.length > 0).map((s) => s.toLowerCase());
  const b = parent.split(/[\\/]+/).filter((s) => s.length > 0).map((s) => s.toLowerCase());
  if (b.length === 0 || b.length > a.length) return false;
  return b.every((segment, i) => segment === a[i]);
}

// Etiqueta de la carpeta de trabajo. Una conversacion "sin friccion" arranca en un subdirectorio del
// scratchpad con nombre de UUID, y ahi el ultimo segmento no dice NADA (es lo que se veia: `aa691438-
// 9c76-4efe-…`). En ese caso la etiqueta es "Scratchpad", y la ruta entera sigue en el tooltip.
export function folderChip(cwd: string, scratchDir: string | readonly string[] | null): ChatChip | null {
  if (cwd.trim().length === 0) return null;
  const enScratch = (typeof scratchDir === 'string' ? [scratchDir] : scratchDir ?? []).some(root => root.length > 0 && isInside(cwd, root));
  const segment = lastPathSegment(cwd);
  return {
    icon: enScratch ? 'note' : 'folder',
    label: enScratch ? t('chat.info.scratchpad') : segment.length > 0 ? segment : cwd,
    title: t('chat.info.folderTitle', { cwd }),
  };
}

export function privacyChip(privacy: 'shared' | 'private'): ChatChip {
  return privacy === 'private'
    ? { icon: 'lock', label: t('chat.info.private'), title: t('chat.info.privateTitle') }
    : { icon: 'diamond', label: t('chat.info.shared'), title: t('chat.info.sharedTitle') };
}

// Etiqueta de la rama (P-026 3.5). Sin repo, sin git o sin confianza, no hay etiqueta. Con la HEAD
// suelta se enseña el commit, que es lo unico que la identifica.
export function gitChip(snapshot: GitSnapshot | undefined): ChatChip | null {
  if (snapshot?.kind !== 'repo') return null;
  const label = snapshot.branch ?? snapshot.headShort ?? 'HEAD';
  const sync =
    snapshot.upstream === null
      ? t('chat.git.noUpstream')
      : t('chat.git.sync', { ahead: snapshot.ahead, behind: snapshot.behind, upstream: snapshot.upstream });
  const title = snapshot.detached ? t('chat.git.detachedTitle', { branch: label, sync }) : t('chat.git.branchTitle', { branch: label, sync });
  return { icon: 'branch', label, title };
}

export interface DiffChip {
  readonly added: string; // "+3520"
  readonly removed: string; // "−231"
  readonly title: string;
}

// Cambios sin confirmar, como en la captura del punto 12: `+N −M` en verde y rojo. Solo con el arbol
// sucio; los ficheros sin seguir no tienen lineas que contar y van al tooltip.
export function diffChip(snapshot: GitSnapshot | undefined): DiffChip | null {
  if (snapshot?.kind !== 'repo' || !snapshot.dirty) return null;
  const values = { count: snapshot.changedFiles, untracked: snapshot.untracked, added: snapshot.added, removed: snapshot.removed };
  return {
    added: `+${snapshot.added}`,
    removed: `−${snapshot.removed}`,
    title: snapshot.untracked > 0 ? t('chat.git.diffTitleUntracked', values) : t('chat.git.diffTitle', values),
  };
}

// --- Barra de PR/CI (grupo D, como Claude Desktop) -------------------------------------------------

export interface PrBarView {
  readonly label: string; // "#7 · Borrador"
  readonly counts: readonly { readonly glyph: string; readonly count: number; readonly tone: 'add' | 'del' | 'muted' }[];
  readonly details: readonly string[]; // revision, fusion, auto-merge: lo que no cabe en la etiqueta
  readonly failing: readonly string[]; // nombres de los checks que fallan
  readonly title: string;
}

// Las dos tablas guardan la CLAVE del catálogo: se traduce al montar la vista.
const PR_STATE_LABELS = { open: 'chat.pr.state.open', merged: 'chat.pr.state.merged', closed: 'chat.pr.state.closed' } as const;
const REVIEW_LABELS = {
  approved: 'chat.pr.review.approved',
  changes_requested: 'chat.pr.review.changesRequested',
  review_required: 'chat.pr.review.required',
} as const;

export function prBarView(pr: GhPullRequest): PrBarView {
  const state = t(pr.state === 'open' && pr.isDraft ? 'chat.pr.state.draft' : PR_STATE_LABELS[pr.state]);
  const { pass, fail, pending } = pr.summary;
  const counts = [
    { glyph: '✓', count: pass, tone: 'add' as const },
    { glyph: '✗', count: fail, tone: 'del' as const },
    { glyph: '●', count: pending, tone: 'muted' as const },
  ].filter((entry) => entry.count > 0);
  const details = [
    pr.reviewDecision === null ? null : t(REVIEW_LABELS[pr.reviewDecision]),
    pr.state === 'open' && pr.mergeable === 'conflicting' ? t('chat.pr.conflict') : null,
    pr.autoMerge ? t('chat.pr.autoMerge') : null,
  ].filter((entry): entry is string => entry !== null);
  const failing = pr.checks.filter((check) => check.state === 'fail').map((check) => check.name);
  const checks = t('chat.pr.checks', { pass, fail, pending });
  const label = t('chat.pr.label', { prNumber: pr.number, state });
  return { label, counts, details, failing, title: t('chat.pr.title', { prNumber: pr.number, title: pr.title, checks }) };
}

export interface GhNoticeView {
  readonly label: string;
  readonly title: string;
  readonly url: string | null; // a donde lleva el clic (solo https, lo exige openExternal)
}

const GH_INSTALL_URL = 'https://cli.github.com';

// DA-3: sin gh o sin sesion, un chip apagado que lo explica, descartable para siempre (Ajustes lo repone).
export function ghNoticeView(snapshot: GhSnapshot | undefined, dismissed: boolean): GhNoticeView | null {
  if (dismissed || snapshot?.kind !== 'off') return null;
  if (snapshot.reason === 'no-gh') return { label: t('chat.gh.noGh'), title: t('chat.gh.noGhTitle'), url: GH_INSTALL_URL };
  if (snapshot.reason === 'no-auth') return { label: t('chat.gh.noAuth'), title: t('chat.gh.noAuthTitle'), url: null };
  return null;
}
