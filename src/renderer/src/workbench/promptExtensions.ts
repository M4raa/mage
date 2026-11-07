import { EditorView, Decoration, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { findImageTokens } from '@shared/imageRefs';
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

// La viñeta como WIDGET que sustituye al `- ` (0.1.4). Con la marca `font-size: 0` + `::before` el `•` se perdía
// con el cursor justo delante o detrás. El rango es atómico, como `[Imagen N]`: el cursor lo salta y
// Backspace/Supr lo borran entero. El documento conserva el `- ` literal: lo enviado sigue siendo markdown.
class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const bullet = document.createElement('span');
    bullet.className = CLASS_BY_KIND['bullet-painted'];
    bullet.textContent = '•';
    return bullet;
  }
}

const bulletDecoration = Decoration.replace({ widget: new BulletWidget() });

export interface PromptDecorationSets {
  readonly all: DecorationSet;
  readonly atomic: DecorationSet; // solo las viñetas
}

function decorationFor(kind: DecorationKind): Decoration {
  return kind === 'bullet-painted' ? bulletDecoration : Decoration.mark({ class: CLASS_BY_KIND[kind] });
}

// Decoraciones del documento con el modulo PURO. `sort: true` porque `Decoration.set` exige orden por posicion y el
// modulo emite por lineas. Recibe el estado (no la vista) para poder probarse sin DOM.
export function buildPromptDecorations(state: EditorState): PromptDecorationSets {
  const text = state.doc.toString();
  const cursorLine = state.doc.lineAt(state.selection.main.head).number - 1;
  const ranges = decorationRangesFor(text, cursorLine);
  const all = ranges.map((range) => decorationFor(range.kind).range(range.from, Math.min(range.to, text.length)));
  const bullets = ranges.filter((range) => range.kind === 'bullet-painted').map((range) => bulletDecoration.range(range.from, Math.min(range.to, text.length)));
  return { all: Decoration.set(all, true), atomic: Decoration.set(bullets, true) };
}

const decorationsPlugin = ViewPlugin.fromClass(
  class {
    sets: PromptDecorationSets;

    constructor(view: EditorView) {
      this.sets = buildPromptDecorations(view.state);
    }

    update(update: ViewUpdate): void {
      // Tambien al mover el cursor: de eso depende que el marcador de la linea editada se VEA.
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.sets = buildPromptDecorations(update.state);
      }
    }
  },
  {
    decorations: (value) => value.sets.all,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.sets.atomic ?? Decoration.none),
  },
);

// `[Imagen N]` como BLOQUE (P-028 19b): una marca `cm-mg-imgref` y rango atomico, para que el cursor lo
// salte y Backspace/Supr lo borren entero. Quitar ademas el adjunto lo hace la barra al ver un borrado.
const imageRefMark = Decoration.mark({ class: 'cm-mg-imgref' });

function buildImageRefDecorations(view: EditorView): DecorationSet {
  const marks = findImageTokens(view.state.doc.toString()).map((token) => imageRefMark.range(token.from, token.to));
  return Decoration.set(marks);
}

const imageRefPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildImageRefDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.decorations = buildImageRefDecorations(update.view);
    }
  },
  {
    decorations: (value) => value.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
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
  return [decorationsPlugin, imageRefPlugin, promptTheme, EditorView.lineWrapping, EditorState.allowMultipleSelections.of(false)];
}
