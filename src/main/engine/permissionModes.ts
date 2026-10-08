import { PERMISSION_MODES, type PermissionModesByProviderView } from '@shared/ipc';
import { AGY_PERMISSION_MODES, AGY_PROVIDER_ID, RUNTIME_PERMISSION_MODES, runsOnMageRuntime } from '@shared/providers';
import { parseCodexPermissionPreset } from '@shared/codexPermissions';

// Modos de permiso LEIDOS DEL CLI (respuesta 18 del usuario: si mañana un CLI añade un modo, Mage lo
// refleja). Medido el 2026-10-01 (`node spike/permission-modes-spike.mjs`, gratis, sin turno):
//   - claude 2.1.286: un valor invalido en `--permission-mode` hace que el CLI liste los suyos y salga
//     ANTES de arrancar: «Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk,
//     plan.». `manual` es el nombre nuevo de `default` (el CLI sigue aceptando `default`, y con `manual`
//     su `initialize` responde `current_permission_mode: "default"`). `dontAsk` no se ofrece: con una UI
//     delante solo deniega en silencio.
//   - codex 0.144.4: `permissionProfile/list` de `codex app-server` (sin cuenta): `:read-only`,
//     `:workspace`, `:danger-full-access`. Es lo que acepta `turn/start.permissions`.
//   - agy 1.2.14: `--mode` solo admite `accept-edits` y `plan` («valid: accept-edits, plan»), pero los
//     tres modos escriben sin preguntar y deniegan los comandos (medido): no son modos de PERMISO, asi
//     que no se ofrecen y agy sigue con su aviso de «sin permisos».
// Si un CLI no contesta, el renderer cae a la lista fija de Mage (`PERMISSION_MODES`).

export type PermissionModesByProvider = PermissionModesByProviderView;

const CLAUDE_CHOICES_PATTERN = /Allowed choices are ([^.]+)\./;
const CLAUDE_ALIASES: Readonly<Record<string, string>> = { manual: 'default' };
const CLAUDE_NOT_OFFERED: readonly string[] = ['dontAsk'];

// Valor que no puede ser un modo: obliga al CLI a listar los suyos.
export const PERMISSION_MODE_ORACLE_VALUE = '__mage_probe__';

export function parseClaudePermissionChoices(output: string): readonly string[] | null {
  const match = CLAUDE_CHOICES_PATTERN.exec(output);
  if (match === null) return null;
  const modes = match[1]!
    .split(',')
    .map((choice) => choice.trim())
    .filter((choice) => choice.length > 0)
    .map((choice) => CLAUDE_ALIASES[choice] ?? choice)
    .filter((choice) => !CLAUDE_NOT_OFFERED.includes(choice));
  return modes.length === 0 ? null : [...new Set(modes)];
}

// `permissionProfile/list` -> ids permitidos (`allowed: true`), en su orden.
export function parseCodexPermissionProfiles(result: unknown): readonly string[] | null {
  if (typeof result !== 'object' || result === null || !Array.isArray((result as { data?: unknown }).data)) return null;
  const ids = (result as { data: unknown[] }).data.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { id, allowed } = entry as { id?: unknown; allowed?: unknown };
    return typeof id === 'string' && id.length > 0 && allowed !== false ? [id] : [];
  });
  return ids.length === 0 ? null : ids;
}

// Frontera de `--permission-mode`/`permissions`: ¿se puede pasar este modo al CLI de ese proveedor?
export function isKnownPermissionModeFor(provider: string, mode: string, probed: PermissionModesByProvider | null): boolean {
  if (provider === 'claude') return (PERMISSION_MODES as readonly string[]).includes(mode) || (probed?.claude ?? []).includes(mode);
  if (provider === 'codex') {
    const preset = parseCodexPermissionPreset(mode);
    return preset !== null && (probed?.codex?.includes(preset.profile) ?? CODEX_PROFILE_PATTERN.test(preset.profile));
  }
  if (provider === AGY_PROVIDER_ID) return AGY_PERMISSION_MODES.includes(mode);
  // El runtime propio (P-032) no tiene CLI que sondear: sus modos son los de Mage.
  if (runsOnMageRuntime(provider)) return (RUNTIME_PERMISSION_MODES as readonly string[]).includes(mode);
  return false;
}

// Forma de los perfiles integrados de codex (`:workspace`): vale mientras no haya sondeo.
const CODEX_PROFILE_PATTERN = /^:[a-z][a-z-]*$/;

export interface PermissionModesProbeDeps {
  // Salida (stdout+stderr) de `claude -p --permission-mode <oraculo>`; null si no se pudo lanzar.
  readonly runClaudeOracle: () => Promise<string | null>;
  // Resultado de `permissionProfile/list` de un app-server de codex; null si no se pudo.
  readonly readCodexProfiles: () => Promise<unknown>;
}

export async function probePermissionModes(deps: PermissionModesProbeDeps): Promise<PermissionModesByProvider> {
  const [claudeOutput, codexResult] = await Promise.all([deps.runClaudeOracle(), deps.readCodexProfiles()]);
  return {
    claude: claudeOutput === null ? null : parseClaudePermissionChoices(claudeOutput),
    codex: parseCodexPermissionProfiles(codexResult),
  };
}
