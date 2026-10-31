// Comandos de los gestores NATIVOS de cada CLI para instalar, quitar y listar MCP y plugins. Mage no edita nunca
// `.claude.json` ni `config.toml`: llama a estos comandos.
//
// Qué se midió y contra qué: `mcp add|remove|list` y `plugin list` con Claude Code 2.1.311 y Codex 0.164.0
// (INFORME-046 C2/H4). El `--scope` de `plugin install|uninstall` de Claude y los `plugin add|remove` y
// `marketplace add` de Codex salen del `--help` de Claude Code 2.1.314 y Codex 0.164.0, SIN medir de punta a punta.
//
// El `--` separa el comando del servidor MCP del resto: ningún argumento suyo se lee como opción del CLI.
// El marketplace NO se quita al desinstalar un plugin porque puede servir a otros plugins.
import type { CapabilityEngine, NativeInstall } from './capabilityPackage';
import { CODEX_MCP_LIST_ARGS } from '../config/codexMcp';

// Un comando de un CLI concreto. Los argumentos son EXACTAMENTE los medidos (ver la cabecera).
export interface NativeCommand {
  readonly engine: CapabilityEngine;
  readonly args: readonly string[];
}

const USER_SCOPE = ['--scope', 'user'] as const;

type ArgsList = readonly (readonly string[])[];

function selector(native: Extract<NativeInstall, { type: 'plugin' }>): string {
  return `${native.name}@${native.marketplace.name}`;
}

function claudeInstall(native: NativeInstall): ArgsList {
  switch (native.type) {
    case 'mcpStdio':
      return [['mcp', 'add', ...USER_SCOPE, '--transport', 'stdio', native.name, '--', native.command, ...native.args]];
    case 'plugin':
      return [
        ['plugin', 'marketplace', 'add', native.marketplace.source],
        ['plugin', 'install', selector(native), ...USER_SCOPE],
      ];
  }
}

function codexInstall(native: NativeInstall): ArgsList {
  switch (native.type) {
    case 'mcpStdio':
      return [['mcp', 'add', native.name, '--', native.command, ...native.args]];
    case 'plugin':
      return [
        ['plugin', 'marketplace', 'add', native.marketplace.source],
        ['plugin', 'add', selector(native)],
      ];
  }
}

function claudeUninstall(native: NativeInstall): ArgsList {
  switch (native.type) {
    case 'mcpStdio':
      return [['mcp', 'remove', native.name, ...USER_SCOPE]];
    case 'plugin':
      return [['plugin', 'uninstall', selector(native), ...USER_SCOPE]];
  }
}

function codexUninstall(native: NativeInstall): ArgsList {
  switch (native.type) {
    case 'mcpStdio':
      return [['mcp', 'remove', native.name]];
    case 'plugin':
      return [['plugin', 'remove', selector(native)]];
  }
}

function tagged(engine: CapabilityEngine, argsList: ArgsList): readonly NativeCommand[] {
  return argsList.map((args) => ({ engine, args }));
}

export function nativeInstallCommands(engine: CapabilityEngine, native: NativeInstall): readonly NativeCommand[] {
  return tagged(engine, engine === 'claude' ? claudeInstall(native) : codexInstall(native));
}

export function nativeUninstallCommands(engine: CapabilityEngine, native: NativeInstall): readonly NativeCommand[] {
  return tagged(engine, engine === 'claude' ? claudeUninstall(native) : codexUninstall(native));
}

export function nativeListCommand(engine: CapabilityEngine, type: NativeInstall['type']): NativeCommand {
  if (type === 'plugin') return { engine, args: ['plugin', 'list', '--json'] };
  if (engine === 'codex') return { engine, args: CODEX_MCP_LIST_ARGS };
  return { engine, args: ['mcp', 'list'] };
}
