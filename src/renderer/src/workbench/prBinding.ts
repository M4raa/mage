// Vinculacion de un PR a la pestaña, como Claude Desktop (el PR lo crea el AGENTE con su Bash; Mage solo
// lo reconoce). PURO: texto -> numero de PR. Tres señales:
//   1. un `Bash` con `gh pr create` cuyo resultado trae la URL del PR;
//   2. el agente escribe `<pr-created>URL</pr-created>` en su texto;
//   3. la rama tiene un PR abierto (lo resuelve el store con `gh pr list --head` al acabar cada turno).

const PR_CREATE_COMMAND = /\bgh\s+pr\s+create\b/;
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)\b/;
const PR_CREATED_TAG = /<pr-created>\s*(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+))\s*<\/pr-created>/;

export function isPrCreateCommand(command: string): boolean {
  return PR_CREATE_COMMAND.test(command);
}

// Numero del primer enlace a un PR de github.com en el texto (la salida de `gh pr create` es la URL).
export function prNumberFromUrl(text: string): number | null {
  const match = PR_URL.exec(text);
  return match === null ? null : toPrNumber(match[1]!);
}

export function prNumberFromCreatedTag(text: string): number | null {
  const match = PR_CREATED_TAG.exec(text);
  return match === null ? null : toPrNumber(match[2]!);
}

function toPrNumber(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
