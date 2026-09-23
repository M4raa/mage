import { useEffect, useMemo, useState } from 'react';
import type { HighlighterCore } from 'shiki/core';
import type { LanguageInput, ThemeInput, ThemedToken } from 'shiki/types';
import { useWorkbenchStore } from './workbenchStore';
import { findActiveImportedTheme, resolveTheme, systemPrefersDark } from './theme';
import {
  resolveHighlightLang,
  resolveShikiTheme,
  SHIKI_THEME_DARK,
  SHIKI_THEME_LIGHT,
  type HighlightLang,
  type ShikiThemeSpec,
} from './codeHighlight';

// Resaltador de sintaxis del chat (F4): UN SOLO `HighlighterCore` de shiki para toda la app, creado la
// primera vez que hace falta y con las gramaticas/temas cargados de uno en uno bajo demanda. Aqui vive
// todo lo IMPURO (motor, imports dinamicos, estado del modulo, hook de React); las decisiones puras
// (alias de lenguaje, tema de shiki desde un tema importado) estan en codeHighlight.ts con tests.
//
// MOTOR DE REGEX: el de RegExp NATIVO de JS, no el de oniguruma en WASM. Razon medida, no de gusto: la
// CSP de produccion de Mage es `script-src 'self'` (src/main/index.ts) y Chromium bloquea compilar
// WebAssembly sin `'wasm-unsafe-eval'` -> con oniguruma el resaltado funcionaria en dev y NO en la app
// empaquetada. Comparados los dos motores sobre las 11 gramaticas con muestras reales de cada lenguaje:
// TOKENS IDENTICOS (contenido, color y fontStyle), asi que no se pierde fidelidad. Costes medidos
// (node 24, Windows): crear el resaltador 0,1 ms (oniguruma 33 ms, incluye el WASM), cargar las 11
// gramaticas 8 ms (31 ms), y la PRIMERA tokenizacion de cada gramatica ~48 ms (~28 ms) porque traduce sus
// regex a RegExp nativas; las siguientes ya van cacheadas. Nada de esto pasa por el camino del primer
// pintado: el bloque se pinta en texto plano y se sustituye cuando los tokens estan listos.

// Import DINAMICO por gramatica: el bundler saca cada una a su propio chunk y no entra ninguna en el
// bundle inicial. `shiki/langs/<x>.mjs` es el modulo individual (el barril `shiki/langs` arrastraria las
// 200+). Los nombres deben cuadrar con HIGHLIGHT_LANGS de codeHighlight.ts.
const LANG_LOADERS: Readonly<Record<HighlightLang, LanguageInput>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
};

// Temas de serie (los dos temas base de Mage). Un tema IMPORTADO no se importa: se registra tal cual.
const BUNDLED_THEME_LOADERS: Readonly<Record<string, ThemeInput>> = {
  [SHIKI_THEME_DARK]: () => import('shiki/themes/github-dark-default.mjs'),
  [SHIKI_THEME_LIGHT]: () => import('shiki/themes/github-light-default.mjs'),
};

let corePromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Map<HighlightLang, Promise<void>>();
const loadedThemes = new Map<string, Promise<void>>();
// Las cargas van EN SERIE: `loadLanguage`/`loadTheme` mutan el Registry de TextMate compartido y varios
// bloques de codigo montan a la vez (uno por lenguaje). Serializar cuesta un then y evita la carrera.
let loadQueue: Promise<unknown> = Promise.resolve();

// El CORE tambien se carga en diferido, no solo las gramaticas (P14). `core()` ya era perezoso en el
// TIEMPO, pero los imports eran estaticos, asi que `@shikijs/core` + `vscode-textmate` +
// `oniguruma-to-es` viajaban en el chunk de arranque para algo que no hace falta hasta el primer
// bloque ```. Medido reconstruyendo: el chunk inicial baja de 1.153 kB a 825 kB, y esos 328 kB salen
// a dos chunks que solo se piden al resaltar. Los `import type` no generan runtime.
async function createCore(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
  ]);
  return createHighlighterCore({
    themes: [],
    langs: [],
    // `forgiving`: un patron de TextMate que no se pueda traducir a RegExp nativa se convierte en uno
    // que no casa nunca, en vez de lanzar. Red de seguridad para gramaticas futuras.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
}

function core(): Promise<HighlighterCore> {
  corePromise ??= createCore();
  return corePromise;
}

// Encola una carga detras de las anteriores. Un fallo no atasca la cola (se limpia con catch), pero SI
// se propaga al llamante: quien pidio resaltar debe poder caer a texto plano.
function enqueue(task: () => Promise<void>): Promise<void> {
  const next = loadQueue.then(task, task);
  loadQueue = next.catch(() => undefined);
  return next;
}

function ensureLang(shiki: HighlighterCore, lang: HighlightLang): Promise<void> {
  const pending = loadedLangs.get(lang);
  if (pending !== undefined) return pending;
  const loading = enqueue(() => shiki.loadLanguage(LANG_LOADERS[lang]));
  loadedLangs.set(lang, loading);
  // Un fallo de carga no se cachea: al siguiente bloque se reintenta.
  void loading.catch(() => loadedLangs.delete(lang));
  return loading;
}

function ensureTheme(shiki: HighlighterCore, theme: ShikiThemeSpec): Promise<void> {
  const pending = loadedThemes.get(theme.name);
  if (pending !== undefined) return pending;
  const input: ThemeInput | undefined = theme.registration ?? BUNDLED_THEME_LOADERS[theme.name];
  if (input === undefined) return Promise.reject(new Error(`Tema de shiki desconocido: ${theme.name}`));
  const loading = enqueue(() => shiki.loadTheme(input));
  loadedThemes.set(theme.name, loading);
  void loading.catch(() => loadedThemes.delete(theme.name));
  return loading;
}

// Tokeniza `code` con la gramatica y el tema dados. Devuelve lineas de tokens con color/estilo; el render
// a React lo hace Markdown.tsx (nunca HTML crudo).
export async function highlightCode(code: string, lang: HighlightLang, theme: ShikiThemeSpec): Promise<ThemedToken[][]> {
  const shiki = await core();
  await ensureLang(shiki, lang);
  await ensureTheme(shiki, theme);
  return shiki.codeToTokens(code, { lang, theme: theme.name }).tokens;
}

// --- Hooks -------------------------------------------------------------------------------------

// Tema que debe usar el resaltador segun la configuracion. Se recalcula cuando cambia `settings`, y eso
// incluye el cambio de tema del SO con preferencia 'system' (App.tsx llama a setTheme('system'), que
// reescribe el objeto settings) -> el resaltado no se queda con los colores del tema anterior.
function useShikiTheme(): ShikiThemeSpec {
  const settings = useWorkbenchStore((s) => s.settings);
  return useMemo(
    () => resolveShikiTheme(findActiveImportedTheme(settings), resolveTheme(settings.theme, systemPrefersDark())),
    [settings],
  );
}

// Espera antes de tokenizar. Un bloque en STREAMING cambia de texto en cada delta; sin esta pausa se
// retokenizaria el bloque entero por delta (coste cuadratico en el bloque). Con ella, la rafaga se
// agrupa y solo se resalta el ultimo texto. No retrasa nada visible: el bloque ya se pinta en texto
// plano desde el primer frame.
const HIGHLIGHT_DEBOUNCE_MS = 80;

// Tokens resaltados de un bloque de codigo, o null mientras no haya (primer pintado, lenguaje no
// soportado o fallo del resaltador): el llamante pinta texto plano en ese caso. Nunca lanza. Al cambiar
// el texto NO se vuelve a null: se mantienen los tokens anteriores hasta tener los nuevos (sin parpadeo).
export function useHighlightedCode(code: string, lang: string | null): readonly ThemedToken[][] | null {
  const resolvedLang = useMemo(() => resolveHighlightLang(lang), [lang]);
  const theme = useShikiTheme();
  const [tokens, setTokens] = useState<readonly ThemedToken[][] | null>(null);

  useEffect(() => {
    if (resolvedLang === null) {
      setTokens(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void highlightCode(code, resolvedLang, theme)
        .then((lines) => {
          if (!cancelled) setTokens(lines);
        })
        .catch((err: unknown) => {
          // Sin resaltado se lee igual: se avisa por consola y el bloque se queda en texto plano.
          console.warn(`No se pudo resaltar un bloque ${resolvedLang}:`, err);
          if (!cancelled) setTokens(null);
        });
    }, HIGHLIGHT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, resolvedLang, theme]);

  return tokens;
}
