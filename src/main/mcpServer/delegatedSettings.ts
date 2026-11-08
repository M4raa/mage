import { codexPermissionPreset, parseCodexPermissionPreset } from '@shared/codexPermissions';
import type { ProviderModel } from '@shared/providers';
import { MageValidationError } from './errors';

// Modelo, esfuerzo y modo de permisos con los que nace una sesión delegada (`mage_create_session`). Por defecto hereda los
// de la creadora (lo que main sabe de ella, nunca lo que diga el agente); un modo pedido solo puede ser igual o más
// restrictivo. Entre proveedores, modelo y esfuerzo son los por defecto del destino y el modo se traduce al equivalente o a
// uno más restrictivo. Solo Claude y Codex delegan: son los que tienen el MCP de Mage.

export interface SessionSettings {
  readonly provider: string;
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: string;
}

export interface DelegatedSettingsRequest {
  readonly creator: SessionSettings | null;
  readonly targetProvider: 'claude' | 'codex';
  readonly requested: { readonly model?: string; readonly effort?: string; readonly permissionMode?: string };
  // Catálogo de modelos de la cuenta destino; vacío = sin catálogo, y entonces el modelo no se valida.
  readonly catalog: readonly ProviderModel[];
}

export interface DelegatedSettings {
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode: string;
}

// Escala común de permisividad, de menos a más: 1 Plan, 2 Manual, 3 Aceptar ediciones, 4 Auto, 5 Omitir permisos.
const CLAUDE_MODES_BY_RANK = ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions'] as const;
// Codex: perfil + política de aprobación (`|never` = no pregunta nunca). Sin sandbox cuenta como 5, pregunte o no.
const CODEX_MODES_BY_RANK = [':read-only|never', ':read-only', ':workspace', ':workspace|never', ':danger-full-access|never'] as const;
const CODEX_RANK: Readonly<Record<string, number>> = {
  ':read-only|never': 1, ':read-only': 2, ':workspace': 3, ':workspace|never': 4, ':danger-full-access': 5, ':danger-full-access|never': 5,
};
// Una creadora cuyo modo no se conoce cuenta como Manual; un perfil de Codex válido pero desconocido, si se PIDE, como el más permisivo.
const UNKNOWN_CREATOR_RANK = 2;
const UNKNOWN_PROFILE_RANK = 5;

export function resolveDelegatedSettings(request: DelegatedSettingsRequest): DelegatedSettings {
  const { creator, targetProvider, requested, catalog } = request;
  const sameProvider = creator?.provider === targetProvider;
  const model = requested.model ?? (sameProvider ? creator?.model : undefined);
  const effort = requested.effort ?? (sameProvider ? creator?.effort : undefined);
  if (requested.model !== undefined) assertModelInCatalog(requested.model, catalog);
  if (requested.effort !== undefined && model !== undefined) assertEffortSupported(model, requested.effort, catalog);
  return {
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    permissionMode: resolvePermissionMode(request),
  };
}

// Rango de un modo en su proveedor; null si no es un modo de ese proveedor.
export function permissionRank(provider: string, mode: string): number | null {
  if (provider === 'claude') {
    const index = (CLAUDE_MODES_BY_RANK as readonly string[]).indexOf(mode);
    return index === -1 ? null : index + 1;
  }
  if (provider !== 'codex') return null;
  const canonical = canonicalCodexMode(mode);
  return canonical === null ? null : (CODEX_RANK[canonical] ?? UNKNOWN_PROFILE_RANK);
}

// El modo del destino más permisivo que no pasa de `rank`.
export function modeForRank(provider: 'claude' | 'codex', rank: number): string {
  const modes: readonly string[] = provider === 'claude' ? CLAUDE_MODES_BY_RANK : CODEX_MODES_BY_RANK;
  return modes[Math.min(Math.max(rank, 1), modes.length) - 1] as string;
}

function resolvePermissionMode(request: DelegatedSettingsRequest): string {
  const { creator, targetProvider, requested } = request;
  const ceiling = creatorRank(creator);
  if (requested.permissionMode !== undefined) return checkedRequestedMode(request, requested.permissionMode, ceiling);
  const inherited = creator?.provider === targetProvider ? creator.permissionMode : undefined;
  if (inherited !== undefined && permissionRank(targetProvider, inherited) !== null) return inherited;
  return modeForRank(targetProvider, ceiling);
}

function checkedRequestedMode(request: DelegatedSettingsRequest, mode: string, ceiling: number): string {
  const { targetProvider, creator } = request;
  const rank = permissionRank(targetProvider, mode);
  if (rank === null) throw new MageValidationError(`invalid_permission_mode: ${mode} (${targetProvider})`);
  if (rank > ceiling) throw new MageValidationError(`permission_mode_exceeds_creator: ${mode} (creadora: ${creator?.permissionMode ?? 'desconocido'})`);
  return targetProvider === 'codex' ? (canonicalCodexMode(mode) as string) : mode;
}

// El rango de la creadora nunca sube por lo que no se sabe: sin modo, o con un perfil de Codex desconocido, cuenta como Manual.
function creatorRank(creator: SessionSettings | null): number {
  if (creator?.permissionMode === undefined) return UNKNOWN_CREATOR_RANK;
  if (creator.provider === 'codex') return CODEX_RANK[canonicalCodexMode(creator.permissionMode) ?? ''] ?? UNKNOWN_CREATOR_RANK;
  return permissionRank(creator.provider, creator.permissionMode) ?? UNKNOWN_CREATOR_RANK;
}

function canonicalCodexMode(mode: string): string | null {
  const preset = parseCodexPermissionPreset(mode);
  return preset === null ? null : codexPermissionPreset(preset.profile, preset.approvalPolicy);
}

function assertModelInCatalog(model: string, catalog: readonly ProviderModel[]): void {
  if (catalog.length === 0 || catalog.some((entry) => entry.id === model)) return;
  throw new MageValidationError(`invalid_model: ${model} (válidos: ${catalog.map((entry) => entry.id).join(', ')})`);
}

function assertEffortSupported(model: string, effort: string, catalog: readonly ProviderModel[]): void {
  const supported = catalog.find((entry) => entry.id === model)?.supportedEfforts;
  if (supported === undefined || supported.includes(effort)) return;
  throw new MageValidationError(`invalid_effort: ${effort} (válidos para ${model}: ${supported.join(', ')})`);
}
