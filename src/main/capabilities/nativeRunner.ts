import { isAbsolute } from 'node:path';
import { scrubAgentEnv } from '../os/agentEnv';
import type { CapabilityEngine } from './capabilityPackage';
import type { CommandResult, CommandRunner } from './commandRunner';
import type { NativeCommand } from './nativeCommands';
import { previewValue } from './capabilityPackage';

// `plugin marketplace add` clona un repositorio git: puede tardar. Dos minutos como techo.
export const NATIVE_COMMAND_TIMEOUT_MS = 120_000;
const OUTPUT_PREVIEW_MAX_CHARS = 2000;

export interface NativeRunContext {
  readonly engine: CapabilityEngine;
  readonly binary: string; // resuelto por claudeBinaryResolver / codexBinaryResolver
  readonly configDir: string; // el de LA cuenta: CLAUDE_CONFIG_DIR o CODEX_HOME
  readonly runner: CommandRunner;
  readonly baseEnv: NodeJS.ProcessEnv;
}

function clip(text: string): string {
  return text.length > OUTPUT_PREVIEW_MAX_CHARS ? `${text.slice(0, OUTPUT_PREVIEW_MAX_CHARS)}…` : text;
}

// Un CLI que arrancó y terminó con un código distinto de 0 (o sin código). Lleva su salida para enseñársela al usuario.
export class NativeCommandError extends Error {
  constructor(
    readonly command: NativeCommand,
    readonly result: CommandResult,
  ) {
    super(
      `${command.engine} ${command.args.join(' ')} falló (código ${result.exitCode ?? 'sin código'}): ` +
        `stderr: ${clip(result.stderr)}; stdout: ${clip(result.stdout)}`,
    );
    this.name = 'NativeCommandError';
  }
}

export function configDirEnvVar(engine: CapabilityEngine): 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME' {
  return engine === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
}

// El saneado va PRIMERO (CLAUDE.md, invariante de facturación) y estos comandos no reciben ninguna clave, ni siquiera
// la de una cuenta de API: `mcp` y `plugin` no hablan con ningún modelo.
export function buildNativeEnv(engine: CapabilityEngine, configDir: string, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...scrubAgentEnv(baseEnv), [configDirEnvVar(engine)]: configDir };
}

function assertRunnable(ctx: NativeRunContext, command: NativeCommand): void {
  if (ctx.configDir.trim() === '' || !isAbsolute(ctx.configDir)) {
    throw new Error(
      `Falta el config dir de la cuenta (${configDirEnvVar(ctx.engine)}): nunca se usa el del usuario por defecto. ` +
        `Recibido: ${JSON.stringify(ctx.configDir)}`,
    );
  }
  if (ctx.binary.trim() === '') throw new Error(`Binario de ${ctx.engine} vacío: ${JSON.stringify(ctx.binary)}`);
  if (command.engine !== ctx.engine) {
    throw new Error(`Comando de ${command.engine} lanzado con el contexto de ${ctx.engine}: ${previewValue(command.args)}`);
  }
}

export async function runNativeCommand(ctx: NativeRunContext, command: NativeCommand): Promise<string> {
  assertRunnable(ctx, command);
  const env = buildNativeEnv(ctx.engine, ctx.configDir, ctx.baseEnv);
  const result = await ctx.runner(ctx.binary, command.args, { env, timeoutMs: NATIVE_COMMAND_TIMEOUT_MS });
  if (result.exitCode !== 0) throw new NativeCommandError(command, result);
  return result.stdout;
}

// En serie y en orden. Un plugin a medias (marketplace añadido, instalación fallida) se queda así; el error lleva la
// salida del CLI para enseñársela al usuario.
export async function runNativeCommands(ctx: NativeRunContext, commands: readonly NativeCommand[]): Promise<readonly string[]> {
  const outputs: string[] = [];
  for (const command of commands) outputs.push(await runNativeCommand(ctx, command));
  return outputs;
}
