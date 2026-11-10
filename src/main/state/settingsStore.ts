import { z } from 'zod';
import type { AppSettings } from '@shared/settings';
import {
  ACCOUNT_ACCENT_COUNT,
  CLOSE_BEHAVIORS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_DELEGATION,
  DEFAULT_KEEP_ALIVE,
  DELEGATION_DEPTH_MAX,
  DELEGATION_DEPTH_MIN,
  DEFAULT_PERMISSION_MODES,
  IMPORTED_CONTEXT_LIMITS,
  KEEP_ALIVE_MAX_PAUSE_MAX,
  KEEP_ALIVE_MAX_PAUSE_MIN,
  KEEP_ALIVE_MIN_CONTEXT_MAX,
  KEEP_ALIVE_MIN_CONTEXT_MIN,
  NEW_CONVERSATION_FOLDERS,
  RUNTIME_SHELLS,
  SCRATCH_RETENTIONS,
  THEME_PREFERENCES,
  ACCOUNT_AVATARS_PLACEMENTS,
  SEPARATOR_CONTRASTS,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  ACCOUNT_ALIAS_MAX,
  PLAN_PRICE_MAX_MICRO_USD,
} from '@shared/settings';
import { UI_LANGUAGE_PREFERENCES } from '@shared/i18n/language';
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

const CHAT_PROJECT_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  instructions: z.string(),
  cwd: z.string().min(1).nullable(),
  sessionIds: z.array(z.string().min(1)),
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
// aqui y se valida a fondo (parseable, http/https) en la frontera de la UI y del runtime con
// `chatCompletionsUrl` — el mismo parser en los dos sitios. La api key NO se persiste aqui (vive en la
// boveda de main): el esquema ya no la conserva, asi que un fichero de la 0.1.1 sale sin ella al primer
// guardado, despues de que `migrateLegacyProviderKeys` la haya pasado a la boveda. `hasApiKey` es solo
// un reflejo; al cargar para el renderer manda lo que diga la boveda.
const CUSTOM_PROVIDER_SCHEMA = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  baseUrl: z.string().min(1),
  hasApiKey: z.boolean().catch(false),
  models: z.array(z.object({ id: z.string().min(1), label: z.string() })),
  // P-032 R5: opcionales y tolerantes (un valor raro se descarta, no tira el proveedor).
  contextWindow: z.number().int().positive().optional().catch(undefined),
  supportsTools: z.boolean().optional().catch(undefined),
});

// Keep-alive de la caché (F4.6). Ausente (fichero anterior) o basura -> el default, sin subir la versión; cada campo
// cae a su default por separado y los enteros se acotan aquí también (el fichero es editable a mano).
const DELEGATION_SCHEMA = z.object({
  maxDepth: z.number().int().min(DELEGATION_DEPTH_MIN).max(DELEGATION_DEPTH_MAX).catch(DEFAULT_DELEGATION.maxDepth),
}).catch(DEFAULT_DELEGATION);

const KEEP_ALIVE_SCHEMA = z.object({
  subscriptionEnabled: z.boolean().catch(DEFAULT_KEEP_ALIVE.subscriptionEnabled),
  apiKeyEnabled: z.boolean().catch(DEFAULT_KEEP_ALIVE.apiKeyEnabled),
  minContextTokens: z.number().int().min(KEEP_ALIVE_MIN_CONTEXT_MIN).max(KEEP_ALIVE_MIN_CONTEXT_MAX).catch(DEFAULT_KEEP_ALIVE.minContextTokens),
  maxPauseHours: z.number().int().min(KEEP_ALIVE_MAX_PAUSE_MIN).max(KEEP_ALIVE_MAX_PAUSE_MAX).catch(DEFAULT_KEEP_ALIVE.maxPauseHours),
}).catch(DEFAULT_KEEP_ALIVE);

const APP_SETTINGS_SCHEMA = z.object({
  version: z.number(),
  notificationRules: z.array(NOTIFICATION_RULE_SCHEMA),
  chatProjects: z.array(CHAT_PROJECT_SCHEMA).catch([]),
  // Ids de conversación fijadas/archivadas: un valor que no sea array de cadenas no vacías cae a [].
  pinnedConversations: z.array(z.string().min(1)).catch([]),
  archivedConversations: z.array(z.string().min(1)).catch([]),
  // theme opcional en disco: ficheros antiguos (sin la clave) y valores invalidos caen a 'dark' via
  // .catch (frontera laxa; el default preserva el aspecto oscuro actual).
  theme: z.enum(THEME_PREFERENCES).catch('dark'),
  // Colocación de los avatares y contraste de separaciones: un valor inválido cae al defecto.
  accountAvatarsPlacement: z.enum(ACCOUNT_AVATARS_PLACEMENTS).catch('top'),
  separatorContrast: z.enum(SEPARATOR_CONTRASTS).catch('normal'),
  // Entero >= 0; cualquier otra cosa cae a 0 (se reaplicarían los defaults del dock una vez).
  dockDefaultsVersion: z.number().int().min(0).catch(0),
  // widgetEnabled opcional en disco: ficheros antiguos (sin la clave) o valores invalidos caen a
  // false via .catch (widget apagado por defecto, opt-in).
  widgetEnabled: z.boolean().catch(false),
  // Igual que el widget: sin la clave (ficheros anteriores a la 0.1.5) o con basura, apagado.
  mageMcpEnabled: z.boolean().catch(false),
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
  // Modo de permiso por defecto (P-028 6). Ausente o basura -> '' = el de la cuenta, el lado que no relaja nada.
  defaultPermissionMode: z.enum(DEFAULT_PERMISSION_MODES).catch(''),
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
  distrustedFolders: z.array(z.string().min(1)).catch([]),
  // Retencion de scratchpads (B.4.2). Ausente o basura -> 'never', que es el lado que NO borra nada:
  // equivocarse hacia el borrado seria destruir trabajo por un fichero corrupto.
  scratchRetention: z.enum(SCRATCH_RETENTIONS).catch('never'),
  // Cerrar la ventana (P-028, 17). Ausente o basura -> 'ask': el lado que vuelve a preguntar.
  closeBehavior: z.enum(CLOSE_BEHAVIORS).catch('ask'),
  // Carpeta de «Nuevo chat» (P-028, 16). Ausente o basura -> 'scratch', lo de siempre.
  newConversationFolder: z.enum(NEW_CONVERSATION_FOLDERS).catch('scratch'),
  // Ausente o basura -> el valor por defecto; el fichero es editable a mano, así que se acota aquí también.
  importedContextMaxChars: z.number().int().min(IMPORTED_CONTEXT_LIMITS.min).max(IMPORTED_CONTEXT_LIMITS.max).catch(IMPORTED_CONTEXT_LIMITS.default),
  // Asistente de primer arranque ya completado (y con que version). Ausente o basura -> 0, o sea
  // "no lo ha visto": equivocarse hacia enseñarlo de mas es molesto; hacia no enseñarlo nunca deja al
  // usuario sin el unico sitio donde se le explica como instalar el motor.
  onboardingCompletedVersion: z.number().int().min(0).catch(0),
  // Ultimas notas de version vistas. Ausente (0.1.0/0.1.1) o basura -> '': el renderer lo trata como
  // «actualizacion desde una version sin el campo» si el asistente ya se completo, y las enseña.
  lastSeenReleaseNotesVersion: z.string().catch(''),
  // Escala de la UI. Se acota aqui tambien (no solo en la UI): el fichero es editable a mano y un 500
  // dejaria la app inservible sin forma de volver atras desde dentro.
  uiScale: z.number().min(UI_SCALE_MIN).max(UI_SCALE_MAX).catch(100),
  // Proveedor por defecto de "Nueva conversacion". No se valida contra la lista: los proveedores del
  // usuario son dinamicos, y el dialogo ya cae al primero disponible si el id no existe.
  defaultProvider: z.string().min(1).catch('claude'),
  // Color por cuenta (PERS-3). Ausente o invalido -> {}: las cuentas vuelven al color de su posicion,
  // que es lo de antes de existir el campo.
  accentByAccount: z.record(z.string(), z.number().int().min(0).max(ACCOUNT_ACCENT_COUNT - 1)).catch({}),
  aliasByAccount: z.record(z.string(), z.string().trim().min(1).max(ACCOUNT_ALIAS_MAX)).catch({}),
  // Precio del plan (P-039): micro-USD enteros; ausente o basura -> {} (sin «valor»).
  planPriceMicroUsdByAccount: z.record(z.string(), z.number().int().min(0).max(PLAN_PRICE_MAX_MICRO_USD)).catch({}),
  adminMode: z.boolean().catch(false),
  hiddenAccounts: z.array(z.string().min(1)).catch([]),
  // Conectores de claude.ai apagados por cuenta. Ausente o basura -> [] (encendidos, como antes de existir).
  claudeAiConnectorsOff: z.array(z.string().min(1)).catch([]),
  // D5: Artifact. Ausente o basura -> false: el lado que no publica nada.
  artifactEnabled: z.boolean().catch(false),
  // Aviso de gh descartado (DA-3). Ausente o basura -> false: el lado que vuelve a avisar.
  ghNoticeDismissed: z.boolean().catch(false),
  // Auto-archivar al cerrarse el PR. Ausente o basura -> false: no se cierra nada solo.
  autoArchiveOnPrClose: z.boolean().catch(false),
  // Reglas de comandos de agy. Ausente o basura -> ninguna: el lado que no concede nada.
  agyCommandRules: z.object({ allow: z.array(z.string().min(1)), deny: z.array(z.string().min(1)) }).catch({ allow: [], deny: [] }),
  // Carpetas extra del perfil de agy. Ausente o basura -> [] (solo las de serie).
  agyLinkedPaths: z.array(z.string().min(1)).catch([]),
  runtimeShell: z.enum(RUNTIME_SHELLS).catch('auto'),
  runtimeToolAccess: z
    .record(
      z.string(),
      z.array(z.object({ model: z.string().min(1), allow: z.array(z.string().min(1)).nullable(), deny: z.array(z.string().min(1)) })),
    )
    .catch({}),
  // Idioma (F3). Ausente o basura -> ausente: «sin preferencia», que hereda la inicial o sigue al sistema.
  uiLanguage: z.enum(UI_LANGUAGE_PREFERENCES).optional().catch(undefined),
  keepAlive: KEEP_ALIVE_SCHEMA,
  delegation: DELEGATION_SCHEMA,
});

export class SettingsStore {
  constructor(private readonly deps: SettingsStoreDeps) {}

  // Lee la configuracion persistida; defaults si no existe, no es JSON valido o no encaja.
  // Cache por mtime del ultimo `load` (P9). `app-settings.json` son 234 kB aqui y se releia y
  // re-validaba con Zod en CADA consulta — incluida una por peticion del runtime, via
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
