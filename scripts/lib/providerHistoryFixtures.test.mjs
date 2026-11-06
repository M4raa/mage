import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seedProviderHistory } from './providerHistoryFixtures.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('seedProviderHistory', () => {
  it('seedProviderHistory_codexRollout_mtimeIsNow', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mage-phf-'));
    const before = Date.now() - 1000;
    const fx = seedProviderHistory({ userDataDir: dir, repoRoot });
    try {
      const day = join(fx.codexHome, 'sessions', '2026', '10', '05');
      const files = readdirSync(day).filter((name) => name.endsWith('.jsonl'));
      expect(files).toHaveLength(1);
      expect(statSync(join(day, files[0])).mtimeMs).toBeGreaterThanOrEqual(before);
    } finally {
      fx.cleanup();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
