import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { decorationRangesFor, type DecorationKind } from './promptDecorations';

// Todo lo especifico de CodeMirror 6 vive AQUI y en `PromptEditor.tsx`, en ningun otro sitio: la logica
// (que decorar, que hace Enter, que adjuntos valen) esta en modulos puros y testeados.
//
// Que NO se instala, y por que (medido en §0.2 del plan):
//   - `@codemirror/lang-markdown`: +345 kB para arrastrar los parsers de HTML/JS/CSS que Mage no usa, y
//     lo unico que justificaba el coste —un "Enter continua la lista" de regalo— ni siquiera se llama
//     como se supone (`insertNewlineContinueMarkup`), y Mage YA lo tiene escrito con 23 tests.
//   - `@codemirror/autocomplete`: el popover de "/" de Mage ya existe, esta verificado por el harness y
//     mira TODO el texto (no el token bajo el cursor). Cambiarlo seria un rediseño, no un port.
//   - `defaultKeymap` entero: colisiona con las cuatro teclas que Mage ya define (Enter, Tab,
//     Shift+Tab, Escape). Se instalan solo `standardKeymap` e `historyKeymap`.

// Clase CSS por tipo de decoracion. El estilo vive en `index.css` con los tokens del tema, para que
// conmute en claro/oscuro y en un tema importado como todo lo demas.
const CLASS_BY_KIND: Readonly<Record<DecorationKind, string>> = {
  bullet: 'cm-mg-bullet',
  'bullet-painted': 'cm-mg-bullet-painted',
  ordinal: 'cm-mg-ordinal',
  'marker-hidden': 'cm-mg-marker-hidden',
  'list-indent': 'cm-mg-list-indent',
  strong: 'cm-mg-strong',
  em: 'cm-mg-em',
  code: 'cm-mg-code',
  fence: 'cm-mg-fence',
  'heading-1': 'cm-mg-h1',
  'heading-2': 'cm-mg-h2',
  'heading-3': 'cm-mg-h3',
  'heading-4': 'cm-mg-h4',
  'heading-5': 'cm-mg-h5',
  'heading-6': 'cm-mg-h6',
};

// Construye las decoraciones del documento actual con el modulo PURO. `sort: true` porque
// `Decoration.set` exige orden por posicion y el modulo emite por lineas.
function buildDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const marks = decorationRangesFor(text, cursorLine).map((range) =>
    Decoration.mark({ class: CLASS_BY_KIND[range.kind] }).range(range.from, Math.min(range.to, text.length)),
  );
  return Decoration.set(marks, true);
}

const decorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      // Tambien al mover el cursor: de eso depende que el marcador de la linea editada se VEA.
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

// Tema del editor. El alto maximo es UNA regla CSS, no un efecto de JS: con el `<textarea>` habia un
// efecto que medía `scrollHeight` en cada tecla Y un `max-h-[200px]` en la clase, o sea el mismo numero
// escrito dos veces.
export const PROMPT_MAX_HEIGHT_PX = 200;

const promptTheme = EditorView.theme({
  '&': { fontSize: '12.5px', color: 'var(--color-mg-text)' },
  '.cm-content': { padding: '0', fontFamily: 'inherit', caretColor: 'var(--color-mg-text)' },
  '.cm-scroller': { maxHeight: `${PROMPT_MAX_HEIGHT_PX}px`, overflowY: 'auto', lineHeight: '1.55', fontFamily: 'inherit' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-placeholder': { color: 'var(--color-mg-muted)' },
});

export function promptExtensions(): readonly Extension[] {
  return [decorationsPlugin, promptTheme, EditorView.lineWrapping, EditorState.allowMultipleSelections.of(false)];
}
