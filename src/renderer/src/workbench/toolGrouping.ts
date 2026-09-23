import { artifactCardFrom } from './artifactView';
import type { ToolClass } from './toolClassify';
import type { Block } from './types';

// Agrupacion de rachas de herramientas (2.12.2), la parte con mas decisiones de producto de la fase.
// PURA y de una sola pasada: corre en cada render del chat, dentro del `useMemo` que ya envuelve el
// filtrado, y el hilo puede tener cientos de bloques.
//
// Las reglas, tal cual las cerro el usuario:
//   - Agrupan TODAS las clases (cambio del 2026-09-18). Antes solo lectura y busqueda, y un turno de
//     veinte ediciones seguia empujando la respuesta fuera de la pantalla.
//   - El PENSAMIENTO agrupa con las tools (cambio del 2026-09-18): antes partia la racha en dos y un
//     turno normal se leia como tres lineas sueltas de la misma cosa.
//   - Ninguna tool CON ERROR agrupa, sea de la clase que sea: un fallo no se esconde en un resumen.
//   - Una tool que aun esta CORRIENDO tampoco agrupa: mientras no se sabe como acabo, se ve.
//   - Rompe la racha cualquier otra cosa del hilo (texto del agente, mensaje del usuario, linea de
//     sistema, pregunta, pensamiento, subagente o una tool no agrupable). Se preserva el ORDEN REAL:
//     un resumen nunca salta por encima de un parrafo del agente.
//   - Una racha de UNO no es una racha: se pinta como la caja normal.
//   - Con el TURNO VIVO, la ultima racha no se pliega: es la que se esta llenando, y verla llenarse es
//     el unico feedback de que el agente esta haciendo algo.

export type ChatRow =
  | { readonly kind: 'block'; readonly block: Block }
  // Racha de tools agrupables consecutivas (>= 2). `summary` ya viene formateado en castellano.
  | { readonly kind: 'run'; readonly id: string; readonly summary: string; readonly blocks: readonly Block[] };

type ToolBlock = Extract<Block, { kind: 'tool' }>;
type ThinkingBlock = Extract<Block, { kind: 'thinking' }>;
// Lo que puede esconderse dentro de una racha. El PENSAMIENTO entra desde el 2026-09-18: partia la
// racha en dos («Bash», «Pensó», «3 comandos» eran tres lineas de lo mismo) cuando para quien lee es
// una pieza mas de lo que el agente hizo mientras trabajaba.
type GroupableBlock = ToolBlock | ThinkingBlock;
// Clave de recuento: la clase de la tool, o `thinking` para el pensamiento (no es una tool y no tiene
// clase). Un solo tipo para no repartir el criterio entre dos mapas.
type RunKey = ToolClass | 'thinking';

// Minimo de cajas para que una racha exista. Con una sola no se gana nada y se esconde informacion.
const MIN_RUN_SIZE = 2;

// `turnActive` = el agente sigue trabajando en este chat. CAMBIA CUANDO se agrupa, que es lo que pidio
// el usuario el 2026-09-18: mientras trabaja, cada herramienta se ve APARECER una a una (es el unico
// feedback de que algo pasa); en cuanto termina y responde, todo lo que hizo se pliega a UNA linea.
// Antes se agrupaba en cuanto habia dos lecturas seguidas terminadas, o sea a mitad del turno, y lo
// que el agente estaba haciendo desaparecia de la vista justo mientras lo hacia.
export function groupChatRows(blocks: readonly Block[], turnActive = false): readonly ChatRow[] {
  const rows: ChatRow[] = [];
  let run: GroupableBlock[] = [];

  // Cierra la racha pendiente: como fila-resumen si llego a dos, o como cajas sueltas si no.
  const flush = (esLaUltima = false): void => {
    if (run.length === 0) return;
    // La racha del FINAL no se pliega mientras el turno sigue vivo: es justo la que se esta llenando.
    // Las anteriores si, porque el agente ya paso de ellas.
    const puedePlegarse = run.length >= MIN_RUN_SIZE && !(esLaUltima && turnActive);
    if (puedePlegarse) {
      rows.push({ kind: 'run', id: `run-${run[0]!.id}`, summary: describeRun(countByClass(run)), blocks: run });
    } else {
      for (const block of run) rows.push({ kind: 'block', block });
    }
    run = [];
  };

  for (const block of blocks) {
    if (isGroupable(block)) {
      run.push(block);
      continue;
    }
    flush();
    rows.push({ kind: 'block', block });
  }
  flush(true);
  return rows;
}

// ¿Puede esta caja esconderse dentro de un resumen? Dos condiciones, las dos de producto: sin error y
// ya terminada.
//
// La CLASE ya no decide (cambio del 2026-09-18, a peticion del usuario). Antes solo se agrupaban
// lectura y busqueda, y ediciones/comandos/subagentes se quedaban como lineas sueltas para siempre —
// con lo que un turno de veinte acciones seguia empujando la respuesta fuera de la pantalla, que era
// justo lo que la racha venia a evitar. Ahora se pliega TODO lo que el agente hizo, y quien quiera
// verlo lo despliega.
//
// Lo que NO se pliega nunca sigue siendo un error: tiene que verse sin abrir nada.
function isGroupable(block: Block): block is GroupableBlock {
  // Un pensamiento agrupa salvo mientras se esta escribiendo: igual que una tool en curso, lo que
  // esta pasando AHORA se ve.
  if (block.kind === 'thinking') return !block.streaming;
  if (block.kind !== 'tool') return false;
  if (block.isError) return false;
  if (block.meta.length === 0) return false; // todavia corriendo
  // Un artifact publicado se pinta como TARJETA (2.4), no como caja: es el entregable del turno, y
  // plegarlo dentro de un "3 acciones" lo hace desaparecer. Se pregunta a `artifactCardFrom`, que es
  // quien decide que es una tarjeta, para no tener el criterio escrito en dos sitios.
  if (artifactCardFrom(block) !== null) return false;
  // UNICA fuente de verdad de "que se puede plegar": tener etiqueta. Antes la lista de clases
  // agrupables y la de etiquetas eran dos sitios distintos y se desincronizaron — una racha de solo
  // ediciones dejaba `describeRun` sin partes, lanzaba dentro del `useMemo` de `BlockChat` y el chat
  // ENTERO dejaba de pintarse. Atandolo aqui, una clase sin etiqueta simplemente no agrupa: se pinta
  // como caja suelta, que es el peor caso aceptable, en vez de tumbar la conversacion.
  return RUN_LABELS.some((label) => label.key === block.toolClass);
}

function runKeyOf(block: GroupableBlock): RunKey {
  return block.kind === 'thinking' ? 'thinking' : block.toolClass;
}

function countByClass(blocks: readonly GroupableBlock[]): ReadonlyMap<RunKey, number> {
  const counts = new Map<RunKey, number>();
  for (const block of blocks) {
    const key = runKeyOf(block);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Etiquetas en castellano de cada clase agrupable, en singular y plural. Orden FIJO (lecturas antes
// que busquedas) para que el resumen no baile entre renders.
const RUN_LABELS: readonly { readonly key: RunKey; readonly one: string; readonly many: string }[] = [
  // El pensamiento va PRIMERO: cronologicamente suele abrir la racha y asi el resumen se lee como el
  // relato del turno ("1 pensamiento, 4 comandos").
  { key: 'thinking', one: '1 pensamiento', many: 'N pensamientos' },
  { key: 'read', one: 'Leído 1 fichero', many: 'Leídos N ficheros' },
  { key: 'search', one: '1 búsqueda', many: 'N búsquedas' },
  // Las tres de abajo entran con el cambio del 2026-09-18 (se agrupa TODO, no solo lectura y
  // busqueda). Sin ellas una racha de solo ediciones daba un resumen VACIO y `describeRun` lanzaba,
  // que es exactamente lo que paso: el chat entero dejo de pintarse. Lo cazo `pnpm verify:gui`.
  { key: 'edit', one: '1 edición', many: 'N ediciones' },
  { key: 'command', one: '1 comando', many: 'N comandos' },
  { key: 'subagent', one: '1 subagente', many: 'N subagentes' },
  // `other` es el cajon de sastre (MCP y cualquier tool que no case): tiene que tener etiqueta, o
  // vuelve el mismo fallo en cuanto alguien use un servidor MCP.
  { key: 'other', one: '1 acción', many: 'N acciones' },
];

// Texto de la linea-resumen: "Leídos 2 ficheros, 1 búsqueda".
export function describeRun(counts: ReadonlyMap<RunKey, number>): string {
  const parts: string[] = [];
  for (const label of RUN_LABELS) {
    const count = counts.get(label.key) ?? 0;
    if (count === 0) continue;
    parts.push(count === 1 ? label.one : label.many.replace('N', String(count)));
  }
  if (parts.length === 0) {
    // Inalcanzable por construccion (`isGroupable` exige etiqueta). Si aun asi pasa, el mensaje lleva
    // lo que llego: un error de presentacion sin el valor recibido no se puede diagnosticar.
    const recibido = [...counts.entries()].map(([key, count]) => `${String(key)}=${count}`).join(', ');
    throw new Error(`No se puede describir una racha sin herramientas conocidas (recibido: ${recibido || 'vacio'})`);
  }
  return parts.join(', ');
}
