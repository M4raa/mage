// Contrato de la tool `AskUserQuestion` del CLI (2.3). Vive en `shared` y no en el renderer porque el
// input es PROTOCOLO, no presentacion: lo usan el renderer (para pintar la tarjeta y construir la
// respuesta) y `main` (para el log). PURO: datos -> datos, sin FS ni DOM.
//
// Forma MEDIDA del control_request (no deducida del fuente):
//   {"subtype":"can_use_tool","tool_name":"AskUserQuestion","display_name":"AskUserQuestion",
//    "input":{"questions":[{"question":"¿Rojo o azul?","header":"Color",
//      "options":[{"label":"Rojo","description":"…"},{"label":"Azul","description":"…"}],
//      "multiSelect":false}]},
//    "tool_use_id":"toolu_…","requires_user_interaction":true}
//
// La RESPUESTA viaja en el propio input: `answers: Record<textoDeLaPregunta, respuesta>` (el esquema de
// la tool lo describe como "User answers collected by the permission component"; en multi-seleccion,
// las etiquetas separadas por comas). Se contesta `behavior:'allow'` con
// `updatedInput = {...input, answers}` — un `allow` a secas manda `{}` y el modelo recibe "no me han
// contestado", que es justo el sintoma que 2.3 viene a arreglar.
//
// POR QUE NO ZOD, siendo dato de la frontera: este modulo lo importa el RENDERER en runtime, y Zod no
// esta en su bundle (invariante medido en la Fase A: `grep zod out/renderer/assets` = 0). El dato ya
// paso ademas por `CanUseToolSchema` en main. Lo que queda aqui es una comprobacion de FORMA con guard
// clauses — que valida igual de estricto y no arrastra 100 KB al renderer.

export interface AskQuestionOption {
  readonly label: string;
  readonly description: string;
}

export interface AskQuestion {
  readonly question: string;
  readonly header: string;
  readonly options: readonly AskQuestionOption[];
  readonly multiSelect: boolean;
}

// Clave con la que la tool espera las respuestas dentro del input.
export const ASK_ANSWERS_KEY = 'answers';

// ¿Es este `input` una pregunta al usuario? Devuelve las preguntas normalizadas, o `null` si no lo es
// —y entonces el `can_use_tool` se pinta como el permiso normal que es—.
//
// Se decide por la FORMA del input y NO por `tool_name`: asi un renombrado de la tool no rompe nada, y
// una tool futura con `requires_user_interaction` pero sin `questions` cae, correctamente, en el panel
// de permiso. Cualquier pregunta mal formada invalida el conjunto: media tarjeta seria peor que
// ninguna, porque el usuario contestaria a algo que no es lo que le preguntaron.
export function parseAskUserQuestion(input: Readonly<Record<string, unknown>>): readonly AskQuestion[] | null {
  const rawQuestions = input.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null;
  const questions: AskQuestion[] = [];
  for (const raw of rawQuestions) {
    const question = toQuestion(raw);
    if (question === null) return null;
    questions.push(question);
  }
  return questions;
}

function toQuestion(raw: unknown): AskQuestion | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.question) || !isNonEmptyString(raw.header)) return null;
  if (!Array.isArray(raw.options) || raw.options.length === 0) return null;
  const options: AskQuestionOption[] = [];
  for (const rawOption of raw.options) {
    const option = toOption(rawOption);
    if (option === null) return null; // una opcion sin etiqueta no se puede ni pintar ni elegir
    options.push(option);
  }
  return { question: raw.question, header: raw.header, options, multiSelect: raw.multiSelect === true };
}

function toOption(raw: unknown): AskQuestionOption | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.label)) return null;
  return { label: raw.label, description: typeof raw.description === 'string' ? raw.description : '' };
}

// Construye el `answers` que espera la tool: clave = TEXTO de la pregunta (no el `header`: con el
// header el modelo recibe un mapa que no reconoce y responde como si no le hubieran contestado), valor
// = etiquetas elegidas separadas por comas.
//
// Contrato de error explicito (nunca un default silencioso): el numero de respuestas tiene que casar
// con el de preguntas y ninguna puede quedar vacia — mandar un `answers` a medias es peor que no
// mandarlo, porque el modelo lo da por bueno.
export function buildAnswers(
  questions: readonly AskQuestion[],
  chosen: readonly (readonly string[])[],
): Readonly<Record<string, string>> {
  if (questions.length !== chosen.length) {
    throw new Error(`Se esperaban ${questions.length} respuestas y llegaron ${chosen.length}`);
  }
  const answers: Record<string, string> = {};
  for (const [index, question] of questions.entries()) {
    const labels = (chosen[index] ?? []).map((label) => label.trim()).filter((label) => label.length > 0);
    if (labels.length === 0) {
      throw new Error(`Respuesta vacia para la pregunta ${JSON.stringify(question.question)}`);
    }
    answers[question.question] = labels.join(', ');
  }
  return answers;
}

// El `updatedInput` completo de la respuesta: el input ORIGINAL mas las respuestas. Se conserva el
// resto del input tal cual porque la tool lo vuelve a leer entero (las `questions` incluidas).
export function buildUpdatedInput(
  input: Readonly<Record<string, unknown>>,
  answers: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  return { ...input, [ASK_ANSWERS_KEY]: answers };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
