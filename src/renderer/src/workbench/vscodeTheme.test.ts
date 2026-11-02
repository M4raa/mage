import { describe, expect, it } from 'vitest';
import { hasReliableThumbnail, mapVscodeTheme, normalizeColor, pickPreviewSyntaxColors } from './vscodeTheme';
import type { FetchedVscodeTheme } from '@shared/themeMarket';
import themes from '../theme/__fixtures__/vscodeThemes.json';

function theme(overrides: Partial<FetchedVscodeTheme> = {}): FetchedVscodeTheme {
  return { label: 'T', uiTheme: 'vs-dark', type: null, colors: {}, tokenColors: [], ...overrides };
}

describe('normalizeColor', () => {
  it('normalizeColor_rrggbb_loDevuelveEnMinusculas', () => {
    expect(normalizeColor('#1A2B3C')).toBe('#1a2b3c');
  });

  it('normalizeColor_rgbCorto_loExpande', () => {
    expect(normalizeColor('#abc')).toBe('#aabbcc');
  });

  it('normalizeColor_rrggbbaa_descartaElAlpha', () => {
    expect(normalizeColor('#11223344')).toBe('#112233');
  });

  it('normalizeColor_rgbaCorto_expandeYDescartaAlpha', () => {
    expect(normalizeColor('#abcd')).toBe('#aabbcc');
  });

  it('normalizeColor_nombreOColorNoHex_devuelveNull', () => {
    expect(normalizeColor('red')).toBeNull();
    expect(normalizeColor('rgb(0,0,0)')).toBeNull();
  });

  it('normalizeColor_longitudInvalida_devuelveNull', () => {
    expect(normalizeColor('#12345')).toBeNull();
  });
});

describe('mapVscodeTheme', () => {
  it('mapVscodeTheme_typeDeclarado_manda', () => {
    expect(mapVscodeTheme(theme({ type: 'light', uiTheme: 'vs-dark' })).type).toBe('light');
  });

  it('mapVscodeTheme_sinType_deduceDeUiThemeVs_light', () => {
    expect(mapVscodeTheme(theme({ type: null, uiTheme: 'vs' })).type).toBe('light');
  });

  it('mapVscodeTheme_sinType_deduceDeUiThemeVsDark_dark', () => {
    expect(mapVscodeTheme(theme({ type: null, uiTheme: 'vs-dark' })).type).toBe('dark');
  });

  it('mapVscodeTheme_editorBackground_mapeaWindow', () => {
    const result = mapVscodeTheme(theme({ colors: { 'editor.background': '#101114' } }));
    expect(result.tokens['--color-mg-window']).toBe('#101114');
  });

  it('mapVscodeTheme_sinSideBar_panelCaeAEditorBackground', () => {
    const result = mapVscodeTheme(theme({ colors: { 'editor.background': '#101114' } }));
    expect(result.tokens['--color-mg-panel']).toBe('#101114');
  });

  it('mapVscodeTheme_conSideBar_panelUsaSideBar', () => {
    const result = mapVscodeTheme(theme({ colors: { 'editor.background': '#101114', 'sideBar.background': '#181920' } }));
    expect(result.tokens['--color-mg-panel']).toBe('#181920');
  });

  it('mapVscodeTheme_foreground_mapeaTextoYNormaliza', () => {
    const result = mapVscodeTheme(theme({ colors: { foreground: '#EEE' } }));
    expect(result.tokens['--color-mg-text']).toBe('#eeeeee');
  });

  it('mapVscodeTheme_claveConAlpha_seNormalizaOpaca', () => {
    const result = mapVscodeTheme(theme({ colors: { 'list.activeSelectionBackground': '#2a2d3add' } }));
    expect(result.tokens['--color-mg-sel']).toBe('#2a2d3a');
  });

  it('mapVscodeTheme_sinColores_noEmiteTokens', () => {
    expect(Object.keys(mapVscodeTheme(theme()).tokens)).toEqual([]);
  });

  it('mapVscodeTheme_colorNoHex_seOmiteEseToken', () => {
    const result = mapVscodeTheme(theme({ colors: { 'editor.background': 'white' } }));
    expect(result.tokens['--color-mg-window']).toBeUndefined();
  });

  it('mapVscodeTheme_temaEscueto_resuelveAcentoYBordePorCandidatosAlternativos', () => {
    // Tema sin focusBorder/panel.border (caso real de Open VSX): antes ambos tokens quedaban sin
    // resolver y la miniatura caia en el gris de respaldo.
    const result = mapVscodeTheme(
      theme({ colors: { 'textLink.foreground': '#4488ff', 'tab.border': '#333333' } }),
    );
    expect(result.tokens['--color-mg-focus']).toBe('#4488ff');
    expect(result.tokens['--color-mg-border']).toBe('#333333');
  });

  it('mapVscodeTheme_soloColoresDeMenuYDeTexto_noMapeanLaSeleccion', () => {
    const result = mapVscodeTheme(theme({ colors: { 'menu.selectionBackground': '#0078d4', 'editor.selectionBackground': '#264f78' } }));

    expect(result.tokens['--color-mg-sel']).toBeUndefined();
  });

  it('mapVscodeTheme_soloColorDelCursor_noMapeaElFoco', () => {
    const result = mapVscodeTheme(theme({ colors: { 'editorCursor.foreground': '#aeafad' } }));

    expect(result.tokens['--color-mg-focus']).toBeUndefined();
  });

  it('mapVscodeTheme_sinPrimerPlano_noEmiteTokensDerivados', () => {
    const result = mapVscodeTheme(theme({ colors: { 'editor.background': '#101114', focusBorder: '#101114' } }));

    expect(result.tokens['--color-mg-focus']).toBe('#101114');
    expect(result.tokens['--color-mg-focus-ring']).toBeUndefined();
    expect(result.tokens['--color-mg-sel-ink']).toBeUndefined();
  });
});

// Tokens estructurales de cuatro temas reales (fixtures de themeFallbacks). Los valores son los de
// themeFallbacks.test.ts; aquí se comprueba a qué variable CSS va cada uno.
describe('mapVscodeTheme con temas reales', () => {
  const STRUCTURAL: Readonly<Record<keyof typeof themes, Readonly<Record<string, string | undefined>>>> = {
    nord: {
      '--color-mg-border-subtle': '#3b4252',
      '--color-mg-border-ctrl': '#484e59',
      '--color-mg-hover': '#3b4252',
      '--color-mg-sel': '#88c0d0',
      '--color-mg-focus': '#82b7c6',
      '--color-mg-focus-ring': '#82b7c6',
      '--color-mg-sel-ink': '#2e3440',
      '--color-mg-sel-mark': undefined,
    },
    oneDarkPro: {
      '--color-mg-border-subtle': '#3e4452',
      '--color-mg-border-ctrl': '#3e4452',
      '--color-mg-hover': '#2c313a',
      '--color-mg-sel': '#323842',
      '--color-mg-focus': '#61afef',
      '--color-mg-focus-ring': '#61afef',
      '--color-mg-sel-ink': '#d7dae0',
      '--color-mg-sel-mark': '#61afef',
    },
    solarizedLight: {
      '--color-mg-border-subtle': '#ddd6c1',
      '--color-mg-border-ctrl': '#d3af86',
      '--color-mg-hover': '#eae0c0',
      '--color-mg-sel': '#dfca88',
      '--color-mg-focus': '#75888d',
      '--color-mg-focus-ring': '#75888d',
      '--color-mg-sel-ink': '#000000',
      '--color-mg-sel-mark': undefined,
    },
    darkModern: {
      '--color-mg-border-subtle': '#2b2b2b',
      '--color-mg-border-ctrl': '#3c3c3c',
      '--color-mg-hover': '#1d1d1d',
      '--color-mg-sel': '#2c2c2c',
      '--color-mg-focus': '#0078d4',
      '--color-mg-focus-ring': '#0078d4',
      '--color-mg-sel-ink': '#cccccc',
      '--color-mg-sel-mark': undefined,
    },
  };

  it.each(Object.keys(STRUCTURAL) as (keyof typeof themes)[])('mapVscodeTheme_%s_tokensEstructuralesDeThemeFallbacks', (id) => {
    // Arrange
    const expected = STRUCTURAL[id];

    // Act
    const { tokens } = mapVscodeTheme(theme({ colors: themes[id] }));

    // Assert
    const actual = Object.fromEntries(Object.keys(expected).map((name) => [name, tokens[name]]));
    expect(actual).toEqual(expected);
  });
});

describe('hasReliableThumbnail', () => {
  it('hasReliableThumbnail_sinTokens_false', () => {
    expect(hasReliableThumbnail({})).toBe(false);
  });

  it('hasReliableThumbnail_sinFondoOSinTexto_false', () => {
    expect(hasReliableThumbnail({ '--color-mg-window': '#101010' })).toBe(false);
    expect(hasReliableThumbnail({ '--color-mg-body': '#eeeeee' })).toBe(false);
  });

  it('hasReliableThumbnail_soloLosDosEstructurales_false', () => {
    // Estan los imprescindibles pero no llegan al minimo: la maqueta saldria casi toda de respaldo.
    expect(hasReliableThumbnail({ '--color-mg-window': '#101010', '--color-mg-body': '#eeeeee' })).toBe(false);
  });

  it('hasReliableThumbnail_cuatroTokensConLosEstructurales_true', () => {
    const tokens = {
      '--color-mg-window': '#101010',
      '--color-mg-body': '#eeeeee',
      '--color-mg-panel': '#181818',
      '--color-mg-sel': '#2a2a2a',
    };
    expect(hasReliableThumbnail(tokens)).toBe(true);
  });

  it('hasReliableThumbnail_temaCompletoReal_true', () => {
    const { tokens } = mapVscodeTheme(
      theme({
        colors: {
          'editor.background': '#101114',
          'editor.foreground': '#e6e6e6',
          'sideBar.background': '#181920',
          'list.activeSelectionBackground': '#2a2d3a',
          focusBorder: '#4488ff',
          'panel.border': '#2b2b2b',
        },
      }),
    );
    expect(hasReliableThumbnail(tokens)).toBe(true);
  });
});

describe('pickPreviewSyntaxColors', () => {
  it('pickPreviewSyntaxColors_reglasConScopeString_devuelveLosTresColores', () => {
    const colors = pickPreviewSyntaxColors([
      { scope: 'comment', settings: { foreground: '#6A737D' } },
      { scope: 'keyword.control', settings: { foreground: '#FF79C6' } },
      { scope: 'string.quoted.double', settings: { foreground: '#F1FA8C' } },
    ]);

    expect(colors).toEqual({ keyword: '#ff79c6', string: '#f1fa8c', comment: '#6a737d' });
  });

  it('pickPreviewSyntaxColors_scopeEnLista_casaCualquieraDeLosScopes', () => {
    const colors = pickPreviewSyntaxColors([{ scope: ['variable', 'keyword'], settings: { foreground: '#abc' } }]);

    expect(colors.keyword).toBe('#aabbcc');
  });

  it('pickPreviewSyntaxColors_sinReglas_devuelveNullEnLosTres', () => {
    expect(pickPreviewSyntaxColors(undefined)).toEqual({ keyword: null, string: null, comment: null });
    expect(pickPreviewSyntaxColors([])).toEqual({ keyword: null, string: null, comment: null });
  });

  it('pickPreviewSyntaxColors_colorNoHex_loIgnoraYSigueBuscando', () => {
    const colors = pickPreviewSyntaxColors([
      { scope: 'keyword', settings: { foreground: 'rebeccapurple' } },
      { scope: 'keyword.other', settings: { foreground: '#112233' } },
    ]);

    expect(colors.keyword).toBe('#112233');
  });

  it('pickPreviewSyntaxColors_reglaSinForeground_noLaUsa', () => {
    const colors = pickPreviewSyntaxColors([
      { scope: 'comment', settings: { fontStyle: 'italic' } },
      { scope: 'comment', settings: { foreground: '#445566' } },
    ]);

    expect(colors.comment).toBe('#445566');
  });
});
