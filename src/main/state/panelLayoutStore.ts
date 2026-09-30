import { z } from 'zod';
import {
  PANEL_LAYOUT_VERSION,
  reconcileLayoutWithRegistry,
  type PanelId,
  type PanelLayoutState,
  type PanelPlacement,
} from '@shared/panelLayout';
import { PANEL_LAYOUT_SCHEMA } from '@shared/panelLayoutSchema';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

// Persistencia del layout de paneles acoplables (F6, PLAN-F6-PANELES.md §5.3) en
// userData/panels-layout.json. Mismo patron que WorkspaceStore/SettingsStore: DI de FS (testable sin
// disco), lectura TOLERANTE (nunca lanza: ausente/corrupto -> reconcileLayoutWithRegistry(null,
// registry), igual que un usuario que actualiza sin haber tenido nunca el fichero, §3.3/§5.3) y
// escritura ATOMICA (tmp con sufijo unico + rename).
//
// Diferencia con WorkspaceStore/SettingsStore: el "registro" contra el que se reconcilia (§3.3) es el
// catalogo real de paneles, que vive en el renderer (panelRegistry.ts) porque cada PanelDefinition
// trae un `render` de React que no puede cruzar al proceso main -- medido con
// `tsc -p tsconfig.node.json`, un fichero de main que importa algo bajo `src/renderer/` rompe con
// "File is not listed within the file list of project". Por eso `load()` recibe el registro como
// PARAMETRO (los mismos id/defaultAnchor/defaultZone de cada PanelDefinition, sin `render`): el
// renderer los manda en la llamada IPC: main nunca hardcodea ni duplica el catalogo de paneles.
export interface PanelLayoutStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
  // Aviso de "nunca silenciar" (§3.3): un panelId persistido que ya no existe en el registro actual
  // se descarta al reconciliar; el caller con acceso al LogBus se entera por aqui (mismo contrato que
  // SharedConfigService.log).
  readonly log: (level: 'warn', message: string) => void;
}

// Esquema LAXO para la LECTURA (envoltura minima): solo descarta basura de otro tipo (un array, una
// cadena, un numero...) o sin ninguna forma de `stripes`. El detalle fino de cada zona/panel (ids
// desconocidos, tamaños invalidos, zonas a medias de una version anterior de Mage) lo resuelve
// reconcileLayoutWithRegistry, que YA trata cada campo como `unknown` puertas adentro y esta
// exhaustivamente testeado para tolerarlo (§3.3, panelLayout.test.ts) -- repetir esa tolerancia campo
// a campo aqui violaria DRY sin ganar nada, y con un esquema mas estricto (exigiendo las tres stripes
// y las dos zonas de cada una) se perderia la reconciliacion PARCIAL que es la razon de ser de §3.3:
// un fichero con solo `left.a` presente debe completar el resto desde el registro, no descartarse
// entero.
const PANEL_LAYOUT_ENVELOPE_SCHEMA = z.object({
  version: z.number().catch(PANEL_LAYOUT_VERSION),
  stripes: z.record(z.string(), z.unknown()),
  // Sin declararlo, Zod lo descarta al leer y los paneles escondidos reaparecerian en cada arranque.
  hiddenPanelIds: z.unknown().optional(),
});

type PanelLayoutEnvelope = z.infer<typeof PANEL_LAYOUT_ENVELOPE_SCHEMA>;

// El esquema ESTRICTO de ESCRITURA vive en `@shared/panelLayoutSchema`, que es de donde
// `PanelLayoutState` DERIVA su tipo: declararlo aqui otra vez es lo que hizo que `splitPx` (presente
// en el tipo y respetado por la lectura) se perdiera en cada guardado. El estado que llega a `save()`
// ya paso por reconcileLayoutWithRegistry en el renderer (nunca son datos crudos de disco), asi que
// exigir la forma completa es correcto — un estado mal formado es un error de programacion, no un
// fichero de usuario corrupto, y debe lanzar con el detalle en vez de escribirse en silencio (mismo
// contrato que WorkspaceStore.save/SettingsStore.save).

// Ids de panel presentes en UNA zona cruda (forma de RawZone de panelLayout.ts, pero aqui no se
// importa ese tipo interno: solo hace falta saber si `panelIds` es un array de strings). Nunca lanza.
function panelIdsInZone(rawZone: unknown): readonly PanelId[] {
  if (typeof rawZone !== 'object' || rawZone === null) return [];
  const panelIds = (rawZone as Record<string, unknown>).panelIds;
  if (!Array.isArray(panelIds)) return [];
  return panelIds.filter((id): id is PanelId => typeof id === 'string');
}

// Ids de panel presentes en UNA stripe cruda (sus dos zonas, 'a' y 'b').
function panelIdsInStripe(rawStripe: unknown): readonly PanelId[] {
  if (typeof rawStripe !== 'object' || rawStripe === null) return [];
  const stripe = rawStripe as Record<string, unknown>;
  return [...panelIdsInZone(stripe.a), ...panelIdsInZone(stripe.b)];
}

// Todos los panelIds que aparecen en cualquier zona de cualquier stripe del fichero persistido, sin
// deduplicar todavia (lo hace el caller). Pura, sin efectos: el aviso al LogBus es responsabilidad de
// quien la invoca (PanelLayoutStore.load), igual que sanitizePanelIds en panelLayout.ts.
function allPersistedPanelIds(rawStripes: Record<string, unknown>): readonly PanelId[] {
  return Object.values(rawStripes).flatMap(panelIdsInStripe);
}

// Ids persistidos que YA NO EXISTEN en el registro actual (panel eliminado en una version posterior
// de Mage, §3.3): reconcileLayoutWithRegistry los descarta en silencio por diseño (es pura); esta
// funcion es la que permite al store avisar por el LogBus sin duplicar la logica de reconciliacion.
export function findDiscardedPanelIds(rawStripes: Record<string, unknown> | null, registry: readonly PanelPlacement[]): readonly PanelId[] {
  if (rawStripes === null) return [];
  const validIds = new Set(registry.map((p) => p.id));
  const discarded = allPersistedPanelIds(rawStripes).filter((id) => !validIds.has(id));
  return [...new Set(discarded)];
}

export class PanelLayoutStore {
  constructor(private readonly deps: PanelLayoutStoreDeps) {}

  // Lee el fichero persistido y lo reconcilia contra el catalogo ACTUAL de paneles (`registry`,
  // enviado por el renderer via IPC — ver cabecera del fichero). Nunca lanza: fichero ausente, JSON
  // invalido o sin ninguna forma de `stripes` -> reconcileLayoutWithRegistry(null, registry), que
  // construye el layout desde los defaults del propio registro (§3.3/§5.3).
  load(registry: readonly PanelPlacement[]): PanelLayoutState {
    const envelope = this.readEnvelopeOrNull();
    this.warnAboutDiscardedPanels(envelope, registry);
    return reconcileLayoutWithRegistry(envelope as unknown as PanelLayoutState | null, registry);
  }

  // Guarda de forma atomica. Valida la forma COMPLETA antes de escribir (contrato explicito: nunca
  // escribir basura en silencio). El estado que llega aqui ya esta reconciliado en memoria.
  save(state: PanelLayoutState): void {
    const result = PANEL_LAYOUT_SCHEMA.safeParse(state);
    if (!result.success) {
      throw new Error(`Layout de paneles invalido al guardar: ${result.error.message}`);
    }
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(result.data, null, 2));
  }

  private readEnvelopeOrNull(): PanelLayoutEnvelope | null {
    if (!this.deps.exists(this.deps.filePath)) return null;
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
      return null; // JSON corrupto: se trata igual que "nunca hubo fichero" (§3.3)
    }
    const result = PANEL_LAYOUT_ENVELOPE_SCHEMA.safeParse(parsed);
    return result.success ? result.data : null;
  }

  private warnAboutDiscardedPanels(envelope: PanelLayoutEnvelope | null, registry: readonly PanelPlacement[]): void {
    const discarded = findDiscardedPanelIds(envelope?.stripes ?? null, registry);
    for (const id of discarded) {
      this.deps.log('warn', `panels-layout.json: panel "${id}" ya no existe en el registro de paneles; se descarta al reconciliar`);
    }
  }
}
