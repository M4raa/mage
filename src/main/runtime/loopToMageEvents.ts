import type { MageEvent } from '@shared/events';
import type { LoopEvent } from './agentLoop';

// Traduce un evento del bucle al modelo comun de Mage (tabla 4.4 de P-032), para que la UI no distinga
// una pestaña del runtime de una de un CLI. PURO.
export function loopToMageEvents(event: LoopEvent): MageEvent[] {
  switch (event.kind) {
    case 'request_started':
      return [{ kind: 'request_started' }];
    case 'text_delta':
      return [{ kind: 'stream_delta', text: event.text }];
    case 'text_done':
      return [{ kind: 'assistant_text', text: event.text }];
    case 'thinking_delta':
      return [{ kind: 'thinking_delta', text: event.text }];
    case 'tool_use':
      return [{ kind: 'tool_use', tool: { toolUseId: event.id, toolName: event.name, input: event.input } }];
    case 'tool_result':
      return [
        {
          kind: 'tool_result',
          result: {
            toolUseId: event.id,
            isError: event.isError,
            output: event.output,
            durationMs: event.durationMs,
            ...(event.file === undefined ? {} : { file: event.file }),
          },
        },
      ];
    case 'notice':
      return [{ kind: 'notice', text: event.text }];
    case 'round_done':
      // Contabilidad interna (transcripcion y presupuesto de contexto): no va a la UI.
      return [];
  }
}
