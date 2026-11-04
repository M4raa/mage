import { describe, expect, it } from 'vitest';
import { adjustSeparators, canDerive, deriveStructuralTokens, type DerivedColor, type StructuralTokens } from './themeFallbacks';
import themes from './__fixtures__/vscodeThemes.json';

// Colores crudos de cuatro temas reales de Open VSX (solo las claves que leen el módulo y el TOKEN_MAP),
// con su `include` de un nivel ya resuelto: Nord 0.19.0, One Dark Pro 3.20.6, Solarized Light 1.95.3 y
// Dark Modern 1.95.3, bajados el 2026-10-31.
type PanelToken = 'separatorWeak' | 'controlBorder' | 'hover' | 'selection' | 'focusRing';


// Valores esperados medidos con la sonda de contraste sobre esos ficheros; razones redondeadas a 2 decimales.
const EXPECTED: Readonly<Record<keyof typeof themes, Readonly<Record<PanelToken | 'selectionInk', DerivedColor>> & { readonly markNeeded: boolean }>> = {
  nord: {
    separatorWeak: { value: '#3b4252', source: 'panel.border', ratio: 1.24, derived: false },
    controlBorder: { value: '#484e59', source: 'derived:15%', ratio: 1.49, derived: true },
    hover: { value: '#3b4252', source: 'list.hoverBackground', ratio: 1.24, derived: false },
    selection: { value: '#88c0d0', source: 'list.activeSelectionBackground', ratio: 6.24, derived: false },
    focusRing: { value: '#82b7c6', source: 'button.background', ratio: 5.66, derived: false },
    selectionInk: { value: '#2e3440', source: 'list.activeSelectionForeground', ratio: 6.24, derived: false },
    markNeeded: false,
  },
  oneDarkPro: {
    separatorWeak: { value: '#3e4452', source: 'panel.border', ratio: 1.58, derived: false },
    controlBorder: { value: '#3e4452', source: 'panel.border', ratio: 1.58, derived: false },
    hover: { value: '#2c313a', source: 'list.hoverBackground', ratio: 1.18, derived: false },
    selection: { value: '#323842', source: 'list.inactiveSelectionBackground', ratio: 1.3, derived: false },
    focusRing: { value: '#61afef', source: 'textLink.foreground', ratio: 6.51, derived: false },
    selectionInk: { value: '#d7dae0', source: 'list.activeSelectionForeground', ratio: 8.42, derived: false },
    markNeeded: true,
  },
  solarizedLight: {
    separatorWeak: { value: '#ddd6c1', source: 'panel.border', ratio: 1.19, derived: false },
    controlBorder: { value: '#d3af86', source: 'dropdown.border', ratio: 1.67, derived: false },
    hover: { value: '#eae0c0', source: 'list.hoverBackground', ratio: 1.08, derived: false },
    selection: { value: '#dfca88', source: 'list.activeSelectionBackground', ratio: 1.32, derived: false },
    focusRing: { value: '#75888d', source: 'derived:88%', ratio: 3.03, derived: true },
    selectionInk: { value: '#000000', source: '#000000', ratio: 12.94, derived: false },
    markNeeded: false,
  },
  darkModern: {
    separatorWeak: { value: '#2b2b2b', source: 'panel.border', ratio: 1.25, derived: false },
    controlBorder: { value: '#3c3c3c', source: 'input.border', ratio: 1.61, derived: false },
    hover: { value: '#1d1d1d', source: 'derived:3%', ratio: 1.05, derived: true },
    selection: { value: '#2c2c2c', source: 'derived:11%', ratio: 1.27, derived: true },
    focusRing: { value: '#0078d4', source: 'focusBorder', ratio: 3.92, derived: false },
    selectionInk: { value: '#cccccc', source: 'editor.foreground', ratio: 8.7, derived: false },
    markNeeded: false,
  },
};

const THEME_IDS = Object.keys(EXPECTED) as (keyof typeof themes)[];
const COLOR_TOKENS: readonly (PanelToken | 'selectionInk')[] = ['separatorWeak', 'controlBorder', 'hover', 'selection', 'focusRing', 'selectionInk'];
const CASES = THEME_IDS.flatMap((id) => COLOR_TOKENS.map((token) => [id, token] as const));

function expectColor(actual: DerivedColor, expected: DerivedColor): void {
  expect({ value: actual.value, source: actual.source, derived: actual.derived }).toEqual({
    value: expected.value,
    source: expected.source,
    derived: expected.derived,
  });
  expect(actual.ratio).toBeCloseTo(expected.ratio, 2);
}

describe('deriveStructuralTokens con temas reales', () => {
  it.each(CASES)('deriveStructuralTokens_%s_%s_daElValorMedido', (id, token) => {
    // Arrange
    const colors: Readonly<Record<string, string>> = themes[id];

    // Act
    const tokens: StructuralTokens = deriveStructuralTokens(colors);

    // Assert
    expectColor(tokens[token], EXPECTED[id][token]);
  });

  it.each(THEME_IDS)('deriveStructuralTokens_%s_marcaDeSeleccionSoloSiSeConfundeConElHover', (id) => {
    const tokens = deriveStructuralTokens(themes[id]);

    expect(tokens.selectionMark).toEqual({ needed: EXPECTED[id].markNeeded, widthPx: 2 });
  });
});

describe('deriveStructuralTokens casos límite', () => {
  it('deriveStructuralTokens_sinPanel_lanzaConElNumeroDeClaves', () => {
    expect(() => deriveStructuralTokens({ foreground: '#ffffff' })).toThrow('claves recibidas: 1');
  });

  it('deriveStructuralTokens_sinPrimerPlano_lanzaConElNumeroDeClaves', () => {
    expect(() => deriveStructuralTokens({ 'sideBar.background': '#000000', 'panel.border': 'red' })).toThrow('claves recibidas: 2');
  });

  it('deriveStructuralTokens_primerPlanoIgualAlPanel_derivaAl100PorCiento', () => {
    // Nada se distingue del panel, ni el primer plano al 100 %: se queda el primer plano tal cual.
    const tokens = deriveStructuralTokens({ 'sideBar.background': '#202020', foreground: '#202020' });

    expectColor(tokens.separatorWeak, { value: '#202020', source: 'derived:100%', ratio: 1, derived: true });
  });

  it('deriveStructuralTokens_textoDeSeleccionSinCandidatosDelTema_caeABlanco', () => {
    const tokens = deriveStructuralTokens({ 'sideBar.background': '#000000', foreground: '#000000' });

    expectColor(tokens.selectionInk, { value: '#ffffff', source: '#ffffff', ratio: 21, derived: false });
  });

  it('deriveStructuralTokens_panelConAlfa_seMideOpaco', () => {
    // Mismo resultado que Nord con el panel opaco: el alfa del panel se descarta.
    const tokens = deriveStructuralTokens({ 'sideBar.background': '#2e344080', foreground: '#d8dee9', 'panel.border': '#3b4252' });

    expectColor(tokens.separatorWeak, { value: '#3b4252', source: 'panel.border', ratio: 1.24, derived: false });
  });

  it('deriveStructuralTokens_candidatoTransparente_noCuentaYPasaAlSiguiente', () => {
    const tokens = deriveStructuralTokens({ 'sideBar.background': '#2e3440', foreground: '#d8dee9', 'panel.border': '#3b425200', 'editorGroup.border': '#3b4252' });

    expect(tokens.separatorWeak.source).toBe('editorGroup.border');
  });

  it('deriveStructuralTokens_candidatoNoHex_seIgnora', () => {
    const tokens = deriveStructuralTokens({ 'sideBar.background': '#2e3440', foreground: '#d8dee9', 'panel.border': 'red', 'editorGroup.border': '#3b4252' });

    expect(tokens.separatorWeak.source).toBe('editorGroup.border');
  });

  it('deriveStructuralTokens_coloresCortos_seExpanden', () => {
    const tokens = deriveStructuralTokens({ 'sideBar.background': '#000', foreground: '#fff', focusBorder: '#fff' });

    expectColor(tokens.focusRing, { value: '#ffffff', source: 'focusBorder', ratio: 21, derived: false });
  });
});

describe('canDerive', () => {
  it('canDerive_sinColores_false', () => {
    expect(canDerive({})).toBe(false);
  });

  it('canDerive_soloPanel_false', () => {
    expect(canDerive({ 'editor.background': '#1f1f1f' })).toBe(false);
  });

  it('canDerive_soloPrimerPlano_false', () => {
    expect(canDerive({ 'editor.foreground': '#cccccc' })).toBe(false);
  });

  it('canDerive_panelConColorNoHex_false', () => {
    expect(canDerive({ 'sideBar.background': 'white', foreground: '#000000' })).toBe(false);
  });

  it('canDerive_panelYPrimerPlano_true', () => {
    expect(canDerive({ 'editor.background': '#1f1f1f', 'editor.foreground': '#cccccc' })).toBe(true);
  });
});

describe('adjustSeparators', () => {
  const nord = { panel: '#2e3440', foreground: '#d8dee9', weak: '#3b4252', separator: '#3b4252', control: '#3b4252' };
  const ratio = (a: string, b: string): number => {
    const lum = (hex: string): number => {
      const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
      const [r = 0, g = 0, bl = 0] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi = 0, lo = 0] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it('adjustSeparators_normal_returnsInput', () => {
    expect(adjustSeparators(nord, 'normal')).toEqual({ weak: '#3b4252', separator: '#3b4252', control: '#3b4252' });
  });

  it('adjustSeparators_strongNord_raisesWeakAndControl', () => {
    const result = adjustSeparators(nord, 'strong');

    expect(result).not.toBeNull();
    expect(ratio(result!.weak, nord.panel)).toBeGreaterThanOrEqual(1.15 * 1.25);
    expect(ratio(result!.separator, nord.panel)).toBeGreaterThanOrEqual(1.3 * 1.25);
    expect(ratio(result!.control, nord.panel)).toBeGreaterThanOrEqual(1.45 * 1.25);
  });

  it('adjustSeparators_strongAlreadyVisible_keepsValue', () => {
    const result = adjustSeparators({ ...nord, weak: '#ffffff' }, 'strong');

    expect(result?.weak).toBe('#ffffff');
  });

  it('adjustSeparators_soft_lowersButNotBelowFloor', () => {
    const result = adjustSeparators({ ...nord, weak: '#ffffff', control: '#ffffff' }, 'soft');

    expect(result).not.toBeNull();
    expect(ratio(result!.weak, nord.panel)).toBeLessThan(ratio('#ffffff', nord.panel));
    expect(ratio(result!.weak, nord.panel)).toBeGreaterThanOrEqual(1.02);
    expect(ratio(result!.control, nord.panel)).toBeGreaterThanOrEqual(1.02);
  });

  it('adjustSeparators_unreadablePanel_null', () => {
    expect(adjustSeparators({ ...nord, panel: 'rgb(1,2,3)' }, 'strong')).toBeNull();
  });
});
