import { join } from 'node:path';
import type { McpRegistrationEntry, McpRegistrationResult } from '@shared/ipc';
import { CLAUDE_REMOVE_ARGS, CODEX_REMOVE_ARGS, claudeAddArgs, codexAddArgs, type MageMcpLaunch } from './registration';
import { claudeConfigHasMageServer, codexConfigHasMageServer } from './registrationStatus';

type McpProvider = 'claude' | 'codex';

const STDERR_MAX_CHARS = 500;

export interface McpRegistrationDeps {
  // Config dir (Claude) o CODEX_HOME (Codex); NUNCA perfiles privados.
  readonly accounts: () => readonly { readonly id: string; readonly name: string; readonly provider: McpProvider; readonly configHome: string }[];
  readonly readText: (path: string) => string | null; // null si no existe
  readonly runCli: (provider: McpProvider, configHome: string, args: readonly string[]) => Promise<{ readonly exitCode: number | null; readonly stderr: string }>;
  readonly launch: () => MageMcpLaunch;
  readonly log: (level: 'info' | 'warn', message: string, data?: unknown) => void;
}

type Account = ReturnType<McpRegistrationDeps['accounts']>[number];
type Failure = McpRegistrationResult['failures'][number];

// H4: registra `mage` en cada cuenta con el propio CLI. El estado se lee del fichero que escribe el CLI (D-M10)
// y Codex lo relee en cada arranque (`forwardToCodexMcp`, M05).
export class McpRegistrationService {
  constructor(private readonly deps: McpRegistrationDeps) {}

  status(): McpRegistrationResult {
    return { entries: this.deps.accounts().map((account) => this.entryOf(account)), failures: [] };
  }

  async registerAll(): Promise<McpRegistrationResult> {
    const launch = this.deps.launch();
    const failures: Failure[] = [];
    // De una en una: el CLI reescribe su fichero de config. Si ya estaba, primero `remove`: el comando
    // registrado puede ser de otra instalación de Mage.
    for (const account of this.deps.accounts()) {
      const add = account.provider === 'claude' ? claudeAddArgs(launch) : codexAddArgs(launch);
      if (this.entryOf(account).registered) await this.run(account, removeArgsOf(account.provider), failures);
      await this.run(account, add, failures);
    }
    return { ...this.status(), failures };
  }

  async unregisterAll(): Promise<McpRegistrationResult> {
    const failures: Failure[] = [];
    for (const account of this.deps.accounts()) {
      if (this.entryOf(account).registered) await this.run(account, removeArgsOf(account.provider), failures);
    }
    return { ...this.status(), failures };
  }

  private entryOf(account: Account): McpRegistrationEntry {
    const base = { accountId: account.id, accountName: account.name, provider: account.provider };
    if (account.provider === 'claude') {
      const text = this.deps.readText(join(account.configHome, '.claude.json')) ?? '';
      return { ...base, registered: claudeConfigHasMageServer(text) };
    }
    const toml = this.deps.readText(join(account.configHome, 'config.toml')) ?? '';
    return { ...base, registered: codexConfigHasMageServer(toml) };
  }

  // Sin entorno ni línea de comandos en el mensaje: solo el principio del stderr.
  private async run(account: Account, args: readonly string[], failures: Failure[]): Promise<void> {
    const result = await this.deps.runCli(account.provider, account.configHome, args);
    if (result.exitCode === 0) return;
    this.deps.log('warn', 'El CLI no pudo cambiar el registro MCP de Mage', { provider: account.provider, exitCode: result.exitCode });
    failures.push({ accountId: account.id, message: result.stderr.slice(0, STDERR_MAX_CHARS) });
  }
}

function removeArgsOf(provider: McpProvider): readonly string[] {
  return provider === 'claude' ? CLAUDE_REMOVE_ARGS : CODEX_REMOVE_ARGS;
}
