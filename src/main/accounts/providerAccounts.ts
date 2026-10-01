import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import type { AccountAuthKind, AccountCreateParams, AccountInfo, AccountProviderId, LoginStatus } from '@shared/accounts';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';
import { pathEquals } from '../os/pathUtils';
import { ACCOUNT_NAME_PATTERN } from './accountService';

// Cuentas que NO son la suscripcion de Claude (grupo E, la matriz fabricante × forma de pago): Claude
// por clave de API, Codex (suscripcion de ChatGPT o clave) y agy por clave. Cada una tiene SU carpeta de
// estado y Mage no comparte credenciales entre ellas:
//   - Claude · API: un config dir `~/.claude-<nombre>` como cualquier otro (lo crea AccountService, con
//     las carpetas compartidas), en el que NUNCA se inicia sesion. Solo esta cuenta recibe su clave.
//   - Codex: un `CODEX_HOME` propio, `~/.codex-<nombre>`. La de suscripcion guarda alli su `auth.json`
//     (lo escribe el CLI al iniciar sesion); la de API no tiene `auth.json`: su clave va por el entorno.
//   - agy · API: un perfil propio (`USERPROFILE`) en `userData/agy-accounts/<nombre>`. La suscripcion
//     de agy no se aisla por carpeta (su login vive fuera, medido en 1.2.14) y sigue siendo una sola.
// Las claves viven cifradas en la boveda (`SecretStore`); aqui solo se guarda QUE cuentas hay.

export interface ProviderAccountEntry {
  readonly providerId: AccountProviderId;
  readonly authKind: AccountAuthKind;
  readonly name: string;
  readonly home: string;
}

// Lo minimo de la boveda que hace falta (DI: los tests pasan un mapa en memoria).
export interface AccountKeyVault {
  readonly set: (id: string, value: string) => void;
  readonly get: (id: string) => string | null;
  readonly has: (id: string) => boolean;
  readonly delete: (id: string) => void;
}

export interface ProviderAccountDeps extends AtomicWriteDeps {
  readonly filePath: string; // userData/provider-accounts.json
  readonly homedir: string;
  readonly userDataDir: string;
  readonly vault: AccountKeyVault;
  readonly mkdir: (path: string) => void;
  readonly rmrf: (path: string) => void;
  // El alta y la baja de un config dir de Claude son de AccountService (enlaces compartidos, semilla).
  readonly createClaudeDir: (name: string) => AccountInfo;
  readonly deleteClaudeDir: (configDir: string) => void;
}

const FILE_VERSION = 1;
const ENTRY_SCHEMA = z.object({
  providerId: z.enum(['claude', 'codex', 'agy']),
  authKind: z.enum(['subscription', 'api-key']),
  name: z.string().min(1),
  home: z.string().min(1),
});
const FILE_SCHEMA = z.object({ version: z.literal(FILE_VERSION), accounts: z.array(ENTRY_SCHEMA) });

const CODEX_DIR_PREFIX = '.codex-';
const AGY_ACCOUNTS_DIR = 'agy-accounts';
const AGY_NAME_PREFIX = 'agy-';
// Lo que deja el login de ChatGPT de codex en su CODEX_HOME (documentado; sin verificar con cuenta).
const CODEX_AUTH_FILE = 'auth.json';
// Nombre del perfil privado de una cuenta de Claude (AccountService): factura como su cuenta.
const PRIVATE_PROFILE_DIR = 'mage-private';

// Que celdas de la matriz se dan de alta aqui. La suscripcion de Claude va por AccountService (login del
// CLI) y la de agy no se crea: es una sola y vive fuera de Mage.
const CREATABLE: readonly string[] = ['claude:api-key', 'codex:subscription', 'codex:api-key', 'agy:api-key'];

export function accountApiKeySecretId(providerId: AccountProviderId, home: string): string {
  return `account-api-key:${providerId}:${home}`;
}

export class ProviderAccountService {
  constructor(private readonly deps: ProviderAccountDeps) {}

  // Las cuentas de Claude descubiertas en disco, con la marca de las de API, y detras las demas.
  list(claudeAccounts: readonly AccountInfo[]): AccountInfo[] {
    const entries = this.read();
    const claude = claudeAccounts.map((account) => this.markClaude(account, entries));
    const others = entries.filter((entry) => entry.providerId !== 'claude').map((entry) => this.describe(entry));
    return [...claude, ...others];
  }

  create(params: AccountCreateParams): AccountInfo {
    const name = params.name.trim();
    if (!ACCOUNT_NAME_PATTERN.test(name)) {
      throw new Error(`Nombre de cuenta invalido (letra inicial + letras/numeros/-/_): ${JSON.stringify(params.name)}`);
    }
    if (!CREATABLE.includes(`${params.providerId}:${params.authKind}`)) {
      throw new Error(`Esa cuenta no se da de alta aqui: ${params.providerId} · ${params.authKind}`);
    }
    const apiKey = params.authKind === 'api-key' ? requireApiKey(params.apiKey) : null;
    const entries = this.read(); // antes de crear nada: un registro corrupto no deja carpetas huerfanas
    const claudeDir = params.providerId === 'claude' ? this.deps.createClaudeDir(name) : null;
    const home = claudeDir?.configDir ?? this.createHome(params.providerId, name);
    const entry: ProviderAccountEntry = { providerId: params.providerId, authKind: params.authKind, name, home };
    if (apiKey !== null) this.deps.vault.set(accountApiKeySecretId(entry.providerId, home), apiKey);
    this.write([...entries, entry]);
    return claudeDir === null ? this.describe(entry) : this.markClaude(claudeDir, [entry]);
  }

  // Borra una cuenta registrada: su carpeta, su clave y su entrada. false = no es de este registro (una
  // suscripcion de Claude, que borra AccountService).
  delete(configDir: string): boolean {
    const entries = this.read();
    const entry = entries.find((candidate) => pathEquals(candidate.home, configDir));
    if (entry === undefined) return false;
    if (entry.providerId === 'claude') this.deps.deleteClaudeDir(entry.home);
    else this.deps.rmrf(entry.home);
    this.deps.vault.delete(accountApiKeySecretId(entry.providerId, entry.home));
    this.write(entries.filter((candidate) => candidate !== entry));
    return true;
  }

  // La cuenta registrada de ESE proveedor cuyo estado vive en `dir` (o en su perfil privado, que factura
  // como su cuenta). null = no es una cuenta de este registro para ese proveedor.
  find(providerId: AccountProviderId, dir: string): ProviderAccountEntry | null {
    const trimmed = dir.trim();
    if (trimmed.length === 0) return null;
    const owner = basename(trimmed) === PRIVATE_PROFILE_DIR ? dirname(trimmed) : trimmed;
    return this.read().find((entry) => entry.providerId === providerId && pathEquals(entry.home, owner)) ?? null;
  }

  // La clave de la cuenta de API de ese proveedor en `dir`, o null si no es una cuenta de API. Una cuenta
  // de API SIN clave en la boveda lanza: lanzarla sin credencial caeria en otra (o fallaria lejos de aqui).
  apiKeyFor(providerId: AccountProviderId, dir: string): string | null {
    const entry = this.find(providerId, dir);
    if (entry === null || entry.authKind !== 'api-key') return null;
    const key = this.deps.vault.get(accountApiKeySecretId(providerId, entry.home));
    if (key === null) throw new Error(`La cuenta ${entry.name} es de clave de API y no tiene clave guardada en Mage`);
    return key;
  }

  private createHome(providerId: AccountProviderId, name: string): string {
    const home =
      providerId === 'codex'
        ? join(this.deps.homedir, `${CODEX_DIR_PREFIX}${name}`)
        : join(this.deps.userDataDir, AGY_ACCOUNTS_DIR, name);
    if (this.deps.exists(home)) throw new Error(`La cuenta ya existe: ${home}`);
    this.deps.mkdir(home);
    return home;
  }

  private markClaude(account: AccountInfo, entries: readonly ProviderAccountEntry[]): AccountInfo {
    const entry = entries.find((candidate) => candidate.providerId === 'claude' && pathEquals(candidate.home, account.configDir));
    if (entry === undefined) return account;
    return { ...account, authKind: 'api-key', loginStatus: this.keyStatus(entry), expiresAt: null };
  }

  private describe(entry: ProviderAccountEntry): AccountInfo {
    return {
      configDir: entry.home,
      name: entry.providerId === 'codex' ? `${CODEX_DIR_PREFIX}${entry.name}` : `${AGY_NAME_PREFIX}${entry.name}`,
      isMain: false,
      providerId: entry.providerId,
      authKind: entry.authKind,
      email: null,
      org: null,
      loginStatus: entry.authKind === 'api-key' ? this.keyStatus(entry) : this.codexLoginStatus(entry.home),
      expiresAt: null,
      defaultModel: null,
    };
  }

  private keyStatus(entry: ProviderAccountEntry): LoginStatus {
    return this.deps.vault.has(accountApiKeySecretId(entry.providerId, entry.home)) ? 'logged_in' : 'logged_out';
  }

  private codexLoginStatus(home: string): LoginStatus {
    return this.deps.exists(join(home, CODEX_AUTH_FILE)) ? 'logged_in' : 'logged_out';
  }

  // Un fichero corrupto LANZA: leerlo como vacio haria que la siguiente alta lo sobrescribiera y Mage
  // olvidaria que cuentas son de API (la de Claude pasaria a parecer de suscripcion).
  private read(): readonly ProviderAccountEntry[] {
    if (!this.deps.exists(this.deps.filePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.deps.readFile(this.deps.filePath));
    } catch (err) {
      throw new Error(`${this.deps.filePath} no es JSON valido: ${err instanceof Error ? err.message : String(err)}`);
    }
    const result = FILE_SCHEMA.safeParse(parsed);
    if (!result.success) throw new Error(`${this.deps.filePath} no tiene la forma esperada: ${result.error.message}`);
    return result.data.accounts;
  }

  private write(accounts: readonly ProviderAccountEntry[]): void {
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify({ version: FILE_VERSION, accounts }, null, 2));
  }
}

function requireApiKey(apiKey: string | undefined): string {
  const trimmed = (apiKey ?? '').trim();
  // El mensaje no cita el valor: podria ser la propia clave.
  if (trimmed.length === 0) throw new Error('Falta la clave de API de la cuenta');
  return trimmed;
}
