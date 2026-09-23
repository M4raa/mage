import { useEffect, useRef, useState } from 'react';
import type { ImportedTheme } from '@shared/settings';
import type { ThemeSearchItem } from '@shared/themeMarket';
import { isNotAColorThemeError } from '@shared/themeMarket';
import { hasReliableThumbnail, mapVscodeTheme, pickPreviewSyntaxColors } from '../../vscodeTheme';
import {
  applyBackgroundOpacity,
  applyCustomThemeTokens,
  applyResolvedTheme,
  applyThemeFromSettings,
  syncTitleBarOverlay,
  systemPrefersDark,
} from '../../theme';
import { useWorkbenchStore } from '../../workbenchStore';
import { Icon } from '../Icon';

// Tienda de temas de VS Code (Open VSX): busqueda, exploracion por paginas, PREVISUALIZAR (aplica en
// vivo sin guardar) y DESCARGAR (guarda y activa), mas la gestion de los ya descargados.
//
// Tres decisiones de esta pantalla, todas por medida y no por gusto:
//   1. La miniatura de un tema cuesta un .vsix entero, asi que solo se pide la de las tarjetas que
//      ENTRAN EN PANTALLA (IntersectionObserver) — antes se pedian las 24 de golpe.
//   2. Lo descargado se cachea A NIVEL DE MODULO: cerrar y reabrir Ajustes ya no vuelve a bajarlo.
//   3. Probar un tema ya NO lo persiste. Antes cualquier tema que se tocaba acababa en
//      app-settings.json (con sus tokenColors), que es parte de por que ese fichero crecio tanto.

// Retraso del debounce de busqueda de temas (ms) y minimo de caracteres para buscar. Por debajo del
// minimo NO se deja la lista vacia: se piden los temas mas descargados (A11).
const THEME_SEARCH_DEBOUNCE_MS = 350;
const THEME_SEARCH_MIN_CHARS = 2;
// Tarjetas visibles de entrada y cuantas anade cada "Mostrar mas". La busqueda trae una pagina grande
// (ver SEARCH_PAGE_SIZE en themeMarketService); revelarla por trozos evita una rejilla de 100 tarjetas
// que no se pueden ojear.
const INITIAL_VISIBLE_CARDS = 12;
const VISIBLE_CARDS_STEP = 12;
// Margen con el que el observador considera "visible" una tarjeta: se adelanta a la descarga medio
// scroll, asi la miniatura suele estar lista cuando la tarjeta entra de verdad.
const OBSERVER_ROOT_MARGIN = '300px';
// Descargas de .vsix en vuelo a la vez. Cuatro va holgado sin maltratar a Open VSX, que es un registro
// comunitario y gratuito.
const THUMBNAIL_CONCURRENCY = 4;

// Id estable de un item de busqueda (namespace.name), usado para importados y thumbnails.
function ovsxId(item: ThemeSearchItem): string {
  return `ovsx:${item.namespace}.${item.name}`;
}

// --- Caches de modulo ---------------------------------------------------------------------------
// Viven fuera de React A PROPOSITO: Ajustes se monta y desmonta cada vez que se abre el dialogo, y sin
// esto cada apertura volvia a bajar los mismos .vsix. Se pierden al recargar la ventana, que es
// exactamente la vida util que tiene sentido para un catalogo remoto.
const thumbnailCache = new Map<string, ImportedTheme>();
const failedCache = new Set<string>();
const notAThemeCache = new Set<string>();
const inFlight = new Set<string>();
// Resultados de busqueda por query normalizada (la vacia son "los mas descargados").
const searchCache = new Map<string, readonly ThemeSearchItem[]>();

export function ThemeMarketSection({
  activeThemeId,
  importedThemes,
  backgroundOpacity,
  onApplyImported,
  onSelect,
  onRemove,
}: {
  readonly activeThemeId: string | null;
  readonly importedThemes: readonly ImportedTheme[];
  readonly backgroundOpacity: number;
  readonly onApplyImported: (imported: ImportedTheme) => void;
  readonly onSelect: (id: string | null) => void;
  readonly onRemove: (id: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly ThemeSearchItem[]>(() => searchCache.get('') ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_CARDS);
  const thumbnails = useThemeThumbnails();
  const preview = useThemePreview(backgroundOpacity);

  // Busqueda con debounce; se cancela el resultado si el query cambia (guard `active`). Con menos de
  // THEME_SEARCH_MIN_CHARS se busca en VACIO -> el servicio devuelve los mas descargados. Una query ya
  // buscada sale de la cache sin red ni parpadeo de "Buscando…".
  useEffect(() => {
    const clean = query.trim();
    const effective = clean.length < THEME_SEARCH_MIN_CHARS ? '' : clean;
    setVisibleCount(INITIAL_VISIBLE_CARDS);
    const cached = searchCache.get(effective);
    if (cached !== undefined) {
      setResults(cached);
      setLoading(false);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      window.mage
        .searchThemes(effective)
        .then((items) => {
          searchCache.set(effective, items);
          if (active) setResults(items);
        })
        .catch((err: unknown) => {
          if (active) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, THEME_SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Open VSX mete los ICON THEMES en `category=Themes`, y un icon theme no tiene `contributes.themes`:
  // no se puede aplicar. Medido el 2026-09-17 contra el registro real: 4 de los 24 primeros resultados.
  // Se caen de la lista en cuanto se sabe que no traen tema de color.
  const listed = results.filter((item) => !thumbnails.notAThemeIds.includes(ovsxId(item)));
  const shown = listed.slice(0, visibleCount);
  const installedIds = new Set(importedThemes.map((t) => t.id));
  // Se liga a una constante para no perder el estrechamiento dentro de los callbacks del aviso.
  const previewed = preview.previewed;

  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">TEMAS DE VS CODE (OPEN VSX)</span>
      <p className="text-[10.5px] leading-[1.5] text-mg-sec">
        Temas de color de VS Code adaptados a la interfaz de Mage (aproximación: no es un editor de
        código, así que solo se usan los colores de UI). <b className="font-semibold text-mg-body2">Previsualizar</b> lo
        aplica al momento sin guardar nada; <b className="font-semibold text-mg-body2">Descargar</b> lo guarda y lo deja activo.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar temas: dracula, solarized, github…"
        aria-label="Buscar temas en Open VSX"
        className="w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted"
      />

      {previewed !== null && (
        <PreviewBanner
          theme={previewed}
          onKeep={() => {
            onApplyImported(previewed);
            preview.forget();
          }}
          onDiscard={preview.discard}
        />
      )}

      {error !== null && <div role="alert" className="text-[10.5px] text-mg-danger">{error}</div>}
      {loading && <div className="text-[10.5px] text-mg-muted">Buscando…</div>}
      {!loading && listed.length === 0 && error === null && (
        <div className="text-[10.5px] text-mg-muted">Sin resultados.</div>
      )}
      {query.trim().length < THEME_SEARCH_MIN_CHARS && listed.length > 0 && (
        <span className="text-[10px] text-mg-ter">Más descargados</span>
      )}

      {shown.length > 0 && (
        <ul className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {shown.map((item) => (
            <ThemeCard
              key={ovsxId(item)}
              item={item}
              thumbnail={thumbnails.byId[ovsxId(item)] ?? null}
              failed={thumbnails.failedIds.includes(ovsxId(item))}
              installed={installedIds.has(ovsxId(item))}
              previewing={previewed?.id === ovsxId(item)}
              observe={thumbnails.observe}
              onPreview={preview.show}
              onDownload={(imported) => {
                onApplyImported(imported);
                preview.forget();
              }}
            />
          ))}
        </ul>
      )}

      {listed.length > visibleCount && (
        <button
          onClick={() => setVisibleCount((n) => n + VISIBLE_CARDS_STEP)}
          className="self-center rounded-[7px] border border-mg-border-emph px-[14px] py-[6px] text-[11px] text-mg-body2 hover:bg-mg-hover"
        >
          Mostrar más ({listed.length - visibleCount} restantes)
        </button>
      )}

      {importedThemes.length > 0 && (
        <div className="mt-[6px] flex flex-col gap-[8px]">
          <span className="text-[10px] font-bold tracking-[.06em] text-mg-ter">DESCARGADOS</span>
          {/* Los descargados YA traen sus `tokens`, asi que su miniatura es exactamente la misma que la
              de la tienda y no cuesta ni una descarga. */}
          <ul className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {importedThemes.map((imported) => (
              <ImportedThemeCard
                key={imported.id}
                theme={imported}
                active={imported.id === activeThemeId}
                onToggle={() => {
                  preview.forget();
                  onSelect(imported.id === activeThemeId ? null : imported.id);
                }}
                onRemove={() => onRemove(imported.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Previsualizacion en vivo -------------------------------------------------------------------

interface ThemePreview {
  readonly previewed: ImportedTheme | null;
  readonly show: (theme: ImportedTheme) => void;
  readonly discard: () => void;
  // Olvida la previsualizacion SIN restaurar: para cuando lo que viene detras ya fija el tema (se
  // descarga el tema previsualizado, o se activa otro de los descargados).
  readonly forget: () => void;
}

// Aplica un tema al DOM sin tocar los ajustes, y sabe volver a lo guardado. El tema efectivo se
// recalcula SIEMPRE desde el store (no desde una copia congelada al previsualizar), asi descartar
// respeta cualquier cambio que se haya hecho mientras tanto.
//
// Nota: `applyCustomThemeTokens` deja un hint en localStorage para pintar sin parpadeo en el siguiente
// arranque. Descartar (o cerrar Ajustes) lo reescribe, asi que el unico caso en que el hint queda
// desalineado es matar la app EN MEDIO de una previsualizacion: se ve un frame del tema probado y el
// settings real lo corrige al montar. No compensa mas maquinaria.
function useThemePreview(backgroundOpacity: number): ThemePreview {
  const [previewed, setPreviewed] = useState<ImportedTheme | null>(null);
  // El efecto de limpieza necesita saber si habia algo previsualizado SIN volver a montarse en cada
  // cambio (un efecto con dependencia se limpiaria al previsualizar el segundo tema y lo revertiria).
  const previewingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (previewingRef.current) restoreSavedTheme();
    };
  }, []);

  const show = (theme: ImportedTheme): void => {
    previewingRef.current = true;
    setPreviewed(theme);
    applyResolvedTheme(theme.type);
    applyCustomThemeTokens(theme.tokens);
    applyBackgroundOpacity(backgroundOpacity);
    syncTitleBarOverlay();
  };

  const discard = (): void => {
    previewingRef.current = false;
    setPreviewed(null);
    restoreSavedTheme();
  };

  const forget = (): void => {
    previewingRef.current = false;
    setPreviewed(null);
  };

  return { previewed, show, discard, forget };
}

// Reaplica el tema que dicen los ajustes GUARDADOS (base o descargado activo).
function restoreSavedTheme(): void {
  applyThemeFromSettings(useWorkbenchStore.getState().settings, systemPrefersDark());
}

// Aviso fijo mientras hay un tema probado sin guardar: sin el, un tema aplicado y no persistido
// desapareceria al reiniciar sin que nadie entienda por que.
function PreviewBanner({
  theme,
  onKeep,
  onDiscard,
}: {
  readonly theme: ImportedTheme;
  readonly onKeep: () => void;
  readonly onDiscard: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[8px] rounded-[7px] border border-mg-focus bg-mg-sel p-[7px_9px]">
      <Icon name="wand" size={13} className="text-mg-focus" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-mg-body">
        Previsualizando <b className="font-semibold">{theme.label}</b> — todavía no se ha guardado.
      </span>
      <button
        onClick={onKeep}
        className="shrink-0 rounded-[6px] border border-mg-focus px-[9px] py-[3px] text-[10.5px] text-mg-text hover:bg-mg-hover"
      >
        Descargar
      </button>
      <button
        onClick={onDiscard}
        className="shrink-0 rounded-[6px] border border-mg-border-ctrl px-[9px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
      >
        Descartar
      </button>
    </div>
  );
}

// --- Miniaturas bajo demanda ---------------------------------------------------------------------

interface ThemeThumbnails {
  readonly byId: Readonly<Record<string, ImportedTheme>>; // temas ya descargados y mapeados
  readonly failedIds: readonly string[]; // los que no se pudieron leer (se listan sin miniatura)
  readonly notAThemeIds: readonly string[]; // icon themes: no se pueden aplicar, se caen de la lista
  // Ref callback de cada tarjeta: registra su nodo en el observador de visibilidad.
  readonly observe: (element: HTMLElement | null, item: ThemeSearchItem) => void;
}

// Descarga y mapea el tema de cada tarjeta que ENTRA EN PANTALLA (no antes) para poder pintar su
// miniatura, con un pool de N descargas a la vez y cache de modulo. Se cancela al desmontar.
function useThemeThumbnails(): ThemeThumbnails {
  const [byId, setById] = useState<Readonly<Record<string, ImportedTheme>>>(() => Object.fromEntries(thumbnailCache));
  const [failedIds, setFailedIds] = useState<readonly string[]>(() => [...failedCache]);
  const [notAThemeIds, setNotAThemeIds] = useState<readonly string[]>(() => [...notAThemeCache]);
  const cancelledRef = useRef(false);
  const queueRef = useRef<ThemeSearchItem[]>([]);
  const runnersRef = useRef(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const itemsRef = useRef(new WeakMap<Element, ThemeSearchItem>());

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      // Lo que quedaba en cola no se pidio nunca: se libera su marca para que la proxima apertura
      // pueda volver a intentarlo.
      for (const item of queueRef.current) inFlight.delete(ovsxId(item));
      queueRef.current = [];
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  // Una miniatura: pide, mapea y guarda en cache + estado. Los errores se separan porque un ICON THEME
  // no es un fallo, es una extension que Open VSX clasifica como tema sin serlo.
  const loadOne = async (item: ThemeSearchItem): Promise<void> => {
    const id = ovsxId(item);
    try {
      const fetched = await window.mage.fetchTheme({ namespace: item.namespace, name: item.name, version: item.version });
      const mapped = mapVscodeTheme(fetched);
      const label = item.displayName.length > 0 ? item.displayName : fetched.label;
      // `tokenColors` viaja TAL CUAL (F4): es lo que come el resaltador de sintaxis del chat.
      const imported: ImportedTheme = { id, label, type: mapped.type, tokens: mapped.tokens, tokenColors: fetched.tokenColors };
      thumbnailCache.set(id, imported);
      if (!cancelledRef.current) setById((current) => ({ ...current, [id]: imported }));
    } catch (err: unknown) {
      if (isNotAColorThemeError(err)) {
        notAThemeCache.add(id);
        if (!cancelledRef.current) setNotAThemeIds((current) => [...current, id]);
      } else {
        failedCache.add(id);
        if (!cancelledRef.current) setFailedIds((current) => [...current, id]);
      }
    } finally {
      inFlight.delete(id);
    }
  };

  // Pool de tamaño fijo: cada corredor tira de la misma cola hasta vaciarla.
  const runner = async (): Promise<void> => {
    for (;;) {
      const next = queueRef.current.shift();
      if (next === undefined || cancelledRef.current) break;
      await loadOne(next);
    }
    runnersRef.current -= 1;
  };

  const enqueue = (item: ThemeSearchItem): void => {
    const id = ovsxId(item);
    if (thumbnailCache.has(id) || failedCache.has(id) || notAThemeCache.has(id) || inFlight.has(id)) return;
    inFlight.add(id);
    queueRef.current.push(item);
    while (runnersRef.current < THUMBNAIL_CONCURRENCY && queueRef.current.length > 0) {
      runnersRef.current += 1;
      void runner();
    }
  };

  const handleIntersect = (entries: readonly IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observerRef.current?.unobserve(entry.target);
      const item = itemsRef.current.get(entry.target);
      if (item !== undefined) enqueue(item);
    }
  };

  const observe = (element: HTMLElement | null, item: ThemeSearchItem): void => {
    if (element === null || cancelledRef.current) return;
    // Sin IntersectionObserver (entorno de test/headless) se pide sin esperar: mejor descargar de mas
    // que quedarse con la rejilla vacia para siempre.
    if (typeof IntersectionObserver !== 'function') {
      enqueue(item);
      return;
    }
    observerRef.current ??= new IntersectionObserver(handleIntersect, { rootMargin: OBSERVER_ROOT_MARGIN });
    itemsRef.current.set(element, item);
    observerRef.current.observe(element);
  };

  return { byId, failedIds, notAThemeIds, observe };
}

// --- Tarjetas -------------------------------------------------------------------------------------

// Tarjeta de un tema del listado: vista previa grande (maqueta pintada con los colores reales del
// tema) + nombre/descargas + las DOS acciones separadas.
function ThemeCard({
  item,
  thumbnail,
  failed,
  installed,
  previewing,
  observe,
  onPreview,
  onDownload,
}: {
  readonly item: ThemeSearchItem;
  readonly thumbnail: ImportedTheme | null;
  readonly failed: boolean;
  readonly installed: boolean;
  readonly previewing: boolean;
  readonly observe: (element: HTMLElement | null, item: ThemeSearchItem) => void;
  readonly onPreview: (imported: ImportedTheme) => void;
  readonly onDownload: (imported: ImportedTheme) => void;
}): React.JSX.Element {
  // Un tema que resuelve muy pocos colores da una maqueta enteramente de respaldo: enseñar "sin vista
  // previa" es mas honesto que fingir una miniatura que no se parece al tema (Ronda 3, item 3). Se
  // sigue pudiendo aplicar: lo que falta es el preview, no el tema.
  const reliable = thumbnail !== null && hasReliableThumbnail(thumbnail.tokens);
  return (
    <li
      ref={(el) => observe(el, item)}
      className={`flex flex-col gap-[7px] rounded-[8px] border p-[8px] ${
        previewing ? 'border-mg-focus bg-mg-sel' : 'border-mg-border-ctrl'
      }`}
    >
      {reliable && thumbnail !== null ? (
        <ThemePreviewMock theme={thumbnail} />
      ) : (
        <div className="flex h-[176px] items-center justify-center rounded-[6px] border border-dashed border-mg-border-subtle text-[10px] text-mg-muted">
          {thumbnail === null && !failed ? 'cargando…' : failed ? 'no se pudo leer este tema' : 'sin vista previa'}
        </div>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[11.5px] text-mg-body">{item.displayName}</span>
        <span className="block truncate text-[9.5px] text-mg-ter">
          {item.downloadCount.toLocaleString('es-ES')} descargas
          {thumbnail !== null && ` · ${thumbnail.type}`}
        </span>
      </span>
      <div className="flex gap-[6px]">
        <button
          onClick={() => thumbnail !== null && onPreview(thumbnail)}
          disabled={thumbnail === null}
          data-tip="Aplica el tema al momento; no se guarda hasta que lo descargues"
          className="flex-1 rounded-[6px] border border-mg-border-ctrl px-[8px] py-[4px] text-[10.5px] text-mg-body2 hover:bg-mg-hover disabled:cursor-default disabled:text-mg-disabled disabled:hover:bg-transparent"
        >
          Previsualizar
        </button>
        <button
          onClick={() => thumbnail !== null && onDownload(thumbnail)}
          disabled={thumbnail === null}
          data-tip={installed ? 'Ya descargado: vuelve a activarlo' : 'Guarda el tema y lo deja activo'}
          className="flex flex-1 items-center justify-center gap-[4px] rounded-[6px] border border-mg-focus px-[8px] py-[4px] text-[10.5px] text-mg-text hover:bg-mg-hover disabled:cursor-default disabled:border-mg-border-ctrl disabled:text-mg-disabled disabled:hover:bg-transparent"
        >
          {installed && <Icon name="check" size={11} className="text-mg-focus" />}
          {installed ? 'Descargado' : 'Descargar'}
        </button>
      </div>
    </li>
  );
}

// Tarjeta de un tema YA DESCARGADO. Misma vista previa que la tienda —los tokens ya estan guardados,
// asi que no cuesta ni una descarga— mas el estado activo y el borrado.
//
// El borrado pide confirmacion EN SITIO (sin modal, que para esto es desproporcionado): un tema
// borrado hay que volver a buscarlo y descargarlo.
function ImportedThemeCard({
  theme,
  active,
  onToggle,
  onRemove,
}: {
  readonly theme: ImportedTheme;
  readonly active: boolean;
  readonly onToggle: () => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const reliable = hasReliableThumbnail(theme.tokens);
  return (
    <li
      className={`flex flex-col gap-[7px] rounded-[8px] border p-[8px] ${
        active ? 'border-mg-focus bg-mg-sel' : 'border-mg-border-ctrl'
      }`}
    >
      <button
        onClick={onToggle}
        aria-pressed={active}
        aria-label={active ? `Dejar de usar el tema ${theme.label}` : `Usar el tema ${theme.label}`}
        className="flex flex-col gap-[6px] text-left"
      >
        {reliable ? (
          <ThemePreviewMock theme={theme} />
        ) : (
          <div className="flex h-[176px] items-center justify-center rounded-[6px] border border-dashed border-mg-border-subtle text-[10px] text-mg-muted">
            declara muy pocos colores
          </div>
        )}
        <span className="flex min-w-0 items-center gap-[6px]">
          {active && <Icon name="check" size={12} className="text-mg-focus" />}
          <span className="truncate text-[11.5px] text-mg-body">{theme.label}</span>
          <span className="ml-auto shrink-0 text-[9.5px] text-mg-ter">{theme.type}</span>
        </span>
      </button>
      {confirming ? (
        <div className="flex items-center gap-[6px] text-[10.5px]">
          <span className="min-w-0 flex-1 truncate text-mg-sec">¿Eliminar?</span>
          <button
            onClick={onRemove}
            className="rounded-[6px] border border-mg-danger px-[8px] py-[3px] text-mg-danger hover:bg-mg-hover"
          >
            Eliminar
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-mg-body2 hover:bg-mg-hover"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          aria-label={`Eliminar el tema ${theme.label}`}
          className="flex items-center gap-[5px] self-start rounded-[6px] px-[6px] py-[3px] text-[10.5px] text-mg-muted transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-danger"
        >
          <Icon name="trash" size={12} />
          Eliminar
        </button>
      )}
    </li>
  );
}

// Maqueta de la app en pequeño, pintada con los colores YA MAPEADOS del tema (no con los de Mage).
// Reproduce lo que el usuario mira de verdad —barra de pestañas, lista de conversaciones, burbuja,
// respuesta y bloque de codigo resaltado con los tokenColors del propio tema— porque la maqueta
// anterior, tres barras de color, no dejaba distinguir un tema de otro. Solo presentacion.
function ThemePreviewMock({ theme }: { readonly theme: ImportedTheme }): React.JSX.Element {
  // El respaldo de cada pieza encadena OTROS tokens del mismo tema antes del token de Mage (Ronda 3,
  // item 3): asi un tema con `colors` escueto sigue saliendo con SUS colores.
  const tok = (names: readonly string[], fallback: string): string =>
    names.map((name) => theme.tokens[name]).find((value) => value !== undefined) ?? fallback;
  const windowBg = tok(['--color-mg-window'], 'var(--color-mg-window)');
  const panel = tok(['--color-mg-panel', '--color-mg-window'], 'var(--color-mg-panel)');
  const block = tok(['--color-mg-block', '--color-mg-panel'], 'var(--color-mg-block)');
  const border = tok(['--color-mg-border', '--color-mg-border-subtle'], 'var(--color-mg-border)');
  const subtle = tok(['--color-mg-border-subtle', '--color-mg-border'], 'var(--color-mg-border)');
  const body = tok(['--color-mg-body', '--color-mg-text'], 'var(--color-mg-body)');
  const secondary = tok(['--color-mg-sec', '--color-mg-body'], 'var(--color-mg-sec)');
  const accent = tok(['--color-mg-focus', '--color-mg-body'], 'var(--color-mg-focus)');
  const selection = tok(['--color-mg-sel', '--color-mg-panel'], 'var(--color-mg-sel)');
  const code = tok(['--color-mg-code', '--color-mg-panel'], 'var(--color-mg-code)');
  // Colores reales del resaltado del tema; si no los declara, se cae a los de UI (nunca a inventados).
  const syntax = pickPreviewSyntaxColors(theme.tokenColors);
  const keyword = syntax.keyword ?? accent;
  const literal = syntax.string ?? body;
  const comment = syntax.comment ?? secondary;

  return (
    <div
      aria-hidden
      className="flex h-[176px] flex-col overflow-hidden rounded-[6px] border"
      style={{ background: windowBg, borderColor: border }}
    >
      {/* Barra de pestañas: una activa (fondo de ventana) y dos en reposo. */}
      <div className="flex shrink-0 items-end gap-[2px] px-[3px] pt-[3px]" style={{ background: panel }}>
        <span className="h-[13px] w-[34%] rounded-t-[3px] border-b-0 px-[3px] pt-[3px]" style={{ background: windowBg }}>
          <span className="block h-[3px] w-[70%] rounded-full" style={{ background: body }} />
        </span>
        <span className="h-[11px] w-[26%] rounded-t-[3px] px-[3px] pt-[3px]" style={{ background: block }}>
          <span className="block h-[3px] w-[60%] rounded-full" style={{ background: secondary }} />
        </span>
        <span className="h-[11px] w-[22%] rounded-t-[3px] px-[3px] pt-[3px]" style={{ background: block }}>
          <span className="block h-[3px] w-[70%] rounded-full" style={{ background: secondary }} />
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-[4px] p-[4px]">
        {/* Lista de conversaciones, con la activa resaltada. */}
        <div className="flex w-[27%] flex-col gap-[3px] rounded-[3px] p-[3px]" style={{ background: panel }}>
          <span className="h-[4px] w-[55%] rounded-full" style={{ background: accent }} />
          <span className="rounded-[2px] p-[3px_2px]" style={{ background: selection }}>
            <span className="block h-[3px] w-[85%] rounded-full" style={{ background: body }} />
          </span>
          <span className="h-[3px] w-[70%] rounded-full" style={{ background: secondary }} />
          <span className="h-[3px] w-[80%] rounded-full" style={{ background: secondary }} />
          <span className="h-[3px] w-[60%] rounded-full" style={{ background: secondary }} />
        </div>

        {/* Chat: burbuja del usuario, respuesta y bloque de codigo con colores de sintaxis reales. */}
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <span className="ml-auto flex w-[58%] flex-col gap-[2px] rounded-[4px] p-[4px]" style={{ background: selection }}>
            <span className="block h-[3px] w-[85%] rounded-full" style={{ background: body }} />
            <span className="block h-[3px] w-[55%] rounded-full" style={{ background: body }} />
          </span>
          <span className="h-[3px] w-[92%] rounded-full" style={{ background: body }} />
          <span className="h-[3px] w-[78%] rounded-full" style={{ background: body }} />
          <span
            className="flex flex-col gap-[3px] rounded-[4px] border p-[4px]"
            style={{ background: code, borderColor: subtle }}
          >
            <span className="flex gap-[3px]">
              <span className="h-[3px] w-[22%] rounded-full" style={{ background: keyword }} />
              <span className="h-[3px] w-[34%] rounded-full" style={{ background: literal }} />
            </span>
            <span className="flex gap-[3px]">
              <span className="h-[3px] w-[14%] rounded-full" style={{ background: keyword }} />
              <span className="h-[3px] w-[46%] rounded-full" style={{ background: body }} />
            </span>
            <span className="h-[3px] w-[52%] rounded-full" style={{ background: comment }} />
          </span>
          {/* Caja de escritura. */}
          <span className="mt-auto flex h-[16px] items-center rounded-[4px] border px-[4px]" style={{ background: block, borderColor: subtle }}>
            <span className="h-[3px] w-[40%] rounded-full" style={{ background: secondary }} />
            <span className="ml-auto h-[8px] w-[8px] rounded-[2px]" style={{ background: accent }} />
          </span>
        </div>
      </div>
    </div>
  );
}
