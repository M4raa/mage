// Modelo de datos y logica PURA del layout de paneles acoplables estilo JetBrains (F6,
// PLAN-F6-PANELES.md §3). Sin FS, sin DOM, sin React: tanto la persistencia real en main
// (PanelLayoutStore, Fase 2) como el cableado del shell en el renderer (Fase 3) importan estos tipos
// y funciones, nunca al reves.
//
// Vive en `shared` (no en `renderer/workbench/panels`, donde la Fase 1 lo dejo originalmente) porque
// la Fase 2 lo necesita desde el proceso main: medido con `tsc -p tsconfig.node.json`, un fichero de
// main que importa algo bajo `src/renderer/` rompe con "File is not listed within the file list of
// project" (tsconfig.node.json solo incluye src/main, src/preload y src/shared). El registro real de
// paneles (`PanelDefinition`, con su `render` de React) SIGUE viviendo solo en el renderer
// (panelRegistry.ts) -- aqui solo se necesita la forma minima de cada entrada del catalogo
// (id/anchor/zona por defecto), expresada en `PanelPlacement`, que `PanelDefinition` satisface de
// sobra por estructura (tiene esos tres campos y ademas title/icon/render).

import type { z } from 'zod';
import type * as Schema from './panelLayoutSchema';

export type Anchor = 'left' | 'right' | 'bottom';

// left/right: 'a' = zona de arriba, 'b' = zona de medio (renderizan las dos en el panel de SU MISMO
// lado). bottom: 'a' = mitad izquierda, 'b' = mitad derecha del panel compartido de abajo — la
// posicion "abajo" de una barra lateral (icono en left/right, panel en bottom) apunta aqui, no a la
// 'b' de su propio lado (ver AccountRail.tsx/RightDock.tsx).
export type ZoneKey = 'a' | 'b';

// Id ESTABLE de un panel del registro (no del layout): se persiste dentro de `panelIds`/`activePanelId`.
export type PanelId = string;

// Forma minima de una entrada del catalogo de paneles que la reconciliacion necesita conocer. El
// registro real del renderer (`PanelDefinition` en panelRegistry.ts) trae ademas `title`/`icon`/
// `render`; como superset estructural, un `readonly PanelDefinition[]` se puede pasar donde se pide
// `readonly PanelPlacement[]` sin conversion explicita.
export interface PanelPlacement {
  readonly id: PanelId;
  readonly defaultAnchor: Anchor;
  readonly defaultZone: ZoneKey;
}

// Los tres tipos del estado se DERIVAN del esquema de escritura (`panelLayoutSchema.ts`): un campo
// que exista aqui y no alli se pierde en cada guardado — le paso a `splitPx`, que la lectura si
// respetaba y el esquema estricto de escritura no declaraba. Solo se re-declaran las referencias
// ANIDADAS, para conservar el `readonly` profundo que `z.infer` no da (mismo criterio que
// `PersistedWorkspace.tabs` en `state.ts`). El import es de SOLO TIPO: este modulo lo usa el renderer
// en runtime y no debe arrastrar Zod a su bundle.
export type ZoneState = Readonly<Omit<z.infer<typeof Schema.ZONE_STATE_SCHEMA>, 'panelIds'>> & {
  readonly panelIds: readonly PanelId[]; // orden = orden de pestañas dentro del grupo
};

// `splitPx` (feedback del usuario, 2026-08-06: "los paneles divididos no se pueden agrandar o hacer
// mas pequeños") = tamaño de 'a' en el eje de apilado (alto en left/right, ancho en bottom); 'b' se
// lleva el resto via flex-1. Con una sola zona abierta no se usa.
export type StripeState = Readonly<Omit<z.infer<typeof Schema.STRIPE_STATE_SCHEMA>, 'a' | 'b'>> & {
  readonly a: ZoneState;
  readonly b: ZoneState;
};

// Las claves de `stripes` salen del propio esquema (son las tres de `Anchor`), no de un Record suelto.
type SchemaStripes = z.infer<typeof Schema.PANEL_LAYOUT_SCHEMA>['stripes'];

export type PanelLayoutState = Readonly<Omit<z.infer<typeof Schema.PANEL_LAYOUT_SCHEMA>, 'stripes' | 'hiddenPanelIds'>> & {
  readonly stripes: Readonly<{ [K in keyof SchemaStripes]: StripeState }>;
  readonly hiddenPanelIds: readonly PanelId[]; // paneles escondidos a proposito: la reconciliacion no los repone
};

// Version de esquema que produce SIEMPRE reconcileLayoutWithRegistry, sea cual sea la del fichero
// cargado: la propia reconciliacion ya es la migracion (§3.3), no queda ningun dato en una version
// vieja despues de pasar por aqui.
export const PANEL_LAYOUT_VERSION = 1;

// Minimo de una zona ABIERTA, en px: por debajo, su contenido deja de ser legible. Se usa tanto para
// sanear un `sizePx` corrupto al reconciliar (§3.3) como limite inferior de resolveResize (§6).
export const MIN_ZONE_SIZE_PX = 160;

// Paso de ajuste del divisor de resize con teclado (flechas), §6: RESIZE_STEP_PX, no un numero suelto.
export const RESIZE_STEP_PX = 24;

// Tamaño por defecto de una zona recien abierta, por borde. left/right igualan el ancho MEDIDO hoy de
// ChatSidebar/Inspector (§2 del plan) para que v1 reproduzca el layout actual sin saltos de tamaño;
// bottom no tiene equivalente medido (panel nuevo en v1, vacio por catalogo, §4.1) — valor de partida
// razonable, sin más pretensión.
export const DEFAULT_ZONE_SIZE_PX: Readonly<Record<Anchor, number>> = {
  left: 252,
  right: 294,
  bottom: 220,
};

// Reparto por defecto entre 'a' y 'b' cuando ambas se abren por primera vez (§ split, 2026-08-06): un
// punto de partida razonable (no medido, no hay equivalente previo — el split es nuevo), ajustable por
// el usuario despues igual que DEFAULT_ZONE_SIZE_PX.
export const DEFAULT_SPLIT_SIZE_PX: Readonly<Record<Anchor, number>> = {
  left: 300,
  right: 300,
  bottom: 400,
};

// Exportadas (Fase 4, panelLayoutOps.ts del renderer las reutiliza para recorrer las 3 stripes x 2
// zonas al mover/localizar un panel) — evita que ese modulo repita esta misma enumeracion.
export const ANCHORS: readonly Anchor[] = ['left', 'right', 'bottom'];
export const ZONE_KEYS: readonly ZoneKey[] = ['a', 'b'];

function registryIdsForZone(registry: readonly PanelPlacement[], anchor: Anchor, zoneKey: ZoneKey): readonly PanelId[] {
  return registry.filter((p) => p.defaultAnchor === anchor && p.defaultZone === zoneKey).map((p) => p.id);
}

function buildFreshZone(registry: readonly PanelPlacement[], anchor: Anchor, zoneKey: ZoneKey): ZoneState {
  const panelIds = registryIdsForZone(registry, anchor, zoneKey);
  return { panelIds, activePanelId: panelIds[0] ?? null, sizePx: DEFAULT_ZONE_SIZE_PX[anchor] };
}

// Layout construido DESDE CERO a partir del registro (defaultAnchor/defaultZone de cada panel), sin
// ningun dato persistido: es la definicion operativa de "v1 reproduce el layout de hoy" (§3.3). Un
// registro vacio produce las tres stripes sin nada — la app sigue arrancando igual.
function buildFreshLayout(registry: readonly PanelPlacement[]): PanelLayoutState {
  const stripes = {} as Record<Anchor, StripeState>;
  for (const anchor of ANCHORS) {
    stripes[anchor] = { a: buildFreshZone(registry, anchor, 'a'), b: buildFreshZone(registry, anchor, 'b'), splitPx: DEFAULT_SPLIT_SIZE_PX[anchor] };
  }
  return { version: PANEL_LAYOUT_VERSION, stripes, hiddenPanelIds: [] };
}

// ¿Tiene `loaded` la forma minima para intentar reconciliarlo campo a campo? Un fichero ausente, no
// JSON o que no encaja el esquema llega aqui como `null` (responsabilidad del store de persistencia,
// Fase 2); esta funcion ademas tolera un objeto que supero esa capa pero viene vacio o corrupto en
// `stripes` (p.ej. `{}`), tratandolo igual que `null`.
function hasStripesShape(loaded: PanelLayoutState | null): loaded is PanelLayoutState {
  if (loaded === null || typeof loaded !== 'object') return false;
  const stripes: unknown = (loaded as { stripes?: unknown }).stripes;
  return typeof stripes === 'object' && stripes !== null;
}

interface RawZone {
  readonly panelIds?: unknown;
  readonly activePanelId?: unknown;
  readonly sizePx?: unknown;
}

// Lectura defensiva de una zona dentro de `stripes`: cualquier nivel puede faltar o venir con el tipo
// equivocado (fichero de una version antigua, edicion manual, `stripes` con una sola zona en vez de
// dos...) — nunca lanza, devuelve `undefined` para que el caller la trate igual que una zona ausente.
function readRawZone(stripes: unknown, anchor: Anchor, zoneKey: ZoneKey): RawZone | undefined {
  if (typeof stripes !== 'object' || stripes === null) return undefined;
  const stripe: unknown = (stripes as Record<string, unknown>)[anchor];
  if (typeof stripe !== 'object' || stripe === null) return undefined;
  const zone: unknown = (stripe as Record<string, unknown>)[zoneKey];
  if (typeof zone !== 'object' || zone === null) return undefined;
  return zone as RawZone;
}

// Lectura defensiva del `splitPx` de UNA stripe (a nivel de stripe, no de zona — ver StripeState):
// mismo motivo que readRawZone, nunca lanza.
function readRawSplitPx(stripes: unknown, anchor: Anchor): unknown {
  if (typeof stripes !== 'object' || stripes === null) return undefined;
  const stripe: unknown = (stripes as Record<string, unknown>)[anchor];
  if (typeof stripe !== 'object' || stripe === null) return undefined;
  return (stripe as Record<string, unknown>).splitPx;
}

// Ids validos (existen en el registro ACTUAL) del `panelIds` cargado, en su orden original. Un id de
// un panel eliminado en una version posterior del registro se descarta aqui en silencio: esta funcion
// es pura y sin efectos, el aviso al LogBus (§3.3) es responsabilidad del caller con acceso a el.
function sanitizePanelIds(rawPanelIds: unknown, registry: readonly PanelPlacement[]): PanelId[] {
  if (!Array.isArray(rawPanelIds)) return [];
  const validIds = new Set(registry.map((p) => p.id));
  return rawPanelIds.filter((id): id is PanelId => typeof id === 'string' && validIds.has(id));
}

// activePanelId ya resuelto contra los panelIds EXISTENTES (antes de anadir los paneles nuevos del
// registro): `null` es un valor legitimo (zona cerrada a proposito, no es corrupcion); cualquier otro
// valor que no apunte a un id presente SI lo es, y cae al primero disponible (§3.3).
function resolveExistingActiveId(rawActiveId: unknown, existingIds: readonly PanelId[]): PanelId | null {
  if (rawActiveId === null) return null;
  if (typeof rawActiveId === 'string' && existingIds.includes(rawActiveId)) return rawActiveId;
  return existingIds[0] ?? null;
}

// Tamaño saneado: ausente o no-finito cae al `fallback` recibido; presente pero por debajo del minimo
// (negativo, 0, o simplemente pequeño) se sube a MIN_ZONE_SIZE_PX. Nunca se devuelve tal cual un
// tamaño que dejaria la zona ilegible. `fallback` explicito (en vez de derivarlo de `anchor` aqui
// dentro) porque lo reutiliza tanto el tamaño de zona (DEFAULT_ZONE_SIZE_PX) como el split entre
// zonas (DEFAULT_SPLIT_SIZE_PX) — misma clase de saneado, defaults distintos.
function sanitizeSizePx(rawSizePx: unknown, fallback: number): number {
  if (typeof rawSizePx !== 'number' || !Number.isFinite(rawSizePx)) return fallback;
  return Math.max(rawSizePx, MIN_ZONE_SIZE_PX);
}

// `claimed` es el conjunto de ids YA colocados por las zonas anteriores de esta misma pasada, y es lo
// que impide que un panel salga DOS veces. Un panel que el usuario movio a otro borde sigue estando en
// el registro con su `defaultZone` original: sin este conjunto, esa zona lo "reponia" y el icono
// aparecia en los dos sitios a la vez — reporte del usuario ("se pueden duplicar iconos, solo puede
// haber uno"). Ademas sanea hacia atras: un fichero que ya trae el duplicado se queda con la primera
// aparicion y suelta el resto.
// Los ids de `candidates` que aun no ha reclamado nadie, marcandolos como reclamados al aceptarlos.
function claim(candidates: readonly PanelId[], claimed: Set<PanelId>): readonly PanelId[] {
  const accepted: PanelId[] = [];
  for (const id of candidates) {
    if (claimed.has(id)) continue;
    claimed.add(id);
    accepted.push(id);
  }
  return accepted;
}

// Primera pasada, UNA zona (§3.3): lo que el usuario dejo guardado en ella (ids validos, sin duplicados,
// en su orden) y su panel activo. Reclama sobre la marcha (`claim`), asi que un mismo id dos veces dentro
// de una zona tambien se colapsa.
function reconcileSavedZone(rawZone: RawZone | undefined, anchor: Anchor, registry: readonly PanelPlacement[], claimed: Set<PanelId>): ZoneState {
  const panelIds = claim(sanitizePanelIds(rawZone?.panelIds, registry), claimed);
  return {
    panelIds,
    activePanelId: resolveExistingActiveId(rawZone?.activePanelId, panelIds),
    sizePx: sanitizeSizePx(rawZone?.sizePx, DEFAULT_ZONE_SIZE_PX[anchor]),
  };
}

// Segunda pasada, UNA zona: añade al final los paneles del registro cuya zona por defecto es esta y que ni
// el usuario colocó en otra parte (`claimed`) ni escondio (`hidden`). Si la zona estaba vacia se ABRE con
// el primero (no hay nada que proteger); si ya tenia contenido conserva su estado, abierta o cerrada, sin
// forzar el panel nuevo delante del usuario.
function addRegistryPanels(
  zone: ZoneState,
  where: { readonly anchor: Anchor; readonly zoneKey: ZoneKey },
  registry: readonly PanelPlacement[],
  taken: { readonly claimed: Set<PanelId>; readonly hidden: ReadonlySet<PanelId> },
): ZoneState {
  const candidates = registryIdsForZone(registry, where.anchor, where.zoneKey).filter((id) => !taken.hidden.has(id));
  const newIds = claim(candidates, taken.claimed);
  if (newIds.length === 0) return zone;
  const activePanelId = zone.panelIds.length === 0 ? (newIds[0] ?? null) : zone.activePanelId;
  return { ...zone, panelIds: [...zone.panelIds, ...newIds], activePanelId };
}

// Ids escondidos por el usuario que siguen existiendo en el registro (un id que ya no existe se purga).
// Un id que ademas aparece colocado en alguna zona del fichero (estado incoherente) gana la zona.
function sanitizeHiddenIds(rawHidden: unknown, registry: readonly PanelPlacement[], claimed: ReadonlySet<PanelId>): readonly PanelId[] {
  return [...new Set(sanitizePanelIds(rawHidden, registry))].filter((id) => !claimed.has(id));
}

// Reconcilia el layout persistido contra el registro de paneles ACTUAL (§3.3): tolera un `loaded`
// ausente/vacio/corrupto (cae al layout desde cero a partir del registro), añade sin robar el foco
// los paneles nuevos de una version posterior, y descarta sin lanzar los que ya no existen. Nunca
// deja una stripe con un icono roto ni una zona con un tamaño ilegible.
//
// DOS pasadas, no una: en una sola, la zona por defecto de un panel que el usuario movio a una zona
// POSTERIOR en el recorrido lo reponia antes de que esa zona lo reclamara (bug 1 del punto 29: movido a
// otro borde, volvia a su sitio). Primero se reclama todo lo guardado en las seis zonas; despues se
// completa con el registro, saltando lo reclamado y lo escondido (bug 2: escondido, reaparecia).
export function reconcileLayoutWithRegistry(loaded: PanelLayoutState | null, registry: readonly PanelPlacement[]): PanelLayoutState {
  if (!hasStripesShape(loaded)) return buildFreshLayout(registry);

  // Un solo conjunto para las SEIS zonas: la unicidad de un icono es global al layout. Ante un duplicado
  // en el fichero gana la primera aparicion en el orden fijo de ANCHORS x ZONE_KEYS (estable entre arranques).
  const claimed = new Set<PanelId>();
  const saved = {} as Record<Anchor, { a: ZoneState; b: ZoneState }>;
  for (const anchor of ANCHORS) {
    saved[anchor] = {
      a: reconcileSavedZone(readRawZone(loaded.stripes, anchor, 'a'), anchor, registry, claimed),
      b: reconcileSavedZone(readRawZone(loaded.stripes, anchor, 'b'), anchor, registry, claimed),
    };
  }
  const hiddenPanelIds = sanitizeHiddenIds((loaded as { hiddenPanelIds?: unknown }).hiddenPanelIds, registry, claimed);
  const taken = { claimed, hidden: new Set(hiddenPanelIds) };

  const stripes = {} as Record<Anchor, StripeState>;
  for (const anchor of ANCHORS) {
    const zones = {} as { a: ZoneState; b: ZoneState };
    for (const zoneKey of ZONE_KEYS) zones[zoneKey] = addRegistryPanels(saved[anchor][zoneKey], { anchor, zoneKey }, registry, taken);
    stripes[anchor] = { ...zones, splitPx: sanitizeSizePx(readRawSplitPx(loaded.stripes, anchor), DEFAULT_SPLIT_SIZE_PX[anchor]) };
  }
  return { version: PANEL_LAYOUT_VERSION, stripes, hiddenPanelIds };
}

// Nueva posicion en px de un divisor de resize (role="separator", §6) dado el tamaño actual y la tecla
// pulsada: las flechas ajustan por `step` (clamp a [min, max]), Home/End saltan a los extremos, y
// cualquier otra tecla deja el tamaño igual (mismo convenio de "no-op en tecla desconocida" que
// nextIndexForArrow, a11y/keyboardNav.ts). El sentido de las flechas sigue esa misma convencion
// (Right/Down = incrementa, Left/Up = decrementa); el caller decide que flechas escuchar segun la
// orientacion de su borde (vertical en left/right, horizontal en bottom).
export function resolveResize(currentPx: number, key: string, min: number, max: number, step: number): number {
  if (min > max) throw new Error(`resolveResize: min (${min}) no puede ser mayor que max (${max})`);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(currentPx + step, max);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(currentPx - step, min);
    case 'Home':
      return min;
    case 'End':
      return max;
    default:
      return currentPx;
  }
}
