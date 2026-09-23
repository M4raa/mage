import { z } from 'zod';
import type { AppSettings } from '@shared/settings';
import { DEFAULT_APP_SETTINGS, SCRATCH_RETENTIONS, THEME_PREFERENCES, UI_SCALE_MAX, UI_SCALE_MIN } from '@shared/settings';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

// Persistencia de la configuracion de la app (M2.3) en userData/app-settings.json. Mismo patron que
// WorkspaceStore: solo FS con DI (testable sin disco), lectura TOLERANTE (ausente/corrupto ->
// defaults: es config local, no dato critico) y escritura ATOMICA (tmp + rename).
// La escritura atomica (tmp con sufijo unico + rename) vive en os/atomicFile.ts, compartida con
// WorkspaceStore, PanelLayoutStore y SharedConfigService.
export interface SettingsStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
  // Marca de modificacion del fichero, para poder cachear sin mentir (P9). Opcional: sin ella el
  // store funciona igual, solo que releyendo siempre (que es lo que hacia antes).
  readonly mtimeMs?: (path: string) => number;
}

// Esquema laxo en la frontera: valida forma y tipos; ignora campos extra.
const NOTIFICATION_RULE_SCHEMA = z.object({
  id: z.string().min(1),
  label: z.string(),
  pattern: z.string(),
  enabled: z.boolean(),
});

// Regla `tokenColors` de un tema de VS Code (F4): scopes TextMate -> estilo. La forma la sanea ya
// ThemeMarketService al importar; aqui solo se valida lo que hay en disco.
const VSCODE_TOKEN_COLOR_SCHEMA = z.object({
  scope: z.union([z.string(), z.array(z.string())]).optional(),
  settings: z.object({
    foreground: z.string().optional(),
    background: z.string().optional(),
    fontStyle: z.string().optional(),
  }),
});

// Tema importado (Open VSX): tokens = mapa de --color-mg-* -> color (strings). record laxo.
const IMPORTED_THEME_SCHEMA = z.object({
  id: z.string().min(1),
  label: z.string(),
  type: z.enum(['light', 'dark']),
  tokens: z.record(z.string(), z.string()),
  // Ausente (fichero escrito antes de F4) o invalido -> undefined via .catch: el tema se sigue
  // aplicando y solo se pierde el resaltado del codigo, que cae al tema base. No sube la version.
  tokenColors: z.array(VSCODE_TOKEN_COLOR_SCHEMA).optional().catch(undefined),
});

// Override de atajo (D5): forma laxa a proposito — `actionId`/`keys` invalidos (accion ya no existe en
// el catalogo, combinacion malformada) se resuelven en el renderer (resolver.ts cae al default), no aqui.
const KEYBINDING_OVERRIDE_SCHEMA = z.object({
  actionId: z.string().min(1),
  keys: z.string().min(1),
});

// Proveedor del usuario (E2): endpoint compatible con la API de OpenAI. `baseUrl` se exige NO vacia
// aqui y se valida a fondo (parseable, http/https) en la frontera de la UI y del gateway con
// `chatCompletionsUrl` — el mismo parser en los dos sitios. `apiKey` puede ser '' (runtime local).
const CUSTOM_PROVIDER_SCHEMA = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string(),
  models: z.array(z.object({ id: z.string().min(1), label: z.string() })),
});

const APP_SETTINGS_SCHEMA = z.object({
  version: z.number(),
  notificationRules: z.array(NOTIFICATION_RULE_SCHEMA),
  // theme opcional en disco: ficheros antiguos (sin la clave) y valores invalidos caen a 'dark' via
  // .catch (frontera laxa; el default preserva el aspecto oscuro actual).
  theme: z.enum(THEME_PREFERENCES).catch('dark'),
  // widgetEnabled opcional en disco: ficheros antiguos (sin la clave) o valores invalidos caen a
  // false via .catch (widget apagado por defecto, opt-in).
  widgetEnabled: z.boolean().catch(false),
  // Igual de tolerante: un fichero de una version anterior no la trae, y un valor fuera de rango (o
  // basura) no puede dejar la app ilegible -> se acota al rango util y, si no hay nada, opaca.
  backgroundOpacity: z.number().min(50).max(100).catch(100),
  // Temas importados: si el array es invalido, se descarta a [] (no critico). Cada tema invalido
  // descartado individualmente no es posible con .catch de array, asi que catch al conjunto.
  importedThemes: z.array(IMPORTED_THEME_SCHEMA).catch([]),
  // Id del tema importado activo; ausente/invalido -> null (tema base).
  activeThemeId: z.string().nullable().catch(null),
  // Modelo por defecto por proveedor (F3): mapa laxo proveedor -> modelo. Ausente/invalido -> {} (sin
  // preferencia), que es como se comportaba antes de existir el campo: los ficheros de versiones
  // anteriores siguen cargando igual.
  defaultModelByProvider: z.record(z.string(), z.string()).catch({}),
  // Overrides de atajos (D5): si el array es invalido, se descarta a [] (no critico, mismo patron que
  // importedThemes). Entradas individuales con forma valida pero actionId/keys que ya no aplican se
  // conservan (no fallan el esquema) y se ignoran en la resolucion, nunca en el guardado.
  keybindingOverrides: z.array(KEYBINDING_OVERRIDE_SCHEMA).catch([]),
  // Proveedores del usuario (E2): mismo patron tolerante que importedThemes — ausente (fichero de una
  // version anterior) o invalido -> [] sin subir APP_SETTINGS_VERSION ni perder el resto de la config.
  customProviders: z.array(CUSTOM_PROVIDER_SCHEMA).catch([]),
  // Carpetas autorizadas para lanzar un agente. Mismo patron tolerante que el resto: un fichero de
  // una version anterior no la trae y cae a []. Que caiga a [] y no a "todo confiado" es el punto: al
  // perderse el dato se vuelve a PREGUNTAR, que es el lado seguro de equivocarse.
  trustedFolders: z.array(z.string().min(1)).catch([]),
  // Retencion de scratchpads (B.4.2). Ausente o basura -> 'never', que es el lado que NO borra nada:
  // equivocarse hacia el borrado seria destruir trabajo por un fichero corrupto.
  scratchRetention: z.enum(SCRATCH_RETENTIONS).catch('never'),
  // Asistente de primer arranque ya completado (y con que version). Ausente o basura -> 0, o sea
  // "no lo ha visto": equivocarse hacia enseñarlo de mas es molesto; hacia no enseñarlo nunca deja al
  // usuario sin el unico sitio donde se le explica como instalar el motor.
  onboardingCompletedVersion: z.number().int().min(0).catch(0),
  // Escala de la UI. Se acota aqui tambien (no solo en la UI): el fichero es editable a mano y un 500
  // dejaria la app inservible sin forma de volver atras desde dentro.
  uiScale: z.number().min(UI_SCALE_MIN).max(UI_SCALE_MAX).catch(100),
  // Proveedor por defecto de "Nueva conversacion". No se valida contra la lista: los proveedores del
  // usuario son dinamicos, y el dialogo ya cae al primero disponible si el id no existe.
  defaultProvider: z.string().min(1).catch('claude'),
});

export class SettingsStore {
  constructor(private readonly deps: SettingsStoreDeps) {}

  // Lee la configuracion persistida; defaults si no existe, no es JSON valido o no encaja.
  // Cache por mtime del ultimo `load` (P9). `app-settings.json` son 234 kB aqui y se releia y
  // re-validaba con Zod en CADA consulta — incluida una por peticion reenviada del gateway, via
  // `setCustomProviderLoader`. La invalidacion es por mtime, asi que el contrato de "se leen
  // frescos" se mantiene: editar el fichero a mano sigue aplicando a la siguiente lectura.
  private cached: { readonly mtimeMs: number; readonly value: AppSettings } | null = null;

  load(): AppSettings {
    if (!this.deps.exists(this.deps.filePath)) return DEFAULT_APP_SETTINGS;
    const mtimeMs = this.deps.mtimeMs?.(this.deps.filePath);
    if (mtimeMs !== undefined && this.cached?.mtimeMs === mtimeMs) return this.cached.value;
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.deps.readFile(this.deps.filePath));
    } catch (err) {
      // Solo un JSON MAL FORMADO justifica caer a defaults (B9). Un EACCES/EBUSY —antivirus o
      // agente de backup reteniendo el fichero, cosa habitual en Windows— era indistinguible del
      // JSON corrupto: se cargaban defaults y el siguiente `save()` SOBRESCRIBIA los datos reales
      // del usuario. Un fallo de lectura tiene que doler, no borrar.
      if (!(err instanceof SyntaxError)) {
        throw new Error(`No se pudo leer ${this.deps.filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return DEFAULT_APP_SETTINGS; // JSON corrupto: arrancar con defaults (config local, no critica)
    }
    const result = APP_SETTINGS_SCHEMA.safeParse(parsed);
    const value = result.success ? result.data : DEFAULT_APP_SETTINGS;
    if (mtimeMs !== undefined) this.cached = { mtimeMs, value };
    return value;
  }

  // Guarda de forma atomica. Valida antes de escribir (contrato explicito: nunca escribir basura).
  save(settings: AppSettings): void {
    const result = APP_SETTINGS_SCHEMA.safeParse(settings);
    if (!result.success) {
      throw new Error(`Configuracion de app invalida al guardar: ${result.error.message}`);
    }
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(result.data, null, 2));
    // Invalidar SIEMPRE, sin fiarse del mtime: la granularidad del reloj de ficheros de Windows es del
    // orden del tick del sistema, asi que dos guardados dentro del mismo tick comparten `mtimeMs` y el
    // `load()` de en medio seguia sirviendo el valor viejo. Con `revokeTrustedFolder` eso significaba
    // seguir considerando confiada una carpeta cuyo permiso el usuario acababa de retirar.
    this.cached = null;
  }
}
