import { z } from 'zod';

// UNICA declaracion de la forma del workspace persistido (M2.5). Los tipos (`PersistedTab`,
// `PersistedWorkspace` en `state.ts`) se DERIVAN de aqui, no se escriben a mano.
//
// Por que existe este modulo aparte (y no viven los esquemas en `state.ts`): el renderer importa
// `WORKSPACE_STATE_VERSION` como VALOR de `state.ts`, asi que si el esquema estuviera alli ese import
// arrastraria Zod al bundle del renderer (medido: hoy no lo tiene). `state.ts` referencia este modulo
// con un import de SOLO TIPO, que TypeScript borra al compilar.
//
// Por que derivar y no declarar dos veces: el esquema es LAXO en la frontera (valida forma y tipos;
// los campos extra los BORRA, que es lo correcto para no propagar datos corruptos al renderer) y
// `load`/`save` devuelven/escriben `result.data`. Un campo que exista en el TIPO pero no aqui se
// pierde en silencio en la ida y en la vuelta: es exactamente lo que le paso a `pinned`,
// `colorIndex`, `splitTabId` y `splitDirection` entre la Ronda 3 y la Fase A. Derivando, un campo no
// puede volver a existir en el tipo sin existir en el esquema.

// Una pestaña persistida = una conversacion reabrible ligada a {cuenta, proyecto, modelo}.
export const PERSISTED_TAB_SCHEMA = z.object({
  id: z.string().min(1),
  accountId: z.string(), // configDir de la cuenta (ruta, NO un secreto)
  accountAlias: z.string(),
  cwd: z.string(),
  model: z.string(),
  provider: z.string(),
  title: z.string(),
  // M2.6: privacidad de la conversacion. `.catch('shared')` para tolerar estados persistidos
  // ANTERIORES a M2.6 (sin el campo) o con un valor invalido -> se tratan como compartidas.
  privacy: z.enum(['shared', 'private']).catch('shared'),
  // M2.6: config dir efectivo de la ultima sesion (cuenta o perfil privado). Persistido para poder
  // localizar la transcripcion de una conversacion privada tras reiniciar. Ausente en pestañas
  // nunca arrancadas.
  resolvedConfigDir: z.string().optional(),
  sessionId: z.string().optional(), // presente solo si la sesion llego a crearse (permite --resume)
  effort: z.string().optional(), // nivel --effort (M2.4)
  maxBudgetUsdCents: z.number().int().positive().optional(), // tope --max-budget-usd, centavos enteros
  permissionMode: z.enum(['default', 'acceptEdits', 'plan']).optional(), // modo de permiso (M2.6)
  // Marcas de tiempo para ORDENAR el sidebar por recencia (ms epoch). Ausentes en estados
  // persistidos anteriores: la fusion cae al mtime de la transcripcion.
  createdAtMs: z.number().int().positive().optional(),
  lastMessageAtMs: z.number().int().positive().optional(),
  // Tools con "Permitir siempre aqui" concedido en esta conversacion (2.3b). Se persiste en los DOS
  // sitios a proposito: aqui, para que una pestana restaurada al arrancar siga teniendo sus reglas sin
  // ir al indice; y en el indice de conversaciones, para que sobrevivan al cierre de la pestana y a
  // reabrir la conversacion desde el historial.
  alwaysAllowTools: z.array(z.string().min(1)).optional(),
  // Ronda 3, item 12: estaban en el TIPO pero no aqui, asi que Zod los borraba al cargar Y al guardar.
  pinned: z.boolean().optional(),
  colorIndex: z.number().int().min(0).optional(), // indice de acento del tema (0..5)
});

// Arbol de division del centro (I11, ampliado en I12): generaliza `splitTabId`/`splitDirection`
// (Ronda 3, como mucho un segundo panel FIJO) a N paneles anidando divisiones binarias. Cada HOJA es
// un GRUPO de pestañas con su propia barra (modelo de "grupos de editor" de VS Code), no una sola
// pestaña. Interfaces declaradas a mano porque `z.lazy()` recursivo no puede inferir su propio tipo
// sin una anotacion explicita.
export interface SplitLeafShape {
  readonly kind: 'leaf';
  readonly tabIds: readonly string[]; // nunca vacia: una hoja vacia no existe, colapsa
  readonly activeTabId: string; // SIEMPRE uno de `tabIds`
}
export interface SplitNodeShape {
  readonly kind: 'split';
  readonly direction: 'row' | 'col';
  readonly ratio: number; // 0..1, fraccion que ocupa `a` frente a `b`
  readonly a: SplitLayoutShape;
  readonly b: SplitLayoutShape;
}
export type SplitLayoutShape = SplitLeafShape | SplitNodeShape;

// Hoja en la forma ACTUAL (grupo). `activeTabId` se NORMALIZA en vez de rechazar el fichero entero:
// un estado persistido con la activa fuera del grupo es recuperable (se activa la primera), y tirar
// todo el workspace por eso le costaria al usuario sus pestañas.
const LEAF_GROUP_SCHEMA = z
  .object({
    kind: z.literal('leaf'),
    tabIds: z.array(z.string()).min(1),
    activeTabId: z.string(),
  })
  .transform(
    (raw): SplitLeafShape => ({
      kind: 'leaf',
      tabIds: raw.tabIds,
      activeTabId: raw.tabIds.includes(raw.activeTabId) ? raw.activeTabId : raw.tabIds[0]!,
    }),
  );

// Forma VIEJA de la hoja (I11: una hoja = UNA pestaña). Se sigue aceptando en la LECTURA y se migra a
// un grupo de una — mismo criterio que `fromLegacySplit` con `splitTabId`/`splitDirection`. La
// escritura ya solo produce la forma de grupo.
const LEGACY_LEAF_SCHEMA = z
  .object({ kind: z.literal('leaf'), tabId: z.string() })
  .transform((raw): SplitLeafShape => ({ kind: 'leaf', tabIds: [raw.tabId], activeTabId: raw.tabId }));

// `z.ZodType<Salida, Def, Entrada>`: la entrada es `unknown` porque las dos formas de hoja se
// transforman, asi que el tipo de entrada ya no coincide con el de salida.
export const SPLIT_LAYOUT_SCHEMA: z.ZodType<SplitLayoutShape, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    LEAF_GROUP_SCHEMA,
    LEGACY_LEAF_SCHEMA,
    z.object({
      kind: z.literal('split'),
      direction: z.enum(['row', 'col']),
      ratio: z.number().min(0).max(1),
      a: SPLIT_LAYOUT_SCHEMA,
      b: SPLIT_LAYOUT_SCHEMA,
    }),
  ]),
);

export const WORKSPACE_SCHEMA = z.object({
  version: z.number(),
  activeTabId: z.string(),
  tabs: z.array(PERSISTED_TAB_SCHEMA),
  // Forma NUEVA (I11), fuente de verdad cuando esta presente. Las dos de abajo son la forma VIEJA
  // (Ronda 3, como mucho un segundo panel FIJO): se siguen aceptando en la LECTURA para migrar un
  // fichero escrito por una version anterior de Mage (ver `workspaceView.ts`); la escritura ya solo
  // produce `splitLayout`. Se validan las tres por separado a proposito: `restoreTabs` decide que
  // hacer con cada combinacion en vez de que un fichero al que le falta una se descarte entero.
  splitLayout: SPLIT_LAYOUT_SCHEMA.optional(),
  splitTabId: z.string().optional(),
  splitDirection: z.enum(['row', 'col']).optional(),
});
