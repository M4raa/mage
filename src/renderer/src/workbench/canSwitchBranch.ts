// ¿Se puede cambiar de rama desde la fila del chat? (P-026 3.5, D26). PURO y compartido entre la UI
// (deshabilita el menu con el motivo en el tooltip) y el store (no se fia de la UI). Main vuelve a
// comprobar el arbol sucio y el nombre de la rama antes de ejecutar nada.

export interface BranchSwitchContext {
  readonly turnActive: boolean; // el agente esta trabajando en esa carpeta
  readonly dirty: boolean;
  readonly detached: boolean;
  // La pestaña trabaja en un worktree de Mage: su rama ES la del worktree (grupo D).
  readonly worktree?: boolean;
}

export type BranchSwitchVerdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export function canSwitchBranch(context: BranchSwitchContext): BranchSwitchVerdict {
  if (context.worktree === true) return { allowed: false, reason: 'Esta conversación trabaja en su worktree: su rama es la suya y no se cambia.' };
  if (context.turnActive) return { allowed: false, reason: 'El agente está trabajando: cambia de rama cuando acabe el turno.' };
  if (context.dirty) return { allowed: false, reason: 'Hay cambios sin confirmar: confírmalos antes de cambiar de rama.' };
  // Con la HEAD suelta, un commit hecho ahi se quedaria sin rama al cambiar: mejor desde un terminal.
  if (context.detached) return { allowed: false, reason: 'HEAD suelta: cambia de rama desde un terminal para no perder commits.' };
  return { allowed: true };
}
