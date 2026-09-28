import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { writeCredentials, type CredentialsDeps } from './credentialsStore';
import type { ClaudeAiOauth } from './oauthFlow';

const CREDS: ClaudeAiOauth = {
  accessToken: 'AT',
  refreshToken: 'RT',
  expiresAt: 1_700_000_000_000,
  scopes: ['user:profile', 'user:inference'],
  subscriptionType: 'max',
  rateLimitTier: 'tier1',
};

// deps con espias y un mapa de contenidos por ruta (lo que no este -> null, como el readJson real).
function deps(jsonByPath: Record<string, unknown> = {}, existing: Set<string> = new Set()): CredentialsDeps & {
  writeFileAtomic: ReturnType<typeof vi.fn>;
  chmod600: ReturnType<typeof vi.fn>;
} {
  return {
    readJson: (path: string) => (path in jsonByPath ? jsonByPath[path] : null),
    writeFileAtomic: vi.fn(),
    chmod600: vi.fn(),
    exists: (path: string) => existing.has(path),
  };
}

describe('writeCredentials', () => {
  it('writeCredentials_freshFile_writesClaudeAiOauthAndChmod600', () => {
    const d = deps();

    writeCredentials('/home/u/.claude-p', CREDS, d);

    const [path, content] = d.writeFileAtomic.mock.calls[0]!;
    expect(path).toBe(join('/home/u/.claude-p', '.credentials.json'));
    expect(JSON.parse(content as string)).toEqual({
      claudeAiOauth: {
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: 1_700_000_000_000,
        scopes: ['user:profile', 'user:inference'],
        subscriptionType: 'max',
        rateLimitTier: 'tier1',
      },
    });
    expect(d.chmod600).toHaveBeenCalledWith(path);
  });

  it('writeCredentials_existingForeignKeys_preservesThem', () => {
    const path = join('/home/u/.claude', '.credentials.json');
    const d = deps({ [path]: { otherProvider: { token: 'x' }, claudeAiOauth: { accessToken: 'old' } } });

    writeCredentials('/home/u/.claude', CREDS, d);

    const parsed = JSON.parse(d.writeFileAtomic.mock.calls[0]![1] as string);
    expect(parsed.otherProvider).toEqual({ token: 'x' }); // clave ajena intacta
    expect(parsed.claudeAiOauth.accessToken).toBe('AT'); // la nuestra reemplazada
  });

  it('writeCredentials_emptyConfigDir_throws', () => {
    expect(() => writeCredentials('', CREDS, deps())).toThrow(/configDir/);
  });
});
