import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder, type ViewUpdate } from '@codemirror/view';
import { Compartment, EditorState, Prec } from '@codemirror/state';
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
  // `userDeleted`: el cambio es un borrado del usuario (Backspace/Supr/borrar palabra), no un cortar ni un
  // cambio por programa. Con el la barra quita el adjunto de un `[Imagen N]` borrado (P-028 19b).
  readonly onChange: (value: string, userDeleted: boolean) => void;
  // Devuelve `true` si la tecla se ha consumido (entonces CodeMirror no la ve).
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
  readonly onPasteImages: (files: readonly File[]) => void;
  // El contenido pasa a ocupar mas (o menos) de una linea visual (P-026 3.1). Solo se llama al CAMBIAR.
  readonly onWrapChange: (wraps: boolean) => void;
  // Ancho en px del texto cuando cabe en UNA linea visual (sin saltos), o null si envuelve/esta vacio. Con
  // el decide la barra si puede volver a poner los selectores en linea (P-028 10). Solo se llama al CAMBIAR.
  readonly onTextWidthChange: (width: number | null) => void;
  // Selectores en su propia fila: el editor se queda con todo el ancho de la suya.
  readonly stacked: boolean;
  readonly handleRef: Ref<PromptEditorHandle>;
}

// Mas de una linea visual: la altura del contenido pasa de 1,5 lineas. Lo mide CodeMirror (valores ya
// calculados, O(1)): nada de medir el DOM a mano en cada tecla.
const WRAP_LINE_FACTOR = 1.5;

// `cut` tambien es un evento `delete.*`, pero NO borra el adjunto (el usuario puede pegar el token en otro
// sitio): se excluye.
function isUserDelete(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.isUserEvent('delete') && !tr.isUserEvent('delete.cut'));
}

// Ancho del texto si ocupa una sola linea logica y visual; null si esta vacio o tiene saltos de linea.
// `coordsAtPos` da la posicion en pantalla del final del documento (null si aun no esta pintado).
function singleLineTextWidth(view: EditorView): number | null {
  const doc = view.state.doc;
  if (doc.length === 0 || doc.lines > 1) return null;
  const end = view.coordsAtPos(doc.length);
  if (end === null) return null;
  return Math.ceil(end.right - view.contentDOM.getBoundingClientRect().left);
}

export function PromptEditor({
  value,
  placeholder,
  disabled,
  ariaLabel,
  onChange,
  onKeyDown,
  onPasteImages,
  onWrapChange,
  onTextWidthChange,
  stacked,
  handleRef,
}: PromptEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Los callbacks viven en una ref para que el editor se cree UNA vez: recrearlo en cada render
  // perderia el foco, el historial y el cursor a cada tecla.
  const handlersRef = useRef({ onChange, onKeyDown, onPasteImages, onWrapChange, onTextWidthChange });
  handlersRef.current = { onChange, onKeyDown, onPasteImages, onWrapChange, onTextWidthChange };
  const wrapsRef = useRef(false);
  const textWidthRef = useRef<number | null>(null);
  // El placeholder SI cambia (depende de `disabled`: «Abre una pestaña…» sin pestaña): va en su propio
  // compartimento para reconfigurarlo sin recrear el editor.
  const placeholderRef = useRef(new Compartment());

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...promptExtensions(),
          placeholderRef.current.of(cmPlaceholder(placeholder)),
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
            if (update.docChanged) handlersRef.current.onChange(update.state.doc.toString(), isUserDelete(update));
            if (!update.docChanged && !update.geometryChanged) return;
            // Con el documento vacio el que puede envolver es el PLACEHOLDER, no el texto del usuario: no cuenta.
            const wraps = update.state.doc.length > 0 && update.view.contentHeight > update.view.defaultLineHeight * WRAP_LINE_FACTOR;
            if (wraps !== wrapsRef.current) {
              wrapsRef.current = wraps;
              handlersRef.current.onWrapChange(wraps);
            }
            const width = wraps ? null : singleLineTextWidth(update.view);
            if (width === textWidthRef.current) return;
            textWidthRef.current = width;
            handlersRef.current.onTextWidthChange(width);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Se monta una sola vez: el `value` y el placeholder se sincronizan en los efectos de abajo.
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
      // Al volver a una pestaña el cursor (al final del borrador) tiene que quedar a la vista (P-028 9/13).
      scrollIntoView: true,
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: placeholderRef.current.reconfigure(cmPlaceholder(placeholder)) });
  }, [placeholder]);

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
          // Sin esto, el Enter que continua una lista en el tope de altura deja el cursor fuera de vista (P-028 9).
          scrollIntoView: true,
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
