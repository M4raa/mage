import { join } from 'node:path';
import { MAGE_MCP_SERVER_NAME } from './registrationStatus';
import { MAGE_MCP_CALLER_ENV } from '../host/mcpCallers';
import type { ResolvedStdioServer } from '../config/mcpResolved';

// Cómo lanza un CLI (Claude o Codex) el servidor MCP de Mage: `mage mcp` hablando con el host de ESTE perfil.
export interface MageMcpLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface MageMcpLaunchInput {
  readonly isPackaged: boolean;
  readonly execPath: string;
  readonly resourcesPath: string;
  readonly appPath: string;
  readonly appImage: string | undefined;
  readonly userDataDir: string;
}

// D-M10. Siempre `--user-data-dir`: así `mage mcp` habla con el host de este perfil (también en desarrollo).
// AppImage: su ejecutable se monta en una ruta temporal distinta en cada arranque, así que se registra el
// propio .AppImage (que atiende `--cli`) y no `process.execPath`.
export function mageMcpLaunch(input: MageMcpLaunchInput): MageMcpLaunch {
  const tail = ['mcp', '--user-data-dir', input.userDataDir];
  if (input.appImage !== undefined && input.appImage !== '') {
    return { command: input.appImage, args: ['--cli', ...tail], env: {} };
  }
  const script = input.isPackaged ? join(input.resourcesPath, 'cli', 'mage.mjs') : join(input.appPath, 'scripts', 'mage-cli', 'mage.mjs');
  return { command: input.execPath, args: [script, ...tail], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

// Una pareja `[flag, 'K=V']` por variable, en orden alfabético de clave (salida estable).
function envFlags(flag: string, env: Readonly<Record<string, string>>): string[] {
  return Object.keys(env).sort().flatMap((key) => [flag, `${key}=${env[key]}`]);
}

// El nombre va ANTES de `-e` a propósito: `-e` admite varios valores y se tragaría el nombre (lo mide cp/M-04).
export function claudeAddArgs(launch: MageMcpLaunch): readonly string[] {
  return ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', MAGE_MCP_SERVER_NAME, ...envFlags('-e', launch.env), '--', launch.command, ...launch.args];
}

export function codexAddArgs(launch: MageMcpLaunch): readonly string[] {
  return ['mcp', 'add', MAGE_MCP_SERVER_NAME, ...envFlags('--env', launch.env), '--', launch.command, ...launch.args];
}

export const CLAUDE_REMOVE_ARGS = ['mcp', 'remove', MAGE_MCP_SERVER_NAME, '--scope', 'user'] as const;
export const CODEX_REMOVE_ARGS = ['mcp', 'remove', MAGE_MCP_SERVER_NAME] as const;

// P-038 V7: con el MCP de Mage ACTIVADO, cada conversación de Claude o Codex lo recibe al lanzarse por el mismo
// camino que los demás MCP comunes (`--mcp-config` en Claude, `-c mcp_servers.*` en Codex), también las privadas
// y las de cuentas creadas después, sin tocar el `.claude.json` ni el `config.toml` de nadie. La credencial
// de la sesión va en su `env`: los traductores la entregan por el entorno, nunca en un fichero ni en la línea
// de comandos.
export function mageMcpServer(launch: MageMcpLaunch, credential: string): ResolvedStdioServer {
  if (credential.trim().length === 0) throw new Error(`Credencial vacia para el MCP de Mage: ${JSON.stringify(credential)}`);
  return {
    name: MAGE_MCP_SERVER_NAME,
    source: 'common',
    onlyIn: null,
    extra: {},
    secrets: {},
    transport: 'stdio',
    command: launch.command,
    args: launch.args,
    env: { ...launch.env, [MAGE_MCP_CALLER_ENV]: credential },
    cwd: null,
  };
}

// P-038 (informe del usuario, 10-11): con el MCP de Mage APAGADO, el modelo no tiene sesiones ni navegador de Mage y,
// sin saberlo, los sustituía en silencio por subagentes y Playwright. Lo lee el modelo (castellano, como el resto).
export const MAGE_MCP_OFF_NOTICE = [
  'Esta conversación corre dentro de Mage, pero el MCP de Mage está DESACTIVADO: no tienes herramientas para crear sesiones de Mage (subsesiones o sesiones delegadas) ni el navegador integrado de Mage.',
  'Si el usuario pide subsesiones, sesiones o conversaciones nuevas de Mage, o usar el navegador de Mage, dile que no puedes porque el MCP de Mage está desactivado y que se activa en Ajustes › MCP y conectores › Servidor MCP de Mage.',
  'No lo sustituyas por subagentes (Agent/Task), por el CLI desde la consola (claude -p, codex exec) ni por otro navegador (Playwright, Chrome) salvo que el usuario te lo pida expresamente.',
].join('\n');

// P-038 V14: las herramientas de Mage que solo LEEN no piden permiso (consultar sesiones, leer su respuesta, leer o
// capturar la página). Crear, mandar, cancelar, navegar, pulsar y escribir siguen preguntando. Formato de regla del
// CLI de Claude para una herramienta MCP: `mcp__<servidor>__<herramienta>`.
export const MAGE_READ_ONLY_TOOLS = ['mage_list_sessions', 'mage_get_status', 'mage_read_result', 'mage_browser_read_dom', 'mage_browser_screenshot'] as const;

type SettingsFragment = Readonly<Record<string, unknown>>;

export function withMageReadOnlyAllow(fragment: SettingsFragment | null): SettingsFragment {
  const base = fragment ?? {};
  const permissions = isRecord(base.permissions) ? base.permissions : {};
  const current = Array.isArray(permissions.allow) ? permissions.allow.filter((rule): rule is string => typeof rule === 'string') : [];
  const rules = MAGE_READ_ONLY_TOOLS.map((tool) => `mcp__${MAGE_MCP_SERVER_NAME}__${tool}`);
  return { ...base, permissions: { ...permissions, allow: [...new Set([...current, ...rules])] } };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
