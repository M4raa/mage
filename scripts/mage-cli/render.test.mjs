import { describe, expect, it } from 'vitest';
import { createMessages } from './messages.mjs';
import { renderEvent } from './render.mjs';

const messages = createMessages('es');

describe('renderEvent', () => {
  it.each([
    [{ kind: 'stream_delta', text: 'hola' }, 'hola'],
    [{ kind: 'tool_use', tool: { toolName: 'Bash' } }, '\n[herramienta: Bash]\n'],
    [{ kind: 'result', result: { subtype: 'success' } }, '\n[fin del turno: success]\n'],
    [{ kind: 'error', message: 'roto' }, '[error] roto\n'],
    [{ kind: 'notice', text: 'ojo' }, '[aviso] ojo\n'],
    [{ kind: 'queue_changed', queue: [{ id: 'a' }, { id: 'b' }] }, '[cola: 2]\n'],
    [{ kind: 'queued_message_failed', error: 'no' }, '[no se pudo enviar desde la cola: no]\n'],
    [{ kind: 'permission_resolved', requestId: 'r', behavior: 'deny' }, '[permiso: denegado]\n'],
    [{ kind: 'background_expired' }, '[la sesión caducó en segundo plano]\n'],
    [{ kind: 'elicitation_request', request: {} }, '[hay una pregunta pendiente: contéstala en la ventana de Mage]\n'],
  ])('renderEvent_casos (%j)', (event, expected) => {
    expect(renderEvent(event, messages)).toBe(expected);
  });

  it('renderEvent_tipoDesconocido_null', () => {
    expect(renderEvent({ kind: 'inventado' }, messages)).toBeNull();
    expect(renderEvent({ kind: 'assistant_text' }, messages)).toBeNull();
    expect(renderEvent({ kind: 'toString' }, messages)).toBeNull();
  });

  it('renderEvent_permissionRequest_null', () => {
    expect(renderEvent({ kind: 'permission_request', request: {} }, messages)).toBeNull();
  });
});
