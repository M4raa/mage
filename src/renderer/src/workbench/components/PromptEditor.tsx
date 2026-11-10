import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder, type ViewUpdate } from '@codemirror/view';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { promptExtensions } from '../promptExtensions';
import type { TextState } from '../promptEditing';
import { withoutImageTokens } from '@shared/imageRefs';

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
  // Caja en pantalla del carácter en `pos` (null si aún no está pintado): ancla los popovers de `@` y `/` (P-038).
  coordsAt: (pos: number) => { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } | null;
}

export interface PromptEditorProps {
  readonly value: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly ariaLabel: string;
  // `userDeleted`: el cambio es un borrado del usuario (Backspace/Supr/borrar palabra), no un cortar ni un
  // cambio por programa. Con el la barra quita el adjunto de un `[Imagen N]` borrado (P-028 19b).
  readonly onChange: (value: string, userDeleted: boolean) => void;
  // La posicion del cursor (de la seleccion principal) cambia, por escribir o por moverse: el popover de menciones `@` la necesita sin esperar a una tecla.
  readonly onSelectionChange: (cursor: number) => void;
  // Devuelve `true` si la tecla se ha consumido (entonces CodeMirror no la ve).
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
  readonly onPasteImages: (files: readonly File[]) => void;
  readonly handleRef: Ref<PromptEditorHandle>;
}

// `cut` tambien es un evento `delete.*`, pero NO borra el adjunto (el usuario puede pegar el token en otro
// sitio): se excluye.
function isUserDelete(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.isUserEvent('delete') && !tr.isUserEvent('delete.cut'));
}

export function PromptEditor({
  value,
  placeholder,
  disabled,
  ariaLabel,
  onChange,
  onSelectionChange,
  onKeyDown,
  onPasteImages,
  handleRef,
}: PromptEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Los callbacks viven en una ref para que el editor se cree UNA vez: recrearlo en cada render
  // perderia el foco, el historial y el cursor a cada tecla.
  const handlersRef = useRef({ onChange, onSelectionChange, onKeyDown, onPasteImages });
  handlersRef.current = { onChange, onSelectionChange, onKeyDown, onPasteImages };
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
              paste: (event, view) => {
                const files = [...(event.clipboardData?.files ?? [])];
                if (files.length === 0) return false; // texto normal: que lo pegue CodeMirror
                event.preventDefault();
                // Texto e imágenes a la vez (un mensaje copiado con su imagen): el texto se pega sin sus tokens y
                // `onPasteImages` pone el de cada imagen que adjunta, en el cursor, detrás del texto.
                const text = withoutImageTokens(event.clipboardData?.getData('text/plain') ?? '');
                if (text.length > 0) view.dispatch(view.state.replaceSelection(text));
                handlersRef.current.onPasteImages(files);
                return true;
              },
            }),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlersRef.current.onChange(update.state.doc.toString(), isUserDelete(update));
            if (update.docChanged || update.selectionSet) handlersRef.current.onSelectionChange(update.state.selection.main.head);
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
      coordsAt: (pos) => {
        const view = viewRef.current;
        if (view === null || pos < 0 || pos > view.state.doc.length) return null;
        return view.coordsAtPos(pos);
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
      className="min-w-0 flex-1"
      data-prompt-editor="true"
    />
  );
}
