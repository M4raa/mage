import { describe, expect, it } from 'vitest';
import type { ImportedTheme } from '@shared/settings';
import type { VscodeTokenColor } from '@shared/themeMarket';
import {
  buildImportedShikiTheme,
  langFromPath,
  resolveHighlightLang,
  resolveShikiTheme,
  SHIKI_THEME_DARK,
  SHIKI_THEME_LIGHT,
} from './codeHighlight';

function imported(overrides: Partial<ImportedTheme> = {}): ImportedTheme {
  return { id: 'ovsx:acme.night', label: 'Night', type: 'dark', tokens: {}, ...overrides };
}

const COMMENT_RULE: VscodeTokenColor = { scope: 'comment', settings: { foreground: '#6a9955', fontStyle: 'italic' } };

describe('resolveHighlightLang', () => {
  it('resolveHighlightLang_nombreDeGramatica_loDevuelveIgual', () => {
    expect(resolveHighlightLang('typescript')).toBe('typescript');
    expect(resolveHighlightLang('diff')).toBe('diff');
  });

  it('resolveHighlightLang_aliasTs_resuelveTypescript', () => {
    expect(resolveHighlightLang('ts')).toBe('typescript');
  });

  it('resolveHighlightLang_aliasSh_resuelveShellscript', () => {
    expect(resolveHighlightLang('sh')).toBe('shellscript');
    expect(resolveHighlightLang('bash')).toBe('shellscript');
  });

  it('resolveHighlightLang_javascript_usaLaGramaticaDeTypescript', () => {
    expect(resolveHighlightLang('js')).toBe('typescript');
    expect(resolveHighlightLang('javascript')).toBe('typescript');
  });

  it('resolveHighlightLang_jsx_usaLaGramaticaDeTsx', () => {
    expect(resolveHighlightLang('jsx')).toBe('tsx');
  });

  it('resolveHighlightLang_mayusculasYEspacios_seNormalizan', () => {
    expect(resolveHighlightLang('  TypeScript  ')).toBe('typescript');
    expect(resolveHighlightLang('YML')).toBe('yaml');
  });

  it('resolveHighlightLang_conMetadatosEnLaValla_usaSoloElPrimerToken', () => {
    expect(resolveHighlightLang('ts title="a.ts"')).toBe('typescript');
    expect(resolveHighlightLang('python,linenos')).toBe('python');
    expect(resolveHighlightLang('js{1,3}')).toBe('typescript');
  });

  it('resolveHighlightLang_null_devuelveNull', () => {
    expect(resolveHighlightLang(null)).toBeNull();
  });

  it('resolveHighlightLang_vacioOSoloEspacios_devuelveNull', () => {
    expect(resolveHighlightLang('')).toBeNull();
    expect(resolveHighlightLang('   ')).toBeNull();
  });

  it('resolveHighlightLang_lenguajeNoRegistrado_devuelveNull', () => {
    expect(resolveHighlightLang('brainfuck')).toBeNull();
    expect(resolveHighlightLang('rust')).toBeNull();
    expect(resolveHighlightLang('plaintext')).toBeNull();
  });
});

describe('buildImportedShikiTheme', () => {
  it('buildImportedShikiTheme_conTokenColors_devuelveTemaConSusReglas', () => {
    const result = buildImportedShikiTheme(imported({ tokenColors: [COMMENT_RULE] }));

    expect(result?.type).toBe('dark');
    expect(result?.settings).toEqual([{ scope: 'comment', settings: { foreground: '#6a9955', fontStyle: 'italic' } }]);
  });

  it('buildImportedShikiTheme_nombreIncluyeIdYNumeroDeReglas', () => {
    const result = buildImportedShikiTheme(imported({ tokenColors: [COMMENT_RULE, { scope: 'keyword', settings: { foreground: '#c586c0' } }] }));

    expect(result?.name).toBe('mage:ovsx:acme.night:2');
  });

  it('buildImportedShikiTheme_conTokensDeMage_derivaFondoYTextoDelEditor', () => {
    const result = buildImportedShikiTheme(
      imported({ tokenColors: [COMMENT_RULE], tokens: { '--color-mg-body': '#dcdcdc', '--color-mg-code': '#141414' } }),
    );

    expect(result?.colors).toEqual({ 'editor.foreground': '#dcdcdc', 'editor.background': '#141414' });
  });

  it('buildImportedShikiTheme_sinTokensDeMage_noInventaColoresDeEditor', () => {
    expect(buildImportedShikiTheme(imported({ tokenColors: [COMMENT_RULE] }))?.colors).toEqual({});
  });

  it('buildImportedShikiTheme_sinTokenColors_devuelveNull', () => {
    expect(buildImportedShikiTheme(imported())).toBeNull();
  });

  it('buildImportedShikiTheme_tokenColorsVacio_devuelveNull', () => {
    expect(buildImportedShikiTheme(imported({ tokenColors: [] }))).toBeNull();
  });

  it('buildImportedShikiTheme_scopeEnLista_loConserva', () => {
    const rule: VscodeTokenColor = { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#555555' } };

    expect(buildImportedShikiTheme(imported({ tokenColors: [rule] }))?.settings[0]?.scope).toEqual([
      'comment',
      'punctuation.definition.comment',
    ]);
  });

  it('buildImportedShikiTheme_reglaSinScope_laMantieneComoReglaGlobal', () => {
    const rule = { settings: { foreground: '#abcdef' } } as VscodeTokenColor;

    expect(buildImportedShikiTheme(imported({ tokenColors: [rule] }))?.settings[0]).toEqual({ settings: { foreground: '#abcdef' } });
  });

  it('buildImportedShikiTheme_reglaSinSettings_laDescarta', () => {
    const corrupt = [{ scope: 'comment' }, COMMENT_RULE] as unknown as readonly VscodeTokenColor[];

    expect(buildImportedShikiTheme(imported({ tokenColors: corrupt }))?.settings).toHaveLength(1);
  });

  it('buildImportedShikiTheme_reglaConSettingsNull_laDescarta', () => {
    const corrupt = [{ scope: 'comment', settings: null }] as unknown as readonly VscodeTokenColor[];

    expect(buildImportedShikiTheme(imported({ tokenColors: corrupt }))).toBeNull();
  });

  it('buildImportedShikiTheme_reglaConSettingsVacio_laDescarta', () => {
    const corrupt = [{ scope: 'comment', settings: {} }] as unknown as readonly VscodeTokenColor[];

    expect(buildImportedShikiTheme(imported({ tokenColors: corrupt }))).toBeNull();
  });

  it('buildImportedShikiTheme_camposNoString_losIgnoraYConservaLosValidos', () => {
    const corrupt = [
      { scope: 42, settings: { foreground: '#111111', fontStyle: 7, background: null } },
    ] as unknown as readonly VscodeTokenColor[];

    expect(buildImportedShikiTheme(imported({ tokenColors: corrupt }))?.settings[0]).toEqual({ settings: { foreground: '#111111' } });
  });

  it('buildImportedShikiTheme_scopeConEntradasNoString_lasFiltra', () => {
    const corrupt = [{ scope: ['comment', 3, null], settings: { foreground: '#111111' } }] as unknown as readonly VscodeTokenColor[];

    expect(buildImportedShikiTheme(imported({ tokenColors: corrupt }))?.settings[0]?.scope).toEqual(['comment']);
  });

  it('buildImportedShikiTheme_scopeListaVacia_laTrataComoReglaGlobal', () => {
    const rule = { scope: [], settings: { foreground: '#111111' } } as unknown as VscodeTokenColor;

    expect(buildImportedShikiTheme(imported({ tokenColors: [rule] }))?.settings[0]).toEqual({ settings: { foreground: '#111111' } });
  });

  it('buildImportedShikiTheme_devuelveUnArrayMutable_shikiInsertaSuReglaGlobal', () => {
    // shiki hace `settings.unshift(...)` al normalizar el tema: un array congelado lo romperia.
    const settings = buildImportedShikiTheme(imported({ tokenColors: [COMMENT_RULE] }))?.settings;

    expect(Object.isFrozen(settings)).toBe(false);
  });
});

// Unico test que habla con shiki DE VERDAD (mismo motor y misma llamada que highlighter.ts). Sin el, un
// cambio en la forma que shiki espera para un tema pasaria los tests puros y romperia la app.
describe('buildImportedShikiTheme + shiki real', () => {
  // I2: este es el UNICO test de los ~1790 de la suite con imports dinamicos + construccion de un
  // motor real (shiki/core + la gramatica de TypeScript), en vez de una funcion pura sincrona. El
  // timeout POR DEFECTO de Vitest (5 s) le sobra en solitario (~350 ms medidos) pero es justo el que
  // se ha visto fallar solo al lanzar la suite COMPLETA (miles de workers de test compitiendo por CPU
  // a la vez que la propia transformacion de este fichero) — el sintoma exacto de un timeout ajustado
  // a tests sincronos aplicado a la unica prueba con E/S real. No es una carrera de datos: la
  // tokenizacion es deterministica para una entrada fija. Margen explicito, no una cifra a ciegas.
  it('buildImportedShikiTheme_temaAceptadoPorShiki_resaltaConSusColores', async () => {
    const { createHighlighterCore } = await import('shiki/core');
    const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript');
    const theme = buildImportedShikiTheme(
      imported({
        tokens: { '--color-mg-body': '#dcdcdc', '--color-mg-code': '#141414' },
        tokenColors: [COMMENT_RULE, { scope: ['keyword', 'storage.type'], settings: { foreground: '#569cd6' } }],
      }),
    );
    const shiki = await createHighlighterCore({
      themes: theme === null ? [] : [theme],
      langs: [() => import('shiki/langs/typescript.mjs')],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });

    const tokens = shiki.codeToTokens('const x = 1; // hola', { lang: 'typescript', theme: theme?.name ?? '' }).tokens[0] ?? [];

    expect(tokens.find((t) => t.content.includes('// hola'))?.color).toBe('#6A9955');
    expect(tokens.find((t) => t.content.trim() === 'const')?.color).toBe('#569CD6');
    // El texto sin regla propia cae al color derivado de --color-mg-body.
    expect(tokens.find((t) => t.content.trim() === 'x')?.color).toBe('#DCDCDC');
  }, 20_000);
});

describe('resolveShikiTheme', () => {
  it('resolveShikiTheme_sinTemaImportado_usaElTemaDeSerieOscuro', () => {
    expect(resolveShikiTheme(null, 'dark')).toEqual({ name: SHIKI_THEME_DARK, registration: null });
  });

  it('resolveShikiTheme_sinTemaImportado_usaElTemaDeSerieClaro', () => {
    expect(resolveShikiTheme(null, 'light')).toEqual({ name: SHIKI_THEME_LIGHT, registration: null });
  });

  it('resolveShikiTheme_temaImportadoConReglas_usaEseTema', () => {
    const spec = resolveShikiTheme(imported({ tokenColors: [COMMENT_RULE] }), 'dark');

    expect(spec.name).toBe('mage:ovsx:acme.night:1');
    expect(spec.registration?.name).toBe(spec.name);
  });

  it('resolveShikiTheme_temaImportadoSinReglas_caeAlTemaDeSerieDelTemaBase', () => {
    expect(resolveShikiTheme(imported({ type: 'light' }), 'light')).toEqual({ name: SHIKI_THEME_LIGHT, registration: null });
  });

  it('resolveShikiTheme_temaImportadoCorrupto_caeAlTemaDeSerie', () => {
    const corrupt = [{ settings: {} }] as unknown as readonly VscodeTokenColor[];

    expect(resolveShikiTheme(imported({ tokenColors: corrupt }), 'dark').registration).toBeNull();
  });

  it('langFromPath_rutaWindowsYPosix_devuelveLaExtension', () => {
    expect(langFromPath('C:\src\mage\a.ts')).toBe('ts');
    expect(langFromPath('/home/x/y.py')).toBe('py');
  });

  it('langFromPath_sinExtensionOculoOSinRuta_devuelveNull', () => {
    expect(langFromPath('/etc/hosts')).toBeNull();
    expect(langFromPath('/home/x/.bashrc')).toBeNull(); // dotfile: el punto inicial no es extension
    expect(langFromPath('/home/x/a.')).toBeNull();
    expect(langFromPath(null)).toBeNull();
  });
});
