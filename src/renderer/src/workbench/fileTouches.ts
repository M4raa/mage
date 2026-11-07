import { z } from 'zod';

// Qué ficheros toca una herramienta y cómo (panel de Ficheros, 0.1.4). Se calcula UNA vez, al crear el bloque, a partir
// del nombre y la entrada de la herramienta: así el panel no vuelve a mirar entradas en cada render. Bash, Glob y Grep
// no cuentan: sus rutas no son fiables.

export type FileTouchAction = 'created' | 'edited' | 'read';

export interface FileTouch {
  readonly path: string;
  readonly action: FileTouchAction;
}

// Herramientas de un solo fichero: la clave de su entrada que lleva la ruta y lo que hacen con él. Las de agy, con los
// nombres y claves de su stream (medidos en sus registros: `TargetFile` al escribir/editar, `AbsolutePath` al leer).
const SINGLE_FILE_TOOLS: ReadonlyMap<string, { readonly key: string; readonly action: FileTouchAction }> = new Map([
  ['Write', { key: 'file_path', action: 'created' }],
  ['Edit', { key: 'file_path', action: 'edited' }],
  ['MultiEdit', { key: 'file_path', action: 'edited' }],
  ['NotebookEdit', { key: 'notebook_path', action: 'edited' }],
  ['Read', { key: 'file_path', action: 'read' }],
  ['write_to_file', { key: 'TargetFile', action: 'created' }],
  ['replace_file_content', { key: 'TargetFile', action: 'edited' }],
  ['multi_replace_file_content', { key: 'TargetFile', action: 'edited' }],
  ['view_file', { key: 'AbsolutePath', action: 'read' }],
]);

// `apply_patch` de Codex: alta = creado, actualización = editado (con su destino si se movió); un borrado no deja fichero.
const PATCH_CHANGE = z.object({ path: z.string(), kind: z.object({ type: z.string(), move_path: z.string().nullish() }).passthrough() }).passthrough();

function patchTouches(changes: unknown): readonly FileTouch[] {
  const parsed = z.array(PATCH_CHANGE).safeParse(changes);
  if (!parsed.success) return [];
  return parsed.data.flatMap((change): FileTouch[] => {
    if (change.kind.type === 'add') return [{ path: change.path, action: 'created' }];
    if (change.kind.type === 'update') return [{ path: change.kind.move_path ?? change.path, action: 'edited' }];
    return [];
  });
}

export function fileTouchesOf(toolName: string, input: Readonly<Record<string, unknown>>): readonly FileTouch[] {
  if (toolName === 'apply_patch') return patchTouches(input.changes);
  const tool = SINGLE_FILE_TOOLS.get(toolName);
  const raw = tool === undefined ? undefined : input[tool.key];
  if (tool === undefined || typeof raw !== 'string' || raw.trim().length === 0) return [];
  return [{ path: raw.trim(), action: tool.action }];
}

// Campo opcional del bloque (como `planText`): ausente si la herramienta no toca ningún fichero.
export function fileTouchesField(toolName: string, input: Readonly<Record<string, unknown>>): { readonly fileTouches?: readonly FileTouch[] } {
  const touches = fileTouchesOf(toolName, input);
  return touches.length === 0 ? {} : { fileTouches: touches };
}
