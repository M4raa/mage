import type { Messages } from '@lingui/core';

// Pseudolocale de DESARROLLO `en-XA` (F3.1, F3.6): el texto con acentos y un 40 % más largo, para ver en `pnpm dev`
// lo que no pasa por el catálogo y lo que se rompe con textos largos. Solo lo importa el renderer bajo
// `import.meta.env.DEV` (import dinámico): Rollup elimina la rama y el build no lo lleva (lo comprueba
// `scripts/noPseudoLocalePlugin.ts`, que falla el build si aparece la marca).
export const PSEUDO_LOCALE = 'en-XA';

const GROWTH = 0.4;
const ACCENTED: Readonly<Record<string, string>> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', c: 'ç', n: 'ñ', y: 'ý', s: 'š', z: 'ž',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', C: 'Ç', N: 'Ñ', Y: 'Ý', S: 'Š', Z: 'Ž',
};

function pseudoText(text: string): string {
  const accented = [...text].map((ch) => ACCENTED[ch] ?? ch).join('');
  const padding = '·'.repeat(Math.ceil(text.trim().length * GROWTH));
  return padding.length === 0 ? accented : `${accented}${padding}`;
}

// Un mensaje compilado de Lingui: texto suelto, o una lista de textos y argumentos `[nombre, tipo?, opciones?]`.
// Solo se transforma el texto: los nombres de variable y las claves de plural/select no se tocan.
type CompiledNode = string | readonly unknown[];

function pseudoNode(node: unknown): unknown {
  if (typeof node === 'string') return node === '#' ? node : pseudoText(node);
  if (!Array.isArray(node)) return node;
  return node.map((part) => (Array.isArray(part) ? pseudoArgument(part) : pseudoNode(part)));
}

function pseudoArgument(argument: readonly unknown[]): readonly unknown[] {
  const [name, type, options] = argument;
  if (options === null || typeof options !== 'object') return argument;
  const pseudoOptions = Object.fromEntries(Object.entries(options).map(([key, value]) => [key, pseudoNode(value)]));
  return [name, type, pseudoOptions];
}

export function pseudoLocalizeCatalog(messages: Messages): Messages {
  return Object.fromEntries(Object.entries(messages).map(([key, message]) => [key, pseudoNode(message as CompiledNode)])) as Messages;
}
