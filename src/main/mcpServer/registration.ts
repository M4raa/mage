import { join } from 'node:path';
import { MAGE_MCP_SERVER_NAME } from './registrationStatus';

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
