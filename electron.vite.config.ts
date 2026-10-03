import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { bundledPackagesPlugin } from './scripts/bundledPackagesPlugin';

// Config de los tres targets de Electron (main / preload / renderer).
// El alias @shared apunta al contrato compartido main<->renderer.
const sharedAlias = { '@shared': resolve('src/shared') };

export default defineConfig({
  main: {
    // externalizeDepsPlugin: no bundlear deps de Node en el proceso main.
    //
    // electron-updater y zod son la EXCEPCION (B2) y tienen que viajar BUNDLEADOS: `electron-builder.yml`
    // excluye `!node_modules/**` del asar a proposito (bajo de 12,4 a 1,6 MB, ver §B1), asi que
    // externalizado NO existe en la app empaquetada. Medido, no razonado: con el import externalizado
    // el .exe empaquetado ni arranca (electron-updater) o falla con ERR_MODULE_NOT_FOUND (zod).
    // Las dos vias, medidas el 2026-08-11 sobre el mismo arbol (asar base sin updater: 2,05 MB):
    //   (a) bundlear aqui .................. asar 2,59 MB (+555 KB)  <- elegida
    //   (b) re-incluir node_modules en
    //       `files` (16 paquetes: el propio
    //       mas 15 transitivos) ............ asar 4,11 MB (+2,06 MB), 302 entradas nuevas
    // (b) casi duplica el asar (arrastra .js.map y .d.ts de cada paquete) y ademas obliga a mantener a
    // mano el cierre transitivo en el YAML. Coste de (a): el paquete entra por completo (incluidos los
    // updaters de deb/rpm/pacman que Windows no usa) porque su `autoUpdater` los resuelve con
    // `require()` dinamico segun plataforma, y eso rollup no lo puede sacudir.
    // @modelcontextprotocol/sdk (P-032 R8, cliente MCP del runtime propio) por lo mismo: sin bundlear no
    // existiria en la app empaquetada. Solo entra lo que importa el cliente (stdio, HTTP, SSE y OAuth).
    // fflate (extensiones .mcpb, grupo C) por lo mismo: externalizado, el smoke empaquetado pasaba solo
    // porque `release/` vive dentro del repo y Node lo encontraba subiendo hasta su `node_modules`.
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater', 'zod', '@modelcontextprotocol/sdk', 'fflate'] }), bundledPackagesPlugin('main', resolve('.'))],
    resolve: { alias: sharedAlias },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), bundledPackagesPlugin('preload', resolve('.'))],
    resolve: { alias: sharedAlias },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        // Tres entradas: la app principal, la ventana de debug (solo dev) y el widget flotante (M3).
        input: {
          index: resolve('src/renderer/index.html'),
          debug: resolve('src/renderer/debug.html'),
          widget: resolve('src/renderer/widget.html'),
        },
      },
    },
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss(), bundledPackagesPlugin('renderer', resolve('.'))],
  },
});
