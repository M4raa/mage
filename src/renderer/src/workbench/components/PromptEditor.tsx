import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { promptExtensions } from '../promptExtensions';
import type { TextState } from '../promptEditing';

// Envoltorio de CodeMirror 6 para el prompt (2.7). TODO lo especifico de CM6 vive aqui y en
// `promptExtensions.ts`: el resto de la app sigue hablando de `TextState` (value + seleccion), que es
// lo que ya usan `promptEditing` (23 tests intactos) y `promptEnter`.
//
// El puente de teclado es el punto delicado: el resolver de Mage casa por `event.code` (posicion
// fisica, portable entre distribuciones) y el keymap de CM6 por `event.key`. NO se traduce entre los
// dos: se pone UN handler de la maxima precedencia que delega en el `onKeyDown` de la barra, que ya
// sabe resolver con los overrides de D5, sus guards y su orden. El handler devuelve `true` SOLO cuando
// ha actuado; devolver `true` de mas deja el editor sordo a teclas que nadie ha reclamado.

export interface PromptEditorHandle {
  focus: () => void;
  getTextState: () => TextState;
  // Aplica un resultado de `promptEditing` (indentar, desindentar, continuar lista) como una
  // transaccion, reponiendo la seleccion. Es lo que sustituye al `pendingSelectionRef` del textarea.
  applyTextState: (next: TextState) => void;
}

export interface PromptEditorProps {
  readonly value: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly ariaLabel: string;
  readonly onChange: (value: string) => void;
  // Devuelve `true` si la tecla se ha consumido (entonces CodeMirror no la ve).
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
  readonly onPasteImages: (files: readonly File[]) => void;
  // El contenido pasa a ocupar mas (o menos) de una linea visual (P-026 3.1). Solo se llama al CAMBIAR.
  readonly onWrapChange: (wraps: boolean) => void;
  // Selectores en su propia fila: el editor se queda con todo el ancho de la suya.
  readonly stacked: boolean;
  readonly handleRef: Ref<PromptEditorHandle>;
}

// Mas de una linea visual: la altura del contenido pasa de 1,5 lineas. Lo mide CodeMirror (valores ya
// calculados, O(1)): nada de medir el DOM a mano en cada tecla.
const WRAP_LINE_FACTOR = 1.5;

export function PromptEditor({
  value,
  placeholder,
  disabled,
  ariaLabel,
  onChange,
  onKeyDown,
  onPasteImages,
  onWrapChange,
  stacked,
  handleRef,
}: PromptEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Los callbacks viven en una ref para que el editor se cree UNA vez: recrearlo en cada render
  // perderia el foco, el historial y el cursor a cada tecla.
  const handlersRef = useRef({ onChange, onKeyDown, onPasteImages, onWrapChange });
  handlersRef.current = { onChange, onKeyDown, onPasteImages, onWrapChange };
  const wrapsRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...promptExtensions(),
          cmPlaceholder(placeholder),
          history(),
          keymap.of([...standardKeymap, ...historyKeymap]),
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (event) => handlersRef.current.onKeyDown(event),
              paste: (event) => {
                const files = [...(event.clipboardData?.files ?? [])];
                if (files.length === 0) return false; // texto normal: que lo pegue CodeMirror
                event.preventDefault();
                handlersRef.current.onPasteImages(files);
                return true;
              },
            }),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlersRef.current.onChange(update.state.doc.toString());
            if (!update.docChanged && !update.geometryChanged) return;
            const wraps = update.view.contentHeight > update.view.defaultLineHeight * WRAP_LINE_FACTOR;
            if (wraps === wrapsRef.current) return;
            wrapsRef.current = wraps;
            handlersRef.current.onWrapChange(wraps);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Se monta una sola vez: el `value` se sincroniza en el efecto de abajo y el placeholder no cambia.
  }, []);

  // Sincroniza el documento cuando el `value` controlado cambia POR FUERA (limpiar al enviar, aceptar
  // una mejora, completar un comando). Si ya coincide no se toca: reemplazar el documento en cada
  // pulsacion tiraria el cursor al final.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: value.length },
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.contentDOM.setAttribute('aria-label', ariaLabel);
    viewRef.current?.contentDOM.setAttribute('role', 'textbox');
    viewRef.current?.contentDOM.setAttribute('aria-multiline', 'true');
    viewRef.current?.contentDOM.setAttribute('contenteditable', disabled ? 'false' : 'true');
  }, [ariaLabel, disabled]);

  useImperativeHandle(
    handleRef,
    () => ({
      focus: () => viewRef.current?.focus(),
      getTextState: () => {
        const view = viewRef.current;
        if (view === null) return { value: '', selectionStart: 0, selectionEnd: 0 };
        const { from, to } = view.state.selection.main;
        return { value: view.state.doc.toString(), selectionStart: from, selectionEnd: to };
      },
      applyTextState: (next) => {
        const view = viewRef.current;
        if (view === null) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next.value },
          selection: { anchor: next.selectionStart, head: next.selectionEnd },
        });
        view.focus();
      },
    }),
    [],
  );

  // `flex: 1 1 160px` y no `flex-1` (que es basis 0): con basis 0 el editor era el UNICO item elastico de
  // una fila donde los controles van `shrink-0`, asi que en una ventana estrecha se quedaba en 0 px de
  // ancho y el placeholder envolvia letra a letra — 562 px de contenido recortados al `max-height` del
  // editor, o sea una caja de 222 px vacia con los chips flotando en medio (reporte del usuario: "en
  // modo ventana mira como se ve el input"). Con 160 px de base, la fila —que ahora es `flex-wrap`—
  // baja los controles a la linea siguiente antes de estrujar el editor. `min-w-0` se queda: si ni eso
  // cabe, que encoja en vez de desbordar la barra.
  //
  // Apilado (P-026 3.1): la base es casi toda la fila (menos el `›` y el hueco), asi que los selectores
  // no caben detras y bajan a la siguiente. Sigue siendo HIJO DIRECTO de la fila: la comprobacion de
  // ventana pequena de `verify:gui` mide `host.parentElement`.
  return (
    <div
      ref={hostRef}
      className={`min-w-0 ${stacked ? 'flex-[1_1_calc(100%-2rem)]' : 'flex-[1_1_160px]'}`}
      data-prompt-editor="true"
      data-prompt-layout={stacked ? 'stacked' : 'inline'}
    />
  );
}
