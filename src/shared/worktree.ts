import type { GitParams } from './git';

// Worktrees de Mage (grupo D, como Claude Desktop): una conversacion en un repo git trabaja en una copia
// aparte, `<repo>/.claude/worktrees/<nombre>`, en la rama `claude/<nombre>`. La carpeta y la rama salen
// del mismo nombre A PROPOSITO: asi un cwd basta para saber si es un worktree de Mage, de que repo y de que
// rama, sin guardar nada mas (reabrir la conversacion del historial lo recrea desde ahi). PURO.

export const WORKTREE_BRANCH_PREFIX = 'claude/';

export interface WorktreeRef {
  readonly repoRoot: string;
  readonly name: string;
  readonly branch: string;
}

const WORKTREE_CWD = /^(.+?)[\\/]\.claude[\\/]worktrees[\\/]([a-z0-9][a-z0-9-]*)[\\/]?$/;

// ¿Es `cwd` un worktree con la forma de Mage? No dice si existe ni si git lo conoce: eso lo valida main.
export function worktreeOfCwd(cwd: string): WorktreeRef | null {
  const match = WORKTREE_CWD.exec(cwd);
  if (match === null) return null;
  return { repoRoot: match[1]!, name: match[2]!, branch: `${WORKTREE_BRANCH_PREFIX}${match[2]!}` };
}

export interface WorktreeCreateParams extends GitParams {
  readonly base: string; // rama del selector de la que parte (DN-4)
  readonly firstMessage: string; // de donde sale el nombre (DN-5)
}

export interface WorktreeMergeBaseParams extends GitParams {
  readonly base: string;
}

export type WorktreeRemoveResult = { readonly removed: true } | { readonly removed: false; readonly reason: 'dirty' | 'unknown' };
