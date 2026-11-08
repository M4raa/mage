import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { McpRegistrationService, type McpRegistrationDeps } from './registrationService';

const LAUNCH = { command: 'node', args: ['cli.mjs'], env: {} };
const ACCOUNTS = [
  { id: 'c1', name: '.claude', provider: 'claude' as const, configHome: 'CL' },
  { id: 'x1', name: 'codex', provider: 'codex' as const, configHome: 'CX' },
];
const CLAUDE_REGISTERED = JSON.stringify({ mcpServers: { mage: { command: 'x' } } });
const CODEX_REGISTERED = '[mcp_servers.mage]\ncommand = "x"\n';

function build(files: Record<string, string>, runCli?: McpRegistrationDeps['runCli']) {
  const calls: { provider: string; args: readonly string[] }[] = [];
  const service = new McpRegistrationService({
    accounts: () => ACCOUNTS,
    readText: (path) => files[path] ?? null,
    runCli: runCli ?? ((provider, _home, args) => { calls.push({ provider, args }); return Promise.resolve({ exitCode: 0, stderr: '' }); }),
    launch: () => LAUNCH,
    log: () => undefined,
  });
  return { service, calls };
}

const claudeFile = join('CL', '.claude.json');
const codexFile = join('CX', 'config.toml');

describe('McpRegistrationService', () => {
  it('status_readsBothConfigFiles', () => {
    const { service } = build({ [claudeFile]: CLAUDE_REGISTERED, [codexFile]: CODEX_REGISTERED });
    expect(service.status().entries.map((e) => e.registered)).toEqual([true, true]);
  });

  it('status_missingFiles_notRegistered', () => {
    const { service } = build({});
    expect(service.status().entries.map((e) => e.registered)).toEqual([false, false]);
  });

  it('registerAll_unregistered_addOnly', async () => {
    const { service, calls } = build({});
    await service.registerAll();
    expect(calls.map((c) => c.args[1])).toEqual(['add', 'add']);
  });

  it('registerAll_registered_removeThenAdd', async () => {
    const { service, calls } = build({ [claudeFile]: CLAUDE_REGISTERED });
    await service.registerAll();
    expect(calls.filter((c) => c.provider === 'claude').map((c) => c.args[1])).toEqual(['remove', 'add']);
    expect(calls.filter((c) => c.provider === 'codex').map((c) => c.args[1])).toEqual(['add']);
  });

  it('registerAll_sequentialNotParallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { service } = build({}, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { exitCode: 0, stderr: '' };
    });
    await service.registerAll();
    expect(maxInFlight).toBe(1);
  });

  it('registerAll_cliFails_failureWithStderrTruncated', async () => {
    const { service } = build({}, () => Promise.resolve({ exitCode: 1, stderr: 'e'.repeat(900) }));
    const result = await service.registerAll();
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toEqual({ accountId: 'c1', message: 'e'.repeat(500) });
  });

  it('unregisterAll_onlyRegistered', async () => {
    const { service, calls } = build({ [codexFile]: CODEX_REGISTERED });
    await service.unregisterAll();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.provider).toBe('codex');
    expect(calls[0]?.args[1]).toBe('remove');
  });
});
