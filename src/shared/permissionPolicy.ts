// Politica de respuesta automatica a los permisos. PURO, en shared: hoy la aplica
// el renderer y en F2.4 la aplica main antes de anunciar el permiso a los clientes.

import type { PermissionDecision, PermissionRequest } from './events';
import { parseAskUserQuestion } from './askUserQuestion';

// Prompt de «Crear PR» (D27). El turno que lo lleva arma las barreras de abajo hasta su `result`.
export const CREATE_PR_PROMPT =
  'Crea un pull request de esta rama. Revisa el diff y haz commit de lo pendiente con un mensaje descriptivo (si estás en la rama principal, crea antes una rama nueva). ' +
  'Haz un push normal de la rama a su remoto, sin forzar, y abre el PR con `gh pr create` con un título y una descripción que expliquen el cambio. ' +
  'Cuando exista, escribe su URL entre <pr-created> y </pr-created>.';

// --- Barreras del turno de «Crear PR» (grupo D, como Claude Desktop) ----------------------------------
// Mientras dura el turno que pidio crear el PR, un `Bash` que fuerce el push, salte los hooks, reescriba
// historia o publique en otro repo se DENIEGA sin preguntar. Un push normal de la rama a su remoto vale.
// Techo conocido: solo actua cuando el CLI pide permiso; con «Omitir permisos» el CLI no pregunta.
// ponytail: tokenizado por espacios, sin entender comillas; un `--force` dentro de un mensaje entre
// comillas tambien se rechaza (el lado seguro). Si molesta, un tokenizador de shell de verdad.

const SEGMENT_SEPARATORS = /&&|\|\||[;|\n]/;

type Rule = { readonly command: readonly string[]; readonly long: readonly string[]; readonly short: string; readonly plusRefspec?: boolean };

const PR_TURN_RULES: readonly Rule[] = [
  { command: ['git', 'push'], long: ['--force', '--force-with-lease', '--force-if-includes', '--delete', '--mirror', '--prune', '--push-option', '--no-verify'], short: 'fdo', plusRefspec: true },
  { command: ['git', 'commit'], long: ['--no-verify', '--amend', '--allow-empty', '--file'], short: 'nF' },
  { command: ['gh', 'pr', 'create'], long: ['--repo', '--head', '--body-file', '--recover'], short: 'RHF' },
];

// Motivo por el que se bloquea el comando en el turno de PR, o null si se puede dejar pasar.
export function prTurnBlockReason(command: string): string | null {
  for (const segment of command.split(SEGMENT_SEPARATORS)) {
    const tokens = segment.trim().split(/\s+/).filter((token) => token.length > 0);
    for (const rule of PR_TURN_RULES) {
      const flag = blockedFlag(tokens, rule);
      if (flag !== null) return `${rule.command.join(' ')} ${flag}`;
    }
  }
  return null;
}

function blockedFlag(tokens: readonly string[], rule: Rule): string | null {
  const start = commandStart(tokens, rule.command);
  if (start < 0) return null;
  for (const token of tokens.slice(start + rule.command.length)) {
    const name = token.split('=')[0]!;
    if (rule.long.some((flag) => name === flag || (flag === '--force' && name.startsWith('--force')))) return name;
    if (/^-[a-zA-Z]+$/.test(token) && [...token.slice(1)].some((letter) => rule.short.includes(letter))) return token;
    if (rule.plusRefspec === true && token.startsWith('+')) return token;
  }
  return null;
}

// Mensaje de la denegacion: le dice al agente que hacer en su lugar.
export function prTurnDenyMessage(blocked: string): string {
  return `Mage no permite \`${blocked}\` en el turno de crear el PR: haz un push normal de la rama, sin forzar ni saltar los hooks, y abre el PR en este repositorio.`;
}

// --- Respuesta automatica a un permiso --------------------------------------
// Orden fijo: barrera del turno de PR > fuera del proyecto > regla «Permitir siempre» > preguntar (null).
// La barrera va primero porque una regla «Permitir siempre Bash» no puede abrirle paso a un push forzado:
// antes salia el allow, main lo aceptaba y el deny llegaba tarde. Una PREGUNTA no se auto-permite nunca:
// es un turno de palabra, no una autorizacion.
export type AutomaticAnswer = { readonly behavior: 'deny'; readonly blocked: string } | { readonly behavior: 'allow' };

export interface AutomaticAnswerContext {
  readonly prGuard: boolean;
  readonly alwaysAllowTools: readonly string[];
  readonly request: Pick<PermissionRequest, 'toolName' | 'input' | 'outsideProject'>;
}

export function automaticAnswer({ prGuard, alwaysAllowTools, request }: AutomaticAnswerContext): AutomaticAnswer | null {
  const blocked = prGuard && request.toolName === 'Bash' ? prTurnBlockReason(String(request.input.command ?? '')) : null;
  if (blocked !== null) return { behavior: 'deny', blocked };
  if (request.outsideProject === true || parseAskUserQuestion(request.input) !== null) return null;
  const tool = request.toolName.trim();
  return tool.length > 0 && alwaysAllowTools.includes(tool) ? { behavior: 'allow' } : null;
}

// Decision que llega al motor por una respuesta automatica.
export function automaticDecision(answer: AutomaticAnswer): PermissionDecision {
  return answer.behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: prTurnDenyMessage(answer.blocked) };
}

// Indice donde empieza el comando (`git push`, `gh pr create`), saltando `git -C <ruta>`/`-c k=v`.
function commandStart(tokens: readonly string[], command: readonly string[]): number {
  const head = tokens.indexOf(command[0]!);
  if (head < 0) return -1;
  let i = head + 1;
  while (tokens[i] === '-C' || tokens[i] === '-c') i += 2;
  const rest = command.slice(1);
  return rest.every((word, k) => tokens[i + k] === word) ? i - 1 : -1;
}
