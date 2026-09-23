import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveClaudeBinary } from './claudeBinaryResolver';
import { scrubAgentEnv } from './agentEnv';

// Version del CLI usada en el User-Agent del endpoint de uso cuando no se puede resolver la real.
// (El endpoint exige un User-Agent "claude-code/<version>" o responde 429.)
export const DEFAULT_CLI_VERSION = '2.1.205';

// Dir de config de la cuenta principal (mismo valor que AccountService.MAIN_DIR_NAME; duplicado a
// proposito para no acoplar este modulo de SO a la logica de cuentas).
const MAIN_CONFIG_DIR_NAME = '.claude';

// Extrae la version semver del stdout de `claude --version` (p.ej. "2.1.205 (Claude Code)").
// Parser PURO (testeable). Devuelve null si no encuentra un patron de version reconocible.
export function parseClaudeVersion(stdout: string): string | null {
  if (typeof stdout !== 'string') return null;
  // major.minor.patch con posible sufijo (p.ej. "-beta.1" o "[1m]").
  const match = stdout.match(/\d+\.\d+\.\d+(?:[-.\w[\]]*)?/);
  return match ? match[0] : null;
}

let cachedVersion: string | null = null;

// Resuelve la version del CLI una sola vez (cacheada). Ejecuta `claude --version` de forma sincrona
// y best-effort; ante cualquier fallo (binario ausente, salida rara) cae en DEFAULT_CLI_VERSION.
// No lanza: el User-Agent debe existir siempre.
export function resolveClaudeVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  cachedVersion = tryResolve() ?? DEFAULT_CLI_VERSION;
  return cachedVersion;
}

// User-Agent completo para el endpoint de uso.
export function claudeUserAgent(): string {
  return `claude-code/${resolveClaudeVersion()}`;
}

// Env con el que se lanza `claude --version`. Era el UNICO punto de arranque del CLI que heredaba el
// entorno tal cual: fija el config dir de la cuenta PRINCIPAL (no el CLAUDE_CONFIG_DIR heredado, que
// puede apuntar a cualquier cuenta o al perfil privado) y BORRA ANTHROPIC_API_KEY, igual que
// claudeAdapter y promptService (invariante de facturacion: ningun hijo `claude` la ve). PURA.
export function buildVersionEnv(baseEnv: NodeJS.ProcessEnv, homeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...scrubAgentEnv(baseEnv), CLAUDE_CONFIG_DIR: join(homeDir, MAIN_CONFIG_DIR_NAME) };
  return env;
}

function tryResolve(): string | null {
  try {
    const stdout = execFileSync(resolveClaudeBinary(), ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      env: buildVersionEnv(process.env, homedir()),
    });
    return parseClaudeVersion(stdout);
  } catch {
    // Best-effort: si el binario no responde, usamos la version por defecto (no bloquea el arranque).
    return null;
  }
}
