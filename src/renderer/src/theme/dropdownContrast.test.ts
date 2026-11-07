import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastHex } from './themeFallbacks';
import { mapVscodeTheme } from '../workbench/vscodeTheme';
import themes from './__fixtures__/vscodeThemes.json';

// Contraste del selector (Dropdown): la opción elegida (`bg-mg-sel` + `text-mg-sel-ink`) y el botón (`text-mg-text`).
const WCAG_TEXT = 4.5;
const LIGHT_SELECTOR = ":root:where([data-theme='light']) {";
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

// Bloque de variables de un tema de serie de index.css: el oscuro es el `@theme {` y el claro el `:where` de abajo.
function themeBlock(theme: 'dark' | 'light'): string {
  const lightStart = css.indexOf(LIGHT_SELECTOR);
  if (lightStart < 0) throw new Error('index.css sin bloque del tema claro');
  if (theme === 'dark') return css.slice(css.indexOf('@theme {'), lightStart);
  return css.slice(lightStart, css.indexOf('\n}\n', lightStart));
}

function token(block: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(block);
  if (match?.[1] === undefined) throw new Error(`index.css sin ${name} en el bloque`);
  return match[1];
}

describe('Dropdown en los temas de serie', () => {
  it.each(['dark', 'light'] as const)('contraste_temaDeSerie_%s_opcionElegidaYBotonA4coma5', (theme) => {
    const block = themeBlock(theme);

    expect(contrastHex(token(block, '--color-mg-sel-ink'), token(block, '--color-mg-sel'))).toBeGreaterThanOrEqual(WCAG_TEXT);
    expect(contrastHex(token(block, '--color-mg-text'), token(block, '--color-mg-panel'))).toBeGreaterThanOrEqual(WCAG_TEXT);
  });
});

describe('Dropdown en temas importados', () => {
  it.each(Object.keys(themes) as (keyof typeof themes)[])('contraste_temaImportado_%s_opcionElegidaA4coma5YBotonNoPeorQueAntes', (id) => {
    const tokens = mapVscodeTheme({ label: id, uiTheme: 'vs-dark', type: null, colors: themes[id], tokenColors: [] }).tokens;
    const read = (name: string): string => {
      const value = tokens[name];
      if (value === undefined) throw new Error(`${id} sin ${name}`);
      return value;
    };

    expect(contrastHex(read('--color-mg-sel-ink'), read('--color-mg-sel'))).toBeGreaterThanOrEqual(WCAG_TEXT);
    expect(contrastHex(read('--color-mg-text'), read('--color-mg-panel'))).toBeGreaterThanOrEqual(
      contrastHex(tokens['--color-mg-sec'] ?? read('--color-mg-text'), read('--color-mg-panel')),
    );
  });
});
