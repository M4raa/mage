import { createContext, forwardRef, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type Components, type ScrollerProps, type VirtuosoHandle } from 'react-virtuoso';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { CopyButton } from './CopyButton';
import { Icon, type IconName } from './Icon';
import { AgyCommandsDialog } from './AgyCommandsDialog';
import { RewindDialog } from './RewindDialog';
import { canOfferRewind } from '../rewindActions';
import type { RewindAction } from '@shared/ipc';
import { isValidAgyRule, parseAgyMcpRule } from '@shared/agyRules';
import { AGY_PROVIDER_ID, isAutoApprovedProvider } from '@shared/providers';
import { useWorkbenchStore } from '../workbenchStore';
import { SPARKLE_WAIST_RATIO } from '../brandMark';
import { useThinkingStore } from '../thinkingStore';
import { transcriptToBlocks } from '../transcriptToBlocks';
import { computeThinkingStatus, formatElapsed } from '../thinkingStatus';
import { commandOutputLayout, currentTurnCapability, hasVisibleContent, isSubagentRunning, pendingToolName, type TurnCapability } from '../engineBlocks';
import { isSlashCommandText } from '../conversationTitle';
import { canChangeCwd, shortenPath } from '../cwdChange';
import { Markdown, ReferenceContext, type ReferenceLinks } from './Markdown';
import { useReferenceIndex } from '../useReferenceIndex';
import { resolveReference } from '../planReferences';
import { PermissionCard } from './PermissionCard';
import { usePanelLayoutStore } from '../panelLayoutStore';
import { ArtifactCard } from './ArtifactCard';
import { artifactCardFrom } from '../artifactView';
import { chatRows, currentTurnSummary, stickResetKey, type ChatRow } from '../chatVisibility';
import { usePaneTabId, usePaneTranscriptStore } from '../paneContext';
import type { Block, ImageAttachment } from '../types';
import { classifySystemWrapper } from '@shared/systemWrappers';
import { INITIAL_ANCHOR, appendedTailKeys, nextListAnchor, type ListAnchor } from '../chatListAnchor';
import { MOTION_S } from '../motionPresets';
import { RecentProjects } from './RecentProjects';
import { reportActionError } from '../notificationStore';
import { conversationIdOfTab } from '../conversationId';
import { useT } from '../../i18n/uiLanguage';
import type { Translate } from '@shared/i18n/translator';

// Referencia ESTABLE para el caso "todavia no hay pensamientos de esta sesion": un `[]` nuevo en cada
// render haria que el efecto de hidratacion se disparase en bucle.
const EMPTY_THINKING: readonly string[] = [];

// Zona central de conversacion: pila de bloques (usuario, herramienta, agente).
export function BlockChat(): React.JSX.Element {
  // La pestaña de ESTE panel del centro (item 13): con el workspace dividido no tiene por que ser la
  // activa global. Sin division, `usePaneTabId` devuelve exactamente `activeTabId`.
  const activeTabId = usePaneTabId();
  // #48: una conversacion reabierta sin bloques todavia esta leyendo su transcripcion: se dice.
  const resumed = useWorkbenchStore((s) => s.tabs.find((tab) => tab.id === activeTabId)?.resumeSessionId !== undefined);
  const useTranscript = usePaneTranscriptStore();
  const transcriptFinal = useTranscript((s) => s.isFinal);
  const transcriptError = useTranscript((s) => s.errorMessage);
  const missingProvider = useWorkbenchStore((s) => s.missingConversationByChat[activeTabId]);
  const allBlocks = useWorkbenchStore((s) => s.blocksByChat[activeTabId] ?? EMPTY);
  useHydrateFromTranscript();
  const accent = useWorkbenchStore((s) => {
    const tab = s.tabs.find((t) => t.id === activeTabId);
    return s.accounts.find((a) => a.id === tab?.accountId)?.accent.base ?? 'var(--color-mg-fill)';
  });
  // Guard de presentacion (A5): los bloques sin contenido no se pintan (antes dejaban rayas sueltas
  // que parecian separadores entre mensajes).
  const blocks = useMemo(() => allBlocks.filter(hasVisibleContent), [allBlocks]);
  // Chat LIMPIO (P-026 3.4, D21–D24): lo que se dice y lo que pide respuesta. Herramientas, pensamiento,
  // subagentes y permisos resueltos van al panel de Actividad; aqui queda, como mucho, una linea que
  // lleva a el (una herramienta que fallo, los subagentes lanzados). Una pasada O(n).
  const status = useWorkbenchStore((s) => s.statusByChat[activeTabId] ?? 'idle');
  const rows = useMemo(() => chatRows(blocks), [blocks]);
  // La linea de estado se ve TODO el turno (antes solo sin texto en curso): con las herramientas fuera
  // del hilo, es lo unico que dice que el agente sigue trabajando.
  const turnLive = status === 'streaming' || status === 'needs_permission';
  const turnSummary = useMemo(() => currentTurnSummary(allBlocks), [allBlocks]);
  // Tool en curso: el indicador dice QUE esta haciendo ("Ejecutando Write…") en vez de un generico.
  const runningTool = useMemo(() => pendingToolName(allBlocks), [allBlocks]);
  const capability = useMemo(() => currentTurnCapability(allBlocks), [allBlocks]);
  // El texto en streaming crece DENTRO del ultimo bloque (no cambia el numero de bloques): el tamaño
  // de la cola es lo que hace que el auto-scroll siga el typing.
  const tailSize = useMemo(() => tailContentSize(rows), [rows]);
  const t = useT();
  const referenceLinks = useChatReferenceLinks(activeTabId);
  const anchor = useListAnchor(activeTabId, rows);
  const enteringKeys = useEnteringRowKeys(`${activeTabId}:${anchor.generation}`, rows);
  const expandedRows = useExpandedRowsStore(activeTabId);
  const { virtuosoRef, onAtBottomChange, repinIfStuck } = useChatAutoScroll({ tailSize, turnLive, resetKey: stickResetKey(activeTabId, blocks) });
  const lastRow = rows[rows.length - 1];
  const lastRowKey = lastRow === undefined ? null : rowKey(lastRow);
  const footerContext = useMemo<ChatListContext>(
    () => ({ accent, lastRowKey, enteringKeys, turnLive, runningTool, capability, steps: turnSummary.steps, errors: turnSummary.errors, repinIfStuck }),
    [accent, lastRowKey, enteringKeys, turnLive, runningTool, capability, turnSummary.steps, turnSummary.errors, repinIfStuck],
  );

  if (blocks.length === 0 && !turnLive) {
    if (activeTabId.length === 0) return <NoConversationState />;
    if (missingProvider !== undefined) return <ConversationLoadState text={missingConversationText(t, missingProvider)} />;
    if (resumed && transcriptError !== null) return <ConversationLoadState text={t('chat.load.failed', { error: transcriptError })} />;
    if (resumed && !transcriptFinal) return <ConversationLoadState text={t('chat.load.loading')} loading />;
    return <EmptyConversation />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Region viva (solo lectores): anuncia el CAMBIO de estado del turno, no cada delta (evita
          ruido). El texto solo cambia en las transiciones, que es cuando el SR lo lee. Va FUERA del
          scroller de la lista virtual. */}
      <div className="sr-only" role="status" aria-live="polite">
        {statusAnnouncement(t, status)}
      </div>
      <ReferenceContext.Provider value={referenceLinks}>
      <ExpandedRowsContext.Provider value={expandedRows}>
        <Virtuoso<ChatRow, ChatListContext>
          key={`${activeTabId}:${anchor.generation}`}
          ref={virtuosoRef}
          className="min-h-0 flex-1"
          data={rows}
          computeItemKey={(_, row) => rowKey(row)}
          firstItemIndex={anchor.firstIndex}
          initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
          increaseViewportBy={{ top: VIEWPORT_OVERSCAN_PX, bottom: VIEWPORT_OVERSCAN_PX }}
          atBottomThreshold={STICK_TO_BOTTOM_PX}
          followOutput={(atBottom) => (atBottom ? 'auto' : false)}
          atBottomStateChange={onAtBottomChange}
          components={CHAT_LIST_COMPONENTS}
          context={footerContext}
          itemContent={renderChatItem}
        />
      </ExpandedRowsContext.Provider>
      </ReferenceContext.Provider>
    </div>
  );
}

// Referencias del hilo (F5.6, #31): resuelven contra el indice de la pestana y abren el punto en Ficheros.
function useChatReferenceLinks(tabId: string): ReferenceLinks {
  const index = useReferenceIndex(tabId);
  const openDocumentAnchor = useWorkbenchStore((s) => s.openDocumentAnchor);
  return useMemo(
    () => ({ resolve: (key) => resolveReference(index, key), open: (anchor) => openDocumentAnchor(tabId, anchor) }),
    [index, openDocumentAnchor, tabId],
  );
}

// Mismo valor que `useStickToBottom` (que sigue usando el panel de Actividad): por debajo de este margen
// el usuario cuenta como «pegado» al final.
const STICK_TO_BOTTOM_PX = 80;
// Filas que Virtuoso mantiene montadas por encima y por debajo de lo visible.
const VIEWPORT_OVERSCAN_PX = 600;

// Contexto que Virtuoso pasa al pie y a cada fila (referencia estable mientras no cambien sus valores).
interface ChatListContext {
  readonly accent: string;
  readonly lastRowKey: string | null;
  // Filas recién llegadas EN VIVO: llevan `mg-enter` el tiempo que dura la animación.
  readonly enteringKeys: ReadonlySet<string>;
  readonly turnLive: boolean;
  readonly runningTool: string | null;
  readonly capability: TurnCapability | null;
  readonly steps: number;
  readonly errors: number;
  // Re-ancla al final si el usuario estaba pegado; lo llama el pie al cambiar de alto.
  readonly repinIfStuck: () => void;
}

// `data-last-row` es el ancla del harness para saber que la ultima fila ya esta pintada; `data-row-key`, para
// seguir una fila concreta al anteponer historial.
function renderChatItem(_index: number, row: ChatRow, context: ChatListContext): React.JSX.Element {
  const key = rowKey(row);
  return (
    <div data-chat-row="true" data-row-key={key} {...(key === context.lastRowKey ? { 'data-last-row': 'true' } : {})} className={`px-[22px] pb-[14px]${context.enteringKeys.has(key) ? ' mg-enter' : ''}`}>
      <ChatRowView row={row} accent={context.accent} />
    </div>
  );
}

// A nivel de modulo: Virtuoso remonta la lista si la referencia de `components` cambia.
const CHAT_LIST_COMPONENTS: Components<ChatRow, ChatListContext> = {
  // La clase `overflow-y-auto` la buscan las comprobaciones de verify:gui.
  Scroller: forwardRef<HTMLDivElement, ScrollerProps>(function ChatScroller(props, ref) {
    return <div {...props} ref={ref} data-chat-scroller="true" className="overflow-y-auto" />;
  }),
  Header: () => <div className="h-[16px]" />,
  Footer: ({ context }) => <ChatFooter context={context} />,
};

// Pie de la lista: la línea de «trabajando». Virtuoso mide el pie DESPUÉS del commit en que aparece el indicador, así que
// el re-anclaje del cambio de `turnLive` se quedaba corto en su altura (V6, R59): al cambiar de alto se vuelve a anclar.
function ChatFooter({ context }: { readonly context: ChatListContext }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { repinIfStuck } = context;
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(() => repinIfStuck());
    observer.observe(element);
    return () => observer.disconnect();
  }, [repinIfStuck]);
  return (
    <div ref={ref} data-chat-footer="true" className="px-[22px] pb-[16px]">
      {context.turnLive && <ThinkingIndicator accent={context.accent} tool={context.runningTool} capability={context.capability} steps={context.steps} errors={context.errors} />}
    </div>
  );
}

// Ancla de la lista: sube `firstItemIndex` al anteponer historial y cuenta una «generacion» cuando el
// contenido se sustituye (la lista se remonta). Cambiar de pestaña la reinicia.
function useListAnchor(activeTabId: string, rows: readonly ChatRow[]): ListAnchor {
  const anchorRef = useRef<ListAnchor>(INITIAL_ANCHOR);
  const tabRef = useRef(activeTabId);
  return useMemo(() => {
    if (tabRef.current !== activeTabId) {
      tabRef.current = activeTabId;
      anchorRef.current = INITIAL_ANCHOR;
    }
    anchorRef.current = nextListAnchor(anchorRef.current, rows, rowKey);
    return anchorRef.current;
  }, [activeTabId, rows]);
}

// Margen sobre la animación CSS (`--mg-dur-base`) antes de quitar la clase de entrada.
const ENTER_CLEAR_MS = MOTION_S.base * 1000 + 40;
const NO_KEYS: ReadonlySet<string> = new Set();

// Claves de las filas que acaban de llegar al final EN VIVO. El primer pintado de una pestaña (o de una
// generación del ancla) fija la referencia y nunca anima; la hidratación y el scroll de la lista virtual
// tampoco pasan por aquí. Se calcula antes de pintar (layout effect) para que no haya un fotograma visible.
function useEnteringRowKeys(resetKey: string, rows: readonly ChatRow[]): ReadonlySet<string> {
  const [entering, setEntering] = useState<ReadonlySet<string>>(NO_KEYS);
  const prevRef = useRef<{ readonly length: number; readonly lastKey: string | null }>({ length: 0, lastKey: null });
  const resetRef = useRef(resetKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keys = useMemo(() => rows.map(rowKey), [rows]);
  useLayoutEffect(() => {
    const reset = resetRef.current !== resetKey;
    resetRef.current = resetKey;
    const added = reset ? [] : appendedTailKeys(prevRef.current, keys);
    prevRef.current = { length: keys.length, lastKey: keys[keys.length - 1] ?? null };
    if (added.length === 0) return;
    setEntering((prev) => new Set([...prev, ...added]));
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setEntering(NO_KEYS), ENTER_CLEAR_MS);
  }, [keys, resetKey]);
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);
  return entering;
}

// Seguir el final: `followOutput` ve filas nuevas, pero el texto en streaming crece DENTRO de la ultima
// fila; ese caso (y enviar un mensaje, que vuelve al final aunque se hubiera subido a leer) se resuelve aqui.
function useChatAutoScroll({ tailSize, turnLive, resetKey }: { readonly tailSize: number; readonly turnLive: boolean; readonly resetKey: string }): {
  readonly virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  readonly onAtBottomChange: (atBottom: boolean) => void;
  readonly repinIfStuck: () => void;
} {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const stuckRef = useRef(true);
  const onAtBottomChange = useCallback((atBottom: boolean): void => {
    stuckRef.current = atBottom;
  }, []);
  const repinIfStuck = useCallback((): void => { if (stuckRef.current) scrollToLastRow(virtuosoRef.current); }, []);
  useLayoutEffect(() => {
    if (stuckRef.current) scrollToLastRow(virtuosoRef.current);
  }, [tailSize, turnLive]);
  useLayoutEffect(() => {
    stuckRef.current = true;
    scrollToLastRow(virtuosoRef.current);
  }, [resetKey]);
  return { virtuosoRef, onAtBottomChange, repinIfStuck };
}

function scrollToLastRow(handle: VirtuosoHandle | null): void {
  handle?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
}

// Estado «desplegado» de los plegados del hilo. Con la lista virtual una fila sale del DOM al alejarse, asi
// que ese estado no puede vivir en el componente: vive aqui, por pestaña y clave de fila.
interface ExpandedRows {
  isExpanded(key: string): boolean;
  setExpanded(key: string, value: boolean): void;
}

const ExpandedRowsContext = createContext<ExpandedRows | null>(null);

function useExpandedRows(): ExpandedRows {
  const value = useContext(ExpandedRowsContext);
  if (value === null) throw new Error('useExpandedRows se uso fuera de ExpandedRowsContext.Provider');
  return value;
}

function useExpandedRowsStore(tabId: string): ExpandedRows {
  const expandedRef = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  // `version` fuerza un valor nuevo del contexto para que los plegados se repinten al cambiar el conjunto.
  return useMemo<ExpandedRows>(() => {
    const scoped = (key: string): string => `${tabId}\u0000${key}`;
    return {
      isExpanded: (key) => expandedRef.current.has(scoped(key)),
      setExpanded: (key, value) => {
        if (expandedRef.current.has(scoped(key)) === value) return;
        if (value) expandedRef.current.add(scoped(key));
        else expandedRef.current.delete(scoped(key));
        setVersion((v) => v + 1);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` es el disparador del repintado
  }, [tabId, version]);
}

// Aviso de una pestaña restaurada cuya conversación no existe en su cuenta (devolución 19). El primer turno abre una nueva.
function missingConversationText(t: Translate, provider: string): string {
  return t('chat.load.missing', { provider: provider === AGY_PROVIDER_ID ? 'agy' : 'Codex' });
}

// Tamaño del contenido de la ULTIMA fila del hilo (caracteres). Cambia con cada delta de streaming ->
// sirve como dependencia del auto-scroll. Un permiso, un artifact o una linea de fallo no crecen: cambian
// de identidad, y eso ya cambia `rows`.
function tailContentSize(rows: readonly ChatRow[]): number {
  const last = rows[rows.length - 1];
  if (last === undefined || last.kind !== 'block') return 0;
  const block = last.block;
  if (block.kind === 'agent') return block.runs.reduce((total, run) => total + run.text.length, 0);
  if (block.kind === 'user' || block.kind === 'system' || block.kind === 'command-output') return block.text.length;
  if (block.kind === 'error') return block.message.length;
  return 0;
}

// Texto para la region aria-live segun el estado del turno de la pestana activa.
function statusAnnouncement(t: Translate, status: string): string {
  switch (status) {
    case 'streaming':
      return t('chat.status.streaming');
    case 'needs_permission':
      return t('chat.status.needsPermission');
    case 'error':
      return t('chat.status.error');
    default:
      return t('chat.status.done');
  }
}

// Reconstruye los bloques de una conversacion REANUDADA (M2.5b) desde su transcripcion, para que no
// arranque con el panel vacio. Reutiliza la transcripcion que el Inspector ya carga en el
// transcriptStore. Conservador: solo hidrata cuando (a) la lectura ha terminado (isFinal) y trae
// entradas, (b) la pestana activa aun no tiene bloques, y (c) la transcripcion cargada es la de ESA
// sesion (no la de un subagente ni una apertura vieja). hydrateBlocks vuelve a comprobar (b) y es
// idempotente, asi que un envio del usuario a mitad no se pisa.
function useHydrateFromTranscript(): void {
  const activeTabId = usePaneTabId();
  const sessionId = useWorkbenchStore((s) => {
    const tab = s.tabs.find((t) => t.id === activeTabId);
    return tab === undefined ? undefined : conversationIdOfTab(tab, s.sessionIdByChat[activeTabId]);
  });
  const hydrateBlocks = useWorkbenchStore((s) => s.hydrateBlocks);
  // 4.1/4.3: el store de la pestaña de ESTE panel. Con el store global, en un split el panel no
  // enfocado leia `lastParams.sessionId` del enfocado, nunca coincidia con el suyo y no hidrataba.
  const useTranscriptStore = usePaneTranscriptStore();
  const entries = useTranscriptStore((s) => s.entries);
  const isFinal = useTranscriptStore((s) => s.isFinal);
  const loadedSessionId = useTranscriptStore((s) => s.lastParams?.sessionId);
  const loadedAgentId = useTranscriptStore((s) => s.lastParams?.agentId);
  // Los pensamientos que guarda Mage (el CLI los persiste vacios). Si aun no han llegado, la
  // hidratacion vuelve a correr cuando lleguen: `hydrateBlocks` es idempotente.
  const thinkingTexts = useThinkingStore((s) => (sessionId === undefined ? EMPTY_THINKING : (s.textsBySession[sessionId] ?? EMPTY_THINKING)));

  useEffect(() => {
    // Ya NO se exige que el chat este vacio (B6): si el usuario se adelanto a escribir, el historial
    // se antepone a su mensaje en vez de perderse. `hydrateBlocks` sigue siendo idempotente, asi que
    // volver a entrar aqui no duplica nada.
    if (!isFinal || entries.length === 0) return;
    if (activeTabId.length === 0 || sessionId === undefined) return;
    // La transcripcion cargada debe ser la de la sesion de la pestana activa (y no la de un subagente).
    if (loadedAgentId !== undefined || loadedSessionId !== sessionId) return;
    hydrateBlocks(activeTabId, transcriptToBlocks(entries, thinkingTexts));
  }, [isFinal, entries, thinkingTexts, activeTabId, sessionId, loadedSessionId, loadedAgentId, hydrateBlocks]);
}

// Estrella de cuatro puntas de la marca, parametrizada por centro y radio. La "cintura" sale MEDIDA
// del arte de origen y vive en `brandMark.ts`: con otra proporcion deja de ser la misma forma que la
// del icono, que es justo lo que hace que la constelacion se lea como marca y no como adorno.

function sparklePath(cx: number, cy: number, r: number): string {
  const w = r * SPARKLE_WAIST_RATIO;
  return `M${cx} ${cy - r} L${cx + w} ${cy - w} L${cx + r} ${cy} L${cx + w} ${cy + w} L${cx} ${cy + r} L${cx - w} ${cy + w} L${cx - r} ${cy} L${cx - w} ${cy - w}Z`;
}

// Constelacion del estado vacio, en el viewBox de 80x80 del simbolo. Posiciones y desfases FIJOS a
// proposito: un patron estable se reconoce como marca, uno aleatorio se lee como ruido.
const EMPTY_SPARKLES = [
  { cx: 38, cy: 33, r: 16, delayS: 0 },
  { cx: 60, cy: 53, r: 8.5, delayS: 0.5 },
  { cx: 20, cy: 51, r: 6, delayS: 1 },
  { cx: 58, cy: 19, r: 4.5, delayS: 1.5 },
  { cx: 25, cy: 21, r: 3.5, delayS: 2 },
] as const;

// Caja de las dos pantallas vacias. `min-h-0` + scroll propio: con el `min-height: auto` de flex no
// encogia por debajo de su contenido y, cuando la barra del prompt crecia (el aviso de coste pasando a dos
// lineas), la columna desbordaba y empujaba la fila de controles hacia abajo (medido: 5,5 px). `safe
// center` para que, si no cabe, se corte por abajo y se pueda desplazar, no por arriba.
const EMPTY_STATE_CLASS = 'flex min-h-0 flex-1 flex-col items-center gap-[20px] overflow-y-auto text-center [justify-content:safe_center]';

// Constelacion de chispas: la MISMA estrella de cuatro puntas del simbolo de marca
// (resources/brand/symbol.svg), en cinco tamanos que titilan desfasados. Monocromo via currentColor
// (hereda el color del contenedor), asi conmuta con el tema. La comparten las dos pantallas vacias.
function BrandConstellation(): React.JSX.Element {
  return (
    <div aria-hidden="true" className="h-[80px] w-[80px] text-mg-sec">
      <svg width="80" height="80" viewBox="0 0 80 80" fill="currentColor">
        {EMPTY_SPARKLES.map((sparkle) => (
          <path
            key={`${sparkle.cx}-${sparkle.cy}`}
            className="mg-sparkle"
            style={{ '--mg-twinkle-delay': `${sparkle.delayS}s` } as React.CSSProperties}
            d={sparklePath(sparkle.cx, sparkle.cy, sparkle.r)}
          />
        ))}
      </svg>
    </div>
  );
}

// Estado de lectura de una conversacion reabierta (#48): nunca una superficie muda mientras carga o si falla.
function ConversationLoadState({ text, loading = false }: { readonly text: string; readonly loading?: boolean }): React.JSX.Element {
  return (
    <div role="status" className="flex flex-1 items-center justify-center gap-2 p-[16px_22px] text-center text-mg-muted">
      {loading && (
        <span aria-hidden="true" className="animate-spin motion-reduce:animate-none">
          <Icon name="refresh" size={16} />
        </span>
      )}
      {text}
    </div>
  );
}

// Estado vacio de una conversacion ya abierta (M2.6): una constelacion de chispas de la marca que
// titilan. Monocromo, y con prefers-reduced-motion pierde la escala y se queda en el latido de
// opacidad. Reemplaza el texto plano "Sin mensajes todavia en este chat.".
function EmptyConversation(): React.JSX.Element {
  const activeTabId = usePaneTabId();
  // Proveedor sin puente de permisos (E3, `agy`): en su pestana la pista "Shift+Tab modo" no aplica
  // (no hay modo de permiso que ciclar) y lo que hay que decir es que edita sin preguntar.
  const autoApproved = useWorkbenchStore((s) => {
    const provider = s.tabs.find((t) => t.id === activeTabId)?.provider;
    return provider !== undefined && isAutoApprovedProvider(provider);
  });
  const t = useT();
  return (
    <div className={EMPTY_STATE_CLASS}>
      <BrandConstellation />
      <div className="flex flex-col items-center gap-[12px]">
        <div className="text-[13px] font-medium text-mg-text">{t('chat.empty.title')}</div>
        <WorkingFolder />
        {autoApproved ? (
          <AgyStartNotice />
        ) : (
          <div className="flex items-center gap-[7px] text-[10.5px] text-mg-muted">
            <Kbd>/</Kbd>
            <span>{t('chat.empty.hintCommands')}</span>
            <span className="opacity-50">·</span>
            <Kbd>Shift+Tab</Kbd>
            <span>{t('chat.empty.hintMode')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Aviso de agy al empezar la conversacion, con la entrada a sus comandos permitidos (grupo E, fase 2):
// es AQUI donde se conceden, porque agy lee sus reglas al lanzar.
function AgyStartNotice(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const count = useWorkbenchStore((s) => s.settings.agyCommandRules.allow.length);
  const t = useT();
  return (
    <div className="flex max-w-[420px] flex-col items-start gap-[6px] rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[7px_10px] text-left text-[10.5px] text-mg-warn-text">
      <div role="status" className="flex items-start gap-[8px]">
        <Icon name="warning" />
        <span>{t('prompt.providers.noPermissionControl')}</span>
      </div>
      <button
        onClick={() => setOpen(true)}
        data-agy-commands-open="true"
        className="ml-[22px] rounded-[6px] border border-mg-warn-border px-[8px] py-[2px] text-[10.5px] font-semibold hover:bg-mg-hover"
      >
        {t('chat.agyNotice.allowedCommands', { count })}
      </button>
      {/* Al body: el estado vacio puede ir dentro de un panel con transform, que romperia el `fixed`. */}
      {createPortal(<AnimatePresence>{open && <AgyCommandsDialog key="agy-commands" onClose={() => setOpen(false)} />}</AnimatePresence>, document.body)}
    </div>
  );
}

// Carpeta de trabajo de la conversacion, con afordancia para cambiarla (F2). Hasta ahora el cwd real
// solo se podia elegir en el dialogo avanzado de la TabBar al crear la pestaña, asi que en una
// conversacion recien abierta no habia ni forma de SABER en que carpeta iba a trabajar el agente.
//
// El boton se deshabilita (con el motivo en el tooltip) cuando cambiarlo ya no es seguro: la regla la
// decide canChangeCwd, el mismo modulo puro que guarda la accion del store.
// P-028, 16: el boton pasa a ser el primario «Elegir proyecto…», con la ruta debajo y, mientras la
// carpeta se pueda cambiar, las tarjetas de proyectos recientes. Todo actua sobre la pestaña de ESTE
// panel (con el workspace dividido no es por fuerza la activa).
function WorkingFolder(): React.JSX.Element | null {
  const activeTabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === activeTabId));
  const hasLiveSession = useWorkbenchStore((s) => s.sessionIdByChat[activeTabId] !== undefined);
  const setActiveCwd = useWorkbenchStore((s) => s.setActiveCwd);

  if (activeTabId.length === 0 || tab === undefined) return null;
  const verdict = canChangeCwd({ hasLiveSession, hasResumeTarget: tab.resumeSessionId !== undefined });
  return (
    <ProjectPicker cwd={tab.cwd} allowed={verdict.allowed} reason={verdict.allowed ? undefined : verdict.reason} onPick={(cwd) => setActiveCwd(cwd, activeTabId)} />
  );
}

// Lo visual de elegir proyecto (Grupo A, 0.1.2): el primario «Elegir proyecto…», la ruta actual (si la
// hay) y, mientras se pueda elegir, las tarjetas de recientes. QUE se hace con la carpeta lo decide quien
// lo usa: la conversacion vacia cambia su cwd; la pantalla sin pestañas crea una conversacion en ella.
function ProjectPicker({
  cwd,
  allowed,
  reason,
  onPick,
}: {
  readonly cwd?: string;
  readonly allowed: boolean;
  readonly reason?: string;
  readonly onPick: (cwd: string) => void;
}): React.JSX.Element {
  const t = useT();
  const pickFolder = (): void => {
    void window.mage
      .pickDirectory()
      .then((picked) => {
        if (picked === null) return; // el usuario cancelo el dialogo del SO
        onPick(picked);
      })
      .catch((err: unknown) => reportActionError(t('chat.project.pickFailed'), err, 'chat'));
  };

  return (
    <div className="flex w-full flex-col items-center gap-[16px]">
      <div className="flex max-w-[420px] flex-col items-center gap-[6px]">
        <button
          onClick={pickFolder}
          disabled={!allowed}
          data-tip={allowed ? t('chat.project.pickTip') : reason}
          aria-label={t('chat.project.pickAria')}
          className="flex items-center gap-[7px] rounded-[8px] bg-mg-primary px-[16px] py-[8px] text-[12px] font-semibold text-mg-primary-ink disabled:cursor-default disabled:opacity-40"
        >
          <Icon name="folderOpen" />
          {t('chat.project.pick')}
        </button>
        {/* La ruta completa en el title: lo que se pinta va acortado para no romper el centrado. */}
        {cwd !== undefined && (
          <span data-working-folder="true" className="flex max-w-full items-center gap-[6px] text-[10.5px] text-mg-muted" title={cwd}>
            <Icon name="folder" />
            <span className="truncate font-mono text-mg-sec">{shortenPath(cwd)}</span>
          </span>
        )}
      </div>
      {allowed && <RecentProjects currentCwd={cwd ?? ''} onPick={onPick} />}
    </div>
  );
}

// Chip de tecla para las pistas del estado vacio (M2.6).
function Kbd({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex h-[18px] items-center justify-center rounded-[5px] border border-mg-border-emph bg-mg-track px-[6px] font-mono text-[10px] text-mg-sec">
      {children}
    </span>
  );
}

// Estado sin ninguna conversacion abierta (Grupo A, 0.1.2): la MISMA pantalla que la de un chat nuevo
// —constelacion y selector de proyecto—, pero elegir un proyecto CREA la conversacion en esa carpeta.
// Debajo, los dos botones de siempre para quien no quiera elegir: esos crean SIEMPRE en una carpeta
// temporal, diga lo que diga el ajuste «carpeta de los chats nuevos». La cuenta es la activa del rail.
function NoConversationState(): React.JSX.Element {
  const t = useT();
  const createConversation = useWorkbenchStore((s) => s.createConversation);
  const hasAccount = useWorkbenchStore((s) => s.activeAccountId.length > 0);
  return (
    <div data-no-conversation="true" className={EMPTY_STATE_CLASS}>
      <BrandConstellation />
      <div className="flex w-full flex-col items-center gap-[12px]">
        <div className="text-[13px] font-medium text-mg-text">{t('chat.noConversation.title')}</div>
        <ProjectPicker allowed={hasAccount} reason={t('chat.noConversation.noAccount')} onPick={(cwd) => void createConversation('shared', { cwd })} />
        <div className="flex gap-[10px]">
          <button
            onClick={() => void createConversation('shared', { scratch: true })}
            disabled={!hasAccount}
            className="rounded-[8px] border border-mg-border-emph px-[16px] py-[9px] text-[12px] text-mg-body2 hover:bg-mg-hover disabled:opacity-40"
          >
            {t('chat.noConversation.newChat')}
          </button>
          <button
            onClick={() => void createConversation('private', { scratch: true })}
            disabled={!hasAccount}
            className="rounded-[8px] border border-mg-border-emph px-[16px] py-[9px] text-[12px] text-mg-body2 hover:bg-mg-hover disabled:opacity-40"
          >
            <Icon name="lock" size={12} /> {t('chat.noConversation.newPrivateChat')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Indicador de actividad mientras el agente trabaja sin emitir texto todavia (M2.6): palabra
// cambiante + tiempo transcurrido del turno + aviso si el motor lleva rato sin dar señales (posible
// cuelgue). Tictac local cada segundo; los tiempos base vienen del store (inicio/ultima actividad).
function ThinkingIndicator({
  accent,
  tool,
  capability,
  steps,
  errors,
}: {
  readonly accent: string;
  readonly tool: string | null;
  readonly capability: TurnCapability | null;
  readonly steps: number;
  readonly errors: number;
}): React.JSX.Element {
  const paneTabId = usePaneTabId();
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  const turnStart = useWorkbenchStore((s) => s.turnStartByChat[paneTabId]);
  const lastActivity = useWorkbenchStore((s) => s.lastActivityByChat[paneTabId]);
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const status = computeThinkingStatus(now - (turnStart ?? now), now - (lastActivity ?? now), turnStart ?? 0);
  // Con una tool en curso se dice QUE esta haciendo; si no, el verbo del turno (uno fijo, como el CLI).
  const label = tool === null ? status.label : t('chat.thinking.runningTool', { tool });
  // Es un BOTON (P-026 3.4): lleva al panel de Actividad, donde esta cada paso de este turno.
  return (
    <button
      onClick={() => openActivity(paneTabId, null)}
      data-turn-status="true"
      aria-label={t('chat.thinking.aria', { label, steps, errors })}
      className="flex w-fit items-center gap-[9px] rounded-[7px] px-[4px] py-[2px] text-left text-[12px] text-mg-ter hover:bg-mg-hover hover:text-mg-body2"
    >
      <span className="h-[7px] w-[7px] flex-none rounded-full mg-pulse" style={{ background: accent }} />
      <span>{label}…</span>
      <span className="text-[10.5px] text-mg-muted">· {t('chat.thinking.steps', { count: steps })}</span>
      <span className="font-mono text-[10.5px] text-mg-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
        · {status.elapsedText}
      </span>
      {capability !== null && <TurnCapabilityChip capability={capability} />}
      {errors > 0 && <span className="text-[10.5px] font-semibold text-mg-danger">· {t('chat.thinking.errors', { count: errors })}</span>}
      {status.stalled && (
        <span className="text-[10.5px] text-mg-warn-text">· {t('chat.thinking.stalled', { since: status.sinceActivityText })}</span>
      )}
      <span aria-hidden="true" className="text-mg-muted">›</span>
    </button>
  );
}

// Skill o servidor MCP que usa el turno, como chip junto a los pasos (#42).
function TurnCapabilityChip({ capability }: { readonly capability: TurnCapability }): React.JSX.Element {
  const t = useT();
  const text = capability.kind === 'skill' ? t('chat.thinking.skill', { name: capability.name }) : t('chat.thinking.mcp', { server: capability.server, tool: capability.tool });
  return (
    <span data-turn-capability={capability.kind} className="rounded-[4px] border border-mg-border-ctrl px-[5px] text-[10px] text-mg-sec">
      {text}
    </span>
  );
}

const EMPTY: readonly Block[] = [];

function rowKey(row: ChatRow): string {
  return row.kind === 'subagents' ? row.id : row.block.id;
}

// Una fila del hilo (P-026 3.4): un bloque, la linea de una herramienta que fallo (D22) o la de los
// subagentes de un turno (D21). Las dos lineas llevan al panel de Actividad.
function ChatRowView({ row, accent }: { readonly row: ChatRow; readonly accent: string }): React.JSX.Element {
  if (row.kind === 'block') return <BlockView block={row.block} accent={accent} repeat={row.repeat ?? 1} />;
  if (row.kind === 'tool-failed') return <ToolFailedLine block={row.block} />;
  return <SubagentsLine blocks={row.blocks} />;
}

function ToolFailedLine({ block }: { readonly block: Extract<Block, { kind: 'tool' }> }): React.JSX.Element {
  const paneTabId = usePaneTabId();
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  const t = useT();
  return (
    <div className="shrink-0" data-block="tool-failed">
      <button
        onClick={() => openActivity(paneTabId, null)}
        className="flex items-center gap-[6px] rounded-[7px] px-[4px] py-[2px] text-[11.5px] text-mg-danger hover:bg-mg-hover"
      >
        <Icon name="warning" size={12} /> {t('chat.toolFailed.line', { tool: block.tool })}
      </button>
    </div>
  );
}

// «Lanzó 4 subagentes» mientras trabajan; «4 terminados · 2 m 31 s» al acabar todos (el tiempo del mas
// lento: van en paralelo), con los que fallaron en rojo.
function SubagentsLine({ blocks }: { readonly blocks: readonly Extract<Block, { kind: 'subagent' }>[] }): React.JSX.Element {
  const paneTabId = usePaneTabId();
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  const running = blocks.some(isSubagentRunning);
  const failed = blocks.filter((b) => b.status === 'error').length;
  const slowest = Math.max(0, ...blocks.map((b) => b.elapsedMs ?? 0));
  const t = useT();
  const text = subagentsLineText(t, { running, count: blocks.length, slowest });
  return (
    <div className="shrink-0" data-block="subagents">
      <button
        onClick={() => openActivity(paneTabId, null)}
        className="flex items-center gap-[7px] rounded-[7px] px-[4px] py-[2px] text-[11.5px] text-mg-ter hover:bg-mg-hover hover:text-mg-body2"
      >
        <span aria-hidden="true">⇲</span>
        <span>{text}</span>
        {failed > 0 && <span className="font-semibold text-mg-danger">· {t('chat.subagents.failed', { count: failed })}</span>}
      </button>
    </div>
  );
}

function subagentsLineText(t: Translate, line: { readonly running: boolean; readonly count: number; readonly slowest: number }): string {
  if (line.running) return t('chat.subagents.launched', { count: line.count });
  if (line.slowest > 0) return t('chat.subagents.doneElapsed', { count: line.count, elapsed: formatElapsed(line.slowest) });
  return t('chat.subagents.done', { count: line.count });
}

// `memo` NO es decorativo aqui, es LA optimizacion del streaming (P2). Cada delta produce un array
// `blocks` nuevo, pero `appendDelta` conserva la IDENTIDAD de los bloques que no toca: sin memo,
// un delta repinta el hilo entero (con 60 bloques y ~30 deltas/s son miles de renders por segundo);
// con memo, solo se repinta el bloque que esta creciendo. `accent` es un string, asi que la
// comparacion por defecto de memo basta — no hace falta comparador propio.
// Envoltorio de CADA bloque del hilo. El `shrink-0` es el arreglo de un bug medido (2.6): el
// contenedor es `flex-col` y un item flexible con `overflow-hidden` —lo que es `ToolBlock`— recibe
// minimo automatico 0, asi que en cuanto la conversacion desborda el alto disponible el navegador lo
// encoge hasta 2 px: cajas de herramienta convertidas en rayas. Va aqui y NO en `ToolBlock` para que
// quede inmune a que mañana otro bloque estrene `overflow-hidden`.
//
// `data-block` es el ancla del harness (`pnpm verify:gui`): sin el, medir "los hijos del contenedor
// scrollable" incluye la region aria-live de 1 px y da un falso negativo.
const BlockView = memo(function BlockView({ block, accent, repeat = 1 }: { readonly block: Block; readonly accent: string; readonly repeat?: number }): React.JSX.Element {
  return (
    <div className="shrink-0" data-block={block.kind}>
      <BlockBody block={block} accent={accent} repeat={repeat} />
    </div>
  );
});

function BlockBody({ block, accent, repeat }: { readonly block: Block; readonly accent: string; readonly repeat: number }): React.JSX.Element | null {
  if (block.kind === 'user') return <UserBlock block={block} />;
  if (block.kind === 'agent') return <AgentBlock block={block} accent={accent} />;
  if (block.kind === 'tool') return <ToolBlock block={block} />;
  if (block.kind === 'error') return <ErrorBlock block={block} repeat={repeat} />;
  if (block.kind === 'system') return <SystemBlock block={block} />;
  if (block.kind === 'command-output') return <CommandOutputBlock block={block} />;
  if (block.kind === 'permission') return <PermissionCard block={block} />;
  // Pensamiento, subagentes y preguntas no llegan aqui: `chatRows` los manda al panel de Actividad o al
  // dock de preguntas (P-026 3.3/3.4).
  return null;
}

// Marcador de sistema (M2.4): linea tenue centrada (p.ej. "🗜 Contexto compactado (manual)").
function SystemBlock({ block }: { readonly block: Extract<Block, { kind: 'system' }> }): React.JSX.Element {
  return <SystemLine text={block.text} {...(block.tip === undefined ? {} : { tip: block.tip })} />;
}

// `tip`: texto secundario en el tooltip (P-028, 20: el aviso del CLI tras la linea de limite de Mage).
// #14: el texto encoge y parte por donde haga falta (rutas sin espacios incluidas) y se lee entero; las
// rayas conservan un minimo para que siga pareciendo una linea de sistema.
function SystemLine({ text, tip }: { readonly text: string; readonly tip?: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-[10px] px-[4px] text-[10.5px] text-mg-muted">
      <span className="h-px min-w-[16px] flex-1 bg-mg-border-subtle" />
      <span className="min-w-0 text-center [overflow-wrap:anywhere]" {...(tip === undefined ? {} : { 'data-tip': tip })}>
        {text}
      </span>
      <span className="h-px min-w-[16px] flex-1 bg-mg-border-subtle" />
    </div>
  );
}

// Salida de un comando local (P-028): una linea es la linea de sistema de siempre («Session renamed
// to: X»); varias van en tarjeta con el comando en la cabecera, plegada si es larga.
const COMMAND_OUTPUT_MAX_HEIGHT_PX = 320;

function CommandOutputBlock({ block }: { readonly block: Extract<Block, { kind: 'command-output' }> }): React.JSX.Element {
  const layout = useMemo(() => commandOutputLayout(block.text), [block.text]);
  const t = useT();
  if (layout === 'line') return <div data-command-output="line"><SystemLine text={block.text} /></div>;
  return (
    <div data-command-output={layout} className="min-w-0 rounded-[9px] border border-mg-border-subtle bg-mg-block p-[8px_12px] text-[12px]">
      {block.command !== null && <div className="mb-[6px] font-mono text-[11px] text-mg-sec">/{block.command}</div>}
      <Collapsible stateKey={block.id} maxHeightPx={COMMAND_OUTPUT_MAX_HEIGHT_PX} expandLabel={t('chat.collapsible.showFullResult')}>
        {layout === 'markdown' ? (
          <div className="min-w-0 text-mg-text">
            <Markdown text={block.text} />
          </div>
        ) : (
          <pre className="overflow-x-auto whitespace-pre font-mono text-[11.5px] leading-[1.5] text-mg-text">{block.text}</pre>
        )}
      </Collapsible>
    </div>
  );
}

// Tarjeta de error (Q-U3): la causa tal cual la dio el motor, `×N` si el mismo fallo llego N veces seguidas,
// como mucho UNA accion propia (la de agy, si el error la tiene) y «Ver en Logs».
function ErrorBlock({ block, repeat }: { readonly block: Extract<Block, { kind: 'error' }>; readonly repeat: number }): React.JSX.Element {
  const t = useT();
  const revealPanel = usePanelLayoutStore((s) => s.revealPanelById);
  return (
    <div
      role="alert"
      data-error-card="true"
      className="rounded-[9px] border border-mg-danger-border bg-mg-danger-bg p-[10px_14px] text-[12px] leading-[1.55] text-mg-danger"
    >
      <div className="text-[11px] font-semibold">
        {t('chat.error.title')}
        {repeat > 1 && <span data-error-repeat={repeat}> {t('chat.error.repeat', { count: repeat })}</span>}
      </div>
      <div>{block.message}</div>
      <div className="mt-[6px] flex flex-wrap items-center gap-[10px]">
        {block.deniedCommand !== undefined && <AllowDeniedCommand command={block.deniedCommand} />}
        <button
          onClick={() => revealPanel('logs')}
          data-error-open-logs="true"
          className="text-[11px] underline-offset-2 hover:underline"
        >
          {t('chat.error.openLogs')}
        </button>
      </div>
    </div>
  );
}

// Comando (o herramienta MCP, fase 3: `mcp(<srv>/<tool>)`) que agy denego: permitirlo vale para la
// conversacion siguiente (agy lee sus reglas al lanzar).
function AllowDeniedCommand({ command }: { readonly command: string }): React.JSX.Element | null {
  const allowed = useWorkbenchStore((s) => s.settings.agyCommandRules.allow.includes(command));
  const setVerdict = useWorkbenchStore((s) => s.setAgyCommandVerdict);
  const t = useT();
  if (!isValidAgyRule(command)) return null;
  const isTool = parseAgyMcpRule(command) !== null;
  if (allowed) {
    return (
      <div data-agy-command-allowed="true" className="text-[11px] text-mg-sec">
        {t('chat.agyDenied.allowed')}
      </div>
    );
  }
  return (
    <button
      onClick={() => setVerdict(command, 'allow')}
      data-agy-allow-command="true"
      className="block rounded-[6px] border border-mg-danger-border px-[8px] py-[2px] text-[11px] font-semibold hover:bg-mg-hover"
    >
      {isTool ? t('chat.agyDenied.allowTool') : t('chat.agyDenied.allowCommand')}
    </button>
  );
}

// Mensaje del USUARIO (A4): burbuja alineada a la DERECHA, mas estrecha, con fondo/borde propios. La
// asimetria (lado + ancho + color) es lo que hace la conversacion legible de un vistazo frente a la
// burbuja del agente, que va a la izquierda.
// Un prompt largo (un pegote de log, un fichero entero) se PLIEGA a una altura maxima con un boton de
// desplegar: si no, un solo mensaje del usuario empuja toda la respuesta fuera de la pantalla.
function UserBlock({ block }: { readonly block: Extract<Block, { kind: 'user' }> }): React.JSX.Element {
  // Envoltorios de sistema que el CLI guarda como mensaje del usuario (P-026, D20): un comando local
  // (`/rename X`) es un chip, y una tarea programada una tarjeta con el cuerpo plegado, en vez de la
  // burbuja con el XML crudo. Los avisos que no se pintan ya los quito `transcriptToBlocks`.
  const wrapper = useMemo(() => classifySystemWrapper(block.text), [block.text]);
  const t = useT();
  const tabId = usePaneTabId();
  const offersRewind = useRewindOffer(tabId, block.nativeId);
  const [rewindAction, setRewindAction] = useState<RewindAction | null>(null);
  if (wrapper.kind === 'command' && block.attachments.length === 0) return <CommandChip command={wrapper.command} />;
  // En directo el comando llega tal cual se tecleo (P-028): mismo chip que al reabrir.
  if (block.attachments.length === 0 && isSlashCommandText(block.text)) return <CommandChip command={block.text.trim()} />;
  if (wrapper.kind === 'scheduled-task') return <ScheduledTaskCard id={block.id} name={wrapper.name} body={wrapper.body} />;
  return (
    <div className="flex justify-end">
      <div className="group relative flex max-w-[80%] min-w-0 flex-col gap-[3px] rounded-[12px] rounded-br-[4px] border border-mg-border-emph bg-mg-sel p-[9px_13px] text-mg-sel-ink leading-[1.55]">
        <div className="absolute right-[4px] top-[-10px] z-[1] flex items-center gap-[2px] opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton text={block.text} label={t('chat.copy.userMessage')} className="border border-mg-border-subtle bg-mg-block" />
          {offersRewind && <BubbleActions onPick={setRewindAction} />}
        </div>
        {rewindAction !== null && <RewindDialog tabId={tabId} blockId={block.id} action={rewindAction} onClose={() => setRewindAction(null)} />}
        {/* Sin cabecera "TU" y SIN HORA (buzon del usuario, punto 1): el lado, el ancho y el fondo ya
            dicen de quien es la burbuja, y una hora por mensaje es ruido en una conversacion que se lee
            de arriba abajo — esto no es una app de mensajeria. `block.time` se conserva en el modelo:
            solo deja de pintarse aqui. */}
        {/* H2: el mensaje del usuario tambien es Markdown (decision del usuario, 2026-09-09). Se
            pintaba en plano con `whitespace-pre-wrap`, asi que un `**negrita**` o un bloque de codigo
            enviados se veian en crudo en la burbuja (reporte del usuario). Mismo render que el del
            agente — y `Markdown` conserva los saltos de linea dentro del parrafo, que era lo unico
            que aportaba el texto plano. */}
        <Collapsible stateKey={block.id} maxHeightPx={USER_MESSAGE_MAX_HEIGHT_PX} expandLabel={t('chat.collapsible.showFullMessage')}>
          <div className="min-w-0 break-words text-mg-text">
            <Markdown text={block.text} />
          </div>
        </Collapsible>
        {block.attachments.length > 0 && <UserAttachments attachments={block.attachments} />}
      </div>
    </div>
  );
}

// ¿Ofrece esta burbuja Reintentar, Divergir y Rebobinar? Solo si su pestaña lo admite (ver `canOfferRewind`). Las
// burbujas que son envoltorios (chip de comando, tarea programada) salen antes de llegar a pintar los botones.
function useRewindOffer(tabId: string, nativeId: string | null): boolean {
  return useWorkbenchStore((s) => {
    const tab = s.tabs.find((candidate) => candidate.id === tabId);
    if (tab === undefined) return false;
    const lock = s.lockByChat[tabId];
    return canOfferRewind({
      provider: tab.provider,
      hasLiveSession: s.sessionIdByChat[tabId] !== undefined,
      readOnly: lock !== undefined && !lock.owner,
      isWrapper: false,
      nativeIdKnown: typeof nativeId === 'string',
    });
  });
}

// Los tres botones de icono de la burbuja, con el mismo aspecto que «Copiar». No hay icono de deshacer en el
// set de Mage: Rebobinar usa la flecha hacia arriba (lo anterior queda arriba).
function BubbleActions({ onPick }: { readonly onPick: (action: RewindAction) => void }): React.JSX.Element {
  const t = useT();
  return (
    <>
      <BubbleButton icon="refresh" label={t('chat.retry.action')} dataAttr="data-bubble-retry" onClick={() => onPick('retry')} />
      <BubbleButton icon="branch" label={t('chat.diverge.action')} dataAttr="data-bubble-diverge" onClick={() => onPick('diverge')} />
      <BubbleButton icon="arrowUp" label={t('chat.rewind.action')} dataAttr="data-bubble-rewind" onClick={() => onPick('rewind')} />
    </>
  );
}

function BubbleButton({ icon, label, dataAttr, onClick }: {
  readonly icon: IconName;
  readonly label: string;
  readonly dataAttr: 'data-bubble-retry' | 'data-bubble-diverge' | 'data-bubble-rewind';
  readonly onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      {...{ [dataAttr]: 'true' }}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex cursor-pointer items-center rounded-[5px] border border-mg-border-subtle bg-mg-block p-[4px] text-mg-muted hover:bg-mg-hover hover:text-mg-body2"
    >
      <Icon name={icon} size={12} />
    </button>
  );
}

function CommandChip({ command }: { readonly command: string }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <span
        data-command-chip="true"
        className="max-w-[80%] truncate rounded-full border border-mg-border-subtle bg-mg-block px-[9px] py-[2px] font-mono text-[11px] text-mg-sec"
      >
        {command}
      </span>
    </div>
  );
}

// `<details>` nativo: el cuerpo de una tarea programada es el prompt de la tarea, largo y repetido en
// cada ejecucion, asi que va plegado.
function ScheduledTaskCard({ id, name, body }: { readonly id: string; readonly name: string; readonly body: string }): React.JSX.Element {
  const t = useT();
  const { isExpanded, setExpanded } = useExpandedRows();
  return (
    <div className="flex justify-end">
      <details
        data-scheduled-task="true"
        open={isExpanded(`${id}:task`)}
        onToggle={(event) => setExpanded(`${id}:task`, event.currentTarget.open)}
        className="max-w-[80%] min-w-0 rounded-[9px] border border-mg-border-subtle bg-mg-block p-[6px_11px] text-[11.5px]">
        <summary className="cursor-pointer text-mg-sec">
          {t('chat.scheduledTask.label')} <span className="font-semibold text-mg-text">{name.length > 0 ? name : t('chat.scheduledTask.unnamed')}</span>
        </summary>
        <p className="mt-[6px] text-mg-sec">
          {t('chat.scheduledTask.note')}
        </p>
        <div className="mt-[6px] whitespace-pre-wrap break-words text-mg-muted">{body}</div>
      </details>
    </div>
  );
}

// Imagenes que el usuario mando en el mensaje (2.12.1). Van FUERA del `Collapsible` a proposito: la
// miniatura es lo que identifica el mensaje de un vistazo y recortarla no ahorraria nada.
// `data:` inline: la CSP de Mage declara `img-src 'self' data:` en dev y en produccion (medido), que es
// donde suele aparecer el "funciona en dev y no empaquetado".
function UserAttachments({ attachments }: { readonly attachments: readonly ImageAttachment[] }): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-[6px] pt-[2px]">
      {attachments.map((attachment, index) =>
        attachment.mediaType.startsWith('image/') ? (
          <img
            key={index}
            src={`data:${attachment.mediaType};base64,${attachment.data}`}
            alt={t('chat.user.imageAlt')}
            className="max-h-[220px] max-w-full rounded-[8px]"
          />
        ) : (
          <span key={index} data-attachment-document="true" className="inline-flex items-center gap-[6px] rounded-[8px] border border-mg-border-subtle px-[8px] py-[4px] text-[12px]">
            <Icon name="file" size={14} />
            {t('chat.user.pdfAttachment')}
          </span>
        ),
      )}
    </div>
  );
}

// Altura maxima (px) de un mensaje del usuario plegado. Da para ~9 lineas: suficiente para reconocer el
// prompt sin que un pegote de texto ocupe la pantalla entera.
const USER_MESSAGE_MAX_HEIGHT_PX = 160;

// Contenedor que PLIEGA su contenido a una altura maxima y ofrece «Ver … completo» (`expandLabel`, ya
// traducido) si no cabe. El boton solo aparece cuando de verdad hay contenido recortado (se mide el alto
// real del contenido y se re-mide si cambia el ancho, p.ej. al abrir/cerrar paneles laterales).
function Collapsible({
  stateKey,
  maxHeightPx,
  expandLabel,
  children,
}: {
  readonly stateKey: string;
  readonly maxHeightPx: number;
  readonly expandLabel: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const t = useT();
  const { isExpanded, setExpanded } = useExpandedRows();
  const expanded = isExpanded(stateKey);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Medida del alto real del contenido: con `overflow:hidden`, scrollHeight es el alto sin recortar.
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (element === null) return;
    const measure = (): void => setOverflowing(element.scrollHeight > maxHeightPx + OVERFLOW_TOLERANCE_PX);
    measure();
    // El texto se reflowa al cambiar el ancho disponible -> lo que antes no sobraba puede sobrar.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // Deps SIN `children` (P3): es un elemento React nuevo en cada render, asi que incluirlo
    // desmontaba y remontaba el ResizeObserver —y forzaba un `scrollHeight` en fase de layout— en
    // cada render de cada mensaje del usuario, o sea en cada delta del stream. El propio observer ya
    // cubre el reflujo por cambio de contenido o de ancho, que es justo para lo que esta.
  }, [maxHeightPx]);

  const collapsed = overflowing && !expanded;
  return (
    <>
      <div
        ref={contentRef}
        style={collapsed ? { maxHeight: `${maxHeightPx}px` } : undefined}
        // El degradado inferior (mask) avisa de que hay mas texto debajo sin meter otro borde.
        className={`min-w-0 overflow-hidden ${collapsed ? 'mg-fade-bottom' : ''}`}
      >
        {children}
      </div>
      {overflowing && (
        <button
          onClick={() => setExpanded(stateKey, !expanded)}
          aria-expanded={expanded}
          className="mt-[2px] self-start text-[10.5px] text-mg-icon underline underline-offset-2 hover:text-mg-body"
        >
          {expanded ? t('chat.collapsible.showLess') : expandLabel}
        </button>
      )}
    </>
  );
}

// Holgura (px) al comparar alturas: evita que un redondeo de subpixel marque como recortado un
// contenido que en realidad cabe justo.
const OVERFLOW_TOLERANCE_PX = 4;

// Una herramienta solo llega al hilo si publico un artifact (P-026 3.4): se pinta como tarjeta (2.4).
// El resto de herramientas vive en el panel de Actividad.
function ToolBlock({ block }: { readonly block: Extract<Block, { kind: 'tool' }> }): React.JSX.Element | null {
  const card = artifactCardFrom(block);
  return card === null ? null : <ArtifactCard card={card} />;
}

function AgentBlock({
  block,
  accent,
}: {
  readonly block: Extract<Block, { kind: 'agent' }>;
  readonly accent: string;
}): React.JSX.Element {
  // El texto del agente es Markdown: se une el run unico (siempre es uno, code=false) y se renderiza
  // con el parser propio. El cursor de streaming va al final del ultimo bloque.
  const text = block.runs.map((run) => run.text).join('');
  const t = useT();
  // Mensaje del AGENTE: burbuja alineada a la IZQUIERDA, mas ancha que la del usuario y con fondo/borde
  // propios (el punto lleva el color de la cuenta y late mientras hay streaming). El par
  // izquierda/derecha + los dos fondos distintos es lo que separa visualmente los turnos.
  return (
    <div className="flex justify-start">
      <div className="group relative flex min-w-0 max-w-[92%] gap-[10px] rounded-[12px] rounded-bl-[4px] border border-mg-sel bg-mg-block p-[10px_14px]">
        <CopyButton
          text={text}
          label={t('chat.copy.agentReply')}
          className="absolute right-[4px] top-[-10px] z-[1] border border-mg-border-subtle bg-mg-block opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        />
        <span
          className={`mt-[5px] h-[8px] w-[8px] flex-none rounded-full ${block.streaming ? 'mg-pulse' : ''}`}
          style={{ background: accent }}
        />
        <div className="min-w-0 flex-1 text-mg-body">
          <Markdown text={text} streaming={block.streaming} />
          {block.streaming && (
            <span className="mg-blink ml-[3px] inline-block h-[14px] w-[8px] translate-y-[2px] bg-mg-focus" />
          )}
        </div>
      </div>
    </div>
  );
}
