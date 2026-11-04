// Tercera fuente de MCP de Mage: los de la biblioteca con clave (ruta `mageMcp`). Mage los añade en cada lanzamiento
// de la cuenta y motor donde se instalaron; la clave sale de la bóveda y viaja por `secrets` (nunca en un fichero ni
// en los argumentos de un comando). Módulo PURO: el estado y la bóveda llegan por parámetro.
import { secretRef, secretVarName, type ResolvedMcpList, type ResolvedMcpServer } from '../../config/mcpResolved';
import type { CapabilityEngine } from '../capabilityPackage';
import { installRouteFor } from '../installRoute';
import { withPlatformLauncher } from '../nativeCommands';
import { librarySecretId, type LibraryVault } from './librarySecrets';
import { sameAccountDir, type LibraryInstallRecord } from './libraryState';

export interface LibraryMcpTarget {
  readonly engine: CapabilityEngine;
  readonly accountDir: string;
}

export interface LibraryMcpContext {
  readonly vault: Pick<LibraryVault, 'get'>;
  readonly platform: NodeJS.Platform;
  readonly caseInsensitive: boolean;
}

type ServerOrWarning = { readonly server: ResolvedMcpServer } | { readonly warning: string };

export function resolveLibraryMcp(
  installs: readonly LibraryInstallRecord[],
  target: LibraryMcpTarget,
  ctx: LibraryMcpContext,
): ResolvedMcpList {
  const servers: ResolvedMcpServer[] = [];
  const warnings: string[] = [];
  const mine = installs.filter((r) => isForTarget(r, target, ctx.caseInsensitive));
  for (const record of mine) {
    const outcome = resolveSafely(record, ctx);
    if (outcome === null) continue;
    if ('server' in outcome) servers.push(outcome.server);
    else warnings.push(outcome.warning);
  }
  return { servers, warnings };
}

function isForTarget(record: LibraryInstallRecord, target: LibraryMcpTarget, caseInsensitive: boolean): boolean {
  return record.enabled && record.engine === target.engine && sameAccountDir(record.accountDir, target.accountDir, caseInsensitive);
}

// Un registro raro no puede tumbar el lanzamiento de la cuenta: se omite con aviso (el mensaje lleva el motivo).
function resolveSafely(record: LibraryInstallRecord, ctx: LibraryMcpContext): ServerOrWarning | null {
  try {
    return resolveRecord(record, ctx);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { warning: `«${record.packageId}» de la biblioteca omitido: ${reason}` };
  }
}

// null = el registro no es de la ruta mageMcp (lo gestiona el CLI).
function resolveRecord(record: LibraryInstallRecord, ctx: LibraryMcpContext): ServerOrWarning | null {
  const { package: pkg } = record;
  if (installRouteFor(pkg, record.engine) !== 'mageMcp') return null;
  if (pkg.native?.type !== 'mcpStdio') throw new Error(`El MCP con clave ${pkg.id} no declara native stdio`);
  const native = withPlatformLauncher(pkg.native, ctx.platform);
  if (native.type !== 'mcpStdio') throw new Error(`El MCP con clave ${pkg.id} perdió su comando al adaptarlo a ${ctx.platform}`);
  const env: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const name of pkg.requires.secrets ?? []) {
    const value = ctx.vault.get(librarySecretId(record, name, ctx.caseInsensitive));
    if (value === null) return { warning: `«${pkg.id}» de la biblioteca omitido: falta su clave en la bóveda` };
    const varName = secretVarName(native.name, 'ENV', name);
    env[name] = secretRef(varName);
    secrets[varName] = value;
  }
  const server: ResolvedMcpServer = {
    transport: 'stdio', name: native.name, source: 'library', onlyIn: null, extra: {},
    command: native.command, args: native.args, cwd: null, env, secrets,
  };
  return { server };
}
