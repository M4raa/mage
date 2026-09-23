import { describe, expect, it } from 'vitest';
import { hasReliableThumbnail, mapVscodeTheme, normalizeColor, pickPreviewSyntaxColors } from './vscodeTheme';
import type { FetchedVscodeTheme } from '@shared/themeMarket';

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
