import { useEffect, useRef, useState } from 'react';
import type { BrowserPenCapture, BrowserPenStroke, BrowserPenStrokeKind } from '@shared/browser';
import { t as translateNow, useT } from '../../i18n/uiLanguage';
import { activeFormatLocale } from '../../i18n/format';
import { describeError } from '../describeError';
import { useWorkbenchStore } from '../workbenchStore';
import { Icon } from '../components/Icon';
import { Hint } from '../components/TranscriptHint';
import { displayToDip, penCaption, replacePenInDraft } from './browserPen';
import { useBrowserStore } from './browserStore';
import { beginStroke, endStroke, extendStroke, undoStroke } from './penStrokes';

// Pluma (D-S6): captura limpia de la página, el usuario dibuja encima y main compone el PNG final con los números de
// los elementos. Aquí solo se dibuja para que el usuario se vea; los puntos se guardan YA en DIP de la página.
const STROKE_COLOR = '#00c800';
const STROKE_WIDTH = 3;
const ARROW_HEAD_PX = 12;
const ARROW_HEAD_ANGLE = Math.PI / 6;
const EMPTY_DRAFT = { text: '', attachments: [], mentions: [] };
const TOOLS: readonly { readonly kind: BrowserPenStrokeKind; readonly label: 'chat.browser.penToolPen' | 'chat.browser.penToolBox' | 'chat.browser.penToolArrow' }[] = [
  { kind: 'pen', label: 'chat.browser.penToolPen' },
  { kind: 'box', label: 'chat.browser.penToolBox' },
  { kind: 'arrow', label: 'chat.browser.penToolArrow' },
];
const BUTTON = 'rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover hover:text-mg-body disabled:opacity-50';

interface DisplaySize {
  readonly width: number;
  readonly height: number;
}

function strokePath(ctx: CanvasRenderingContext2D, stroke: BrowserPenStroke, scale: number): void {
  const [first, ...rest] = stroke.pointsDip.map(([x, y]) => [x * scale, y * scale] as const);
  if (first === undefined) return;
  const last = rest[rest.length - 1] ?? first;
  ctx.beginPath();
  if (stroke.kind === 'box') {
    ctx.rect(first[0], first[1], last[0] - first[0], last[1] - first[1]);
    return;
  }
  ctx.moveTo(first[0], first[1]);
  const through = stroke.kind === 'arrow' ? [last] : rest;
  for (const [x, y] of through) ctx.lineTo(x, y);
  if (stroke.kind === 'arrow') {
    const angle = Math.atan2(last[1] - first[1], last[0] - first[0]);
    for (const side of [-1, 1]) {
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(last[0] - ARROW_HEAD_PX * Math.cos(angle + side * ARROW_HEAD_ANGLE), last[1] - ARROW_HEAD_PX * Math.sin(angle + side * ARROW_HEAD_ANGLE));
    }
  }
}

function paintStrokes(canvas: HTMLCanvasElement, strokes: readonly BrowserPenStroke[], scale: number): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    strokePath(ctx, stroke, scale);
    ctx.stroke();
  }
}

function usePenCapture(sessionId: string): { readonly capture: BrowserPenCapture | null; readonly error: string | null } {
  const [capture, setCapture] = useState<BrowserPenCapture | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.mage
      .browserPenCapture(sessionId)
      .then((result) => alive && setCapture(result))
      .catch((err: unknown) => alive && setError(describeError(err)));
    return () => {
      alive = false;
    };
  }, [sessionId]);
  return { capture, error };
}

interface Drawing {
  readonly strokes: readonly BrowserPenStroke[];
  readonly setSize: (size: DisplaySize) => void;
  readonly size: DisplaySize;
  readonly undo: () => void;
  readonly handlers: {
    readonly onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
    readonly onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
    readonly onPointerUp: () => void;
  };
}

function useDrawing(capture: BrowserPenCapture | null, tool: BrowserPenStrokeKind, canvasRef: React.RefObject<HTMLCanvasElement | null>): Drawing {
  const [strokes, setStrokes] = useState<readonly BrowserPenStroke[]>([]);
  const [size, setSize] = useState<DisplaySize>({ width: 0, height: 0 });
  const drawing = useRef(false);
  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>): readonly [number, number] | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (capture === null || rect.width <= 0 || rect.height <= 0) return null;
    return displayToDip({ x: e.clientX - rect.left, y: e.clientY - rect.top }, rect, { width: capture.widthDip, height: capture.heightDip });
  };
  useEffect(() => {
    if (canvasRef.current !== null && capture !== null && size.width > 0) paintStrokes(canvasRef.current, strokes, size.width / capture.widthDip);
  }, [strokes, size, capture, canvasRef]);
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      const point = pointOf(e);
      if (point === null) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      setStrokes((s) => beginStroke(s, tool, point));
    },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
      const point = drawing.current ? pointOf(e) : null;
      if (point !== null) setStrokes((s) => extendStroke(s, point));
    },
    onPointerUp: () => {
      if (!drawing.current) return;
      drawing.current = false;
      setStrokes(endStroke);
    },
  };
  return { strokes, size, setSize, undo: () => setStrokes(undoStroke), handlers };
}

async function attachPen(tabId: string, sessionId: string, capture: BrowserPenCapture, strokes: readonly BrowserPenStroke[]): Promise<void> {
  const result = await window.mage.browserPenCompose({ sessionId, captureId: capture.captureId, strokes });
  const caption = penCaption(translateNow, result);
  const workbench = useWorkbenchStore.getState();
  const browser = useBrowserStore.getState();
  const draft = workbench.draftByChat[tabId] ?? EMPTY_DRAFT;
  workbench.setDraft(tabId, replacePenInDraft(draft, browser.penByTab[tabId] ?? null, { attachment: result.attachment, caption }, activeFormatLocale()));
  browser.rememberPen(tabId, { data: result.attachment.data, caption });
}

interface ToolbarProps {
  readonly tool: BrowserPenStrokeKind;
  readonly canUndo: boolean;
  readonly canAttach: boolean;
  readonly onTool: (kind: BrowserPenStrokeKind) => void;
  readonly onUndo: () => void;
  readonly onCancel: () => void;
  readonly onAttach: () => void;
}

function PenToolbar(props: ToolbarProps): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-[6px] border-b border-mg-border-subtle px-[10px] py-[5px]">
      {TOOLS.map(({ kind, label }) => (
        <button key={kind} data-browser-pen-tool={kind} aria-pressed={props.tool === kind} onClick={() => props.onTool(kind)} className={`${BUTTON} ${props.tool === kind ? 'bg-mg-sel text-mg-sel-ink' : ''}`}>
          {t(label)}
        </button>
      ))}
      <button onClick={props.onUndo} disabled={!props.canUndo} className={BUTTON}>
        {t('chat.browser.penUndo')}
      </button>
      <button onClick={props.onCancel} className={`${BUTTON} ml-auto`}>
        {t('chat.browser.penCancel')}
      </button>
      <button data-browser-pen-attach onClick={props.onAttach} disabled={!props.canAttach} className={BUTTON}>
        <Icon name="pencil" size={12} className="mr-[4px]" />
        {t('chat.browser.penAttach')}
      </button>
    </div>
  );
}

// Mide la imagen mostrada: el lienzo tiene que medir lo mismo para que los puntos caigan donde el usuario los ve.
function useDisplayedSize(imgRef: React.RefObject<HTMLImageElement | null>, setSize: (size: DisplaySize) => void, active: boolean): () => void {
  const measure = (): void => {
    const img = imgRef.current;
    if (img !== null) setSize({ width: img.clientWidth, height: img.clientHeight });
  };
  useEffect(() => {
    const img = imgRef.current;
    if (!active || img === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `measure` solo lee refs y un setter estable
  }, [active]);
  return measure;
}

export function PenOverlay({ sessionId, tabId, onDone }: { readonly sessionId: string; readonly tabId: string; readonly onDone: () => void }): React.JSX.Element {
  const t = useT();
  const { capture, error: captureError } = usePenCapture(sessionId);
  const [tool, setTool] = useState<BrowserPenStrokeKind>('pen');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useDrawing(capture, tool, canvasRef);
  const measure = useDisplayedSize(imgRef, drawing.setSize, capture !== null);
  const attach = (): void => {
    if (capture === null) return;
    setBusy(true);
    setError(null);
    attachPen(tabId, sessionId, capture, drawing.strokes)
      .then(onDone)
      .catch((err: unknown) => setError(describeError(err)))
      .finally(() => setBusy(false));
  };
  const shownError = error ?? captureError;
  return (
    <div data-browser-pen className="flex min-h-0 flex-1 flex-col">
      <PenToolbar tool={tool} canUndo={drawing.strokes.length > 0} canAttach={capture !== null && !busy} onTool={setTool} onUndo={drawing.undo} onCancel={onDone} onAttach={attach} />
      {shownError !== null && (
        <div role="alert" className="px-[10px] py-[4px] text-[10.5px] text-mg-danger">
          {shownError}
        </div>
      )}
      {capture === null ? (
        shownError === null && <Hint text={t('chat.browser.penLoading')} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-[10px]">
          <div className="relative">
            <img ref={imgRef} onLoad={measure} alt="" src={`data:${capture.image.mime};base64,${capture.image.base64}`} className="block w-full object-contain" />
            <canvas ref={canvasRef} width={drawing.size.width} height={drawing.size.height} {...drawing.handlers} className="absolute left-0 top-0 touch-none cursor-crosshair" />
          </div>
        </div>
      )}
    </div>
  );
}
