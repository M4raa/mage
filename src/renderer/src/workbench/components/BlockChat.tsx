import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shortToolCommand } from '../toolSummary';
import { Icon } from './Icon';
import { NO_PERMISSION_CONTROL_WARNING, isAutoApprovedProvider } from '@shared/providers';
import { useWorkbenchStore } from '../workbenchStore';
import { SPARKLE_WAIST_RATIO } from '../brandMark';
import { useThinkingStore } from '../thinkingStore';
import { transcriptToBlocks } from '../transcriptToBlocks';
import { computeThinkingStatus } from '../thinkingStatus';
import { hasVisibleContent, pendingToolName } from '../engineBlocks';
import { canChangeCwd, shortenPath } from '../cwdChange';
import { Markdown, HighlightedLines } from './Markdown';
import { useHighlightedCode } from '../highlighter';
import { langFromPath } from '../codeHighlight';
import { QuestionCard } from './QuestionCard';
import { PermissionCard } from './PermissionCard';
import { DiffView } from './DiffView';
import { ArtifactCard } from './ArtifactCard';
import { artifactCardFrom } from '../artifactView';
import { ToolRunRow } from './ToolRunRow';
import { SubagentBlock } from './SubagentBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { groupChatRows, type ChatRow } from '../toolGrouping';
import { TOOL_CLASS_GLYPH } from '../toolClassify';
import { usePaneTabId, usePaneTranscriptStore } from '../paneContext';
import type { Block, ImageAttachment } from '../types';

// Referencia ESTABLE para el caso "todavia no hay pensamientos de esta sesion": un `[]` nuevo en cada
// render haria que el efecto de hidratacion se disparase en bucle.
const EMPTY_THINKING: readonly string[] = [];

// Margen (px) por debajo del cual se considera que el usuario esta "pegado" al final del chat: con
// scroll dentro de ese margen, los mensajes nuevos siguen bajando solos; si ha subido a leer, no.
const STICK_TO_BOTTOM_PX = 80;

// Zona central de conversacion: pila de bloques (usuario, herramienta, agente).
export function BlockChat(): React.JSX.Element {
  // La pestaña de ESTE panel del centro (item 13): con el workspace dividido no tiene por que ser la
  // activa global. Sin division, `usePaneTabId` devuelve exactamente `activeTabId`.
  const activeTabId = usePaneTabId();
  const allBlocks = useWorkbenchStore((s) => s.blocksByChat[activeTabId] ?? EMPTY);
  useHydrateFromTranscript();
  const accent = useWorkbenchStore((s) => {
    const tab = s.tabs.find((t) => t.id === activeTabId);
    return s.accounts.find((a) => a.id === tab?.accountId)?.accent.base ?? 'var(--color-mg-fill)';
  });
  // Guard de presentacion (A5): los bloques sin contenido no se pintan (antes dejaban rayas sueltas
  // que parecian separadores entre mensajes).
  const blocks = useMemo(() => allBlocks.filter(hasVisibleContent), [allBlocks]);
  // Rachas de herramientas (2.12.2): una sola pasada O(n), dentro del mismo useMemo que ya envolvia el
  // filtrado. Lo que se pinta son FILAS, no bloques: una fila puede ser un bloque o una racha.
  // El turno VIVO cambia la agrupacion: con el agente trabajando, la ultima racha se queda abierta
  // para ver cada accion aparecer; al terminar, se pliega.
  const chatStatus = useWorkbenchStore((s) => s.statusByChat[activeTabId] ?? 'idle');
  const turnActive = chatStatus === 'streaming';
  const rows = useMemo(() => groupChatRows(blocks, turnActive), [blocks, turnActive]);
  // "Pensando": el turno esta activo pero no hay texto en streaming visible (tras enviar, o
  // mientras corre una tool). Damos feedback para que no parezca que se ha quedado colgado.
  const status = chatStatus;
  const streamingId = useWorkbenchStore((s) => s.streamingIdByChat[activeTabId] ?? null);
  const thinking = status === 'streaming' && streamingId === null;
  // Tool en curso: el indicador dice QUE esta haciendo ("Ejecutando Write…") en vez de un generico.
  const runningTool = useMemo(() => pendingToolName(allBlocks), [allBlocks]);
  // El texto en streaming crece DENTRO del ultimo bloque (no cambia el numero de bloques): el tamaño
  // de la cola es lo que hace que el auto-scroll siga el typing.
  const tailSize = useMemo(() => tailContentSize(blocks), [blocks]);
  // `rows.length` ademas de `blocks.length`: al agruparse una racha el numero de bloques puede crecer
  // sin que crezca el de filas (y al reves al desplegarla), y el auto-scroll depende de lo que se pinta.
  const { ref: scrollRef, onScroll } = useStickToBottom([blocks.length, rows.length, tailSize, thinking, activeTabId]);

  if (blocks.length === 0 && !thinking) {
    if (activeTabId.length === 0) return <NoConversationState />;
    return <EmptyConversation />;
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto p-[16px_22px]">
      {/* Region viva (solo lectores): anuncia el CAMBIO de estado del turno, no cada delta (evita
          ruido). El texto solo cambia en las transiciones, que es cuando el SR lo lee. */}
      <div className="sr-only" role="status" aria-live="polite">
        {statusAnnouncement(status)}
      </div>
      {rows.map((row) => (
        <ChatRowView key={rowKey(row)} row={row} accent={accent} />
      ))}
      {thinking && <ThinkingIndicator accent={accent} tool={runningTool} />}
    </div>
  );
}

// Tamaño del contenido del ULTIMO bloque (caracteres). Cambia con cada delta de streaming y con la
// salida de una tool -> sirve como dependencia del auto-scroll.
function tailContentSize(blocks: readonly Block[]): number {
  const last = blocks[blocks.length - 1];
  if (last === undefined) return 0;
  if (last.kind === 'agent') return last.runs.reduce((total, run) => total + run.text.length, 0);
  if (last.kind === 'tool') return last.output.reduce((total, run) => total + run.text.length, 0) + last.meta.length;
  if (last.kind === 'user') return last.text.length;
  if (last.kind === 'error') return last.message.length;
  // Una tarjeta de pregunta no crece: su tamaño solo cambia al contestarla, y eso ya cambia el bloque.
  if (last.kind === 'question') return last.state.length;
  // Igual la de permiso: lo unico que cambia es su estado (pendiente -> permitido/denegado/cancelado).
  if (last.kind === 'permission') return last.state.length;
  if (last.kind === 'subagent') return (last.status ?? '').length;
  if (last.kind === 'thinking') return last.runs.reduce((total, run) => total + run.text.length, 0);
  return last.text.length;
}

// Mantiene el chat pegado al final cuando llega contenido nuevo, SALVO que el usuario haya subido a
// leer (entonces no se le mueve el scroll bajo los pies). useLayoutEffect: mide y ajusta antes del
// pintado, asi no se ve el salto. Devuelve la ref del contenedor scrollable.
function useStickToBottom(deps: readonly unknown[]): {
  readonly ref: React.RefObject<HTMLDivElement | null>;
  readonly onScroll: () => void;
} {
  const ref = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);

  // Cada scroll manual actualiza si seguimos "pegados" al final. Va como PROP de React y no como
  // `addEventListener` dentro de un `useEffect([])`: al arrancar en frio, el chat vacio devuelve
  // `<EmptyConversation/>` antes de pintar el div, asi que el efecto salia por `ref.current === null` y
  // con deps vacias no volvia a correr JAMAS — `stuckRef` se quedaba en `true` de por vida y cada delta
  // devolvia al usuario al fondo aunque hubiera subido a leer.
  const onScroll = (): void => {
    const element = ref.current;
    if (element === null) return;
    stuckRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_TO_BOTTOM_PX;
  };

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || !stuckRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, deps);

  return { ref, onScroll };
}

// Texto para la region aria-live segun el estado del turno de la pestana activa.
function statusAnnouncement(status: string): string {
  switch (status) {
    case 'streaming':
      return 'Generando respuesta…';
    case 'needs_permission':
      return 'El agente requiere un permiso.';
    case 'error':
      return 'Se produjo un error en la conversación.';
    default:
      return 'Respuesta completada.';
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
    return s.sessionIdByChat[activeTabId] ?? tab?.resumeSessionId;
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
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[20px] text-center">
      {/* Constelacion de chispas: la MISMA estrella de cuatro puntas del simbolo de marca
          (resources/brand/symbol.svg), en cinco tamanos que titilan desfasados. Monocromo via
          currentColor (hereda el color del contenedor), asi conmuta con el tema. */}
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
      <div className="flex flex-col items-center gap-[12px]">
        <div className="text-[13px] font-medium text-mg-text">Escribe una instrucción para empezar</div>
        <WorkingFolder />
        {autoApproved ? (
          <div
            role="status"
            className="flex max-w-[420px] items-start gap-[8px] rounded-[7px] border border-mg-warn-border bg-mg-warn-bg p-[7px_10px] text-left text-[10.5px] text-mg-warn-text"
          >
            <Icon name="warning" />
            <span>{NO_PERMISSION_CONTROL_WARNING}</span>
          </div>
        ) : (
          <div className="flex items-center gap-[7px] text-[10.5px] text-mg-muted">
            <Kbd>/</Kbd>
            <span>comandos</span>
            <span className="opacity-50">·</span>
            <Kbd>Shift+Tab</Kbd>
            <span>modo</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Carpeta de trabajo de la conversacion, con afordancia para cambiarla (F2). Hasta ahora el cwd real
// solo se podia elegir en el dialogo avanzado de la TabBar al crear la pestaña, asi que en una
// conversacion recien abierta no habia ni forma de SABER en que carpeta iba a trabajar el agente.
//
// El boton se deshabilita (con el motivo en el tooltip) cuando cambiarlo ya no es seguro: la regla la
// decide canChangeCwd, el mismo modulo puro que guarda la accion del store.
function WorkingFolder(): React.JSX.Element | null {
  const activeTabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === activeTabId));
  const hasLiveSession = useWorkbenchStore((s) => s.sessionIdByChat[activeTabId] !== undefined);
  const setActiveCwd = useWorkbenchStore((s) => s.setActiveCwd);

  if (activeTabId.length === 0 || tab === undefined) return null;
  const verdict = canChangeCwd({ hasLiveSession, hasResumeTarget: tab.resumeSessionId !== undefined });

  const pickFolder = (): void => {
    void window.mage
      .pickDirectory()
      .then((picked) => {
        if (picked === null) return; // el usuario cancelo el dialogo del SO
        setActiveCwd(picked);
      })
      .catch(() => undefined);
  };

  return (
    <div className="flex max-w-[420px] items-center gap-[8px] text-[10.5px] text-mg-muted">
      <Icon name="folder" />
      {/* La ruta completa en el title: lo que se pinta va acortado para no romper el centrado. */}
      <span className="truncate font-mono text-mg-sec" title={tab.cwd}>
        {shortenPath(tab.cwd)}
      </span>
      <button
        onClick={pickFolder}
        disabled={!verdict.allowed}
        data-tip={verdict.allowed ? 'Elegir otra carpeta de trabajo' : verdict.reason}
        aria-label="Cambiar carpeta de trabajo"
        className="shrink-0 rounded-[6px] border border-mg-border-emph px-[7px] py-[2px] text-[10px] text-mg-body2 hover:bg-mg-hover disabled:cursor-default disabled:opacity-40"
      >
        Cambiar
      </button>
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

// Estado sin ninguna conversacion abierta: botones centrales para crear una (compartida o privada),
// sin pasar por el sidebar ni un dialogo. La cuenta es la activa del rail.
function NoConversationState(): React.JSX.Element {
  const createConversation = useWorkbenchStore((s) => s.createConversation);
  const hasAccount = useWorkbenchStore((s) => s.activeAccountId.length > 0);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[14px] text-center">
      <div className="text-[13px] text-mg-muted">No hay ninguna conversación abierta.</div>
      <div className="flex gap-[10px]">
        <button
          onClick={() => void createConversation('shared')}
          disabled={!hasAccount}
          className="rounded-[8px] border border-mg-border-emph px-[16px] py-[9px] text-[12px] text-mg-body2 hover:bg-mg-hover disabled:opacity-40"
        >
          ＋ Nuevo chat
        </button>
        <button
          onClick={() => void createConversation('private')}
          disabled={!hasAccount}
          className="rounded-[8px] border border-mg-border-emph px-[16px] py-[9px] text-[12px] text-mg-body2 hover:bg-mg-hover disabled:opacity-40"
        >
          <Icon name="lock" size={12} /> Nuevo chat privado
        </button>
      </div>
    </div>
  );
}

// Indicador de actividad mientras el agente trabaja sin emitir texto todavia (M2.6): palabra
// cambiante + tiempo transcurrido del turno + aviso si el motor lleva rato sin dar señales (posible
// cuelgue). Tictac local cada segundo; los tiempos base vienen del store (inicio/ultima actividad).
function ThinkingIndicator({ accent, tool }: { readonly accent: string; readonly tool: string | null }): React.JSX.Element {
  const paneTabId = usePaneTabId();
  const turnStart = useWorkbenchStore((s) => s.turnStartByChat[paneTabId]);
  const lastActivity = useWorkbenchStore((s) => s.lastActivityByChat[paneTabId]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const status = computeThinkingStatus(now - (turnStart ?? now), now - (lastActivity ?? now));
  // Con una tool en curso se dice QUE esta haciendo; si no, la palabra cambiante de "pensando".
  const label = tool === null ? status.label : `Ejecutando ${tool}`;
  return (
    <div className="flex items-center gap-[9px] px-[4px] py-[2px] text-[12px] text-mg-ter">
      <span className="h-[7px] w-[7px] flex-none rounded-full mg-pulse" style={{ background: accent }} />
      <span>{label}…</span>
      <span className="font-mono text-[10.5px] text-mg-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {status.elapsedText}
      </span>
      {status.stalled && (
        <span className="text-[10.5px] text-mg-warn-text">· sin respuesta hace {status.sinceActivityText}</span>
      )}
    </div>
  );
}

const EMPTY: readonly Block[] = [];

function rowKey(row: ChatRow): string {
  return row.kind === 'run' ? row.id : row.block.id;
}

// Una fila del hilo: o un bloque, o una RACHA de herramientas agrupadas (2.12.2). Al desplegar la
// racha salen sus cajas, cada una colapsada: dos niveles, como se decidio.
function ChatRowView({ row, accent }: { readonly row: ChatRow; readonly accent: string }): React.JSX.Element {
  const expanded = useWorkbenchStore((s) => s.expandedRuns.has(row.kind === 'run' ? row.id : ''));
  const toggleRun = useWorkbenchStore((s) => s.toggleRun);
  if (row.kind === 'block') return <BlockView block={row.block} accent={accent} />;
  return (
    <div className="shrink-0" data-block="run">
      <ToolRunRow summary={row.summary} expanded={expanded} onToggle={() => toggleRun(row.id)}>
        {row.blocks.map((block) => (
          <BlockView key={block.id} block={block} accent={accent} />
        ))}
      </ToolRunRow>
    </div>
  );
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
const BlockView = memo(function BlockView({ block, accent }: { readonly block: Block; readonly accent: string }): React.JSX.Element {
  return (
    <div className="shrink-0" data-block={block.kind}>
      <BlockBody block={block} accent={accent} />
    </div>
  );
});

function BlockBody({ block, accent }: { readonly block: Block; readonly accent: string }): React.JSX.Element {
  if (block.kind === 'user') return <UserBlock block={block} />;
  if (block.kind === 'tool') return <ToolBlock block={block} />;
  if (block.kind === 'error') return <ErrorBlock block={block} />;
  if (block.kind === 'system') return <SystemBlock block={block} />;
  if (block.kind === 'question') return <QuestionBlock block={block} />;
  if (block.kind === 'permission') return <PermissionCard block={block} />;
  if (block.kind === 'subagent') return <SubagentBlock block={block} />;
  if (block.kind === 'thinking') return <ThinkingBlock block={block} />;
  return <AgentBlock block={block} accent={accent} />;
}

// Tarjeta de pregunta del agente (2.3). Contestar y "no contestar" son las DOS caras del mismo
// can_use_tool: las dos responden la peticion, y por eso las dos pasan por `answerActivePermission`.
function QuestionBlock({ block }: { readonly block: Extract<Block, { kind: 'question' }> }): React.JSX.Element {
  const answerQuestion = useWorkbenchStore((s) => s.answerQuestion);
  const answerActivePermission = useWorkbenchStore((s) => s.answerActivePermission);
  return (
    <QuestionCard
      block={block}
      onAnswer={(answers) => answerQuestion(block.requestId, answers)}
      onDeny={() => answerActivePermission({ behavior: 'deny', message: 'El usuario no contesto la pregunta.' })}
    />
  );
}

// Marcador de sistema (M2.4): linea tenue centrada (p.ej. "🗜 Contexto compactado (manual)").
function SystemBlock({ block }: { readonly block: Extract<Block, { kind: 'system' }> }): React.JSX.Element {
  return (
    <div className="flex items-center gap-[10px] px-[4px] text-[10.5px] text-mg-muted">
      <span className="h-px flex-1 bg-mg-border-subtle" />
      <span className="flex-none">{block.text}</span>
      <span className="h-px flex-1 bg-mg-border-subtle" />
    </div>
  );
}

function ErrorBlock({ block }: { readonly block: Extract<Block, { kind: 'error' }> }): React.JSX.Element {
  return (
    <div role="alert" className="rounded-[9px] border border-mg-danger-border bg-mg-danger-bg p-[10px_14px] text-[12px] leading-[1.55] text-mg-danger">
      {block.message}
    </div>
  );
}

// Mensaje del USUARIO (A4): burbuja alineada a la DERECHA, mas estrecha, con fondo/borde propios. La
// asimetria (lado + ancho + color) es lo que hace la conversacion legible de un vistazo frente a la
// burbuja del agente, que va a la izquierda.
// Un prompt largo (un pegote de log, un fichero entero) se PLIEGA a una altura maxima con un boton de
// desplegar: si no, un solo mensaje del usuario empuja toda la respuesta fuera de la pantalla.
function UserBlock({ block }: { readonly block: Extract<Block, { kind: 'user' }> }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[80%] min-w-0 flex-col gap-[3px] rounded-[12px] rounded-br-[4px] border border-mg-border-emph bg-mg-sel p-[9px_13px] leading-[1.55]">
        {/* Sin cabecera "TU" y SIN HORA (buzon del usuario, punto 1): el lado, el ancho y el fondo ya
            dicen de quien es la burbuja, y una hora por mensaje es ruido en una conversacion que se lee
            de arriba abajo — esto no es una app de mensajeria. `block.time` se conserva en el modelo:
            solo deja de pintarse aqui. */}
        {/* H2: el mensaje del usuario tambien es Markdown (decision del usuario, 2026-09-09). Se
            pintaba en plano con `whitespace-pre-wrap`, asi que un `**negrita**` o un bloque de codigo
            enviados se veian en crudo en la burbuja (reporte del usuario). Mismo render que el del
            agente — y `Markdown` conserva los saltos de linea dentro del parrafo, que era lo unico
            que aportaba el texto plano. */}
        <Collapsible maxHeightPx={USER_MESSAGE_MAX_HEIGHT_PX} label="mensaje">
          <div className="min-w-0 break-words text-mg-text">
            <Markdown text={block.text} />
          </div>
        </Collapsible>
        {block.attachments.length > 0 && <UserAttachments attachments={block.attachments} />}
      </div>
    </div>
  );
}

// Imagenes que el usuario mando en el mensaje (2.12.1). Van FUERA del `Collapsible` a proposito: la
// miniatura es lo que identifica el mensaje de un vistazo y recortarla no ahorraria nada.
// `data:` inline: la CSP de Mage declara `img-src 'self' data:` en dev y en produccion (medido), que es
// donde suele aparecer el "funciona en dev y no empaquetado".
function UserAttachments({ attachments }: { readonly attachments: readonly ImageAttachment[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-[6px] pt-[2px]">
      {attachments.map((attachment, index) => (
        <img
          key={index}
          src={`data:${attachment.mediaType};base64,${attachment.data}`}
          alt="Imagen adjunta"
          className="max-h-[220px] max-w-full rounded-[8px]"
        />
      ))}
    </div>
  );
}

// Altura maxima (px) de un mensaje del usuario plegado. Da para ~9 lineas: suficiente para reconocer el
// prompt sin que un pegote de texto ocupe la pantalla entera.
const USER_MESSAGE_MAX_HEIGHT_PX = 160;

// Contenedor que PLIEGA su contenido a una altura maxima y ofrece "Ver … completo" si no cabe. El boton
// solo aparece cuando de verdad hay contenido recortado (se mide el alto real del contenido y se
// re-mide si cambia el ancho, p.ej. al abrir/cerrar paneles laterales).
function Collapsible({
  maxHeightPx,
  label,
  children,
}: {
  readonly maxHeightPx: number;
  readonly label: string; // sustantivo para el boton: "Ver <label> completo"
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
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
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-[2px] self-start text-[10.5px] text-mg-icon underline underline-offset-2 hover:text-mg-body"
        >
          {expanded ? 'Ver menos' : `Ver ${label} completo`}
        </button>
      )}
    </>
  );
}

// Holgura (px) al comparar alturas: evita que un redondeo de subpixel marque como recortado un
// contenido que en realidad cabe justo.
const OVERFLOW_TOLERANCE_PX = 4;

function ToolBlock({ block }: { readonly block: Extract<Block, { kind: 'tool' }> }): React.JSX.Element {
  // Un artifact YA PUBLICADO se pinta como tarjeta (2.4) en vez de como caja de tool: la caja enseñaba
  // la ruta del scratchpad como encabezado, que no le dice nada a nadie.
  const card = artifactCardFrom(block);
  if (card !== null) return <ArtifactCard card={card} />;
  return <ToolBox block={block} />;
}

function ToolBox({ block }: { readonly block: Extract<Block, { kind: 'tool' }> }): React.JSX.Element {
  // COLAPSADA por defecto (2.12.2): el defecto visible cambio, y por eso el estado del store se llama
  // ahora `expandedTools` y no `collapsedTools`.
  const expanded = useWorkbenchStore((s) => s.expandedTools.has(block.id));
  const toggleTool = useWorkbenchStore((s) => s.toggleTool);
  // PESO VISUAL de "Pensó", no de una respuesta (peticion del usuario, 2026-09-18). Una caja con
  // borde, fondo propio y ancho completo competia con lo que dice el modelo, y en un turno con quince
  // herramientas el hilo pasaba a ser una lista de cajas con la respuesta perdida entre ellas. Lo que
  // el agente HACE es contexto; lo que DICE es el contenido.
  //
  // Solo cambia la presentacion: mismo plegado, mismo `aria-expanded`, mismo cuerpo montado solo al
  // desplegar, mismo glifo por clase y mismo estado en el store. Y el cuerpo desplegado SI conserva su
  // fondo y su borde izquierdo — ahi es justo donde hace falta leer, igual que en el pensamiento.
  return (
    <div className="flex flex-col gap-[5px]">
      <button
        onClick={() => toggleTool(block.id)}
        aria-expanded={expanded}
        aria-label={`${block.tool} ${block.command}`}
        className="flex w-full items-center gap-[7px] rounded-[7px] px-[8px] py-[3px] text-left font-mono text-[11px] text-mg-ter hover:bg-mg-hover hover:text-mg-body2"
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        {/* Glifo por CLASE de tool (lectura, busqueda, edicion, comando...): monocromo, como el resto
            de iconografia de Mage, para que conmute con el tema. */}
        <span data-tool-glyph className="inline-flex w-[14px] flex-none justify-center" aria-hidden="true">{TOOL_CLASS_GLYPH[block.toolClass]}</span>
        <span className="flex-none font-semibold">{block.tool}</span>
        {/* Solo el nombre del fichero cuando lo que lleva es una ruta. La ruta ENTERA sigue en el
            `aria-label` de arriba, en el tooltip y en el pie del bloque desplegado. */}
        <span className="truncate opacity-80" title={block.command}>{shortToolCommand(block.tool, block.command)}</span>
        {/* El estado NO se atenua con el resto: un error tiene que seguir saltando a la vista aunque la
            fila ahora pese poco. */}
        <span className={`ml-auto flex-none ${block.isError ? 'font-semibold text-mg-danger' : 'opacity-70'}`}>{block.meta}</span>
      </button>
      {/* El cuerpo solo se MONTA al desplegar: en una conversacion larga, tener el diff de cada
          edicion en el DOM cuesta, y ademas es lo que hace que `aria-expanded` no pueda mentir. */}
      {expanded && (
        <div className="ml-[10px] flex flex-col gap-[6px] overflow-hidden rounded-[7px] border-l border-mg-border-subtle pl-[10px]">
          {block.output.length > 0 && <ToolOutput block={block} />}
          {block.diff !== null && <DiffView lines={block.diff} path={block.filePath} />}
          {block.diff === null && block.writtenContent !== null && (
            <WrittenContent lines={block.writtenContent} path={block.filePath} />
          )}
          {block.filePath !== null && <FileActions path={block.filePath} />}
        </div>
      )}
    </div>
  );
}

// Salida de una tool. Cuando lo que trae es el CONTENIDO DE UN FICHERO (una lectura con ruta conocida)
// se resalta con el mismo shiki que el chat: leer 200 lineas de codigo en gris plano era lo que pedia
// arreglar el usuario. Para todo lo demas —stdout de un Bash, confirmaciones— el texto plano es lo
// correcto: no hay lenguaje que aplicar.
function ToolOutput({ block }: { readonly block: Extract<Block, { kind: 'tool' }> }): React.JSX.Element {
  const text = block.output.map((run) => run.text).join('');
  const lang = block.toolClass === 'read' ? langFromPath(block.filePath) : null;
  const lines = useHighlightedCode(text, lang);
  return (
    <div className="whitespace-pre-wrap bg-mg-code p-[9px_14px] font-mono text-[11px] leading-[1.65] text-mg-sec">
      {lines === null ? text : <HighlightedLines lines={lines} />}
    </div>
  );
}

// Contenido completo de un fichero recien CREADO (un `Write`): no hay diff que enseñar porque no habia
// nada antes, asi que se pinta el contenido sin signos ni numeros de linea antiguos — pero SI con
// resaltado, que es lo que lo hace legible.
function WrittenContent({ lines, path }: { readonly lines: readonly string[]; readonly path: string | null }): React.JSX.Element {
  const text = useMemo(() => lines.join('\n'), [lines]);
  const highlighted = useHighlightedCode(text, langFromPath(path));
  return (
    <div className="max-h-[260px] overflow-auto whitespace-pre-wrap border-t border-mg-border-subtle bg-mg-code p-[9px_14px] font-mono text-[11px] leading-[1.6] text-mg-sec">
      {highlighted === null ? text : <HighlightedLines lines={highlighted} />}
    </div>
  );
}



// Botones para abrir la ubicacion del archivo en el gestor del SO y guardarlo (copiar) fuera.
function FileActions({ path }: { readonly path: string }): React.JSX.Element {
  const [saved, setSaved] = useState(false);

  const reveal = (): void => {
    void window.mage.revealFile(path).catch((err: unknown) => console.error('No se pudo abrir la ubicación', err));
  };
  const save = (): void => {
    void window.mage
      .saveFileAs(path)
      .then((ok) => setSaved(ok))
      .catch((err: unknown) => console.error('No se pudo guardar el archivo', err));
  };

  return (
    <div className="flex items-center gap-[8px] border-t border-mg-border-subtle p-[8px_14px] text-[11px]">
      <button
        onClick={reveal}
        className="rounded-[6px] border border-mg-border-ctrl px-[9px] py-[4px] text-mg-body2 hover:bg-mg-hover"
      >
        <Icon name="folderOpen" size={12} /> Abrir ubicación
      </button>
      <button
        onClick={save}
        className="rounded-[6px] border border-mg-border-ctrl px-[9px] py-[4px] text-mg-body2 hover:bg-mg-hover"
      >
        <Icon name="save" size={12} /> Guardar como…
      </button>
      {saved && <span className="text-mg-ter">✓ guardado</span>}
      <span className="ml-auto truncate font-mono text-[10px] text-mg-muted">{path}</span>
    </div>
  );
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
  // Mensaje del AGENTE: burbuja alineada a la IZQUIERDA, mas ancha que la del usuario y con fondo/borde
  // propios (el punto lleva el color de la cuenta y late mientras hay streaming). El par
  // izquierda/derecha + los dos fondos distintos es lo que separa visualmente los turnos.
  return (
    <div className="flex justify-start">
      <div className="flex min-w-0 max-w-[92%] gap-[10px] rounded-[12px] rounded-bl-[4px] border border-mg-sel bg-mg-block p-[10px_14px]">
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
