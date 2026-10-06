import type { AccountInfo } from '@shared/accounts';
import type { CodexAccountMetadata } from '@shared/mcp';

export interface CodexAccountCatalogDeps {
  readonly probe: (home: string) => Promise<CodexAccountMetadata>;
  readonly now: () => number;
  readonly onError: (reason: string) => void;
}

// Descubrimiento y confirmacion separados: el catalogo es la frontera del arranque de cuentas.
export class CodexAccountCatalog {
  private readonly cache = new Map<string, { value: CodexAccountMetadata; at: number }>();
  private pending: Promise<readonly AccountInfo[]> | null = null;
  constructor(private readonly deps: CodexAccountCatalogDeps) {}

  invalidate(home: string): void { this.cache.delete(home); }

  list(accounts: readonly AccountInfo[]): readonly AccountInfo[] {
    return accounts.map((account) => {
      if (!shouldProbe(account)) return account;
      const entry = this.cache.get(account.configDir);
      if (entry === undefined || this.deps.now() - entry.at >= LOGIN_CACHE_MS) return account;
      return confirmedAccount(account, entry.value);
    });
  }

  confirm(accounts: readonly AccountInfo[]): Promise<readonly AccountInfo[]> {
    this.pending ??= this.confirmSerially(accounts).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async confirmSerially(accounts: readonly AccountInfo[]): Promise<readonly AccountInfo[]> {
    for (const account of accounts) {
      if (!shouldProbe(account)) continue;
      const entry = this.cache.get(account.configDir);
      if (entry !== undefined && this.deps.now() - entry.at < LOGIN_CACHE_MS) continue;
      const value = await this.deps.probe(account.configDir);
      this.cache.set(account.configDir, { value, at: this.deps.now() });
      if (value.error !== null) this.deps.onError(value.error);
    }
    return this.list(accounts);
  }
}

const LOGIN_CACHE_MS = 60_000;

function shouldProbe(account: AccountInfo): boolean {
  return account.providerId === 'codex' && account.authKind === 'subscription' && account.loginStatus !== 'logged_out';
}

function confirmedAccount(account: AccountInfo, value: CodexAccountMetadata): AccountInfo {
  if (value.authenticated === null) return account;
  const loginStatus = value.authenticated ? 'logged_in' : 'logged_out';
  return { ...account, loginStatus };
}
