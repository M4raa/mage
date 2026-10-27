import type { Plugin } from 'vite';

// F3.1 (DEVOLUCION-018): el pseudolocale de desarrollo `en-XA` no puede llegar a un build. El renderer lo carga con
// un import dinámico bajo `import.meta.env.DEV`, que Rollup elimina al construir; este plugin lo COMPRUEBA mirando
// los MÓDULOS de cada chunk (no un texto: la constante `en-XA` se sacude aunque el módulo entre entero, medido).
const PSEUDO_MODULE = /[\\/]shared[\\/]i18n[\\/]pseudoLocale\.ts$/;

export function noPseudoLocalePlugin(): Plugin {
  return {
    name: 'mage-no-pseudo-locale',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (this.environment.config.mode !== 'production') return;
      const leaked = Object.values(bundle)
        .filter((output) => output.type === 'chunk' && Object.keys(output.modules).some((id) => PSEUDO_MODULE.test(id)))
        .map((output) => output.fileName);
      if (leaked.length > 0) this.error(`El pseudolocale en-XA (shared/i18n/pseudoLocale.ts) ha llegado al build en: ${leaked.join(', ')}`);
    },
  };
}
