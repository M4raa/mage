import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { NO_PERMISSION_CONTROL_WARNING, isAutoApprovedProvider } from '@shared/providers';
import { useWorkbenchStore } from '../workbenchStore';
import { SPARKLE_WAIST_RATIO } from '../brandMark';
import { useThinkingStore } from '../thinkingStore';
import { transcriptToBlocks } from '../transcriptToBlocks';
import { computeThinkingStatus, formatElapsed } from '../thinkingStatus';
import { hasVisibleContent, pendingToolName } from '../engineBlocks';
import { canChangeCwd, shortenPath } from '../cwdChange';
import { Markdown } from './Markdown';
import { PermissionCard } from './PermissionCard';
import { ArtifactCard } from './ArtifactCard';
import { artifactCardFrom } from '../artifactView';
import { chatRows, currentTurnSummary, type ChatRow } from '../chatVisibility';
import { usePaneTabId, usePaneTranscriptStore } from '../paneContext';
import type { Block, ImageAttachment } from '../types';
import { classifySystemWrapper } from '@shared/systemWrappers';
import { useStickToBottom } from '../useStickToBottom';

// Referencia ESTABLE para el caso "todavia no hay pensamientos de esta sesion": un `[]` nuevo en cada
// render haria que el efecto de hidratacion se disparase en bucle.
const EMPTY_THINKING: readonly string[] = [];

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
  // El texto en streaming crece DENTRO del ultimo bloque (no cambia el numero de bloques): el tamaño
  // de la cola es lo que hace que el auto-scroll siga el typing.
  const tailSize = useMemo(() => tailContentSize(rows), [rows]);
  // Lo que cuenta es lo que se PINTA: las filas, no los bloques (casi todos van al panel de Actividad).
  const { ref: scrollRef, onScroll } = useStickToBottom([rows.length, tailSize, turnLive, activeTabId]);

  if (blocks.length === 0 && !turnLive) {
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
      {turnLive && <ThinkingIndicator accent={accent} tool={runningTool} steps={turnSummary.steps} errors={turnSummary.errors} />}
    </div>
  );
}

// Tamaño del contenido de la ULTIMA fila del hilo (caracteres). Cambia con cada delta de streaming ->
// sirve como dependencia del auto-scroll. Un permiso, un artifact o una linea de fallo no crecen: cambian
// de identidad, y eso ya cambia `rows`.
function tailContentSize(rows: readonly ChatRow[]): number {
  const last = rows[rows.length - 1];
  if (last === undefined || last.kind !== 'block') return 0;
  const block = last.block;
  if (block.kind === 'agent') return block.runs.reduce((total, run) => total + run.text.length, 0);
  if (block.kind === 'user' || block.kind === 'system') return block.text.length;
  if (block.kind === 'error') return block.message.length;
  return 0;
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
function ThinkingIndicator({
  accent,
  tool,
  steps,
  errors,
}: {
  readonly accent: string;
  readonly tool: string | null;
  readonly steps: number;
  readonly errors: number;
}): React.JSX.Element {
  const paneTabId = usePaneTabId();
  const openActivity = useWorkbenchStore((s) => s.openActivity);
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
  // Es un BOTON (P-026 3.4): lleva al panel de Actividad, donde esta cada paso de este turno.
  return (
    <button
      onClick={() => openActivity(paneTabId, null)}
      data-turn-status="true"
      aria-label={`${label}, ${steps} pasos${errors > 0 ? `, ${errors} con error` : ''}: ver la actividad`}
      className="flex w-fit items-center gap-[9px] rounded-[7px] px-[4px] py-[2px] text-left text-[12px] text-mg-ter hover:bg-mg-hover hover:text-mg-body2"
    >
      <span className="h-[7px] w-[7px] flex-none rounded-full mg-pulse" style={{ background: accent }} />
      <span>{label}…</span>
      <span className="text-[10.5px] text-mg-muted">· {steps} {steps === 1 ? 'paso' : 'pasos'}</span>
      <span className="font-mono text-[10.5px] text-mg-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
        · {status.elapsedText}
      </span>
      {errors > 0 && <span className="text-[10.5px] font-semibold text-mg-danger">· {errors} {errors === 1 ? 'error' : 'errores'}</span>}
      {status.stalled && (
        <span className="text-[10.5px] text-mg-warn-text">· sin respuesta hace {status.sinceActivityText}</span>
      )}
      <span aria-hidden="true" className="text-mg-muted">›</span>
    </button>
  );
}

const EMPTY: readonly Block[] = [];

function rowKey(row: ChatRow): string {
  return row.kind === 'subagents' ? row.id : row.block.id;
}

// Una fila del hilo (P-026 3.4): un bloque, la linea de una herramienta que fallo (D22) o la de los
// subagentes de un turno (D21). Las dos lineas llevan al panel de Actividad.
function ChatRowView({ row, accent }: { readonly row: ChatRow; readonly accent: string }): React.JSX.Element {
  if (row.kind === 'block') return <BlockView block={row.block} accent={accent} />;
  if (row.kind === 'tool-failed') return <ToolFailedLine block={row.block} />;
  return <SubagentsLine blocks={row.blocks} />;
}

function ToolFailedLine({ block }: { readonly block: Extract<Block, { kind: 'tool' }> }): React.JSX.Element {
  const paneTabId = usePaneTabId();
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  return (
    <div className="shrink-0" data-block="tool-failed">
      <button
        onClick={() => openActivity(paneTabId, null)}
        className="flex items-center gap-[6px] rounded-[7px] px-[4px] py-[2px] text-[11.5px] text-mg-danger hover:bg-mg-hover"
      >
        <Icon name="warning" size={12} /> {block.tool} falló · ver en Actividad
      </button>
    </div>
  );
}

// «Lanzó 4 subagentes» mientras trabajan; «4 terminados · 2 m 31 s» al acabar todos (el tiempo del mas
// lento: van en paralelo), con los que fallaron en rojo.
function SubagentsLine({ blocks }: { readonly blocks: readonly Extract<Block, { kind: 'subagent' }>[] }): React.JSX.Element {
  const paneTabId = usePaneTabId();
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  const running = blocks.some((b) => b.status === null);
  const failed = blocks.filter((b) => b.status === 'error').length;
  const slowest = Math.max(0, ...blocks.map((b) => b.elapsedMs ?? 0));
  const n = blocks.length;
  const text = running
    ? `Lanzó ${n} ${n === 1 ? 'subagente' : 'subagentes'}`
    : `${n} ${n === 1 ? 'terminado' : 'terminados'}${slowest > 0 ? ` · ${formatElapsed(slowest)}` : ''}`;
  return (
    <div className="shrink-0" data-block="subagents">
      <button
        onClick={() => openActivity(paneTabId, null)}
        className="flex items-center gap-[7px] rounded-[7px] px-[4px] py-[2px] text-[11.5px] text-mg-ter hover:bg-mg-hover hover:text-mg-body2"
      >
        <span aria-hidden="true">⇲</span>
        <span>{text}</span>
        {failed > 0 && <span className="font-semibold text-mg-danger">· {failed} con error</span>}
      </button>
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

function BlockBody({ block, accent }: { readonly block: Block; readonly accent: string }): React.JSX.Element | null {
  if (block.kind === 'user') return <UserBlock block={block} />;
  if (block.kind === 'agent') return <AgentBlock block={block} accent={accent} />;
  if (block.kind === 'tool') return <ToolBlock block={block} />;
  if (block.kind === 'error') return <ErrorBlock block={block} />;
  if (block.kind === 'system') return <SystemBlock block={block} />;
  if (block.kind === 'permission') return <PermissionCard block={block} />;
  // Pensamiento, subagentes y preguntas no llegan aqui: `chatRows` los manda al panel de Actividad o al
  // dock de preguntas (P-026 3.3/3.4).
  return null;
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
  // Envoltorios de sistema que el CLI guarda como mensaje del usuario (P-026, D20): un comando local
  // (`/rename X`) es un chip, y una tarea programada una tarjeta con el cuerpo plegado, en vez de la
  // burbuja con el XML crudo. Los avisos que no se pintan ya los quito `transcriptToBlocks`.
  const wrapper = useMemo(() => classifySystemWrapper(block.text), [block.text]);
  if (wrapper.kind === 'command' && block.attachments.length === 0) return <CommandChip command={wrapper.command} />;
  if (wrapper.kind === 'scheduled-task') return <ScheduledTaskCard name={wrapper.name} body={wrapper.body} />;
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
function ScheduledTaskCard({ name, body }: { readonly name: string; readonly body: string }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <details data-scheduled-task="true" className="max-w-[80%] min-w-0 rounded-[9px] border border-mg-border-subtle bg-mg-block p-[6px_11px] text-[11.5px]">
        <summary className="cursor-pointer text-mg-sec">
          Tarea programada: <span className="font-semibold text-mg-text">{name.length > 0 ? name : 'sin nombre'}</span>
        </summary>
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
