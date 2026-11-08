import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { messages as viteEs } from '../../src/shared/i18n/catalogs/es.json?lingui';
import { messages as viteEn } from '../../src/shared/i18n/catalogs/en.json?lingui';
import { linguiCatalogPlugin } from './linguiEsbuildPlugin.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const esbuild = createRequire(path.join(repoRoot, 'package.json'))(path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
const catalogPath = (locale) => path.join(repoRoot, 'src/shared/i18n/catalogs', `${locale}.json`).replaceAll('\\', '/');

// Empaqueta `entry.mjs` (que reexporta `target?lingui`) en un temporal y devuelve el código resultante.
async function bundleCatalog(tmp, target) {
  const entry = path.join(tmp, 'entry.mjs');
  fs.writeFileSync(entry, `export { messages } from '${target}?lingui';`);
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    plugins: [linguiCatalogPlugin(repoRoot)],
  });
  return result.outputFiles[0].text;
}

async function compiledMessages(target) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-lingui-'));
  try {
    const code = await bundleCatalog(tmp, target);
    const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    return module.messages;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('linguiCatalogPlugin', () => {
  it('linguiCatalogPlugin_esCatalog_matchesVitePluginCompilation', async () => {
    const messages = await compiledMessages(catalogPath('es'));

    expect(messages).toEqual(viteEs);
  });

  it('linguiCatalogPlugin_enCatalog_matchesVitePluginCompilation', async () => {
    const messages = await compiledMessages(catalogPath('en'));

    expect(messages).toEqual(viteEn);
  });

  it('linguiCatalogPlugin_unknownCatalogPath_throwsWithPath', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-lingui-'));
    try {
      const foo = path.join(tmp, 'foo.json');
      fs.writeFileSync(foo, '{}');

      await expect(bundleCatalog(tmp, foo.replaceAll('\\', '/'))).rejects.toThrow(/foo\.json/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
