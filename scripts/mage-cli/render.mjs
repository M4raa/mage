// Pintado de los eventos del host en la terminal (F7.3): evento -> texto para stdout, o `null` si no se pinta.
// Puro. `permission_request` y `elicitation_request` los trata el controlador, no esta tabla.

const RENDERERS = {
  stream_delta: (event) => event.text,
  tool_use: (event, m) => `\n${m.toolUse(event.tool.toolName)}\n`,
  result: (event, m) => `\n${m.turnEnded(event.result.subtype)}\n`,
  error: (event, m) => `${m.error(event.message ?? '')}\n`,
  notice: (event, m) => `${m.notice(event.text ?? '')}\n`,
  queue_changed: (event, m) => `${m.queueSize(event.queue.length)}\n`,
  queued_message_failed: (event, m) => `${m.queuedFailed(event.error ?? '')}\n`,
  permission_resolved: (event, m) => `${m.permissionAnswered(event.behavior)}\n`,
  background_expired: (_event, m) => `${m.expired()}\n`,
};

export function renderEvent(event, messages) {
  if (!Object.hasOwn(RENDERERS, event.kind)) return null;
  return RENDERERS[event.kind](event, messages);
}
