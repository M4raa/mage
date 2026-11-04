import type { ImportedTheme } from '@shared/settings';
import type { FetchedVscodeTheme, FetchThemeParams } from '@shared/themeMarket';
import { mapVscodeTheme } from '../../vscodeTheme';

const OVSX_PREFIX = 'ovsx:';
// Open VSX resuelve `latest` a la última versión publicada; el tema guardado no recuerda la suya.
const LATEST_VERSION = 'latest';
// Token que solo traen los temas importados desde F5.2: su ausencia delata un tema anterior.
const SELECTION_INK_TOKEN = '--color-mg-sel-ink';

// Separa `ovsx:<namespace>.<name>` en sus dos partes (el namespace de Open VSX no lleva puntos). Otro prefijo, sin
// punto o con alguna parte vacía -> null.
export function parseOvsxThemeId(id: string): { readonly namespace: string; readonly name: string } | null {
  if (!id.startsWith(OVSX_PREFIX)) return null;
  const rest = id.slice(OVSX_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot === rest.length - 1) return null;
  return { namespace: rest.slice(0, dot), name: rest.slice(dot + 1) };
}

// ¿Se importó antes de F5.2 (sin los respaldos de contraste) y se puede volver a importar desde Open VSX?
export function canReimportTheme(theme: ImportedTheme): boolean {
  return theme.tokens[SELECTION_INK_TOKEN] === undefined && parseOvsxThemeId(theme.id) !== null;
}

// Vuelve a leer el tema de Open VSX y devuelve la entrada nueva con el MISMO id y etiqueta. Lanza si el id no es de
// Open VSX; el fallo de red lo propaga quien llama.
export async function reimportTheme(
  theme: ImportedTheme,
  fetchTheme: (params: FetchThemeParams) => Promise<FetchedVscodeTheme>,
): Promise<ImportedTheme> {
  const parsed = parseOvsxThemeId(theme.id);
  if (parsed === null) throw new Error(`El tema no viene de Open VSX, no se puede volver a importar: ${JSON.stringify(theme.id)}`);
  const fetched = await fetchTheme({ ...parsed, version: LATEST_VERSION });
  const mapped = mapVscodeTheme(fetched);
  return { id: theme.id, label: theme.label, type: mapped.type, tokens: mapped.tokens, tokenColors: fetched.tokenColors };
}
