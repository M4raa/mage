import type { MergeStrategy, PrWriteAction } from '@shared/pr';

// Argumentos de `gh pr <accion>` para cada escritura del panel de PR. PURO. `repoRef` es `host/owner/repo`
// (siempre `-R` explicito: la PR no depende de la carpeta desde la que se pida). NUNCA `--admin`: saltarse
// las reglas de la rama protegida no es una accion que Mage ofrezca (lo comprueba un test sobre todas).

export const PR_BODY_MAX_CHARS = 20_000;

const REVIEW_FLAG = { approve: '--approve', request_changes: '--request-changes', comment: '--comment' } as const;
const STRATEGY_FLAG: Readonly<Record<MergeStrategy, string>> = { merge: '--merge', squash: '--squash', rebase: '--rebase' };

export function buildPrWriteArgs(action: PrWriteAction, number: number, repoRef: string, headSha: string): string[] {
  const command = (verb: string, ...rest: string[]): string[] => ['pr', verb, String(number), '-R', repoRef, ...rest];
  switch (action.kind) {
    case 'comment':
      return command('comment', '-b', action.body);
    case 'review':
      return command('review', REVIEW_FLAG[action.event], ...(action.body.length > 0 ? ['-b', action.body] : []));
    case 'close':
      return command('close');
    case 'reopen':
      return command('reopen');
    case 'merge':
      return command('merge', STRATEGY_FLAG[action.strategy], '--match-head-commit', headSha, ...(action.deleteBranch ? ['--delete-branch'] : []));
    case 'autoMerge':
      return command('merge', ...(action.enabled ? ['--auto', STRATEGY_FLAG[action.strategy], '--match-head-commit', headSha] : ['--disable-auto']));
  }
}

// Longitud del cuerpo, que aplica a comentar y a revisar (en aprobar es opcional).
export function assertBody(action: PrWriteAction): void {
  if (action.kind !== 'comment' && action.kind !== 'review') return;
  const length = action.body.length;
  const optional = action.kind === 'review' && action.event === 'approve' && length === 0;
  if (!optional && (length < 1 || length > PR_BODY_MAX_CHARS)) throw new Error(`Cuerpo de PR no valido: ${length} caracteres (1..${PR_BODY_MAX_CHARS})`);
}
