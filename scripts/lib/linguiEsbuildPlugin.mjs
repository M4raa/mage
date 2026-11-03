import { createRequire } from 'node:module';
import path from 'node:path';

// Los spikes que se empaquetan con esbuild arrastran `src/shared/i18n/translator.ts`, que importa los catálogos con
// `…/es.json?lingui`. esbuild no sabe resolver ese sufijo: este plugin compila el catálogo igual que el hook
// `vite-plugin-lingui-load-catalog` de `@lingui/vite-plugin` 6.10.1 (mismo `getCatalogForFile`, `getTranslations` y
// `createCompiledCatalog`), así que el resultado es el del build real. Si se actualiza Lingui, hay que volver a mirar ese hook.

const QUERY_SUFFIX = /\?lingui$/;
const NAMESPACE = 'mage-lingui';

// `@lingui/conf` y `@lingui/cli` no cuelgan de `node_modules/@lingui/`: se resuelven desde `@lingui/vite-plugin`
// (su `package.json` no está en `exports`, por eso se parte de su entrada principal).
function loadLingui(repoRoot) {
  const fromRepo = createRequire(path.join(repoRoot, 'package.json'));
  const fromVitePlugin = createRequire(fromRepo.resolve('@lingui/vite-plugin'));
  return { conf: fromVitePlugin('@lingui/conf'), api: fromVitePlugin('@lingui/cli/api') };
}

export function linguiCatalogPlugin(repoRoot) {
  const { conf, api } = loadLingui(repoRoot);
  let config;
  let catalogs;

  async function compile(filePath) {
    config ??= conf.getConfig({ cwd: repoRoot });
    catalogs ??= await api.getCatalogs(config);
    const fileCatalog = api.getCatalogForFile(path.relative(config.rootDir, filePath), catalogs);
    if (fileCatalog === null || fileCatalog === undefined) {
      throw new Error(`El recurso ${filePath} no corresponde a ningún catálogo de lingui.config`);
    }
    const { locale, catalog } = fileCatalog;
    const { messages } = await catalog.getTranslations(locale, {
      fallbackLocales: config.fallbackLocales,
      sourceLocale: config.sourceLocale,
      missingBehavior: 'ignore',
    });
    const { source, errors } = api.createCompiledCatalog(locale, messages, { namespace: 'es' });
    if (errors.length > 0) throw new Error(`El catálogo ${locale} (${filePath}) tiene ${errors.length} errores de compilación`);
    return source;
  }

  return {
    name: 'mage-lingui-catalogs',
    setup(build) {
      build.onResolve({ filter: /\.json\?lingui$/ }, (args) => ({
        path: path.resolve(args.resolveDir, args.path.replace(QUERY_SUFFIX, '')),
        namespace: NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, async (args) => ({
        contents: await compile(args.path),
        loader: 'js',
        resolveDir: path.dirname(args.path),
      }));
    },
  };
}
