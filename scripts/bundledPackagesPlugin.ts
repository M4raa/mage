import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// B7 de la revision del runtime (D6 de P-033): que paquetes entran DE VERDAD en cada bundle. El asar no
// lleva `node_modules` (`electron-builder.yml`), asi que lo que se distribuye es exactamente el codigo que
// rollup deja en los bundles; `pnpm notices` avisa de esos y no de todo lo instalado (el SDK de MCP
// arrastra express, hono… que nunca viajan). Se escribe en cada `pnpm build` en
// `third-party-bundle.json` (versionado: `notices --check` lo usa sin construir).

export const BUNDLE_MANIFEST = 'third-party-bundle.json';

export function bundledPackagesPlugin(target: 'main' | 'preload' | 'renderer', root: string): Plugin {
  return {
    name: 'mage-bundled-packages',
    apply: 'build',
    generateBundle(_options, bundle) {
      const names = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [id, info] of Object.entries(output.modules)) {
          const name = packageOf(id);
          // Un modulo sacudido entero (`renderedLength` 0) no se distribuye.
          if (name !== null && info.renderedLength > 0) names.add(name);
        }
      }
      writeManifest(path.join(root, BUNDLE_MANIFEST), target, [...names].sort((a, b) => a.localeCompare(b, 'en')));
    },
  };
}

// Nombre del paquete de un modulo de `node_modules` (pnpm anida: se toma el ULTIMO `node_modules/`).
export function packageOf(id: string): string | null {
  const normalized = id.replace(/^\0/, '').replaceAll('\\', '/');
  const at = normalized.lastIndexOf('/node_modules/');
  if (at === -1) return null;
  const parts = normalized.slice(at + '/node_modules/'.length).split('/');
  const name = parts[0]!.startsWith('@') ? `${parts[0]}/${parts[1] ?? ''}` : parts[0]!;
  return name.length === 0 || name.endsWith('/') ? null : name;
}

// Cada target actualiza SU clave: electron-vite construye main, preload y renderer uno detras de otro.
function writeManifest(file: string, target: string, names: readonly string[]): void {
  const current: Record<string, string[]> = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string[]>) : {};
  const next = { ...current, [target]: names };
  const text = `${JSON.stringify(Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text, 'utf8');
}
