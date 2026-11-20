// Acciones que sacan datos de la máquina y que en Claude piden permiso SIEMPRE, también en Auto y en Aceptar
// ediciones. Van como reglas `permissions.ask` del propio CLI (por el `--settings` del arranque): Mage no intercepta
// herramientas. Medido en claude 2.1.319 (spike/permission-ask-rules-spike.mjs): con la regla, el CLI manda
// `can_use_tool` en default, acceptEdits, auto y también en bypassPermissions; por eso en ese modo no se pasan.

// Cada regla, con por qué está:
export const EXTERNAL_ACTION_ASK_RULES = [
  // Publica en claude.ai. La regla es por herramienta: también pide permiso para listar o leer (se acepta).
  'Artifact',
  // Sube commits a un remoto.
  'Bash(git push:*)',
  // Escriben en GitHub en nombre del usuario: abrir, comentar, revisar o fusionar un PR, abrir o comentar una
  // issue y crear un release.
  'Bash(gh pr create:*)',
  'Bash(gh pr comment:*)',
  'Bash(gh pr review:*)',
  'Bash(gh pr merge:*)',
  'Bash(gh issue create:*)',
  'Bash(gh issue comment:*)',
  'Bash(gh release create:*)',
] as const;

// Modo en el que el usuario pidió de forma explícita que nada pregunte.
const SKIP_PERMISSIONS_MODE = 'bypassPermissions';

type Settings = Readonly<Record<string, unknown>>;

// Las reglas `ask` que ya trae `permissions`, validadas: una forma inesperada es un error, no se descarta.
function existingAskRules(permissions: Settings): readonly string[] {
  const ask = permissions.ask;
  if (ask === undefined) return [];
  if (!Array.isArray(ask) || !ask.every((rule) => typeof rule === 'string')) {
    throw new Error(`permissions.ask tiene que ser una lista de textos: ${JSON.stringify(ask)}`);
  }
  return ask;
}

function permissionsOf(settings: Settings): Settings {
  const permissions = settings.permissions;
  if (permissions === undefined) return {};
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
    throw new Error(`permissions tiene que ser un objeto: ${JSON.stringify(permissions)}`);
  }
  return permissions as Settings;
}

// Une dos listas de reglas `ask` sin repetir, primero las que ya había y en su orden.
export function mergeAskRules(current: readonly string[], added: readonly string[]): readonly string[] {
  return [...new Set([...current, ...added])];
}

// Junta dos objetos de `--settings` (el fragmento común del usuario y los ajustes de arranque de la sesión):
// lo de `extra` manda, salvo `permissions`, que se mezcla campo a campo y une las reglas `ask` de los dos.
export function mergeClaudeSettings(base: Settings, extra: Settings): Settings {
  const merged = { ...base, ...extra };
  if (base.permissions === undefined || extra.permissions === undefined) return merged;
  const basePermissions = permissionsOf(base);
  const extraPermissions = permissionsOf(extra);
  const ask = mergeAskRules(existingAskRules(basePermissions), existingAskRules(extraPermissions));
  return { ...merged, permissions: { ...basePermissions, ...extraPermissions, ask } };
}

// `settings` con las reglas de acciones externas añadidas a `permissions.ask` (sin perder ni repetir las que traiga),
// o tal cual en «Omitir permisos». `permissionMode` undefined = el modo por defecto de la cuenta: se pasan.
export function withExternalActionAsk(settings: Settings, permissionMode: string | undefined): Settings {
  if (permissionMode === SKIP_PERMISSIONS_MODE) return settings;
  return mergeClaudeSettings(settings, { permissions: { ask: [...EXTERNAL_ACTION_ASK_RULES] } });
}
