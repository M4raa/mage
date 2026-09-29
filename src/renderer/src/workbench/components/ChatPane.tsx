import { useRef, useState } from 'react';
import type { SplitPath } from '../splitLayout';
import { useWorkbenchStore } from '../workbenchStore';
import { PaneTabProvider } from '../paneContext';
import { useTranscriptLifecycle } from '../useTranscriptLifecycle';
import { TAB_DRAG_MIME, TAB_DRAG_ORIGIN_MIME } from '../tabActions';
import { zoneFromPoint, type DropZone } from '../splitLayout';
import { shouldFocusPromptOnClick } from '../promptFocus';
import { BlockChat } from './BlockChat';
import { PromptBar } from './PromptBar';
import { RateLimitBanner } from './RateLimitBanner';
import { ChatInfoBar } from './ChatInfoBar';
import { QuestionDock } from './QuestionDock';
import { AgentsDock } from './AgentsDock';
import { QueuedMessagesDock } from './QueuedMessagesDock';

// Resaltado visual de la zona bajo el puntero mientras se arrastra una pestaña (I11-drag, estilo VS
// Code/IntelliJ): un rectangulo semitransparente que ocupa la MITAD del panel hacia ese borde, o un
// recuadro central para "mover aqui sin dividir". Puro CSS, sin logica — `zoneFromPoint` decide cual.
const ZONE_RECT_CLASS: Readonly<Record<DropZone, string>> = {
  left: 'inset-y-0 left-0 w-1/2',
  right: 'inset-y-0 right-0 w-1/2',
  top: 'inset-x-0 top-0 h-1/2',
  bottom: 'inset-x-0 bottom-0 h-1/2',
  center: 'inset-[18%] rounded-[6px]',
};

// Un panel de conversacion del centro (Ronda 3, item 13; N paneles en I11). Sin dividir hay uno solo
// y `tabId` es la pestaña activa; dividido hay varios, cada uno con la suya.
//
// El panel ENFOCADO es, por invariante del store, el de `activeTabId`. Interactuar con un panel lo
// enfoca (captura de mousedown y de focus): a partir de ahi todas las acciones "de la pestaña activa"
// del store —enviar, cambiar de modelo, interrumpir, los atajos globales— apuntan justo a este panel,
// sin necesidad de duplicar ninguna de ellas por panel.
export function ChatPane({
  tabId,
  focused,
  split,
  path,
}: {
  readonly tabId: string;
  readonly focused: boolean;
  // Camino de ESTE panel en el arbol: es lo que identifica al destino de un arrastre, porque un panel
  // puede tener varias pestañas y ya no basta con el tabId que enseña.
  readonly path: SplitPath;
  // Con un solo panel no hay a quien dar el foco ni de quien distinguirse: se pinta sin marco.
  readonly split: boolean;
}): React.JSX.Element {
  // Lectura de la transcripcion de la conversacion de ESTE panel (4.1): vive aqui, no en `App` con la
  // pestaña activa, porque en un split solo se leia la del panel enfocado y el otro se quedaba con el
  // chat vacio teniendo historial en disco (4.3).
  useTranscriptLifecycle(tabId);
  // `setActiveTab` ya intercambia los dos paneles si `tabId` es el del secundario (ver el store): no
  // hace falta una accion aparte para "enfocar panel".
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const movePaneTab = useWorkbenchStore((s) => s.movePaneTab);
  const take = (): void => {
    if (!focused) setActiveTab(tabId);
  };

  // P-028 23: clic en una zona sin nada enfocable del panel -> foco al input. `onClick` y no `mousedown`,
  // para no romper la seleccion por arrastre; `take` (mousedown en captura) ya dejo activa esta pestaña.
  const focusPrompt = useWorkbenchStore((s) => s.focusPrompt);
  const onPaneClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const focus = shouldFocusPromptOnClick({
      button: e.button,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      target,
      currentTarget: e.currentTarget,
      selectionCollapsed: window.getSelection()?.isCollapsed ?? true,
    });
    if (focus) focusPrompt();
  };

  // I11-drag: arrastrar una pestaña sobre este panel (arrastre nativo, mismo patron que F6 en
  // dock/Stripe.tsx). `dragover` no deja leer `dataTransfer` — solo `types` — asi que la zona se
  // recalcula en cada evento a partir de la posicion del puntero, sin depender de un payload que
  // todavia no se puede leer.
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    // Solo pestañas de ESTA ventana (P-028, 36): una de otra ventana de Mage se deja pasar sin aceptar,
    // y su origen la mueve aqui por el cursor.
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME) || !e.dataTransfer.types.includes(TAB_DRAG_ORIGIN_MIME)) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setDropZone(zoneFromPoint(rect, e.clientX, e.clientY));
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    const draggedTabId = e.dataTransfer.getData(TAB_DRAG_MIME);
    setDropZone(null);
    if (draggedTabId.length === 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    e.preventDefault();
    // Zona recalculada del propio evento de suelta, NUNCA del estado `dropZone` de `onDragOver`: ese
    // estado puede quedarse un evento atras si el navegador despacha `dragover` y `drop` en el mismo
    // lote antes de que React vuelva a renderizar (confirmado con arrastres reales por CDP: el panel
    // resultante no coincidia con la zona del punto de suelta).
    movePaneTab(draggedTabId, path, zoneFromPoint(rect, e.clientX, e.clientY));
  };

  return (
    <PaneTabProvider value={tabId}>
      <div
        ref={containerRef}
        // Ancla ESTABLE para `pnpm verify:gui` (con N paneles, ningun selector de rol/texto identifica
        // a "el panel de esta pestaña en concreto"). No la usa ningun otro codigo de produccion.
        data-pane-tab-id={tabId}
        // onMouseDownCapture/onFocusCapture (fase de captura): el foco debe cambiar ANTES de que el
        // control pulsado dispare su accion, o esa accion iria a la pestaña del otro panel.
        onMouseDownCapture={take}
        onFocusCapture={take}
        onClick={onPaneClick}
        onDragOver={onDragOver}
        onDragLeave={() => setDropZone(null)}
        onDrop={onDrop}
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col bg-mg-window ${
          split ? (focused ? 'outline outline-1 -outline-offset-1 outline-mg-border-emph' : 'opacity-80') : ''
        }`}
      >
        <BlockChat />
        <RateLimitBanner />
        {/* Encima del input, no dentro: es informacion de la CONVERSACION, no un control del mensaje
            que se esta escribiendo. Ese es tambien el orden en que se lee la pantalla. */}
        <ChatInfoBar />
        {/* La pregunta pendiente del agente, anclada encima del input (P-026 3.3). */}
        <QuestionDock />
        <AgentsDock />
        {/* Lo enviado con el turno en marcha espera aqui, no en el hilo (0.1.1 R2, punto 30). */}
        <QueuedMessagesDock />
        <PromptBar />
        {dropZone !== null && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
            <div className={`absolute border-2 border-mg-focus bg-mg-focus/20 ${ZONE_RECT_CLASS[dropZone]}`} />
          </div>
        )}
      </div>
    </PaneTabProvider>
  );
}
