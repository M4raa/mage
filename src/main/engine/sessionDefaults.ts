import { join } from 'node:path';
import { EFFORT_LEVELS, PERMISSION_MODES, type CreateSessionParams } from '@shared/ipc';
import type { LaunchParams, SharedLaunchConfig } from './providerAdapter';

// Dependencias inyectables (FS/HOME) -> testable.
export interface DefaultsDeps {
  readonly homedir: string;
  readonly fileExists: (path: string) => boolean;
  readonly listHome: () => string[];
  // Resuelve lo comun (MCP de mcp-common.json y extensiones, settings-common.json) para ESTE proveedor y
  // cuenta; se llama en cada sesion nueva para leerlo fresco (nunca se cachea).
  readonly resolveShared: (provider: string, accountDir: string) => SharedLaunchConfig;
}

// Un CLAUDE_CONFIG_DIR es una cuenta valida si tiene credenciales OAuth.
const CREDENTIALS_FILE = '.credentials.json';
// Nombres de dir de config de Claude: .claude, .claude-<algo>, .claude<digitos>.
const CONFIG_DIR_PATTERN = /^\.claude(-.*|\d*)$/;

// Resuelve los parametros de lanzamiento validando en la frontera. Rellena cuenta/cwd por defecto
// cuando vienen vacios (los selectores explicitos llegan en M1.2). Nunca defaults silenciosos:
// si no hay cuenta con login, lanza Error con el valor recibido.
export function resolveLaunchParams(
  sessionId: string,
  params: CreateSessionParams,
  deps: DefaultsDeps,
  resume = false,
): LaunchParams {
  const model = params.model.trim();
  if (model.length === 0) throw new Error('El modelo no puede estar vacio');

  const accountDir = params.accountDir.trim() || resolveDefaultAccountDir(deps);
  const isClaude = params.provider === 'claude';
  if (isClaude && !deps.fileExists(join(accountDir, CREDENTIALS_FILE))) {
    throw new Error(`La cuenta no tiene login valido (falta ${CREDENTIALS_FILE}): ${accountDir}`);
  }

  const cwd = params.cwd.trim() || deps.homedir;
  const effort = resolveEffort(params.effort);
  const maxBudgetUsdCents = resolveBudgetCents(params.maxBudgetUsdCents);
  const permissionMode = resolvePermissionMode(params.permissionMode);
  return {
    sessionId,
    accountDir,
    model,
    cwd,
    resume,
    shared: deps.resolveShared(params.provider, accountDir),
    ...(effort === undefined ? {} : { effort }),
    ...(maxBudgetUsdCents === undefined ? {} : { maxBudgetUsdCents }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
  };
}

// Valida el modo de permiso en la frontera (M2.6): undefined -> sin flag, y el CLI arranca en el modo
// que tenga configurado la cuenta (P-026 2.3: Mage lo adopta de su `initialize`). Cualquier valor DEBE
// ser un PERMISSION_MODES conocido (si no, lanza: nunca un flag invalido al hijo). `default` SI se
// pasa: si el usuario eligio Manual, el `defaultMode` de la cuenta no puede cambiarselo por detras.
function resolvePermissionMode(mode: string | undefined): string | undefined {
  if (mode === undefined || mode.length === 0) return undefined;
  if (!(PERMISSION_MODES as readonly string[]).includes(mode)) {
    throw new Error(`Modo de permiso invalido: ${JSON.stringify(mode)} (validos: ${PERMISSION_MODES.join(', ')})`);
  }
  return mode;
}

// Valida el tope de gasto en la frontera: undefined -> sin tope; si viene, debe ser un entero > 0
// (centavos). Un no-entero (float) o <= 0 lanza con el valor recibido — el dinero es entero por
// estandar y un tope de 0/negativo no tiene sentido.
function resolveBudgetCents(cents: number | undefined): number | undefined {
  if (cents === undefined) return undefined;
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(`Tope de presupuesto invalido (centavos enteros > 0): ${JSON.stringify(cents)}`);
  }
  return cents;
}

// Valida el nivel de esfuerzo en la frontera: undefined/'' -> sin effort (default CLI); cualquier otro
// valor DEBE ser un EFFORT_LEVELS conocido (si no, lanza con el valor recibido: nunca un flag invalido
// al hijo, que abortaria la sesion).
function resolveEffort(effort: string | undefined): string | undefined {
  if (effort === undefined || effort.length === 0) return undefined;
  if (!(EFFORT_LEVELS as readonly string[]).includes(effort)) {
    throw new Error(`Nivel de effort invalido: ${JSON.stringify(effort)} (validos: ${EFFORT_LEVELS.join(', ')})`);
  }
  return effort;
}

// Cuenta por defecto: ~/.claude si tiene login; si no, la primera cuenta con login descubierta.
function resolveDefaultAccountDir(deps: DefaultsDeps): string {
  const main = join(deps.homedir, '.claude');
  if (deps.fileExists(join(main, CREDENTIALS_FILE))) return main;

  for (const name of deps.listHome()) {
    if (!CONFIG_DIR_PATTERN.test(name)) continue;
    const dir = join(deps.homedir, name);
    if (deps.fileExists(join(dir, CREDENTIALS_FILE))) return dir;
  }
  throw new Error(`No se encontro ninguna cuenta de Claude con login en ${deps.homedir}`);
}
