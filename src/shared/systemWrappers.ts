// Clasificador PURO de los envoltorios de sistema que el CLI de Claude Code guarda como si fueran un
// mensaje del USUARIO (P-026, 1.6 / D20). Hasta ahora Mage los pintaba tal cual —una burbuja con
// `<command-name>/rename</command-name>…`— y los usaba de titulo de la conversacion.
//
// MEDIDO sobre las transcripciones reales de la maquina del usuario (2026-09-26, CLI 2.1.283):
//   - `<command-name>/x</command-name>` + `<command-message>` + `<command-args>` (a veces con
//     `<command-message>` delante): un comando local (`/rename`, `/effort`, `/model`…).
//   - `<local-command-stdout>…</local-command-stdout>`: su salida («Session renamed to: X»); puede
//     venir vacia. Tambien llega como linea `system/local_command`.
//   - `<local-command-caveat>…`: el aviso que el CLI antepone a un comando local (casi siempre `isMeta`).
//   - `<system-reminder>…`: contexto inyectado (casi siempre `isMeta`).
//   - `<scheduled-task name="n" file="…">…</scheduled-task>`: una tarea programada.
//   - `<task-notification>…<summary>…</summary>…`: el aviso de una tarea en segundo plano.
// Tolerante: lo que no reconoce, o un envoltorio sin su etiqueta de cierre, es `plain`.

export type SystemWrapper =
  | { readonly kind: 'plain' }
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'command-output'; readonly output: string }
  | { readonly kind: 'caveat' }
  | { readonly kind: 'reminder' }
  | { readonly kind: 'scheduled-task'; readonly name: string; readonly body: string }
  | { readonly kind: 'task-notification'; readonly summary: string };

const PLAIN: SystemWrapper = { kind: 'plain' };

export function classifySystemWrapper(text: string): SystemWrapper {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<')) return PLAIN;
  if (isWrapped(trimmed, 'local-command-caveat')) return { kind: 'caveat' };
  if (isWrapped(trimmed, 'system-reminder')) return { kind: 'reminder' };
  const output = innerOf(trimmed, 'local-command-stdout') ?? innerOf(trimmed, 'local-command-stderr');
  if (output !== null) return { kind: 'command-output', output: output.trim() };
  if (trimmed.startsWith('<command-name>') || trimmed.startsWith('<command-message>')) return commandFrom(trimmed);
  if (trimmed.startsWith('<scheduled-task')) return scheduledTaskFrom(trimmed);
  if (isWrapped(trimmed, 'task-notification')) {
    return { kind: 'task-notification', summary: (firstTag(trimmed, 'summary') ?? '').trim() };
  }
  return PLAIN;
}

// `/x` o `/x args`. Sin `<command-name>` bien cerrado no es un comando: se pinta tal cual.
function commandFrom(text: string): SystemWrapper {
  const name = firstTag(text, 'command-name')?.trim() ?? '';
  if (name.length === 0) return PLAIN;
  const args = firstTag(text, 'command-args')?.trim() ?? '';
  return { kind: 'command', command: args.length === 0 ? name : `${name} ${args}` };
}

const SCHEDULED_TASK = /^<scheduled-task\b([^>]*)>([\s\S]*)<\/scheduled-task>$/;
const NAME_ATTRIBUTE = /\bname="([^"]*)"/;

function scheduledTaskFrom(text: string): SystemWrapper {
  const match = SCHEDULED_TASK.exec(text);
  if (match === null) return PLAIN;
  const name = NAME_ATTRIBUTE.exec(match[1] ?? '')?.[1]?.trim() ?? '';
  return { kind: 'scheduled-task', name, body: (match[2] ?? '').trim() };
}

// El texto ENTERO es `<tag>…</tag>`.
function isWrapped(text: string, tag: string): boolean {
  return text.startsWith(`<${tag}>`) && text.endsWith(`</${tag}>`);
}

function innerOf(text: string, tag: string): string | null {
  return isWrapped(text, tag) ? text.slice(tag.length + 2, text.length - tag.length - 3) : null;
}

// Contenido de la PRIMERA `<tag>…</tag>` del texto; null si no esta o no cierra.
function firstTag(text: string, tag: string): string | null {
  const open = `<${tag}>`;
  const start = text.indexOf(open);
  if (start === -1) return null;
  const end = text.indexOf(`</${tag}>`, start + open.length);
  return end === -1 ? null : text.slice(start + open.length, end);
}
