import { create, type UseBoundStore, type StoreApi } from 'zustand';
import type { TranscriptEntry, TranscriptParseError, TranscriptTailPosition } from '@shared/transcripts';
import { TRANSCRIPT_TAIL_START } from '@shared/transcripts';
import type { OpenTranscriptParams, TranscriptBatchPayload } from '@shared/ipc';

export interface TranscriptStoreState {
  // Id de la lectura activa; lo genera el renderer y ES la identidad (filtra los mensajes del canal).
  // Se fija ANTES de invocar main -> ningun lote/error puede llegar antes de que el store lo conozca
  // (el error por fichero inexistente se emite de forma sincrona en main, sin espera de I/O).
  readonly transcriptId: string | null;
  readonly entries: readonly TranscriptEntry[];
  readonly errors: readonly TranscriptParseError[];
  readonly isFinal: boolean;
  readonly totalLinesSoFar: number;
  // I5: posicion de reanudacion tras el ultimo lote recibido. `refresh()` la manda de vuelta a main
  // en vez de releer el fichero entero desde el principio en cada turno.
  readonly tailPosition: TranscriptTailPosition;
  readonly errorMessage: string | null;
  // Ultimos params abiertos: permiten reintentar (refresh) sin que el panel tenga que conocerlos.
  readonly lastParams: OpenTranscriptParams | null;
  // Abre la transcripcion de una sesion DESDE EL PRINCIPIO; cancela cualquier lectura anterior en
  // curso. Usar para una sesion NUEVA (cambio de pestana) — para releer la misma, usar `refresh()`.
  open: (params: OpenTranscriptParams) => Promise<void>;
  // Continua la ULTIMA transcripcion abierta desde donde se dejo (I5: tail, no relee desde el
  // principio) — util cuando el fichero aun no existia al primer intento (posicion 0, equivalente a
  // abrir), o para ver el contenido mas reciente de una sesion en vivo. No-op si no se abrio ninguna.
  refresh: () => void;
  // Cancela la lectura en curso (p.ej. al cambiar de pestana o cerrar el panel de logs).
  cancel: () => void;
}

// Estado que un lote entrante añade al que ya hay. PURO (estado + payload -> parche), para poder
// probar la acumulacion sin Electron ni `window`. Devuelve un parche VACIO cuando el lote no es de
// esta lectura (otra instancia del store, o una apertura ya reemplazada): filtrar aqui dentro y no
// antes es lo que cierra la carrera — el filtro y la acumulacion tienen que mirar la MISMA
// instantanea, y con dos lotes en el mismo tick la de `getState()` ya esta vieja.
export function applyTranscriptBatch(
  current: Pick<TranscriptStoreState, 'transcriptId' | 'entries' | 'errors'>,
  payload: TranscriptBatchPayload,
): Partial<TranscriptStoreState> {
  if (current.transcriptId !== payload.transcriptId) return {};
  // Fallo terminal de lectura (fichero inexistente, error de FS): cierra la carga con el mensaje.
  if (payload.error !== undefined) return { errorMessage: payload.error, isFinal: true };
  if (payload.batch === undefined) return {};
  const batch = payload.batch;
  return {
    entries: [...current.entries, ...batch.entries],
    errors: [...current.errors, ...batch.errors],
    isFinal: batch.isFinal,
    totalLinesSoFar: batch.totalLinesSoFar,
    // I5: posicion tras ESTE lote (ya acumulada desde main si esta lectura era una reanudacion) —
    // guardarla en cada lote, no solo en el final, no cuesta nada y deja el estado siempre consistente.
    tailPosition: { bytesRead: batch.bytesReadSoFar, rawLineNumber: batch.rawLineNumber, totalLinesSoFar: batch.totalLinesSoFar },
  };
}

// Factoria de stores de transcripcion: cada instancia mantiene UNA lectura activa y se suscribe al
// canal de lotes filtrando por SU propio transcriptId (UUID). Asi conviven varias instancias sin
// colisionar: la principal (pestanas Logs/Contexto) y la del drill-down de subagentes (M2.2.3b)
// ignoran mutuamente los lotes de la otra. Sin factoria habria que multiplexar a mano el unico
// store; con ella, cada dominio es independiente y el arreglo de la carrera (id fijado en el
// renderer antes del invoke) se conserva por instancia.
// Lo ya leido de cada sesion, POR INSTANCIA de store (P11). Volver a una pestaña vuelve a llamar a
// `open()`, que reseteaba `tailPosition` y releia el .jsonl DESDE EL BYTE CERO — y en este disco hay
// 420 MB en 539 transcripciones, la mayor de 18,5 MB. Con la cache, `open()` de una sesion ya leida
// reanuda igual que `refresh()`: mismo IPC, misma lectura incremental que ya existia para I5.
// Se guarda por sessionId y no por pestaña: es la SESION la que tiene un fichero y un offset.
interface CachedTranscript {
  readonly entries: TranscriptStoreState['entries'];
  readonly errors: TranscriptStoreState['errors'];
  readonly totalLinesSoFar: number;
  readonly tailPosition: TranscriptStoreState['tailPosition'];
}

// Un store y su cancelacion. La cancelacion hace falta porque desde 4.1 hay un store POR PESTAÑA y
// cada uno se suscribe al canal de lotes: sin desuscribir al cerrar la pestaña, el listener y las
// entradas ya leidas se quedarian vivos para siempre.
interface TranscriptStoreHandle {
  readonly use: UseBoundStore<StoreApi<TranscriptStoreState>>;
  readonly dispose: () => void;
}

function createTranscriptStore(): TranscriptStoreHandle {
  const readSoFar = new Map<string, CachedTranscript>();

  const useStore = create<TranscriptStoreState>((set, get) => ({
    transcriptId: null,
    entries: [],
    errors: [],
    isFinal: false,
    totalLinesSoFar: 0,
    tailPosition: TRANSCRIPT_TAIL_START,
    errorMessage: null,
    lastParams: null,

    open: async (params) => {
      get().cancel(); // cancela la lectura anterior en main (evita fugas de fs.ReadStream)
      // Id generado AQUI y fijado de forma sincrona antes del invoke: cierra la carrera por la que un
      // error/lote temprano llegaba antes de conocer el id y se descartaba (colgaba en "Cargando…").
      const transcriptId = crypto.randomUUID();
      // Si ya se leyo esta sesion en esta instancia, se retoman sus entradas y su offset en vez de
      // empezar de cero: es la misma lectura incremental de I5, aplicada tambien al cambio de pestaña.
      const cached = readSoFar.get(params.sessionId);
      set({
        transcriptId,
        entries: cached?.entries ?? [],
        errors: cached?.errors ?? [],
        isFinal: false,
        totalLinesSoFar: cached?.totalLinesSoFar ?? 0,
        tailPosition: cached?.tailPosition ?? TRANSCRIPT_TAIL_START,
        errorMessage: null,
        lastParams: params,
      });
      try {
        await window.mage.openTranscript(transcriptId, { ...params, resumeFrom: get().tailPosition });
      } catch (err) {
        // Si otra apertura ya reemplazo esta (el transcriptId cambio), ignora este fallo tardio.
        if (get().transcriptId !== transcriptId) return;
        set({ errorMessage: err instanceof Error ? err.message : String(err), isFinal: true });
      }
    },

    // I5: NO reinicia `entries`/`errors`/`tailPosition` — continua desde la posicion del ultimo lote
    // recibido (lectura incremental). Con `tailPosition` en cero (nunca se leyo nada todavia, o el
    // primer intento fallo por fichero inexistente) equivale a `open()`: mismo IPC, mismo resultado.
    refresh: () => {
      const { lastParams, tailPosition } = get();
      if (lastParams === null) return;
      get().cancel();
      const transcriptId = crypto.randomUUID();
      set({ transcriptId, isFinal: false, errorMessage: null });
      void window.mage.openTranscript(transcriptId, { ...lastParams, resumeFrom: tailPosition }).catch((err: unknown) => {
        if (get().transcriptId !== transcriptId) return;
        set({ errorMessage: err instanceof Error ? err.message : String(err), isFinal: true });
      });
    },

    cancel: () => {
      const { transcriptId } = get();
      if (transcriptId !== null) void window.mage.cancelTranscript(transcriptId);
      set({ transcriptId: null });
    },
  }));

  // Suscripcion UNICA a nivel de instancia (no por componente): acumula lotes del transcriptId activo
  // e ignora los que lleguen para OTRO transcriptId (otra instancia, o una apertura ya reemplazada).
  // Guard de entorno (F6 Fase 3): este modulo ahora lo importa panelRegistry.ts (registro puro, sin
  // DOM), que a su vez lo cargan los tests de logica de negocio en Node (vitest.config.ts, sin
  // `window`) — sin este guard, crear el store con `window` ausente rompe `pnpm test` aunque nadie
  // llegue a invocar `render()`. En Electron (renderer real) `window.mage` siempre existe.
  let unsubscribe: (() => void) | null = null;
  if (typeof window !== 'undefined') {
    // Actualizador FUNCIONAL: leer el estado con getState() antes de setState hacia que dos lotes del
    // mismo tick escribieran los dos sobre la misma instantanea, y el segundo perdia las entradas del
    // primero. No se habia observado, pero es una carrera real y el arreglo cuesta una linea.
    unsubscribe = window.mage.onTranscriptBatch((payload) => {
      useStore.setState((current) => applyTranscriptBatch(current, payload));
      // La cache se refresca con lo que acaba de quedar en el store (P11). Se hace AQUI y no en
      // `open`/`refresh` porque es el unico punto por el que pasan todas las lecturas.
      const s = useStore.getState();
      const sessionId = s.lastParams?.sessionId;
      if (sessionId !== undefined) {
        readSoFar.set(sessionId, { entries: s.entries, errors: s.errors, totalLinesSoFar: s.totalLinesSoFar, tailPosition: s.tailPosition });
      }
    });
  }

  return {
    use: useStore,
    dispose: () => {
      useStore.getState().cancel();
      if (unsubscribe !== null) unsubscribe();
      readSoFar.clear();
    },
  };
}

// 4.1: UNA instancia por pestaña, no una global. Antes habia un solo store siguiendo a `activeTabId`,
// asi que en un workspace dividido el panel NO enfocado leia la transcripcion del enfocado: su
// hidratacion comparaba `lastParams.sessionId` con la suya, no coincidia nunca y se quedaba con el
// chat vacio teniendo historial en disco (4.3).
//
// Quien pide el store decide QUE pestaña le toca a traves de `usePaneTabId()`
// (`usePaneTranscriptStore` en paneContext.ts): dentro de un `ChatPane`, la suya; fuera —los paneles
// del dock, Logs y Contexto, y la StatusBar— la ACTIVA (decision del usuario, 2026-09-09), que por
// invariante es la del panel enfocado.
const storesByTab = new Map<string, TranscriptStoreHandle>();

export function transcriptStoreForTab(tabId: string): UseBoundStore<StoreApi<TranscriptStoreState>> {
  const existing = storesByTab.get(tabId);
  if (existing !== undefined) return existing.use;
  const created = createTranscriptStore();
  storesByTab.set(tabId, created);
  return created.use;
}

// La llama `closeTab`, con el mismo motivo que los `without(...)` de sus mapas por pestaña: sin esto
// el store de cada pestaña cerrada se queda con sus entradas en memoria y con su listener del canal
// corriendo en cada lote (B12 fue exactamente esta fuga con otros dos mapas).
export function disposeTranscriptStore(tabId: string): void {
  const handle = storesByTab.get(tabId);
  if (handle === undefined) return;
  storesByTab.delete(tabId);
  handle.dispose();
}

// Store dedicado al drill-down de subagentes (M2.2.3b): abrir un subagente no pisa el transcript
// principal, asi el usuario vuelve a el al cerrar el overlay sin recargar. Sigue siendo UNO para toda
// la app porque el overlay tambien lo es: solo se puede estar viendo un subagente a la vez.
export const useSubagentTranscriptStore = createTranscriptStore().use;
